// Backs the desktop app's "Server PC" dialog (Advanced menu): a small,
// persisted flag marking this PC as the designated main store PC. Today
// that flag has no functional effect on its own - the server still only
// binds to 127.0.0.1 (see server/index.js), so nothing about how the app
// runs actually changes when it's set. It exists so a store with multiple
// registers can start agreeing *now* on which PC would eventually host a
// shared Print History/product cache database, ahead of that networking
// actually being built - a deliberately small, honest first step rather
// than a feature that pretends to already share data across PCs.
//
// Lives in the same per-PC directory as upcCatalog.js's config.json and
// db.js's data.db (see appData.js), as its own small file rather than
// folded into either of those - it's conceptually unrelated to what either
// already stores.

const fs = require('fs');
const path = require('path');
const { getAppDataDir } = require('./appData');

function configFilePath() {
  return path.join(getAppDataDir(), 'server-config.json');
}

function getServerConfig() {
  try {
    const raw = fs.readFileSync(configFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      isServer: !!parsed.isServer,
      confirmedAt: typeof parsed.confirmedAt === 'string' ? parsed.confirmedAt : null,
    };
  } catch {
    // No file yet, or it's unreadable/corrupt - either way, "not the
    // server" is the only safe default (never silently treat an unreadable
    // config as an affirmative confirmation).
    return { isServer: false, confirmedAt: null };
  }
}

// confirmedAt is set fresh whenever isServer flips to true, and cleared
// when unset - it timestamps the current true/false state rather than
// "the last time this was ever true", so unmarking a PC and re-marking it
// later doesn't leave a stale confirmation date behind.
function setServerConfig({ isServer }) {
  const config = {
    isServer: !!isServer,
    confirmedAt: isServer ? new Date().toISOString() : null,
  };
  fs.mkdirSync(getAppDataDir(), { recursive: true });
  fs.writeFileSync(configFilePath(), JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

module.exports = { getServerConfig, setServerConfig, configFilePath };
