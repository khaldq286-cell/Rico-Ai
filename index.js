
import express from "express";
import { Client } from "meowsab";
import { subBots } from "./system/sub.js";
import "meowsab/safe";
import "./system/database.js";
import * as baileys from "baileys";
import notifications from "./system/notifications.js";

const app = express();

app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/public/index.html");
});

app.get("/api/status", (req, res) => {
  res.json({
    name: "RICO BOT",
    status: "online",
    platform: "Render"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RICO BOT Server running on port ${PORT}`);
});

/* WhatsApp Bot */

const client = new Client({
  plugsdir: "plugins",
  prefix: [".", "!"],

  library: [baileys],

  sessionStorage: {
    type: "sqlite",
    path: "./session",
  },

  login: {
    method: "pair",
    number: process.env.BOT_NUMBER || "",
    code: process.env.BOT_CODE || "RICO1234",
  },

  owners: [
    { jid: "966575252858@s.whatsapp.net", lid: "269144427626750@lid" },
    { jid: "966567158348@s.whatsapp.net", lid: "230919638098013@lid" },
    { jid: "201066826750@s.whatsapp.net", lid: "247579682029763@lid" },
    { lid: "1838246064203@lid" },
    { jid: "201027439894@s.whatsapp.net", lid: "140656605450455@lid" },
    { username: "T7_14" },
  ],

  settings: {
    message_owner_only: false,
    private_mode: false,
    message_group_only: false,
    no_message_baileys: false,
    from_me: false,
  },
});

const { config } = client;

config.info = {
  nameBot: "RICO BOT",
  title: "RICO BOT WhatsApp Platform",
  channel: {
    isForwarded: true,
    forwardingScore: 1,
    forwardedNewsletterMessageInfo: {
      newsletterJid: "120363225356834044@newsletter",
      newsletterName: "Union",
      serverMessageId: 0,
    },
  },
  newsletter: {
    name: "Union",
    jid: "120363225356834044@newsletter",
  },
  images: [
    "https://raw.githubusercontent.com/MohamedVex/Lora-Upload1/main/uploads/1791910619812.jpg",
    "https://raw.githubusercontent.com/MohamedVex/Lora-Upload1/main/uploads/1791910652175.jpg",
    "https://raw.githubusercontent.com/MohamedVex/Lora-Upload1/main/uploads/1791910673893.jpg",
    "https://raw.githubusercontent.com/MohamedVex/Lora-Upload1/main/uploads/1791910702904.jpg",
  ],
};

/* Error Handler */

client.on("error", async (err) => {
  console.error("Bot Error:", err);
});

/* Notifications */

const plugins = client.plug();
plugins.notification(notifications);

/* Start System */

async function start() {
  await client.connect();
  await subBots(client);

  console.log("RICO BOT started successfully");
}

start().catch((err) => {
  console.error("Startup Error:", err);
});
