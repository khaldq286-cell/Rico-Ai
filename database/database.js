
const fs = require("fs");
const path = require("path");

const DATABASE_FILE = path.join(__dirname, "database.json");

const defaultData = {
  installLimit: 100,
  bannedUsers: [],
  totalConnections: 0,
  failedConnections: 0,
  announcements: [],
  users: []
};

function load() {
  try {
    if (!fs.existsSync(DATABASE_FILE)) {
      save(defaultData);
      return { ...defaultData };
    }

    const savedData = JSON.parse(
      fs.readFileSync(DATABASE_FILE, "utf8")
    );

    return {
      ...defaultData,
      ...savedData
    };
  } catch (error) {
    console.error("Database loading error:", error.message);
    return { ...defaultData };
  }
}

function save(data) {
  const temporaryFile = DATABASE_FILE + ".tmp";

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(temporaryFile, DATABASE_FILE);
}

module.exports = {
  load,
  save
};
