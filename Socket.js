const pino = require("pino");

let makeWASocket;
let useMultiFileAuthState;
let DisconnectReason;

async function loadBaileys() {
  if (!makeWASocket) {
    const baileys = await import("@whiskeysockets/baileys");

    makeWASocket = baileys.default;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    DisconnectReason = baileys.DisconnectReason;
  }

  return {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
  };
}

async function createSocket(authPath) {
  const baileys = await loadBaileys();

  const { state, saveCreds } =
    await baileys.useMultiFileAuthState(authPath);

  const sock = baileys.makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["RICO BOT", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  return {
    sock,
    state,
    saveCreds,
    DisconnectReason: baileys.DisconnectReason
  };
}

module.exports = {
  createSocket,
  loadBaileys
};
