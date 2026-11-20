// تخزين دائم في data/db.json (كتابة آمنة)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cfg = require("../config");

fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
const file = path.join(cfg.DATA_DIR, "db.json");

const db = {
  limit: cfg.DEFAULT_LIMIT,
  banned: [],
  users: {},
  commands: {},
  announcement: null,
  secret: null
};

try { Object.assign(db, JSON.parse(fs.readFileSync(file, "utf8"))); } catch {}
if (!db.secret) { db.secret = crypto.randomBytes(32).toString("hex"); }

let timer = null;

function flush() {
  clearTimeout(timer);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, file);
}

function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

const bye = () => { try { flush(); } catch {} process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);

flush();
module.exports = { db, save, flush };
