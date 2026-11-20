const pino = require("pino");

دع بيليز؛

async function loadBaileys() {
  إذا لم يكن baileys موجودًا، فسيتم استيراده باستخدام الأمر التالي: `wait import("@whiskeysockets/baileys");`
  إرجاع بيليز؛
}

async function createSocket(authPath) {
  const b = await loadBaileys();
  const logger = pino({ level: "silent" });

  const { state, saveCreds } = await b.useMultiFileAuthState(authPath);
  const { version } = await b.fetchLatestBaileysVersion().catch(() => ({}));

  const sock = b.default({
    ...(الإصدار ؟ {الإصدار} : {}),
    auth: {
      بيانات الاعتماد: state.creds,
      keys: b.makeCacheableSignalKeyStore(state.keys, logger)
    },
    مسجل،
    printQRInTerminal: false,
    المتصفح: ["RICO BOT", "Chrome", "1.0.0"],
    markOnlineOnConnect: false
  });

  sock.ev.on("creds.update", saveCreds);

  return { sock, state, saveCreds, DisconnectReason: b.DisconnectReason };
}

module.exports = { createSocket, loadBaileys };
