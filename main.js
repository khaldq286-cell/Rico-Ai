const fs = require("fs");
const path = require("path");

const DATABASE_FILE = path.join(__dirname, "database.json");

function makeDefaults() {
  return {
    installLimit: Number(process.env.INSTALL_LIMIT || 100),
    installAdjust: 0,
    maintenance: false,
    bannedUsers: [],
    totalConnections: 0,
    failedConnections: 0,
    announcements: [],
    commands: {}
  };
}

function load() {
  try {
    if (!fs.existsSync(DATABASE_FILE)) {
      const defaults = makeDefaults();
      save(defaults);
      return defaults;
    }
    const saved = JSON.parse(fs.readFileSync(DATABASE_FILE, "utf8"));
    return { ...makeDefaults(), ...saved };
  } catch (error) {
    console.error("Database loading error:", error.message);
    return makeDefaults();
  }
}

function save(data) {
  const temporaryFile = DATABASE_FILE + ".tmp";
  fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temporaryFile, DATABASE_FILE);
}

module.exports = { load, save };
