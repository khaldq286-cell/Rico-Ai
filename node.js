
require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const pino = require("pino");

const app = express();
const PORT = process.env.PORT || 3000;

// ==============================
// RICO BOT SETTINGS
// ==============================

const ADMIN_ACTIVATION_CODE =
  process.env.RICO_ADMIN_ACTIVATION_CODE || "RICO-ADMIN-2010";

const DATA_DIR = path.join(__dirname, "database");
const SESSION_DIR = path.join(__dirname, "sessions");
const DB_FILE = path.join(DATA_DIR, "database.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

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

// ==============================
// DATABASE
// ==============================

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const saved = JSON.parse(
        fs.readFileSync(DB_FILE, "utf8")
      );

      db = { ...db, ...saved };
    }
  } catch (error) {
    console.error("DATABASE LOAD ERROR:", error.message);
  }
}

function saveDatabase() {
  try {
    const tempFile = DB_FILE + ".tmp";

    fs.writeFileSync(
      tempFile,
      JSON.stringify(db, null, 2),
      "utf8"
    );

    fs.renameSync(tempFile, DB_FILE);
  } catch (error) {
    console.error("DATABASE SAVE ERROR:", error.message);
  }
}

loadDatabase();

// ==============================
// GENERAL HELPERS
// ==============================

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
  const expiresAt = token ? adminTokens.get(token) : null;

  if (!token || !expiresAt || expiresAt < Date.now()) {
    if (token) adminTokens.delete(token);

    return res.status(401).json({
      success: false,
      message: "انتهت جلسة المطور، سجل الدخول من جديد"
    });
  }

  next();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==============================
// WHATSAPP CONNECTION
// ==============================

async function createWhatsAppSocket(
  phone,
  authPath,
  session,
  authState = null
) {
  const auth = authState ||
    await useMultiFileAuthState(authPath);

  const { state, saveCreds } = auth;

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
      const wasConnected = session.status === "connected";

      session.status = "connected";
      session.retryCount = 0;

      if (!wasConnected) {
        db.totalConnections++;
        saveDatabase();
      }

      console.log("WHATSAPP CONNECTED:", phone);
    }

    if (connection === "close") {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode;

      console.log(
        "WHATSAPP DISCONNECTED:",
        phone,
        statusCode
      );

      session.status = "disconnected";

      if (statusCode === DisconnectReason.loggedOut) {
        sessions.delete(phone);
        console.log("WHATSAPP LOGGED OUT:", phone);
        return;
      }

      if (
        sessions.get(phone) === session &&
        !session.reconnectTimer
      ) {
        session.retryCount =
          (session.retryCount || 0) + 1;

        if (session.retryCount > 5) {
          console.error("RECONNECT LIMIT REACHED:", phone);
          return;
        }

        const delay =
          statusCode === DisconnectReason.restartRequired
            ? 1500
            : Math.min(3000 * session.retryCount, 15000);

        session.reconnectTimer = setTimeout(async () => {
          session.reconnectTimer = null;

          if (sessions.get(phone) !== session) return;

          try {
            session.status = "connecting";

            await createWhatsAppSocket(
              phone,
              authPath,
              session
            );
          } catch (error) {
            console.error("RECONNECT ERROR:", error.message);
            session.status = "disconnected";
          }
        }, delay);
      }
    }
  });

  return sock;
}

// ==============================
// HOME PAGE
// ==============================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// ==============================
// PAIR WHATSAPP
// ==============================

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
    sock: null,
    status: "connecting",
    createdAt: Date.now(),
    retryCount: 0,
    reconnectTimer: null
  };

  sessions.set(phone, session);

  let sock;
  let timeout;

  try {
    const authState =
      await useMultiFileAuthState(authPath);

    if (authState.state.creds.registered) {
      sessions.delete(phone);

      return res.status(409).json({
        success: false,
        message: "هذا الرقم مرتبط مسبقاً"
      });
    }

    sock = await createWhatsAppSocket(
      phone,
      authPath,
      session,
      authState
    );

    // منح الاتصال وقتاً للتهيئة
    await wait(1500);

    if (authState.state.creds.registered) {
      throw new Error("هذا الرقم مرتبط مسبقاً");
    }

    const pairingPromise = sock.requestPairingCode(phone);

    const code = await Promise.race([
      pairingPromise,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error("انتهت مهلة طلب كود الاقتران")
          );
        }, 45000);
      })
    ]);

    clearTimeout(timeout);

    return res.json({
      success: true,
      code,
      message: "أدخل كود الربط في واتساب"
    });

  } catch (error) {
    clearTimeout(timeout);

    console.error("PAIR ERROR:", error);

    db.failedConnections++;
    saveDatabase();

    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
    }

    sessions.delete(phone);

    if (sock) {
      try {
        sock.end(undefined);
      } catch {}
    }

    return res.status(500).json({
      success: false,
      message: "تعذر طلب كود الاقتران",
      error: error.message
    });
  }
});

// ==============================
// PAIR STATUS
// ==============================

app.get("/api/pair/status", (req, res) => {
  const phone = cleanPhone(req.query.phone);
  const session = sessions.get(phone);

  res.json({
    status: session ? session.status : "not_found"
  });
});

// ==============================
// DEVELOPER LOGIN
// ==============================

app.post("/api/developer/login", (req, res) => {
  const password = String(req.body.password || "");

  if (!password) {
    return res.status(400).json({
      success: false,
      message: "أدخل كود تفعيل لوحة المطور"
    });
  }

  const validCode =
    crypto.timingSafeEqual(
      Buffer.from(
        crypto.createHash("sha256")
          .update(password)
          .digest("hex")
      ),
      Buffer.from(
        crypto.createHash("sha256")
          .update(ADMIN_ACTIVATION_CODE)
          .digest("hex")
      )
    );

  if (!validCode) {
    return res.status(401).json({
      success: false,
      message: "كود التفعيل غير صحيح"
    });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;

  adminTokens.set(token, expiresAt);

  const secure = req.secure ||
    req.headers["x-forwarded-proto"] === "https";

  res.setHeader(
    "Set-Cookie",
    `rico_admin=${token}; HttpOnly; ${secure ? "Secure;" : ""} SameSite=Lax; Path=/; Max-Age=28800`
  );

  res.json({
    success: true,
    message: "تم تسجيل الدخول"
  });
});

// ==============================
// DEVELOPER LOGOUT
// ==============================

app.post(
  "/api/developer/logout",
  requireAdmin,
  (req, res) => {
    const token = getToken(req);

    if (token) adminTokens.delete(token);

    res.setHeader(
      "Set-Cookie",
      "rico_admin=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
    );

    res.json({ success: true });
  }
);

// ==============================
// DEVELOPER STATS
// ==============================

app.get(
  "/api/developer/stats",
  requireAdmin,
  (req, res) => {
    res.json({
      users: sessions.size,
      connections: db.totalConnections,
      failed: db.failedConnections,
      limit: db.installLimit,
      banned: db.bannedUsers.length
    });
  }
);

// ==============================
// CHANGE INSTALL LIMIT
// ==============================

app.post(
  "/api/developer/limit",
  requireAdmin,
  (req, res) => {
    const limit = Number(req.body.limit);

    if (!Number.isInteger(limit) || limit < 1) {
      return res.status(400).json({
        success: false,
        message: "الحد غير صحيح"
      });
    }

    db.installLimit = limit;
    saveDatabase();

    res.json({
      success: true,
      limit
    });
  }
);

// ==============================
// BAN USER
// ==============================

app.post(
  "/api/developer/ban",
  requireAdmin,
  (req, res) => {
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
  }
);

// ==============================
// UNBAN USER
// ==============================

app.post(
  "/api/developer/unban",
  requireAdmin,
  (req, res) => {
    const phone = cleanPhone(req.body.phone);

    db.bannedUsers =
      db.bannedUsers.filter(number => number !== phone);

    saveDatabase();

    res.json({ success: true });
  }
);

// ==============================
// ANNOUNCEMENTS
// ==============================

app.post(
  "/api/developer/announce",
  requireAdmin,
  (req, res) => {
    const message = String(
      req.body.message || ""
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
  }
);

// ==============================
// HEALTH CHECK
// ==============================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    name: "RICO BOT",
    status: "running"
  });
});

// ==============================
// ERROR HANDLER
// ==============================

app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", error);

  res.status(500).json({
    success: false,
    message: "حدث خطأ داخلي في السيرفر"
  });
});

// ==============================
// START SERVER
// ==============================

async function startServer() {
  try {
    const baileys =
      await import("@whiskeysockets/baileys");

    makeWASocket = baileys.default;
    useMultiFileAuthState =
      baileys.useMultiFileAuthState;
    DisconnectReason = baileys.DisconnectReason;

    if (
      !makeWASocket ||
      !useMultiFileAuthState ||
      !DisconnectReason
    ) {
      throw new Error(
        "تعذر تحميل وظائف Baileys المطلوبة"
      );
    }

    app.listen(PORT, () => {
      console.log("==============================");
      console.log("          RICO BOT");
      console.log("       SERVER STARTED");
      console.log("       PORT:", PORT);
      console.log("==============================");
    });

  } catch (error) {
    console.error("STARTUP ERROR:", error);
    process.exit(1);
  }
}

startServer();
