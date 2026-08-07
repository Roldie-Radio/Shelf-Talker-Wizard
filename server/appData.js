// Shared per-PC storage location: originally private to upcCatalog.js (its
// config.json lives here), now also used by db.js for the SQLite file.
// Kept in its own module so both agree on exactly one directory rather than
// each resolving it slightly differently.
//
// SHELF_TALKER_CONFIG_DIR overrides the location entirely - the test suite
// uses this to keep every test's data in its own throwaway temp directory
// instead of touching a real machine's actual app data.

const path = require('path');
const os = require('os');

function getAppDataDir() {
  if (process.env.SHELF_TALKER_CONFIG_DIR) return process.env.SHELF_TALKER_CONFIG_DIR;
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'Shelf Talker Wizard');
  }
  return path.join(os.homedir(), '.shelf-talker-wizard');
}

module.exports = { getAppDataDir };
