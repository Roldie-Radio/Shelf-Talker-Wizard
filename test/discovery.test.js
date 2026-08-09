const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');

const {
  buildAnnouncePayload, parseAnnouncePayload, isStale, createBeacon,
} = require('../server/discovery');

// A distinct port from DISCOVERY_PORT (41234) - real deployments must all
// agree on that one, but these tests bind their own real sockets and
// shouldn't fight a real running copy of the app on the same machine.
const TEST_PORT = 41567;

test('buildAnnouncePayload/parseAnnouncePayload round-trip', () => {
  const raw = buildAnnouncePayload({
    instanceId: 'sender-1',
    hostname: 'REGISTER-1',
    addresses: ['192.168.1.50'],
    confirmedAt: '2026-08-09T12:00:00.000Z',
  });
  const parsed = parseAnnouncePayload(raw, 'receiver-1');
  assert.deepEqual(parsed, {
    hostname: 'REGISTER-1',
    addresses: ['192.168.1.50'],
    confirmedAt: '2026-08-09T12:00:00.000Z',
  });
});

test('parseAnnouncePayload filters out our own broadcast echoing back', () => {
  const raw = buildAnnouncePayload({
    instanceId: 'same-id', hostname: 'REGISTER-1', addresses: [], confirmedAt: null,
  });
  assert.equal(parseAnnouncePayload(raw, 'same-id'), null);
});

test('parseAnnouncePayload rejects malformed JSON instead of throwing', () => {
  assert.equal(parseAnnouncePayload('{not valid json', 'receiver-1'), null);
});

test('parseAnnouncePayload rejects payloads without the right magic', () => {
  const raw = JSON.stringify({
    magic: 'something-else', instanceId: 'sender-1', hostname: 'X', addresses: [],
  });
  assert.equal(parseAnnouncePayload(raw, 'receiver-1'), null);
});

test('parseAnnouncePayload rejects payloads missing hostname/addresses', () => {
  const raw = buildAnnouncePayload({ instanceId: 'sender-1', addresses: ['1.2.3.4'] });
  assert.equal(parseAnnouncePayload(raw, 'receiver-1'), null);
});

test('isStale: fresh timestamps are not stale, old ones are', () => {
  const now = Date.parse('2026-08-09T12:00:00.000Z');
  assert.equal(isStale('2026-08-09T11:59:50.000Z', now), false); // 10s ago
  assert.equal(isStale('2026-08-09T11:59:40.000Z', now), true); // 20s ago
  assert.equal(isStale('not a date', now), true);
});

test('createBeacon: a listener sees a real announcement sent over an actual UDP socket', async () => {
  // Two real PCs never share a bind port, but two beacons in one test
  // process on one machine would if both bound TEST_PORT - the OS would
  // deliver each datagram to only one of the two sockets, arbitrarily
  // (frequently back to the sender itself). Binding the sender to a
  // different port and pointing it at the listener's via destinationPort
  // sidesteps that, without changing how two distinct real PCs behave.
  const sender = createBeacon({ port: TEST_PORT + 10 });
  const listener = createBeacon({ port: TEST_PORT });
  try {
    listener.startListening();
    assert.equal(listener.getDiscoveredServer(), null);

    sender.startAnnouncing({
      confirmedAt: '2026-08-09T12:00:00.000Z', address: '127.0.0.1', destinationPort: TEST_PORT,
    });

    // startAnnouncing sends immediately, but delivery is still async -
    // poll briefly instead of assuming it's landed the instant we return.
    const deadline = Date.now() + 2000;
    let seen = null;
    while (Date.now() < deadline) {
      seen = listener.getDiscoveredServer();
      if (seen) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.ok(seen, 'expected the listener to have received the sender\'s announcement');
    assert.equal(seen.hostname, os.hostname());
    assert.equal(seen.confirmedAt, '2026-08-09T12:00:00.000Z');
    assert.ok(Array.isArray(seen.addresses));
  } finally {
    sender.stop();
    listener.stop();
  }
});

test('createBeacon: a beacon never hears its own announcement', async () => {
  const beacon = createBeacon({ port: TEST_PORT + 1 });
  try {
    beacon.startAnnouncing({ confirmedAt: '2026-08-09T12:00:00.000Z', address: '127.0.0.1' });
    // Give a self-echo every opportunity to arrive if the self-filter were broken.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(beacon.getDiscoveredServer(), null);
  } finally {
    beacon.stop();
  }
});

test('createBeacon: stopAnnouncing stops new announcements without closing the listening socket', async () => {
  const sender = createBeacon({ port: TEST_PORT + 11 });
  const listener = createBeacon({ port: TEST_PORT + 2 });
  try {
    listener.startListening();
    sender.startAnnouncing({
      confirmedAt: '2026-08-09T12:00:00.000Z', address: '127.0.0.1', destinationPort: TEST_PORT + 2,
    });

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !listener.getDiscoveredServer()) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(listener.getDiscoveredServer(), 'setup: expected an announcement before stopping it');

    sender.stopAnnouncing();
    // stopAnnouncing only stops future sends; the one already received
    // stays visible until it goes stale on its own (see isStale test above).
    assert.ok(listener.getDiscoveredServer());
  } finally {
    sender.stop();
    listener.stop();
  }
});
