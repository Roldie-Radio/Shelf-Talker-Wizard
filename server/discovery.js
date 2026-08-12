// LAN visibility for the "Server PC" flag (see serverConfig.js): the PC
// currently marked as the main store PC periodically broadcasts a small UDP
// announcement so *other* PCs on the same network can see which one it is.
// This is visibility only, same spirit as serverConfig.js itself - no Print
// History data crosses PCs, and neither PC's main HTTP server becomes
// reachable from the network (that's still 127.0.0.1-only,
// see index.js's start()). The UDP announcement is a separate, much smaller
// surface than the HTTP API - so is exportSync.js's own export-serve port,
// the only other thing that leaves the PC (see that file), which reuses
// this beacon's own discoveredServer to know where to fetch from.
//
// The wire format and staleness/self-filtering logic below are plain,
// dependency-free functions so they can be unit tested without opening a
// real socket (see test/discovery.test.js). createBeacon() is what wires
// them to an actual UDP socket - it's only ever instantiated from index.js's
// start(), never from createApp() itself, so building (or testing) the
// Express app never binds a network socket as a side effect.

const dgram = require('dgram');
const os = require('os');

const DISCOVERY_PORT = 41234;
const ANNOUNCE_INTERVAL_MS = 4000;
// An announcement not renewed within this long is treated as stale (the
// announcing PC was unmarked, closed, or dropped off the network) rather
// than shown forever - about 3-4 missed broadcasts' worth of grace.
const STALE_AFTER_MS = 15000;
const MAGIC = 'shelf-talker-wizard-server-announce/v1';

function localAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

function buildAnnouncePayload({ instanceId, hostname, addresses, confirmedAt }) {
  return JSON.stringify({
    magic: MAGIC, instanceId, hostname, addresses, confirmedAt,
  });
}

// Returns the parsed announcement, or null if `raw` isn't one of ours, is
// malformed, or is our own broadcast echoing back (a UDP broadcast reaches
// its own sender too) - callers never need to special-case any of that.
function parseAnnouncePayload(raw, ownInstanceId) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!payload || payload.magic !== MAGIC || !payload.instanceId) return null;
  if (payload.instanceId === ownInstanceId) return null;
  if (typeof payload.hostname !== 'string' || !Array.isArray(payload.addresses)) return null;
  return {
    hostname: payload.hostname,
    addresses: payload.addresses,
    confirmedAt: typeof payload.confirmedAt === 'string' ? payload.confirmedAt : null,
  };
}

function isStale(receivedAtIso, now = Date.now()) {
  const receivedAt = new Date(receivedAtIso).getTime();
  if (Number.isNaN(receivedAt)) return true;
  return now - receivedAt > STALE_AFTER_MS;
}

/**
 * Wires the payload/staleness logic above to a real UDP socket. Every PC
 * listens all the time (so unmarking the server PC, or marking a different
 * one, is visible on the others within one stale window); only a PC
 * currently marked isServer actually sends.
 *
 * `port` defaults to DISCOVERY_PORT (the real rendezvous port every install
 * agrees on) but is overridable so tests can use one that isn't shared with
 * a real running copy of the app on the same machine.
 */
function createBeacon({ port = DISCOVERY_PORT } = {}) {
  const instanceId = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  let socket = null;
  let announceTimer = null;
  let lastSeen = null; // { hostname, addresses, confirmedAt, receivedAt }

  function ensureSocket() {
    if (socket) return socket;
    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', (msg) => {
      const parsed = parseAnnouncePayload(msg.toString('utf-8'), instanceId);
      if (!parsed) return;
      lastSeen = { ...parsed, receivedAt: new Date().toISOString() };
    });
    // Best-effort: a locked-down network profile that blocks UDP broadcast
    // just means this PC never sees or sends an announcement - nothing else
    // in the app depends on this working.
    socket.on('error', () => {});
    socket.bind(port, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        // ignore - sends below will just fail silently too
      }
    });
    return socket;
  }

  function startListening() {
    ensureSocket();
  }

  // `address` and `destinationPort` are overridable for tests; every real
  // caller wants the LAN broadcast address on this same beacon's own port
  // (that's the whole point of a well-known rendezvous port - every real
  // install agrees on it, so there's never a reason to send anywhere else).
  // The override exists because two *different* real PCs never collide on
  // a bind port the way two beacons in one test process would if they both
  // bound DISCOVERY_PORT on the same machine - tests use it to stand in for
  // "another PC" without that collision, not because production ever needs
  // a different destination.
  function startAnnouncing({ confirmedAt, address = '255.255.255.255', destinationPort = port }) {
    stopAnnouncing();
    const sock = ensureSocket();
    const send = () => {
      const payload = buildAnnouncePayload({
        instanceId, hostname: os.hostname(), addresses: localAddresses(), confirmedAt,
      });
      try {
        sock.send(payload, destinationPort, address);
      } catch {
        // retried on the next tick
      }
    };
    send();
    announceTimer = setInterval(send, ANNOUNCE_INTERVAL_MS);
    if (announceTimer.unref) announceTimer.unref();
  }

  function stopAnnouncing() {
    if (announceTimer) {
      clearInterval(announceTimer);
      announceTimer = null;
    }
  }

  function getDiscoveredServer() {
    if (!lastSeen || isStale(lastSeen.receivedAt)) return null;
    return lastSeen;
  }

  function stop() {
    stopAnnouncing();
    if (socket) {
      socket.close();
      socket = null;
    }
    lastSeen = null;
  }

  return {
    startListening, startAnnouncing, stopAnnouncing, getDiscoveredServer, stop, instanceId,
  };
}

module.exports = {
  DISCOVERY_PORT,
  ANNOUNCE_INTERVAL_MS,
  STALE_AFTER_MS,
  buildAnnouncePayload,
  parseAnnouncePayload,
  isStale,
  createBeacon,
};
