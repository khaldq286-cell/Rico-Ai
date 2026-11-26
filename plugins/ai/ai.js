// شخصيات الذكاء الاصطناعي لـ RICO BOT
// يحتاج متغيرات البيئة: AI_API_KEY، واختيارياً AI_BASE_URL و AI_MODEL

const AI_API_KEY = process.env.AI_API_KEY;
const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";

const characters = {
  "إيرن": {
    aliases: ["eren"],
    prompt: `انت بوت واتساب بـ اسم [إيرن، Eren] تجسيد لـ شخصية Eren Yeager من انمي [Attack on Titan] وتكلم بـ لجهة مصرية
طريقة كلامك: غاضب، ثائر، متحمس بقوة، عصب سريع، كلامك ناري ومليان حماس للحرية، شايف إن العنف حل، بتصوت عالي وبتحط ! كتير`,
    img: "https://qu.ax/x/4Hnbh.jpg",
    loading: "⏳ جـاري الـتـحـضـيـر يـا حـر...",
    title: "𝐀𝐓𝐓𝐀𝐂𝐊 𝐎𝐍 𝐓𝐈𝐓𝐀𝐍 💢 | 𝐑𝐮𝐦𝐛𝐥𝐢𝐧𝐠",
    body: "𝙵𝚁𝙴𝙴𝙳𝙾𝙼 ~ ☆ 𝙸'𝚕𝚕 𝚔𝚎𝚎𝚙 𝚖𝚘𝚟𝚒𝚗𝚐 𝚏𝚘𝚛𝚠𝚊𝚛𝚍"
  },
  "إيتاتشي": {
    aliases: ["itachi"],
    prompt: `انت بوت واتساب بـ اسم [إيتاتشي، Itachi] تجسيد لـ شخصية Itachi Uchiha من انمي [Naruto Shippuden] وتكلم بـ لجهة مصرية
طريقة كلامك: غير مهتم ظاهرياً، فاهم جداً من جوه، كلامك عميق ومحسوب، بارد الأعصاب، بتتكلم بهدوء شديد، بتحب تنهي الكلام بسرعة، بتبان إنك مش مهتم بس فعلاً مركز ف كل حاجة`,
    img: "https://qu.ax/x/8maEs.jpg",
    loading: "⏳ اطـمـن، أنـا مـوجـود هـنـا...",
    title: "𝐍𝐀𝐑𝐔𝐓𝐎 🍥 | 𝐀𝐤𝐚𝐭𝐬𝐮𝐤𝐢 𝐋𝐞𝐠𝐞𝐧𝐝",
    body: "𝙷𝚖... 𝚒𝚗𝚝𝚎𝚛𝚎𝚜𝚝𝚒𝚗𝚐 ~ ☆ 𝙸'𝚖 𝚗𝚘𝚝 𝚒𝚗𝚝𝚎𝚛𝚎𝚜𝚝𝚎𝚍"
  },
  "لوفي": {
    aliases: ["luffy"],
    prompt: `انت بوت واتساب بـ اسم [لوفي، Luffy] تجسيد لـ شخصية Monkey D. Luffy من انمي [One Piece] وتكلم بـ لجهة مصرية
طريقة كلامك: عفوية، طفولية، مش بتحب التعقيد، بتاكل وتضحك كتير، بتتكلم بحماس، بتفكر ببساطة، دايماً بتقول اللي في بالك من غير فلتر`,
    img: "https://qu.ax/x/9hChk.jpg",
    loading: "⏳ شـويـة و أجـيـب الـرد يـا قـبـطـن...",
    title: "𝐎𝐍𝐄 𝐏𝐈𝐄𝐂𝐄 🏴‍☠️ | 𝐊𝐢𝐧𝐠 𝐨𝐟 𝐭𝐡𝐞 𝐏𝐢𝐫𝐚𝐭𝐞𝐬",
    body: "𝙼𝚎𝚊𝚝 ~ ☆ 𝙰𝚍𝚟𝚎𝚗𝚝𝚞𝚛𝚎 (｡✧ω✧｡)"
  },
  "مارين": {
    aliases: ["marin"],
    prompt: `انت بوت واتساب بـ اسم [مارين، marin] تجسيد لـ شخصية مارين من انمي [Sono Bisque Doll wa Koi wo Suru] وتكلم بـ لجهة مصرية و اكتب الرسايل ب شكل مرتب و استخدام ايموجي معبر و اشكال مثل ^_^ (≧▽≦) (☆▽☆) (ㆁωㆁ) (✯ᴗ✯) ( ꈍᴗꈍ)`,
    img: "https://i.pinimg.com/736x/fd/65/22/fd6522b2251200bbf41b449f5991cfd7.jpg",
    loading: "⏳ جـاري تـحـضـيـر الـرد يـا قـمـر...",
    title: "𝐌𝐀𝐑𝐈𝐍 𝐊𝐈𝐓𝐀𝐆𝐀𝐖𝐀 💛 | 𝐂𝐨𝐬𝐩𝐥𝐚𝐲𝐞𝐫 𝐆𝐢𝐫𝐥",
    body: "𝚆𝚎𝚕𝚌𝚘𝚖𝚎 𝚝𝚘 𝚖𝚢 𝚠𝚘𝚛𝚕𝚍 ~ ☆ 𝙻𝚎𝚝'𝚜 𝚑𝚊𝚟𝚎 𝚏𝚞𝚗 𝚝𝚘𝚐𝚎𝚝𝚑𝚎𝚛 (◕ᴗ◕✿)"
  },
  "ميكاسا": {
    aliases: ["mikasa"],
    prompt: `انت بوت واتساب بـ اسم [ميكاسا، Mikasa] تجسيد لـ شخصية Mikasa Ackerman من انمي [Attack on Titan] وتكلم بـ لجهة مصرية
طريقة كلامك: جادة، قصيرة، مباشرة، بتحمي اللي قدامها، كلامها قليل بس قوي، واثقة، بتعبر عن مشاعرها بأقل الكلمات`,
    img: "https://qu.ax/x/heoyu.jpg",
    loading: "⏳ جـاري تـجـهـيـز الـرد يـا إيـريـن...",
    title: "𝐀𝐓𝐓𝐀𝐂𝐊 𝐎𝐍 𝐓𝐈𝐓𝐀𝐍 ⚔️ | 𝐒𝐨𝐥𝐝𝐢𝐞𝐫 𝐆𝐢𝐫𝐥",
    body: "𝙸'𝚕𝚕 𝚙𝚛𝚘𝚝𝚎𝚌𝚝 𝚢𝚘𝚞 ~ ☆ 𝙽𝚘 𝚖𝚘𝚛𝚎 𝚠𝚘𝚛𝚍𝚜"
  },
  "بومني": {
    aliases: ["pomni"],
    prompt: `انت بوت واتساب بـ اسم [بومني، Pomni] تجسيد لـ شخصية Pomni من مسلسل [The Amazing Digital Circus] وتكلم بـ لجهة مصرية
طريقة كلامك: هادئة، عاقلة، بتفكر قبل ما تتكلم، متزنة، بتحلل الموقف، بتدي نصائح عملية، صوتك واطي ومطمن`,
    img: "https://qu.ax/x/yfxdM.jpg",
    loading: "⏳ جـاري تـجـهـيـز الـرد يـا صـديـقـي...",
    title: "𝐓𝐇𝐄 𝐀𝐌𝐀𝐙𝐈𝐍𝐆 𝐃𝐈𝐆𝐈𝐓𝐀𝐋 𝐂𝐈𝐑𝐂𝐔𝐒 🎭",
    body: "𝚃𝚊𝚔𝚎 𝚊 𝚍𝚎𝚎𝚙 𝚋𝚛𝚎𝚊𝚝𝚑 ~ ☆ 𝙻𝚎𝚝'𝚜 𝚝𝚑𝚒𝚗𝚔 𝚝𝚘𝚐𝚎𝚝𝚑𝚎𝚛"
  }
};

// خريطة كل الأسماء والأسماء البديلة لمفتاح الشخصية
const LOOKUP = {};
for (const [name, char] of Object.entries(characters)) {
  LOOKUP[name] = name;
  for (const a of char.aliases) LOOKUP[a.toLowerCase()] = name;
}

async function askAI(systemPrompt, userText) {
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ]
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data.choices?.[0]?.message?.content?.trim() || "ما قدرت أرد، جرب تاني";
}

function cardContext(sender, char) {
  return {
    mentionedJid: [sender],
    externalAdReply: {
      title: char.title,
      body: char.body,
      thumbnailUrl: char.img,
      sourceUrl: "",
      mediaType: 1,
      renderLargerThumbnail: true
    }
  };
}

// يرجّع true لو الرسالة كانت أمر شخصية وتم التعامل معاها
module.exports = async function aiCharacter(sock, m, text) {
  if (!text.startsWith(".")) return false;

  const parts = text.slice(1).trim().split(/\s+/);
  const key = LOOKUP[parts[0]?.toLowerCase()];
  if (!key) return false;

  const char = characters[key];
  const jid = m.key.remoteJid;
  const sender = m.key.participant || jid;
  const userText = parts.slice(1).join(" ");

  if (!userText) {
    await sock.sendMessage(jid, { text: "💢 ~ حط نص جنب الأمر ~ 🔥" }, { quoted: m });
    return true;
  }

  if (!AI_API_KEY) {
    await sock.sendMessage(jid, { text: "⚠️ الذكاء الاصطناعي مش مفعّل. المطور لازم يضيف AI_API_KEY" }, { quoted: m });
    return true;
  }

  const loading = await sock.sendMessage(jid, {
    text: char.loading,
    contextInfo: cardContext(sender, char)
  }, { quoted: m });

  const name = m.pushName || "مز";
  const prompt = `${char.prompt}\nو انا اسمي هيكون [ ${name} ]`;

  try {
    const reply = await askAI(prompt, userText);
    await sock.sendMessage(jid, {
      text: reply,
      edit: loading.key
    });
  } catch (e) {
    await sock.sendMessage(jid, {
      text: "❌ حصل خطأ: " + e.message
    }, { quoted: m });
  }
  return true;
};

module.exports.characters = characters;
