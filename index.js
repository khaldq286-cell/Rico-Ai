
import express from "express";
import { Client } from "meowsab";
import { subBots, subs } from "./system/sub.js";
import "meowsab/safe";
import "./system/database.js";
import * as baileys from "baileys";
import notifications from "./system/notifications.js";

const app = express();

app.use(express.json());
app.use(express.static("public"));

app.get("/api/status", (req, res) => {
  res.json({
    name: "RICO BOT",
    status: "online",
    platform: "Render"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RICO BOT Web Server: ${PORT}`);
});

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

  owners: process.env.OWNER_NUMBER
    ? [{ jid: `${process.env.OWNER_NUMBER}@s.whatsapp.net` }]
    : [],

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
  images: [],
};

const plugins = client.plug();
plugins.notification(notifications);

async function start() {
  await client.connect();
  await subBots(client);
  await subs.start();
  console.log("RICO BOT started successfully");
}

start().catch(console.error);
