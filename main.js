require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const pino = require("pino");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "database");
const SESSION_DIR = path.join(__dirname, "sessions");
const DB_FILE = path.join(DATA_DIR, "database.json");

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

let makeWASocket;
let useMultiFileAuthState;
let DisconnectReason;

let db = {
  installLimit: Number(process.env.INSTALL_LIMIT || 100),
  bannedUsers: [],
  totalConnections: 0,
  failedConnections: 0,
  announcements: []
};

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      db = { ...db, ...saved };
    }
  } catch (error) {
    console.error("DATABASE ERROR:", error.message);
  }
}

function saveDatabase() {
  const temp = DB_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB_FILE);
}

loadDatabase();

function cleanPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function validPhone(phone) {
  return /^\d{8,15}$/.test(phone);
}

function getToken(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)rico_admin=([^;]+)/);
  return match ? match[1] : null;
}

function requireAdmin(req, res, next) {
  const token = getToken(req);
  const expires = token ? adminTokens.get(token) : null;

  if (!expires || expires < Date.now()) {
    if (token) adminTokens.delete(token);

    return res.status(401).json({
      success: false,
      message: "سجل دخول المطور من جديد"
    });
  }

  next();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createWhatsAppSocket(phone, authPath, session) {
  const { state, saveCreds } =
    await useMultiFileAuthState(authPath);

  session.state = state;
  session.saveCreds = saveCreds;

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["RICO BOT", "Chrome", "1.0.0"]
  });

  session.sock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async update => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      if (session.status !== "connected") {
        db.totalConnections++;
        saveDatabase();
      }

      session.status = "connected";
      session.retryCount = 0;
    }

    if (connection === "close") {
      session.status = "disconnected";

      const code = lastDisconnect?.error?.output?.statusCode;

      if (code === DisconnectReason.loggedOut) {
        sessions.delete(phone);
        return;
      }

      if (sessions.get(phone) !== session) return;
      if (session.reconnectTimer) return;

      session.retryCount++;

      if (session.retryCount > 5) return;

      session.reconnectTimer = setTimeout(async () => {
        session.reconnectTimer = null;

        if (sessions.get(phone) !== session) return;

        try {
          session.status = "connecting";
          await createWhatsAppSocket(phone, authPath, session);
        } catch (error) {
          console.error("RECONNECT ERROR:", error.message);
          session.status = "disconnected";
        }
      }, Math.min(3000 * session.retryCount, 15000));
    }
  });

  return sock;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/pair", async (req, res) => {
  const phone = cleanPhone(req.body.phone);

  if (!validPhone(phone)) {
    return res.status(400).json({
      success: false,
      message: "رقم الهاتف غير صحيح"
    });
  }

  if (db.bannedUsers.includes(phone)) {
    return res.status(403).json({
      success: false,
      message: "هذا الرقم محظور"
    });
  }

  if (sessions.has(phone)) {
    return res.status(409).json({
      success: false,
      message: "يوجد طلب ربط لهذا الرقم"
    });
  }

  if (sessions.size >= db.installLimit) {
    return res.status(403).json({
      success: false,
      message: "تم الوصول إلى حد التنصيب"
    });
  }

  const authPath = path.join(SESSION_DIR, phone);

  const session = {
    status: "connecting",
    retryCount: 0,
    reconnectTimer: null,
    createdAt: Date.now()
  };

  sessions.set(phone, session);

  try {
    const auth = await useMultiFileAuthState(authPath);

    if (auth.state.creds.registered) {
      sessions.delete(phone);

      return res.status(409).json({
        success: false,
        message: "هذا الرقم مرتبط مسبقاً"
      });
    }

    const sock = await createWhatsAppSocket(
      phone,
      authPath,
      session
    );

    await wait(3000);

    if (auth.state.creds.registered) {
      throw new Error("هذا الرقم مرتبط مسبقاً");
    }

    const code = await sock.requestPairingCode(phone);

    return res.json({
      success: true,
      code,
      message: "أدخل كود الربط في واتساب"
    });

  } catch (error) {
    console.error("PAIR ERROR:", error.message);

    db.failedConnections++;
    saveDatabase();

    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
    }

    sessions.delete(phone);

    return res.status(500).json({
      success: false,
      message: "تعذر طلب كود الاقتران"
    });
  }
});

app.get("/api/pair/status", (req, res) => {
  const phone = cleanPhone(req.query.phone);
  const session = sessions.get(phone);

  res.json({
    status: session ? session.status : "not_found"
  });
});

app.post("/api/developer/login", (req, res) => {
  const password = String(req.body.password || "");

  const inputHash = crypto.createHash("sha256")
    .update(password).digest();

  const adminHash = crypto.createHash("sha256")
    .update(ADMIN_CODE).digest();

  if (
    !password ||
    !crypto.timingSafeEqual(inputHash, adminHash)
  ) {
    return res.status(401).json({
      success: false,
      message: "كود التفعيل غير صحيح"
    });
  }

  const token = crypto.randomBytes(32).toString("hex");
  adminTokens.set(token, Date.now() + 8 * 60 * 60 * 1000);

  const secure =
    req.secure || req.headers["x-forwarded-proto"] === "https";

  res.setHeader(
    "Set-Cookie",
    `rico_admin=${token}; HttpOnly; ${secure ? "Secure;" : ""} SameSite=Lax; Path=/; Max-Age=28800`
  );

  res.json({ success: true, message: "تم تسجيل الدخول" });
});

app.post("/api/developer/logout", requireAdmin, (req, res) => {
  const token = getToken(req);
  adminTokens.delete(token);

  res.setHeader(
    "Set-Cookie",
    "rico_admin=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
  );

  res.json({ success: true });
});

app.get("/api/developer/stats", requireAdmin, (req, res) => {
  res.json({
    users: sessions.size,
    connections: db.totalConnections,
    failed: db.failedConnections,
    limit: db.installLimit,
    banned: db.bannedUsers.length
  });
});

app.post("/api/developer/limit", requireAdmin, (req, res) => {
  const limit = Number(req.body.limit);

  if (!Number.isInteger(limit) || limit < 1) {
    return res.status(400).json({
      success: false,
      message: "الحد غير صحيح"
    });
  }

  db.installLimit = limit;
  saveDatabase();

  res.json({ success: true, limit });
});

app.post("/api/developer/ban", requireAdmin, (req, res) => {
  const phone = cleanPhone(req.body.phone);

  if (!validPhone(phone)) {
    return res.status(400).json({
      success: false,
      message: "رقم الهاتف غير صحيح"
    });
  }

  if (!db.bannedUsers.includes(phone)) {
    db.bannedUsers.push(phone);
    saveDatabase();
  }

  res.json({ success: true });
});

app.post("/api/developer/unban", requireAdmin, (req, res) => {
  const phone = cleanPhone(req.body.phone);

  db.bannedUsers = db.bannedUsers.filter(x => x !== phone);
  saveDatabase();

  res.json({ success: true });
});

app.post("/api/developer/announce", requireAdmin, (req, res) => {
  const message = String(
    req.body.announcement || req.body.message || ""
  ).trim();

  if (!message) {
    return res.status(400).json({
      success: false,
      message: "الإعلان فارغ"
    });
  }

  db.announcements.push({
    id: crypto.randomUUID(),
    message,
    date: new Date().toISOString()
  });

  saveDatabase();

  res.json({ success: true });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    name: "RICO BOT",
    status: "running"
  });
});

app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", error.message);

  res.status(500).json({
    success: false,
    message: "حدث خطأ داخلي في السيرفر"
  });
});

async function startServer() {
  try {
    const baileys = await import("@whiskeysockets/baileys");

    makeWASocket = baileys.default;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    DisconnectReason = baileys.DisconnectReason;

    if (!makeWASocket || !useMultiFileAuthState) {
      throw new Error("تعذر تحميل Baileys");
    }

    app.listen(PORT, () => {
      console.log("RICO BOT SERVER STARTED:", PORT);
    });

  } catch (error) {
    console.error("STARTUP ERROR:", error);
    process.exit(1);
  }
}

startServer();
