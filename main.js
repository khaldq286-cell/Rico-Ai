require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "database");
const SESSION_DIR = process.env.SESSION_DIR || path.join(__dirname, "sessions");
const DB_FILE = path.join(DATA_DIR, "database.json");
const PAIR_CODE = process.env.PAIRING_CODE || "RICO2010";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const ADMIN_CODE = process.env.RICO_ADMIN_ACTIVATION_CODE;
if (!ADMIN_CODE) {
  console.error("RICO_ADMIN_ACTIVATION_CODE is missing");
  process.exit(1);
}

const sessions = new Map();
const adminTokens = new Map();
const logger = pino({ level: "silent" });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let db = {
  installLimit: Number(process.env.INSTALL_LIMIT || 100),
  installAdjust: 0,
  maintenance: false,
  bannedUsers: [],
  totalConnections: 0,
  failedConnections: 0,
  announcements: [],
  commands: {}
};

// ================= DATABASE =================

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
    }
  } catch (error) {
    console.error("DATABASE ERROR:", error.message);
  }
}

function saveDatabase() {
  try {
    const temp = DB_FILE + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(db, null, 2));
    fs.renameSync(temp, DB_FILE);
  } catch (error) {
    console.error("DATABASE SAVE ERROR:", error.message);
  }
}

loadDatabase();

// ================= HELPERS =================

function cleanPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function validPhone(phone) {
  return /^\d{8,15}$/.test(phone);
}

function getToken(req) {
  const match = (req.headers.cookie || "").match(/(?:^|;\s*)rico_admin=([^;]+)/);
  return match ? match[1] : null;
}

function requireAdmin(req, res, next) {
  const token = getToken(req);
  const expires = token ? adminTokens.get(token) : null;

  if (!expires || expires < Date.now()) {
    if (token) adminTokens.delete(token);
    return res.status(401).json({ success: false, message: "سجل دخول المطور من جديد" });
  }
  next();
}

function recordCommand(cmd) {
  const day = new Date().toISOString().slice(0, 10);
  db.commands[day] = db.commands[day] || {};
  db.commands[day][cmd] = (db.commands[day][cmd] || 0) + 1;

  const days = Object.keys(db.commands).sort();
  days.slice(0, Math.max(0, days.length - 400)).forEach(d => delete db.commands[d]);
  saveDatabase();
}

function topCommands(period) {
  const span = period === "y" ? 365 : period === "w" ? 7 : 1;
  const total = {};

  for (let i = 0; i < span; i++) {
    const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    for (const [cmd, n] of Object.entries(db.commands[day] || {})) {
      total[cmd] = (total[cmd] || 0) + n;
    }
  }

  return Object.entries(total).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

// ================= WHATSAPP (Baileys) =================

// ضع أوامر البوت هنا. الدالة بتاخد (sock, message, phone)
let commandHandler = async (sock, m, phone) => {
  const msg = m.message || {};
  const text = msg.conversation || msg.extendedTextMessage?.text || "";

  if (text.trim() === ".menu" || text.trim() === ".قائمة") {
    await sock.sendMessage(m.key.remoteJid, {
      text: "أقسام RICO BOT:\n• إسلاميات\n• إدارة\n• ألعاب\n• تعديل"
    }, { quoted: m });
  }
};

async function createSocket(authPath) {
  const { state, saveCreds } = await useMultiFileAuthState(authPath);

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {}

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const phone = path.basename(authPath);

    for (const m of messages) {
      if (!m.message || m.key.fromMe) continue;

      const text = m.message.conversation || m.message.extendedTextMessage?.text || "";
      if (text.startsWith(".")) recordCommand("." + text.slice(1).trim().split(/\s+/)[0]);

      try {
        await commandHandler(sock, m, phone);
      } catch (error) {
        console.error("COMMAND ERROR:", error.message);
      }
    }
  });

  return { sock, state, DisconnectReason };
}

async function connectWhatsApp(phone, sessionDir) {
  const authPath = path.join(sessionDir, phone);
  const result = await createSocket(authPath);

  if (!result.state.creds.registered) {
    await sleep(2500);
    const code = await result.sock.requestPairingCode(phone, PAIR_CODE);
    return { ...result, code };
  }

  throw new Error("الرقم دا منصب أصلاً");
}

// ================= SESSIONS =================

function attachSocketEvents(phone, session, authPath) {
  const sock = session.sock;

  sock.ev.on("connection.update", async update => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      if (session.status !== "connected") {
        db.totalConnections++;
        saveDatabase();
      }
      session.status = "connected";
      session.retryCount = 0;
      console.log("RICO CONNECTED:", phone);
    }

    if (connection === "close") {
      session.status = "disconnected";

      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        sessions.delete(phone);
        fs.rmSync(authPath, { recursive: true, force: true });
        return;
      }

      if (sessions.get(phone) !== session || session.reconnectTimer) return;

      session.retryCount++;
      if (session.retryCount > 5) {
        console.log("RECONNECT LIMIT:", phone);
        return;
      }

      session.reconnectTimer = setTimeout(async () => {
        session.reconnectTimer = null;
        if (sessions.get(phone) !== session) return;

        try {
          session.status = "connecting";
          const result = await createSocket(authPath);
          session.sock = result.sock;
          session.state = result.state;
          attachSocketEvents(phone, session, authPath);
        } catch (error) {
          console.error("RECONNECT ERROR:", error.message);
          session.status = "disconnected";
        }
      }, Math.min(3000 * session.retryCount, 15000));
    }
  });
}

function isRegistered(phone) {
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, phone, "creds.json"), "utf8"));
    return creds.registered === true;
  } catch {
    return false;
  }
}

// التنصيب التلقائي: بيرجّع الجلسة المحفوظة
async function restoreSession(phone) {
  const authPath = path.join(SESSION_DIR, phone);
  const session = {
    sock: null,
    state: null,
    status: "connecting",
    retryCount: 0,
    reconnectTimer: null,
    createdAt: Date.now()
  };

  sessions.set(phone, session);
  const result = await createSocket(authPath);
  session.sock = result.sock;
  session.state = result.state;
  attachSocketEvents(phone, session, authPath);
}

async function restoreAllSessions() {
  let folders = [];
  try {
    folders = fs.readdirSync(SESSION_DIR);
  } catch {}

  const phones = folders.filter(p => validPhone(p) && isRegistered(p) && !db.bannedUsers.includes(p));
  console.log("RESTORING SESSIONS:", phones.length);

  for (const phone of phones) {
    try {
      await restoreSession(phone);
    } catch (error) {
      console.error("RESTORE ERROR:", phone, error.message);
    }
    await sleep(1500);
  }
}

// ================= HOME =================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/public", (req, res) => {
  res.json({ maintenance: db.maintenance });
});

// إحصائيات عامة للصفحة الرئيسية (بدون بيانات حساسة)
app.get("/api/stats", (req, res) => {
  res.json({
    users: sessions.size,
    connections: db.totalConnections,
    failed: db.failedConnections,
    limit: db.installLimit + db.installAdjust
  });
});

// ================= PAIRING =================

app.post("/api/pair", async (req, res) => {
  const phone = cleanPhone(req.body.phone);

  if (!validPhone(phone)) {
    return res.status(400).json({ success: false, message: "رقم الهاتف غير صحيح" });
  }
  if (db.maintenance) {
    return res.status(503).json({ success: false, message: "المنصة في وضع الصيانة حاليًا" });
  }
  if (db.bannedUsers.includes(phone)) {
    return res.status(403).json({ success: false, message: "هذا الرقم محظور" });
  }
  if (sessions.has(phone)) {
    return res.status(409).json({ success: false, message: "يوجد طلب ربط لهذا الرقم" });
  }
  if (sessions.size >= db.installLimit + db.installAdjust) {
    return res.status(403).json({ success: false, message: "تم الوصول إلى حد التنصيب" });
  }

  const authPath = path.join(SESSION_DIR, phone);
  const session = {
    sock: null,
    state: null,
    status: "connecting",
    retryCount: 0,
    reconnectTimer: null,
    createdAt: Date.now()
  };
  sessions.set(phone, session);

  try {
    const result = await connectWhatsApp(phone, SESSION_DIR);
    session.sock = result.sock;
    session.state = result.state;
    attachSocketEvents(phone, session, authPath);

    return res.json({ success: true, code: result.code, expiresIn: 60, message: "أدخل كود الربط في واتساب" });
  } catch (error) {
    console.error("PAIR ERROR:", error.message);
    db.failedConnections++;
    saveDatabase();

    sessions.delete(phone);
    try { session.sock?.end(undefined); } catch {}

    return res.status(500).json({ success: false, message: "تعذر طلب كود الاقتران", error: error.message });
  }
});

app.get("/api/pair/status", (req, res) => {
  const session = sessions.get(cleanPhone(req.query.phone));
  res.json({ status: session ? session.status : "not_found" });
});

app.post("/api/reconnect", async (req, res) => {
  const phone = cleanPhone(req.body.phone);

  if (!validPhone(phone) || !isRegistered(phone)) {
    return res.status(404).json({ success: false, message: "الرقم دا ما منصب، اضغط تنصيب" });
  }
  if (db.bannedUsers.includes(phone)) {
    return res.status(403).json({ success: false, message: "هذا الرقم محظور" });
  }

  try {
    const old = sessions.get(phone);
    try { old?.sock?.end(undefined); } catch {}
    sessions.delete(phone);

    await restoreSession(phone);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false, message: "تعذر إعادة الاتصال" });
  }
});

// ================= DEVELOPER LOGIN =================

app.post("/api/developer/login", (req, res) => {
  const password = String(req.body.password || "");
  const inputHash = crypto.createHash("sha256").update(password).digest();
  const adminHash = crypto.createHash("sha256").update(ADMIN_CODE).digest();

  if (!password || !crypto.timingSafeEqual(inputHash, adminHash)) {
    return res.status(401).json({ success: false, message: "كود التفعيل غير صحيح" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  adminTokens.set(token, Date.now() + 8 * 60 * 60 * 1000);

  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader(
    "Set-Cookie",
    `rico_admin=${token}; HttpOnly; ${secure ? "Secure;" : ""} SameSite=Lax; Path=/; Max-Age=28800`
  );
  res.json({ success: true });
});

app.post("/api/developer/logout", requireAdmin, (req, res) => {
  adminTokens.delete(getToken(req));
  res.setHeader("Set-Cookie", "rico_admin=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ success: true });
});

// ================= DEVELOPER PANEL =================

app.get("/api/developer/stats", requireAdmin, (req, res) => {
  const connected = [...sessions.values()].filter(s => s.status === "connected").length;
  res.json({
    users: sessions.size,
    connected,
    connections: db.totalConnections,
    failed: db.failedConnections,
    limit: db.installLimit + db.installAdjust,
    banned: db.bannedUsers.length,
    maintenance: db.maintenance
  });
});

app.post("/api/developer/limit", requireAdmin, (req, res) => {
  const limit = Number(req.body.limit);
  if (!Number.isInteger(limit) || limit < 1) {
    return res.status(400).json({ success: false, message: "الحد غير صحيح" });
  }
  db.installLimit = limit;
  saveDatabase();
  res.json({ success: true, limit });
});

app.post("/api/developer/adjust", requireAdmin, (req, res) => {
  db.installAdjust += parseInt(req.body.delta, 10) || 0;
  saveDatabase();
  res.json({ success: true, limit: db.installLimit + db.installAdjust });
});

app.post("/api/developer/maintenance", requireAdmin, (req, res) => {
  db.maintenance = !!req.body.on;
  saveDatabase();
  res.json({ success: true, maintenance: db.maintenance });
});

app.get("/api/developer/numbers", requireAdmin, (req, res) => {
  res.json([...sessions.entries()].map(([phone, s]) => ({
    number: phone,
    status: s.status,
    banned: db.bannedUsers.includes(phone)
  })));
});

app.get("/api/developer/commands", requireAdmin, (req, res) => {
  res.json(topCommands(req.query.period));
});

app.post("/api/developer/ban", requireAdmin, (req, res) => {
  const phone = cleanPhone(req.body.phone);
  if (!validPhone(phone)) {
    return res.status(400).json({ success: false, message: "رقم الهاتف غير صحيح" });
  }

  if (!db.bannedUsers.includes(phone)) {
    db.bannedUsers.push(phone);
    saveDatabase();
  }

  const s = sessions.get(phone);
  if (s) {
    try { s.sock?.end(undefined); } catch {}
    sessions.delete(phone);
  }
  res.json({ success: true });
});

app.post("/api/developer/unban", requireAdmin, (req, res) => {
  const phone = cleanPhone(req.body.phone);
  db.bannedUsers = db.bannedUsers.filter(x => x !== phone);
  saveDatabase();

  if (isRegistered(phone) && !sessions.has(phone)) {
    restoreSession(phone).catch(() => {});
  }
  res.json({ success: true });
});

app.post("/api/developer/announce", requireAdmin, async (req, res) => {
  const message = String(req.body.announcement || req.body.message || "").trim();
  if (!message) {
    return res.status(400).json({ success: false, message: "الإعلان فارغ" });
  }

  db.announcements.push({ id: crypto.randomUUID(), message, date: new Date().toISOString() });
  saveDatabase();

  let sent = 0;
  for (const [phone, s] of sessions) {
    if (s.status !== "connected" || !s.sock) continue;
    try {
      await s.sock.sendMessage(phone + "@s.whatsapp.net", { text: "📢 إعلان من RICO BOT\n\n" + message });
      sent++;
    } catch {}
    await sleep(1000);
  }
  res.json({ success: true, sent });
});

// ================= HEALTH & ERRORS =================

app.get("/api/health", (req, res) => {
  res.json({ success: true, name: "RICO BOT", status: "running" });
});

app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", error.message);
  res.status(500).json({ success: false, message: "حدث خطأ داخلي في السيرفر" });
});

// ================= START =================

app.listen(PORT, () => {
  console.log("RICO BOT SERVER STARTED:", PORT);
  restoreAllSessions();
});

module.exports = { recordCommand, setCommandHandler: fn => { commandHandler = fn; } };
