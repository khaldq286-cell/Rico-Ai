
const path = require("path");
const { createSocket } = require("./Socket");

const CUSTOM_PAIRING_CODE = "RICO2010";

async function connectWhatsApp(phone, sessionDir) {
  const authPath = path.join(sessionDir, phone);

  const {
    sock,
    state,
    DisconnectReason
  } = await createSocket(authPath);

  if (state.creds.registered) {
    throw new Error("هذا الرقم مرتبط مسبقاً");
  }

  const code = await sock.requestPairingCode(
    phone,
    CUSTOM_PAIRING_CODE
  );

  return {
    code,
    sock,
    state,
    DisconnectReason
  };
}

module.exports = connectWhatsApp;
