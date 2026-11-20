const path = require("path");
const { createSocket } = require("./Socket");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// يطلب رمز اقتران حقيقي من واتساب للرقم (بصيغة دولية بدون +)
async function connectWhatsApp(phone, sessionDir) {
  const { sock, state, DisconnectReason } =
    await createSocket(path.join(sessionDir, phone));

  if (state.creds.registered) {
    sock.end(undefined);
    throw new Error("هذا الرقم مرتبط مسبقاً");
  }

  try {
    await wait(3000); // انتظار جاهزية الاتصال قبل طلب الرمز
    const raw = await sock.requestPairingCode(phone);
    const code = raw.match(/.{1,4}/g).join("-");
    return { code, sock, state, DisconnectReason };
  } catch (error) {
    sock.end(undefined);
    throw error;
  }
}

module.exports = connectWhatsApp;
