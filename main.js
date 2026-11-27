require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pino = require("pino");
const baileys = require("@whiskeysockets/baileys");
const database = require("./database/database");

const makeWASocket = baileys.default;
const { useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = baileys;

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const SESSION_DIR = path.join(DATA_DIR, "sessions");
const PAIRING_TIMEOUT_MS = 120000;
const MAX_RECONNECTS = 5;
const AI_MODEL = process.env.AI_MODEL || "claude-haiku-5-5";
const ADMIN_CODE = process.env.RICO_ADMIN_ACTIVATION_CODE;
const ADMIN_HASH = ADMIN_CODE ? crypto.createHash("sha256").update(ADMIN_CODE).digest() : null;
const PERIODS = { d: 864e5, w: 7 * 864e5, y: 365 * 864e5 };
const AI_SYSTEM = "أنت RICO AI، مساعد لمنصة RICO BOT. اتكلم عربي عادي زي الكلام اليومي بين الناس، بجمل قصيرة وواضحة. رد دايماً برسالة واحدة متصلة، من غير تقسيم لرسايل أو مقدمات طويلة، ومن غير قوائم إلا لو المستخدم طلبها. ساعد في تنصيب البوت وحل مشاكل الربط، ولو السؤال خارج الموضوع ساعد بقدر المستطاع.";

if (!ADMIN_CODE) {
  console.error("RICO_ADMIN_ACTIVATION_CODE is missing");
  process.exit(1);
}

fs.mkdirSync(SESSION_DIR, { recursive: true });

const logger = pino({ level: "silent" });
const db = database.load();
db.commands ||= {};
db.bannedUsers ||= [];
db.announcements ||= [];
db.support ||= [];

const sessions = new Map();    // phone -> { sock, status, reconnects, pairTimer }
const adminTokens = new Map(); // token -> expiresAt

/* ================= helpers ================= */

const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanPhone = v => String(v || "").replace(/\D/g, "").replace(/^0+/, "");
const isValidPhone = p => /^\d{7,15}$/.test(p);
const sessionPath = phone => path.join(SESSION_DIR, phone);
const isLinked = phone => sessions.get(phone)?.status === "linked";
const connectedCount = () => [...sessions.values()].filter(s => s.status === "linked").length;
const effectiveLimit = () => Math.max(0, db.installLimit + db.installAdjust);

let saveTimer = null;
function saveDatabase() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDatabase, 500);
}
function flushDatabase() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try { database.save(db); } catch (e) { console.error("DB SAVE ERROR", e.message); }
}

function recordCommand(cmd) {
  if (!cmd) return;
  const list = (db.commands[cmd] ||= []);
  list.push(Date.now());
  if (list.length > 1000) list.splice(0, list.length - 1000);
  saveDatabase();
}

function getCookie(req, name) {
  const m = (req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function isSecure(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

/* ================= الإضافات (plugins) ================= */

const PLUGINS_DIR = path.join(__dirname, "plugins");
const ADMIN_NUMBERS = String(process.env.RICO_ADMIN_NUMBERS || "")
  .split(",")
  .map(cleanPhone)
  .filter(Boolean);
const plugins = [];

// الإضافات المدمجة: رد السلام وأوامر الأدمن
const builtinPlugins = [
  {
    name: "greeting",
    match: text => /^(ال)?سلام/.test(text),
    run: async ctx => {
      await ctx.reply("وعليكم السلام ورحمة الله 👋");
    }
  },
  {
    name: "admin-stats",
    admin: true,
    commands: ["stats"],
    run: async ctx => {
      await ctx.reply(`الأرقام المتصلة: ${connectedCount()}\nالحد الأقصى: ${effectiveLimit()}`);
    }
  },
  {
    name: "admin-maintenance",
    admin: true,
    commands: ["maintenance"],
    run: async ctx => {
      db.maintenance = !db.maintenance;
      saveDatabase();
      await ctx.reply(db.maintenance ? "تم تفعيل وضع الصيانة" : "تم إيقاف وضع الصيانة");
    }
  }
];

// تحميل كل ملفات فولدر plugins تلقائياً
// كل ملف يصدّر كائن أو مصفوفة كائنات بالشكل ده:
// { name, admin?, commands?: ["cmd"], match?: (text, ctx) => bool, run: async ctx => {} }
function loadPlugins() {
  plugins.length = 0;
  plugins.push(...builtinPlugins);

  if (!fs.existsSync(PLUGINS_DIR)) {
    console.log("PLUGINS DIR NOT FOUND, using built-in only");
    return;
  }

  for (const file of fs.readdirSync(PLUGINS_DIR)) {
    if (!file.endsWith(".js")) continue;
    const full = path.join(PLUGINS_DIR, file);
    try {
      delete require.cache[require.resolve(full)];
      const mod = require(full);
      const list = Array.isArray(mod) ? mod : [mod];
      for (const p of list) {
        if (p && typeof p.run === "function") plugins.push({ file, ...p });
      }
    } catch (e) {
      console.error("PLUGIN LOAD ERROR", file, e.message);
    }
  }
  console.log("PLUGINS LOADED", plugins.length);
}

function getMessageText(m) {
  const msg = m.message || {};
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    ""
  ).trim();
}

async function handleIncoming(sock, { messages, type }) {
  if (type !== "notify") return;

  for (const m of messages) {
    if (m.key.fromMe) continue;

    const jid = m.key.remoteJid;
    if (!jid || jid === "status@broadcast") continue;

    const sender = cleanPhone(m.key.participant || jid);
    if (db.bannedUsers.includes(sender)) continue;

    const text = getMessageText(m);
    if (!text) continue;

    const isAdmin = ADMIN_NUMBERS.includes(sender);
    const firstWord = text.split(/\s+/)[0];
    const isCommand = firstWord.startsWith(".") || firstWord.startsWith("!");
    const cmdName = isCommand ? firstWord.slice(1).toLowerCase() : "";
    const args = text.split(/\s+/).slice(1);

    const ctx = {
      sock,
      jid,
      msg: m,
      text,
      sender,
      args,
      isAdmin,
      reply: t => sock.sendMessage(jid, { text: t }, { quoted: m })
    };

    for (const plugin of plugins) {
      if (plugin.admin && !isAdmin) continue;

      let matched = false;
      if (typeof plugin.match === "function") {
        matched = !!plugin.match(text, ctx);
      } else if (Array.isArray(plugin.commands)) {
        matched = isCommand && plugin.commands.includes(cmdName);
      }
      if (!matched) continue;

      try {
        await plugin.run(ctx);
      } catch (e) {
        console.error("PLUGIN RUN ERROR", plugin.name || plugin.file, e.message);
      }
      break; // أول إضافة تطابق بترد وخلاص
    }
  }
}

/* ================= WhatsApp sessions ================= */

async function createSocket(phone) {
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath(phone));
  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    logger,
    browser: ["Ubuntu", "Chrome", "22.0.04"],
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      if (m.key.fromMe) continue;
      const text = m.message?.conversation || m.message?.extendedTextMessage?.text || "";
      if (text.startsWith(".") || text.startsWith("!")) {
        recordCommand(text.trim().split(/\s+/)[0].slice(1).toLowerCase());
      }
    }
  });

  // الإضافة الجديدة: توجيه الرسائل للـ plugins
  sock.ev.on("messages.upsert", ev => {
    handleIncoming(sock, ev).catch(e => console.error("HANDLER ERROR", e.message));
  });

  return sock;
}

function attachConnectionEvents(phone, sock) {
  sock.ev.on("connection.update", update => {
    const current = sessions.get(phone);
    if (!current || current.sock !== sock) return; // socket قديم، نتجاهله

    const { connection, lastDisconnect } = update;
    const statusCode = lastDisconnect?.error?.output?.statusCode;

    console.log("CONNECTION UPDATE", JSON.stringify({
      phone,
      connection,
      statusCode,
      message: lastDisconnect?.error?.message
    }));

    if (connection === "open") {
      current.status = "linked";
      current.reconnects = 0;
      clearTimeout(current.pairTimer);
      db.totalConnections++;
      saveDatabase();
      console.log("LINKED", phone);
      return;
    }

    if (connection === "close") {
      if (statusCode === DisconnectReason.loggedOut) {
        console.log("LOGGED OUT", phone);
        if (current.status === "pending") db.failedConnections++;
        destroySession(phone, true);
        saveDatabase();
        return;
      }

      if (current.reconnects >= MAX_RECONNECTS) {
        console.log("RECONNECT LIMIT", phone);
        db.failedConnections++;
        destroySession(phone, false);
        saveDatabase();
        return;
      }

      const delay = Math.min(2000 * 2 ** current.reconnects, 30000);
      setTimeout(() => {
        const now = sessions.get(phone);
        if (!now || now.sock !== sock) return;
        startSession(phone, now.status, now.reconnects + 1).catch(e =>
          console.error("RECONNECT ERROR", phone, e.message)
        );
      }, delay);
    }
  });
}

async function startSession(phone, status = "pending", reconnects = 0) {
  const sock = await createSocket(phone);
  const previous = sessions.get(phone);
  if (previous?.pairTimer) clearTimeout(previous.pairTimer);

  sessions.set(phone, { sock, status, reconnects, pairTimer: null });
  attachConnectionEvents(phone, sock);

  try { previous?.sock?.end(undefined); } catch {}
  return sessions.get(phone);
}

function destroySession(phone, removeFiles) {
  const entry = sessions.get(phone);
  if (entry) {
    clearTimeout(entry.pairTimer);
    sessions.delete(phone);
    try { entry.sock?.end(undefined); } catch {}
  }
  if (removeFiles) {
    fs.rmSync(sessionPath(phone), { recursive: true, force: true });
  }
}

async function restoreAllSessions() {
  for (const name of fs.readdirSync(SESSION_DIR)) {
    const phone = cleanPhone(name);
    if (!isValidPhone(phone) || phone !== name) continue;
    if (!fs.existsSync(path.join(sessionPath(phone), "creds.json"))) continue;
    try {
      await startSession(phone, "pending");
      console.log("RESTORED", phone);
    } catch (e) {
      console.error("RESTORE ERROR", phone, e.message);
    }
  }
}

/* ================= app ================= */

const app = express();
app.use(express.json({ limit: "100kb" }));

// CORS عشان الصفحة لو على دومين تاني
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ملفات الواجهة (CSS / JS / صور) من فولدر public
app.use(express.static(path.join(__dirname, "public")));

// الصفحة الرئيسية: public/index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function requireAdmin(req, res, next) {
  const token = getCookie(req, "rico_admin");
  const exp = token && adminTokens.get(token);
  if (!exp || exp < Date.now()) {
    if (token) adminTokens.delete(token);
    return res.status(401).json({ message: "سجل دخول من جديد" });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [token, exp] of adminTokens) if (exp < now) adminTokens.delete(token);
}, 60 * 60 * 1000);

/* ----- عام ----- */

app.get("/api/health", (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), sessions: sessions.size });
});

app.get("/api/public", (req, res) => {
  res.json({ maintenance: db.maintenance, available: Math.max(0, effectiveLimit() - sessions.size) });
});

app.get("/api/stats", (req, res) => {
  res.json({ users: connectedCount() });
});

app.get("/api/status", (req, res) => {
  const phone = cleanPhone(req.query.number);
  res.json({ linked: isValidPhone(phone) && isLinked(phone) });
});

app.get("/api/pair/status", (req, res) => {
  const phone = cleanPhone(req.query.number);
  res.json({ linked: isValidPhone(phone) && isLinked(phone) });
});

app.post("/api/pair", async (req, res) => {
  try {
    const phone = cleanPhone(req.body?.phone || req.body?.number);
    if (!isValidPhone(phone)) {
      return res.status(400).json({ success: false, message: "الرقم غير صحيح" });
    }
    if (db.maintenance) {
      return res.status(503).json({ success: false, message: "السيرفر في وضع الصيانة حالياً" });
    }
    if (db.bannedUsers.includes(phone)) {
      return res.status(403).json({ success: false, message: "الرقم محظور" });
    }
    if (isLinked(phone)) {
      return res.status(409).json({ success: false, message: "الرقم مرتبط بالفعل" });
    }
    if (!sessions.has(phone) && sessions.size >= effectiveLimit()) {
      return res.status(429).json({ success: false, message: "وصلنا للحد الأقصى من التنصيبات" });
    }

    await startSession(phone, "pending");
    await sleep(2500);

    const sock = sessions.get(phone)?.sock;
    if (!sock) throw new Error("session lost");

    const code = await sock.requestPairingCode(phone);
    console.log("PAIR CODE GENERATED", phone, code);

    const current = sessions.get(phone);
    if (current?.sock === sock) {
      current.pairTimer = setTimeout(() => {
        if (sessions.get(phone)?.status !== "linked") {
          console.log("PAIR TIMEOUT", phone);
          db.failedConnections++;
          saveDatabase();
          destroySession(phone, true);
        }
      }, PAIRING_TIMEOUT_MS);
    }

    res.json({ success: true, code });

  } catch (e) {
    console.error("PAIR ERROR", e.message);
    db.failedConnections++;
    saveDatabase();
    res.status(500).json({ success: false, message: "تعذر توليد الكود، حاول مرة تانية" });
  }
});

app.post("/api/reconnect", async (req, res) => {
  try {
    const phone = cleanPhone(req.body?.phone || req.body?.number);
    if (!isValidPhone(phone)) return res.status(400).json({ success: false, message: "الرقم غير صحيح" });
    if (isLinked(phone)) return res.json({ success: true, message: "متصل بالفعل" });
    if (!fs.existsSync(path.join(sessionPath(phone), "creds.json"))) {
      return res.status(404).json({ success: false, message: "ما فيش جلسة محفوظة لهذا الرقم" });
    }
    await startSession(phone, "pending");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: "فشل إعادة الاتصال" });
  }
});

app.post("/api/support", (req, res) => {
  const msg = String(req.body?.msg || "").trim().slice(0, 2000);
  if (!msg) return res.status(400).json({ success: false, message: "اكتب المشكلة" });
  db.support.push({
    msg,
    contact: String(req.body?.contact || "").slice(0, 200),
    at: new Date().toISOString()
  });
  saveDatabase();
  res.json({ success: true });
});

app.post("/api/ai", async (req, res) => {
  const text = String(req.body?.text || "").trim().slice(0, 2000);
  if (!text) return res.status(400).json({ success: false, message: "اكتب سؤالك" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ success: false, message: "الذكاء الاصطناعي غير مفعل" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 700,
        system: AI_SYSTEM,
        messages: [{ role: "user", content: text }]
      })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || "anthropic error");
    // نجمع كل الأجزاء في فقرة واحدة عشان الرد يطلع رسالة واحدة بس
    const reply = (d.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join(" ")
      .replace(/\s*\n+\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    res.json({ success: true, reply: reply || "ما قدرت أرد، جرب تاني." });
  } catch (e) {
    console.error("AI ERROR", e.message);
    res.status(502).json({ success: false, message: "تعذر الرد الآن، حاول بعد شوية" });
  }
});

/* ----- المطور ----- */

app.post("/api/developer/login", (req, res) => {
  const hash = crypto.createHash("sha256").update(String(req.body?.password || "")).digest();
  if (!crypto.timingSafeEqual(hash, ADMIN_HASH)) {
    return res.status(401).json({ message: "الكود غلط" });
  }
  const token = crypto.randomBytes(32).toString("hex");
  const maxAge = 12 * 60 * 60 * 1000;
  adminTokens.set(token, Date.now() + maxAge);

  const secure = isSecure(req);
  res.cookie("rico_admin", token, {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    maxAge
  });
  res.json({ success: true });
});

app.post("/api/developer/logout", (req, res) => {
  const token = getCookie(req, "rico_admin");
  if (token) adminTokens.delete(token);
  res.clearCookie("rico_admin", { httpOnly: true, sameSite: "none", secure: true });
  res.json({ success: true });
});

app.get("/api/developer/stats", requireAdmin, (req, res) => {
  res.json({
    users: sessions.size,
    connected: connectedCount(),
    failed: db.failedConnections,
    limit: effectiveLimit(),
    banned: db.bannedUsers.length,
    maintenance: db.maintenance
  });
});

app.post("/api/developer/limit", requireAdmin, (req, res) => {
  const n = Number(req.body?.limit);
  if (!Number.isInteger(n) || n < 1) return res.status(400).json({ message: "الحد لازم رقم صحيح أكبر من صفر" });
  db.installLimit = n;
  saveDatabase();
  res.json({ success: true });
});

app.post("/api/developer/adjust", requireAdmin, (req, res) => {
  const delta = Number(req.body?.delta);
  if (!Number.isInteger(delta)) return res.status(400).json({ message: "القيمة غلط" });
  db.installAdjust += delta;
  saveDatabase();
  res.json({ success: true });
});

app.post("/api/developer/maintenance", requireAdmin, (req, res) => {
  db.maintenance = Boolean(req.body?.on);
  saveDatabase();
  res.json({ success: true, maintenance: db.maintenance });
});

app.post("/api/developer/ban", requireAdmin, (req, res) => {
  const phone = cleanPhone(req.body?.phone);
  if (!isValidPhone(phone)) return res.status(400).json({ message: "الرقم غير صحيح" });
  if (!db.bannedUsers.includes(phone)) db.bannedUsers.push(phone);
  destroySession(phone, true);
  saveDatabase();
  res.json({ success: true });
});

app.post("/api/developer/unban", requireAdmin, (req, res) => {
  const phone = cleanPhone(req.body?.phone);
  db.bannedUsers = db.bannedUsers.filter(p => p !== phone);
  saveDatabase();
  res.json({ success: true });
});

app.post("/api/developer/announce", requireAdmin, async (req, res) => {
  const text = String(req.body?.announcement || "").trim().slice(0, 2000);
  if (!text) return res.status(400).json({ message: "اكتب الإعلان" });

  let sent = 0;
  for (const [phone, entry] of sessions) {
    if (entry.status !== "linked") continue;
    try {
      await entry.sock.sendMessage(`${phone}@s.whatsapp.net`, { text });
      sent++;
    } catch (e) {
      console.error("ANNOUNCE ERROR", phone, e.message);
    }
  }

  db.announcements.push({ text, sent, at: new Date().toISOString() });
  saveDatabase();
  res.json({ success: true, sent });
});

app.get("/api/developer/commands", requireAdmin, (req, res) => {
  const span = PERIODS[req.query.period] || PERIODS.d;
  const since = Date.now() - span;
  const rows = Object.entries(db.commands)
    .map(([cmd, times]) => [cmd, times.filter(t => t >= since).length])
    .filter(r => r[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  res.json(rows);
});

app.get("/api/developer/numbers", requireAdmin, (req, res) => {
  const rows = [...sessions].map(([phone, entry]) => ({
    number: phone,
    status: entry.status === "linked" ? "متصل" : "قيد الربط",
    banned: db.bannedUsers.includes(phone)
  }));
  res.json(rows);
});

/* ================= التشغيل ================= */

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`RICO server running on port ${PORT}`);
  loadPlugins();
  restoreAllSessions().catch(e => console.error("RESTORE ALL ERROR", e.message));
});

function shutdown() {
  flushDatabase();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", e => console.error("UNHANDLED", e?.message || e));
