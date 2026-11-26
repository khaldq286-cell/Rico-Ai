// قائمة أوامر RICO BOT
const MENU_IMG = "https://raw.githubusercontent.com/MohamedVex/Lora-Upload1/main/uploads/1794253862863.jpg";
const BOT_NAME = "RICO BOT";
const TRIGGERS = [".menu", ".اوامر", ".قائمة"];

const CATEGORIES = [
  { n: 1, name: "التـحـمـيـل", key: "downloads", icon: "📂" },
  { n: 2, name: "الـمـجـمـوعـات", key: "groups", icon: "🐞" },
  { n: 3, name: "الـمـلـصـقـات", key: "sticker", icon: "🌄" },
  { n: 4, name: "الـمـطـوريـن", key: "owners", icon: "🇩🇪" },
  { n: 5, name: "الادمــن", key: "admins", icon: "👨🏻‍⚖️" },
  { n: 6, name: "الالــعـاب", key: "games", icon: "🎮" },
  { n: 7, name: "الـتـرفـيـه والـمـرح", key: "fun", icon: "🎭" },
  { n: 8, name: "الـلـوجـو والـتـصـمـيـم", key: "logos", icon: "🎨" },
  { n: 9, name: "الـبـحـث", key: "search", icon: "🔍" },
  { n: 10, name: "الـذكـاء الاصـطـنـاعـي", key: "ai", icon: "🤖" },
  { n: 11, name: "الادوات والـتـحـويـلات", key: "tools", icon: "🛠️" },
  { n: 12, name: "الـبـوتـات الـفـرعـي", key: "sub", icon: "♥️" },
  { n: 13, name: "الـمـعـلـومـات", key: "info", icon: "ℹ️" },
  { n: 14, name: "الـجـيـف", key: "gif", icon: "🎞️" },
  { n: 15, name: "كـل الأوامـر", key: "all", icon: "🪻" }
];

const ALIASES = {
  download: "downloads", downloads: "downloads",
  group: "groups", groups: "groups", general: "groups",
  sticker: "sticker", stickers: "sticker",
  owner: "owners", owners: "owners",
  admin: "admins", admins: "admins",
  game: "games", games: "games",
  fun: "fun",
  logo: "logos", logos: "logos",
  search: "search",
  ai: "ai",
  tool: "tools", tools: "tools",
  sub: "sub", subs: "sub", subbot: "sub", subbots: "sub",
  info: "info", information: "info",
  gif: "gif", gifs: "gif",
  all: "all"
};

// ضيف أوامرك هنا: cmd بدون نقطة، cat من مفاتيح الأقسام فوق
const COMMANDS = [
  { cmd: "menu", cat: "info", desc: "عرض القائمة" },
  // { cmd: "قرآن", cat: "sub", desc: "..." },
  // { cmd: "ستيكر", cat: "sticker", desc: "..." },
];

function resolveCategory(arg) {
  const a = String(arg || "").trim().toLowerCase();
  if (/^\d+$/.test(a)) return CATEGORIES.find(c => c.n === Number(a));
  const key = ALIASES[a];
  return key ? CATEGORIES.find(c => c.key === key) : null;
}

function buildCategoryText(cat) {
  const items = COMMANDS.filter(c => cat.key === "all" || c.cat === cat.key);
  if (!items.length) return null;

  return items.map(c => {
    const icon = CATEGORIES.find(x => x.key === c.cat)?.icon || "🪻";
    return `⦑ ${icon} ⦒ ⦂ .${c.cmd}`;
  }).join("\n");
}

module.exports = async function menu(sock, m, text) {
  const parts = text.trim().split(/\s+/);
  if (!TRIGGERS.includes(parts[0].toLowerCase())) return false;

  const jid = m.key.remoteJid;
  const sender = m.key.participant || jid;
  const num = sender.split("@")[0].split(":")[0];
  const arg = parts[1];

  // القائمة الرئيسية
  if (!arg) {
    const list = CATEGORIES.map(c => `⦑ ${c.n} ⦒ ⦂ ${c.name} ${c.icon}`).join("\n");

    await sock.sendMessage(jid, {
      image: { url: MENU_IMG },
      caption:
        "رَبَّنَا اغْفِرْ لَنَا وَلِإِخْوَانِنَا الَّذِينَ سَبَقُونَا بِالْإِيمَانِ\n\n" +
        `🪻 اهلا → @${num}\n\n` +
        "*🪻 قائمة الأوامر*\n" +
        "_اكتب .menu ورقم القسم عشان تشوف أوامره_\n\n" +
        list +
        `\n\n> ${BOT_NAME}`,
      mentions: [sender]
    }, { quoted: m });
    return true;
  }

  // أوامر قسم معين
  const cat = resolveCategory(arg);
  if (!cat) {
    await sock.sendMessage(jid, {
      text: `🪻: اختار رقم صحيح من 1 لـ ${CATEGORIES.length}`
    }, { quoted: m });
    return true;
  }

  const body = buildCategoryText(cat);
  await sock.sendMessage(jid, {
    text: body
      ? `*⪩ قـسـم ${cat.name} ${cat.icon}*\n── ⋅ ⋅ ── 🪻 ── ⋅ ⋅ ──\n\n${body}\n\n── ⋅ ⋅ ── 🪻 ── ⋅ ⋅ ──\n> ${BOT_NAME}`
      : "🪻: القسم فاضي"
  }, { quoted: m });
  return true;
};
