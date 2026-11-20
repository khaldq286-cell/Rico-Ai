const path = require("path");
const { createSocket } = require("./Socket");

async function connectWhatsApp(phone, sessionDir) {
  const authPath = path.join(sessionDir, phone);

  const {
    sock,
    state,
    DisconnectReason
  } = await createSocket(authPath);

  if (state.creds.registered) {
    sock.end(undefined);
    throw new Error("هذا الرقم مرتبط مسبقاً");
  }

  try {
    await new Promise(resolve => setTimeout(resolve, 3000));

    const code = await sock.requestPairingCode(phone);
    console.log("PAIRING CODE:", code);

    return {
      code,
      sock,
      state,
      DisconnectReason
    };
  } catch (error) {
    sock.end(undefined);
    throw error;
  }
}

module.exports = connectWhatsApp;
