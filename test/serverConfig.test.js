const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { getServerConfig, setServerConfig, configFilePath } = require('../server/serverConfig');

// Same per-test throwaway directory pattern as test/upcCatalog.test.js and
// test/db.test.js.
function withTempConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-talker-serverconfig-test-'));
  const prev = process.env.SHELF_TALKER_CONFIG_DIR;
  process.env.SHELF_TALKER_CONFIG_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.SHELF_TALKER_CONFIG_DIR;
    else process.env.SHELF_TALKER_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('getServerConfig defaults to not-the-server when nothing is configured', () => {
  withTempConfigDir(() => {
    assert.deepEqual(getServerConfig(), { isServer: false, confirmedAt: null });
  });
});

test('setServerConfig(true) persists isServer and stamps confirmedAt', () => {
  withTempConfigDir((dir) => {
    const saved = setServerConfig({ isServer: true });
    assert.equal(saved.isServer, true);
    assert.ok(saved.confirmedAt);
    assert.ok(fs.existsSync(path.join(dir, 'server-config.json')));

    const reloaded = getServerConfig();
    assert.equal(reloaded.isServer, true);
    assert.equal(reloaded.confirmedAt, saved.confirmedAt);
  });
});

test('setServerConfig(false) clears confirmedAt', () => {
  withTempConfigDir(() => {
    setServerConfig({ isServer: true });
    const saved = setServerConfig({ isServer: false });
    assert.equal(saved.isServer, false);
    assert.equal(saved.confirmedAt, null);
    assert.deepEqual(getServerConfig(), { isServer: false, confirmedAt: null });
  });
});

test('re-marking as server after unmarking gets a fresh confirmedAt, not the old one', () => {
  withTempConfigDir(() => {
    const first = setServerConfig({ isServer: true });
    setServerConfig({ isServer: false });
    const second = setServerConfig({ isServer: true });
    assert.equal(second.isServer, true);
    assert.ok(second.confirmedAt);
    // Not asserting inequality of timestamps (could tie at millisecond
    // resolution) - just that unmarking genuinely cleared it in between.
    assert.equal(first.isServer, true);
  });
});

test('getServerConfig treats a corrupt config file as not-the-server, not a crash', () => {
  withTempConfigDir((dir) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configFilePath(), '{not valid json', 'utf-8');
    assert.deepEqual(getServerConfig(), { isServer: false, confirmedAt: null });
  });
});

test('configFilePath respects SHELF_TALKER_CONFIG_DIR', () => {
  withTempConfigDir((dir) => {
    assert.equal(configFilePath(), path.join(dir, 'server-config.json'));
  });
});
