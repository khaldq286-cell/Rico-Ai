"استخدام صارم"؛
const fs = require("fs");
const path = require("path");
const cfg = require("../config");
const store = require("./store");
const { createSocket } = require("../Socket");
const connectWhatsApp = require("../connect");

const db = store.db;
const live = new Map(); // phone -> { sock, connected }
ثابت معلق = خريطة جديدة () ؛ // phone -> مؤقت انتظار الحجم الرمزي
const dir = (p) => path.join(cfg.SESSIONS_DIR, p);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(cfg.SESSIONS_DIR, { recursive: true });

const installed = () => Object.keys(db.users).length;
const connected = () => [...live.values()].filter((s) => s.connected).length;
const isBanned = (p) => db.banned.includes(p);

// أوامر البوت الأصغر: أضف طلباتك هنا (اسم الأمر -> دالة ترجع النص)
const COMMANDS = {
  ping: () => "pong 🏓",
  القائمة: () => "🤖 *RICO BOT*\n\n.ping\n.menu"
};

دالة إيقاف (هاتف) {
  const s = live.get(phone);
  live.delete(phone);
  حاول { s && s.sock.end(undefined); } catch {}
}

دالة مسح (هاتف) {
  أوقف (الهاتف)؛
  clearTimeout(pending.get(phone));
  pending.delete(phone);
  fs.rmSync(dir(phone), { recursive: true, force: true });
}

دالة attach(phone, sock, DR) {
  const entry = { sock, connected: false };
  live.set(phone, entry);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    إذا لم يكن (live.get(phone) !== entry) فارجع؛

    إذا كانت حالة الاتصال "مفتوحة" {
      entry.connected = true;
      clearTimeout(pending.get(phone));
      pending.delete(phone);
      إذا لم يكن (db.users[phone]) {
        db.users[phone] = { installedAt: Date.now() };
        store.save();
        sock.sendMessage(phone + "@s.whatsapp.net", {
          text: "✔ تم تنصيب *ريكوبوت* فعال\n كتب .menu"
        }).catch(() => {});
      }
    }

    إذا كانت حالة الاتصال "مغلقة" {
      entry.connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;

      إذا كان (رمز الخطأ === DR.loggedOut) {
        حذف db.users[phone]؛
        store.save();
        إرجاع مسح (الهاتف)؛
      }
      // إعادة تشغيل الاتصال التلقائي (وبعد الاقتران يطلب إعادة الاتصال التلقائي)
      إذا كان (db.users[phone] || code === DR.restartRequired) {
        live.delete(phone);
        setTimeout(() => start(phone), 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    إذا لم يكن نوع الإشعار هو "notify"، فقم بالخروج.
    for (const m of messages) {
      const text = m.message?.conversation || m.message?.extendedTextMessage?.text || "";
      إذا لم يبدأ النص بـ (cfg.PREFIX)، فتابع؛

      const sender = (m.key.participant || m.key.remoteJid || "").split("@")[0].split(":")[0];
      إذا كان (محظورًا(المرسل)) استمر؛

      const name = text.slice(cfg.PREFIX.length).trim().split(/\s+/)[0].toLowerCase();
      const fn = COMMANDS[name];
      إذا لم يكن fn موجودًا، فتابع؛

      db.commands[name] = (db.commands[name] || 0) + 1;
      store.save();

      Promise.resolve(fn(m))
        .then((r) => r && sock.sendMessage(m.key.remoteJid, { text: r }, { quoted: m }))
        .catch(() => {});
    }
  });
}

دالة غير متزامنة تبدأ (هاتف) {
  إذا كان الهاتف محظورًا أو كان موجودًا على الإنترنت، فقم بالخروج.
  حاول {
    const { sock, DisconnectReason } = await createSocket(dir(phone));
    attach(phone, sock, DisconnectReason);
  } catch (e) {
    console.error("فشل بدء التشغيل:", phone, e.message);
    setTimeout(() => start(phone), 15000);
  }
}

async function pair(phone) {
  if (isBanned(phone)) throw new Error("هذا الرقم محظور");
  if (db.users[phone]) throw new Error("هذا الرقم منصّباً إضافياً");

  امسح (الهاتف)؛
  if (installed() + hanging.size >= db.limit) throw new Error("اكتملت حد التنصيب حالياً");

  const { code, sock, DisconnectReason } =
    await connectWhatsApp(phone, cfg.SESSIONS_DIR).catch((e) => { wipe(phone); throw e; });

  attach(phone, sock, DisconnectReason);
  pending.set(phone, setTimeout(() => { if (!db.users[phone]) wipe(phone); }, 5 * 60 * 1000));
  رمز الإرجاع؛
}

// عند تشغيل السيرفر: إعادة كل المستخدمين ربطاً تلقائياً
async function restoreAll() {
  for (const p of fs.readdirSync(cfg.SESSIONS_DIR)) {
    let registered = false;
    حاول { تم التسجيل = JSON.parse(fs.readFileSync(path.join(dir(p), "creds.json"), "utf8")).registered; } catch {}
    إذا كان (مسجلاً) { db.users[p] = db.users[p] || { installedAt: Date.now() }; }
    آخر مسح (ع)؛ // جلسة لم يكتمل ربطها
  }
  for (const p of Object.keys(db.users)) if (!fs.existsSync(dir(p))) delete db.users[p];
  store.save();

  for (const p of Object.keys(db.users)) { start(p); await wait(1500); }
  console.log(`restored ${installed()} sessions`);
}

دالة حظر (هاتف) {
  إذا لم يكن الهاتف محظورًا، فسيتم إضافته إلى قاعدة البيانات وحفظه في المتجر.
  أوقف (الهاتف)؛
}

دالة إلغاء الحظر (الهاتف) {
  db.banned = db.banned.filter((x) => x !== phone);
  store.save();
  إذا كان (db.users[phone]) ابدأ(phone)؛
}

دالة setLimit(n) { db.limit = n; store.save(); }

async function broadcast(text) {
  db.announcement = { text, at: Date.now() };
  store.save();
  const targets = [...live.entries()].filter(([, s]) => s.connected);
  (async () => {
    for (const [p, s] of targets) {
      wait s.sock.sendMessage(p + "@s.whatsapp.net"، { text: "📢 *إعلان من ريكو بوت*\n\n" + text }).catch(() => {});
      انتظر (2000)؛
    }
  })();
  إرجاع عدد الأهداف
}

دالة stats() {
  إرجاع {
    مثبت: مثبت(),
    متصل: متصل(),
    الحد: db.limit،
    ممنوع: db.banned,
    topCommands: Object.entries(db.commands).sort((a, b) => b[1] - a[1]).slice(0, 10)
  };
}

module.exports = { pair, restoreAll, ban, unban, setLimit, broadcast, stats };
