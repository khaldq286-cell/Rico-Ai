"use strict";
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const cfg = require("./config");
const store = require("./lib/store");
const sm = require("./lib/sessions");

const db = store.db;
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/developer", (_, res) => res.sendFile(path.join(__dirname, "public", "developer.html")));

// ---------- أدوات الجلسة (توقيع ثابت محفوظ، يبقى صالحاً بعد إعادة التشغيل) ----------
const hmac = (s) => crypto.createHmac("sha256", db.secret).update(s).digest("hex");
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const same = (a, b) => !!b && crypto.timingSafeEqual(sha(a), sha(b));
const sign = (stg, ttl) => { const p = `${stg}.${Date.now() + ttl}`; return `${p}.${hmac(p)}`; };
const valid = (tok, stg) => {
  const [s, e, h] = String(tok || "").split(".");
  return s === stg && Date.now() < +e && !!h && same(h, hmac(`${s}.${e}`));
};
const getCookie = (req, n) =>
  (req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).find((c) => c[0] === n)?.[1];
const setCookie = (req, res, n, v, ms) =>
  res.cookie(n, v, { httpOnly: true, sameSite: "strict", secure: req.secure, maxAge: ms });
const stage = (req) =>
  valid(getCookie(req, "rico_admin"), "admin") ? 2 : valid(getCookie(req, "rico_gate"), "gate") ? 1 : 0;

// ---------- حماية من التخمين ----------
const hits = new Map();
const hit = (k, ms) => {
  const t = Date.now(); let h = hits.get(k);
  if (!h || t > h.until) h = { n: 0, until: t + ms };
  h.n++; hits.set(k, h); return h.n;
};
const count = (k) => { const h = hits.get(k); return h && Date.now() < h.until ? h.n : 0; };

const ok = (res, o = {}) => res.json({ success: true, ...o });
const fail = (res, m, c = 400) => res.status(c).json({ success: false, message: m });
const digits = (v) => String(v || "").replace(/\D/g, "");
const validPhone = (p) => /^\d{8,15}$/.test(p);

// ---------- التنصيب ----------
app.post("/api/pair", async (req, res) => {
  const phone = digits(req.body.phone);
  if (!validPhone(phone)) return fail(res, "رقم الهاتف غير صحيح");
  if (hit(req.ip + "p", 10 * 60e3) > 3) return fail(res, "محاولات كثيرة، حاول بعد قليل", 429);
  try {
    ok(res, { code: await sm.pair(phone), message: "افتح واتساب > الأجهزة المرتبطة > ربط برقم الهاتف وأدخل الرمز" });
  } catch (e) {
    console.error("pair:", e.message);
    fail(res, /[\u0600-\u06FF]/.test(e.message) ? e.message : "تعذر إنشاء رمز الاقتران، تأكد من الرقم وحاول مجدداً");
  }
});

// ---------- لوحة المطور ----------
const check = (req, res, pass) => {
  const k = req.ip + "l";
  if (count(k) >= 5) { fail(res, "تم القفل مؤقتاً، حاول بعد 15 دقيقة", 429); return false; }
  if (!pass || !same(req.body.password, pass)) { hit(k, 15 * 60e3); fail(res, "رمز غير صحيح", 401); return false; }
  return true;
};

app.get("/api/developer/status", (req, res) => ok(res, { stage: stage(req) }));

app.post("/api/developer/login", (req, res) => {
  if (!check(req, res, cfg.ADMIN_PASS_1)) return;
  setCookie(req, res, "rico_gate", sign("gate", 10 * 60e3), 10 * 60e3);
  ok(res);
});

app.post("/api/developer/login2", (req, res) => {
  if (stage(req) < 1) return fail(res, "ابدأ بالرمز الأول", 401);
  if (!cfg.ADMIN_PASS_2) return fail(res, "الرمز الثاني غير مضبوط في config.js", 500);
  if (!check(req, res, cfg.ADMIN_PASS_2)) return;
  setCookie(req, res, "rico_admin", sign("admin", 12 * 3600e3), 12 * 3600e3);
  res.clearCookie("rico_gate");
  ok(res);
});

app.post("/api/developer/logout", (req, res) => {
  res.clearCookie("rico_admin"); res.clearCookie("rico_gate"); ok(res);
});

const auth = (req, res, next) => (stage(req) === 2 ? next() : fail(res, "غير مصرح", 401));

app.get("/api/developer/stats", auth, (_, res) => ok(res, sm.stats()));

app.post("/api/developer/limit", auth, (req, res) => {
  const { action, amount, limit } = req.body;
  const a = Math.max(1, parseInt(amount) || 1);
  let n = db.limit;
  if (action === "increase") n += a;
  else if (action === "decrease") n -= a;
  else if (Number.isInteger(limit)) n = limit;
  sm.setLimit(Math.max(0, n));
  ok(res, { limit: db.limit, message: "تم تحديث حد التنصيب" });
});

app.post("/api/developer/ban", auth, (req, res) => {
  const p = digits(req.body.phone);
  if (!validPhone(p)) return fail(res, "رقم غير صحيح");
  sm.ban(p); ok(res, { message: "تم حظر المستخدم" });
});

app.post("/api/developer/unban", auth, (req, res) => {
  const p = digits(req.body.phone);
  if (!validPhone(p)) return fail(res, "رقم غير صحيح");
  sm.unban(p); ok(res, { message: "تم فك الحظر" });
});

app.post("/api/developer/announce", auth, async (req, res) => {
  const t = String(req.body.announcement || "").trim().slice(0, 1000);
  if (!t) return fail(res, "اكتب نص الإعلان");
  ok(res, { message: `جارٍ إرسال الإعلان إلى ${await sm.broadcast(t)} مستخدم متصل` });
});

process.on("unhandledRejection", (e) => console.error("unhandled:", e));
process.on("uncaughtException", (e) => console.error("uncaught:", e));

app.listen(cfg.PORT, () => {
  console.log("RICO BOT on port", cfg.PORT);
  if (!cfg.ADMIN_PASS_2) console.warn("⚠️ ADMIN_PASS_2 غير مضبوط: لن تعمل لوحة المطور");
  sm.restoreAll();
});
