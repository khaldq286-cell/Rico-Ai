
require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = path.join(__dirname, "database");
const SESSION_DIR = path.join(__dirname, "sessions");
const DB_FILE = path.join(DATA_DIR, "database.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

const sessions = new Map();
const adminTokens = new Map();

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
      db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
    }
  } catch (error) {
    console.error("Database error:", error.message);
  }
}

function saveDatabase() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
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

  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({
      success: false,
      message: "غير مصرح لك"
    });
  }

  next();
}

// الصفحة الرئيسية
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// طلب كود واتساب
app.post("/api/pair", async (req, res) => {
  const phone = cleanPhone(req.body.phone);

  if (!validPhone(phone)) {
    return res.status(400).json({
      message: "رقم الهاتف غير صحيح"
    });
  }

  if (db.bannedUsers.includes(phone)) {
    return res.status(403).json({
      message: "هذا الرقم محظور"
    });
  }

  if (sessions.has(phone)) {
    return res.status(409).json({
      message: "يوجد طلب ربط لهذا الرقم"
    });
  }

  if (sessions.size >= db.installLimit) {
    return res.status(403).json({
      message: "تم الوصول إلى حد التنصيب"
    });
  }

  let sock;
  let session;

  try {
    const authPath = path.join(SESSION_DIR, phone);
    fs.mkdirSync(authPath, { recursive: true });

    const { state, saveCreds } =
      await useMultiFileAuthState(authPath);

    if (state.creds.registered) {
      return res.status(409).json({
        message: "هذا الرقم مرتبط مسبقاً"
      });
    }

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
      browser: ["RICO BOT", "Chrome", "1.0.0"],
      printQRInTerminal: false
    });

    session = {
      sock,
      status: "connecting",
      createdAt: Date.now()
    };

    sessions.set(phone, session);
    sock.ev.on("creds.update", saveCreds);

    const code = await new Promise((resolve, reject) => {
      let completed = false;

      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true;
          reject(new Error("Pairing timeout"));
        }
      }, 30000);

      sock.ev.on("connection.update", async update => {
        if (update.connection === "open") {
          session.status = "connected";
          db.totalConnections++;
          saveDatabase();
        }

        if (update.connection === "close") {
          session.status = "disconnected";

          const statusCode =
            update.lastDisconnect?.error?.output?.statusCode;

          if (statusCode === DisconnectReason.loggedOut) {
            sessions.delete(phone);
          }
        }
      });

      const requestCode = async () => {
        if (completed) return;

        try {
          const pairingCode =
            await sock.requestPairingCode(phone);

          if (!completed) {
            completed = true;
            clearTimeout(timeout);
            resolve(pairingCode);
          }
        } catch (error) {
          if (!completed) {
            completed = true;
            clearTimeout(timeout);
            reject(error);
          }
        }
      };

      setTimeout(requestCode, 3000);
    });

    return res.json({
      success: true,
      code,
      message: "أدخل كود الربط في واتساب"
    });

  } catch (error) {
    console.error("PAIR ERROR:", error);

    db.failedConnections++;
    saveDatabase();

    sessions.delete(phone);

    if (sock) {
      try {
        await sock.end(undefined);
      } catch {}
    }

    return res.status(500).json({
      success: false,
      message: "تعذر طلب كود الاقتران"
    });
  }
});

// حالة الاتصال
app.get("/api/pair/status", (req, res) => {
  const phone = cleanPhone(req.query.phone);
  const session = sessions.get(phone);

  res.json({
    status: session ? session.status : "not_found"
  });
});

// تسجيل دخول المطور
app.post("/api/developer/login", (req, res) => {
  const password = String(req.body.password || "");
  const adminPassword = process.env.RICO_ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(503).json({
      message: "كلمة مرور المطور غير مضبوطة في Render"
    });
  }

  if (password !== adminPassword) {
    return res.status(401).json({
      message: "كلمة المرور غير صحيحة"
    });
  }

  const token = crypto.randomBytes(32).toString("hex");

  adminTokens.set(token, Date.now());

  res.setHeader(
    "Set-Cookie",
    `rico_admin=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`
  );

  res.json({
    success: true,
    message: "تم تسجيل الدخول"
  });
});

// تسجيل الخروج
app.post("/api/developer/logout", requireAdmin, (req, res) => {
  const token = getToken(req);

  if (token) adminTokens.delete(token);

  res.setHeader(
    "Set-Cookie",
    "rico_admin=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
  );

  res.json({ success: true });
});

// الإحصائيات
app.get("/api/developer/stats", requireAdmin, (req, res) => {
  res.json({
    users: sessions.size,
    connections: db.totalConnections,
    failed: db.failedConnections,
    limit: db.installLimit,
    banned: db.bannedUsers.length
  });
});

// تعديل الحد
app.post("/api/developer/limit", requireAdmin, (req, res) => {
  const limit = Number(req.body.limit);

  if (!Number.isInteger(limit) || limit < 1) {
    return res.status(400).json({
      message: "الحد غير صحيح"
    });
  }

  db.installLimit = limit;
  saveDatabase();

  res.json({ success: true, limit });
});

// حظر رقم
app.post("/api/developer/ban", requireAdmin, (req, res) => {
  const phone = cleanPhone(req.body.phone);

  if (!validPhone(phone)) {
    return res.status(400).json({
      message: "رقم الهاتف غير صحيح"
    });
  }

  if (!db.bannedUsers.includes(phone)) {
    db.bannedUsers.push(phone);
    saveDatabase();
  }

  res.json({ success: true });
});

// فك الحظر
app.post("/api/developer/unban", requireAdmin, (req, res) => {
  const phone = cleanPhone(req.body.phone);

  db.bannedUsers =
    db.bannedUsers.filter(number => number !== phone);

  saveDatabase();

  res.json({ success: true });
});

// حفظ إعلان
app.post("/api/developer/announce", requireAdmin, (req, res) => {
  const message = String(req.body.message || "").trim();

  if (!message) {
    return res.status(400).json({
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

// فحص السيرفر
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    name: "RICO BOT",
    status: "running"
  });
});

// معالجة الأخطاء
app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", error);

  res.status(500).json({
    success: false,
    message: "حدث خطأ داخلي في السيرفر"
  });
});

app.listen(PORT, () => {
  console.log("================================");
  console.log("          RICO BOT");
  console.log("       SERVER STARTED");
  console.log("       PORT:", PORT);
  console.log("================================");
});
