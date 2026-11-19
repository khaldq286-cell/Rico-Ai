
require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const sessions = new Map();
const adminTokens = new Set();
const bannedUsers = new Set();

let installLimit = Number(process.env.INSTALL_LIMIT || 100);
let totalConnections = 0;
let failedConnections = 0;

const authFolder = path.join(__dirname, "sessions");
fs.mkdirSync(authFolder, { recursive: true });

function validPhone(phone) {
  return /^\d{8,15}$/.test(phone);
}

function requireAdmin(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ message: "غير مصرح لك" });
  }

  next();
}

// الصفحة الرئيسية
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// طلب كود الربط
app.post("/api/pair", async (req, res) => {
  try {
    const phone = String(req.body.phone || "").replace(/\D/g, "");

    if (!validPhone(phone)) {
      return res.status(400).json({
        message: "رقم الهاتف غير صحيح"
      });
    }

    if (bannedUsers.has(phone)) {
      return res.status(403).json({
        message: "هذا الرقم محظور من التنصيب"
      });
    }

    if (sessions.size >= installLimit && !sessions.has(phone)) {
      return res.status(403).json({
        message: "تم الوصول إلى حد التنصيب"
      });
    }

    if (sessions.has(phone)) {
      return res.status(409).json({
        message: "يوجد طلب ربط لهذا الرقم بالفعل"
      });
    }

    const folder = path.join(authFolder, phone);
    fs.mkdirSync(folder, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(folder);

    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      browser: ["RICO BOT", "Chrome", "1.0.0"]
    });

    const session = {
      sock,
      status: "connecting",
      createdAt: Date.now()
    };

    sessions.set(phone, session);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        session.status = "connected";
        totalConnections++;
      }

      if (connection === "close") {
        session.status = "disconnected";

        const code = lastDisconnect?.error?.output?.statusCode;

        if (code !== DisconnectReason.loggedOut) {
          sessions.delete(phone);
        } else {
          sessions.delete(phone);
        }
      }
    });

    const code = await sock.requestPairingCode(phone);

    res.json({
      success: true,
      code,
      message: "أدخل الكود في واتساب لإكمال الربط"
    });

  } catch (error) {
    failedConnections++;

    console.error("Pair error:", error);

    res.status(500).json({
      message: "تعذر إنشاء كود الربط، حاول مرة أخرى"
    });
  }
});

// تسجيل دخول المطور
app.post("/api/developer/login", (req, res) => {
  const password = req.body.password;

  if (!process.env.RICO_ADMIN_PASSWORD) {
    return res.status(503).json({
      message: "لم يتم إعداد كلمة مرور المطور في إعدادات السيرفر"
    });
  }

  if (password !== process.env.RICO_ADMIN_PASSWORD) {
    return res.status(401).json({
      message: "كلمة المرور غير صحيحة"
    });
  }

  const token = crypto.randomBytes(32).toString("hex");
  adminTokens.add(token);

  res.json({
    success: true,
    token,
    message: "تم تسجيل الدخول"
  });
});

// الإحصائيات
app.get("/api/developer/stats", requireAdmin, (req, res) => {
  res.json({
    users: sessions.size,
    connections: totalConnections,
    failed: failedConnections,
    limit: installLimit
  });
});

// تعديل حد التنصيب
app.post("/api/developer/limit", requireAdmin, (req, res) => {
  const limit = Number(req.body.limit);

  if (!Number.isInteger(limit) || limit < 1) {
    return res.status(400).json({
      message: "أدخل حداً صحيحاً"
    });
  }

  installLimit = limit;

  res.json({
    success: true,
    message: "تم تعديل حد التنصيب"
  });
});

// حظر مستخدم
app.post("/api/developer/ban", requireAdmin, (req, res) => {
  const phone = String(req.body.phone || "").replace(/\D/g, "");

  if (!validPhone(phone)) {
    return res.status(400).json({
      message: "رقم الهاتف غير صحيح"
    });
  }

  bannedUsers.add(phone);

  res.json({
    success: true,
    message: "تم حظر الرقم"
  });
});

// فك الحظر
app.post("/api/developer/unban", requireAdmin, (req, res) => {
  const phone = String(req.body.phone || "").replace(/\D/g, "");

  if (!validPhone(phone)) {
    return res.status(400).json({
      message: "رقم الهاتف غير صحيح"
    });
  }

  bannedUsers.delete(phone);

  res.json({
    success: true,
    message: "تم فك الحظر"
  });
});

// الإعلان - محفوظ كطلب فقط إلى أن نضيف نظام الإرسال
app.post("/api/developer/announce", requireAdmin, (req, res) => {
  const message = String(req.body.message || "").trim();

  if (!message) {
    return res.status(400).json({
      message: "اكتب نص الإعلان أولاً"
    });
  }

  res.json({
    success: true,
    message: "تم استلام الإعلان، وسيتم ربط الإرسال في مرحلة الإعلانات"
  });
});

// تشغيل الخادم
app.listen(PORT, () => {
  console.log(`RICO BOT running on port ${PORT}`);
});
