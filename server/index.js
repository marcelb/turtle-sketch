import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// y-protocols@1.0.7 no longer exports these; wire values are fixed by the protocol
const messageSync = 0;
const messageAwareness = 1;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/data';
const STATIC_DIR = path.join(__dirname, '..', 'client', 'dist');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const WORKSPACES_FILE = path.join(DATA_DIR, 'workspaces.json');
const MAX_BACKUPS = 25;
const PERSIST_DEBOUNCE_MS = 2000;
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const safeName = (name) => /^[A-Za-z0-9_-]{1,64}$/.test(name);
const safeRoom = (name) => /^[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{1,64})?$/.test(name);

// ---------- workspaces ----------
// A workspace is a named container of boards. Rooms (boards) are named "<ws>/<board>"
// and stored as DATA_DIR/<ws>/<board>.bin. "Using is creating": opening a URL with a
// workspace or board id creates the record/file even if it did not exist before.

/** @type {Map<string, {id: string, name: string, lastChange: number}>} */
const workspaces = new Map();

function loadWorkspaces() {
  try {
    for (const w of JSON.parse(fs.readFileSync(WORKSPACES_FILE, 'utf8'))) {
      if (w && safeName(w.id)) workspaces.set(w.id, { id: w.id, name: String(w.name || ''), lastChange: Number(w.lastChange) || Date.now() });
    }
  } catch { /* no registry yet */ }
}
function saveWorkspaces() {
  const tmp = WORKSPACES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify([...workspaces.values()]));
  fs.renameSync(tmp, WORKSPACES_FILE);
}
function ensureWorkspace(id, name) {
  if (!safeName(id)) return null;
  let w = workspaces.get(id);
  if (!w) {
    w = { id, name: (name || '').replace(/\s+/g, ' ').trim().slice(0, 128) || `Untitled_${id}`, lastChange: Date.now() };
    workspaces.set(id, w);
    saveWorkspaces();
    console.log(`[workspace] created ${id} (${w.name})`);
  }
  return w;
}
loadWorkspaces();
// a board directory on disk implies the workspace exists, even without a registry entry
for (const d of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
  if (d.isDirectory() && d.name !== 'backups' && safeName(d.name)) ensureWorkspace(d.name);
}

// ---------- room state ----------

/** @type {Map<string, {name: string, doc: Y.Doc, conns: Set<any>, dirty: boolean, timer: any, lastBackup: number}>} */
const rooms = new Map();

const roomFile = (name) => path.join(DATA_DIR, ...name.split('/')) + '.bin';
const roomBackupDir = (name) => path.join(BACKUP_DIR, ...name.split('/').slice(0, -1));

function pruneBackups(name) {
  const dir = roomBackupDir(name);
  if (!fs.existsSync(dir)) return;
  const base = name.split('/').pop();
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.`) && f.endsWith('.bin'))
    .sort();
  while (files.length > MAX_BACKUPS) {
    fs.unlinkSync(path.join(dir, files.shift()));
  }
}

function persist(room) {
  if (!room.dirty) return;
  room.dirty = false;
  // stamp the last-change time into the doc meta so the dashboard can read it from disk;
  // the saving flag keeps this update out of the broadcast/persist path
  room.saving = true;
  try { room.doc.getMap('meta').set('lastChange', Date.now()); } finally { room.saving = false; }
  const file = roomFile(room.name);
  // rotate the previous state into a timestamped backup (bounded window)
  if (fs.existsSync(file)) {
    const now = Date.now();
    if (now - room.lastBackup > BACKUP_INTERVAL_MS) {
      room.lastBackup = now;
      const bdir = roomBackupDir(room.name);
      fs.mkdirSync(bdir, { recursive: true });
      fs.copyFileSync(file, path.join(bdir, `${room.name.split('/').pop()}.${now}.bin`));
      pruneBackups(room.name);
    }
  }
  const update = Y.encodeStateAsUpdate(room.doc); // full compacted state, one blob
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, update);
  fs.renameSync(tmp, file); // atomic replace
  console.log(`[persist] ${room.name}: ${update.length} bytes, ${room.doc.getMap('shapes').size} shapes`);
}

function schedulePersist(room) {
  if (room.timer) return;
  room.timer = setTimeout(() => {
    room.timer = null;
    try { persist(room); } catch (e) { console.error('[persist] failed', room.name, e); }
  }, PERSIST_DEBOUNCE_MS);
}

function getRoom(name) {
  let room = rooms.get(name);
  if (room) return room;
  const doc = new Y.Doc();
  doc.awareness = new awarenessProtocol.Awareness(doc);
  const file = roomFile(name);
  if (fs.existsSync(file)) {
    try {
      Y.applyUpdate(doc, fs.readFileSync(file));
      console.log(`[load] ${name}: ${doc.getMap('shapes').size} shapes from disk`);
    } catch (e) {
      console.error(`[load] ${name}: failed to read ${file}, starting empty`, e);
    }
  }
  room = { name, doc, conns: new Set(), dirty: true, timer: null, lastBackup: 0, lastChange: Date.now(), saving: false };
  schedulePersist(room); // create the room file immediately so the dashboard lists it

  doc.on('update', (update, origin) => {
    if (room.saving) return;
    room.lastChange = Date.now();
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const msg = encoding.toUint8Array(encoder);
    for (const conn of room.conns) {
      if (conn !== origin && conn.readyState === 1) conn.send(msg);
    }
    room.dirty = true;
    schedulePersist(room);
  });

  doc.awareness.on('update', ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed);
    if (changed.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, changed));
    const msg = encoding.toUint8Array(encoder);
    for (const conn of room.conns) {
      if (conn !== origin && conn.readyState === 1) conn.send(msg);
    }
  });

  rooms.set(name, room);
  // a namespaced room implies its workspace exists ("using is creating")
  if (name.includes('/')) ensureWorkspace(name.split('/')[0]);
  return room;
}

// read title/lastChange out of a board file without keeping the doc around
function readBoardMeta(file) {
  let name = null;
  let lastChange = null;
  try { lastChange = fs.statSync(file).mtimeMs; } catch {}
  try {
    const d = new Y.Doc();
    Y.applyUpdate(d, fs.readFileSync(file));
    const m = d.getMap('meta');
    if (typeof m.get('title') === 'string' && m.get('title')) name = m.get('title');
    if (typeof m.get('lastChange') === 'number') lastChange = m.get('lastChange');
  } catch { /* unreadable file: keep fallbacks */ }
  return { name, lastChange };
}

// list boards of one workspace (wsId set) or of all workspaces (wsId null);
// in-memory rooms plus board files on disk, newest first
function listBoards(wsId) {
  const list = [];
  const seen = new Set();
  const prefix = wsId ? wsId + '/' : null;
  for (const room of rooms.values()) {
    if (prefix && !room.name.startsWith(prefix)) continue;
    seen.add(room.name);
    const m = room.doc.getMap('meta');
    const title = m.get('title');
    const lc = m.get('lastChange');
    const base = room.name.split('/').pop();
    list.push({
      id: base,
      room: room.name,
      name: typeof title === 'string' && title ? title : `Untitled_${base}`,
      lastChange: typeof lc === 'number' ? lc : room.lastChange || Date.now(),
    });
  }
  // boards live in per-workspace subdirectories; root-level .bin files are legacy and ignored
  const dirs = wsId ? [[wsId, path.join(DATA_DIR, wsId)]] : [...workspaces.keys()].map((ws) => [ws, path.join(DATA_DIR, ws)]);
  for (const [ws, dir] of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.bin')) continue;
      const base = f.slice(0, -4);
      const full = `${ws}/${base}`;
      if (seen.has(full) || !safeRoom(full)) continue;
      const { name, lastChange } = readBoardMeta(path.join(dir, f));
      list.push({
        id: base,
        room: full,
        name: name || `Untitled_${base}`,
        lastChange: lastChange || Date.now(),
      });
    }
  }
  list.sort((a, b) => b.lastChange - a.lastChange);
  return list;
}

function deleteRoom(name) {
  const room = rooms.get(name);
  if (room) {
    for (const conn of room.conns) { try { conn.terminate(); } catch {} }
    rooms.delete(name);
  }
  try { fs.unlinkSync(roomFile(name)); } catch {}
  const dir = roomBackupDir(name);
  if (fs.existsSync(dir)) {
    const base = name.split('/').pop();
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${base}.`) && f.endsWith('.bin')) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
    }
  }
}

// ---------- websocket sync ----------

const wss = new WebSocketServer({ noServer: true });

function handleConnection(ws, room) {
  room.conns.add(ws);

  // initial sync: ask the client for its state vector, reply with ours
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, messageSync);
  syncProtocol.writeSyncStep1(enc, room.doc);
  ws.send(encoding.toUint8Array(enc));

  // send current presence snapshot
  const states = room.doc.awareness.getStates();
  if (states.size > 0) {
    const enc2 = encoding.createEncoder();
    encoding.writeVarUint(enc2, messageAwareness);
    encoding.writeVarUint8Array(enc2, awarenessProtocol.encodeAwarenessUpdate(room.doc.awareness, [...states.keys()]));
    ws.send(encoding.toUint8Array(enc2));
  }

  ws.on('message', (data) => {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const encoder = encoding.createEncoder();
      const messageType = decoding.readVarUint(decoder);
      if (messageType === messageSync) {
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
      } else if (messageType === messageAwareness) {
        awarenessProtocol.applyAwarenessUpdate(room.doc.awareness, decoding.readVarUint8Array(decoder), ws);
      }
      if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
    } catch (e) {
      console.error('[ws] message error', e);
    }
  });

  const close = () => {
    room.conns.delete(ws);
    awarenessProtocol.removeAwarenessStates(room.doc.awareness, [ws], 'disconnect');
    if (room.conns.size === 0) schedulePersist(room);
  };
  ws.on('close', close);
  ws.on('error', close);
}

// ---------- static files ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: APP_VERSION }));
    return;
  }
  const json = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const readBody = () => new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });

  if (url.pathname === '/api/workspaces' && req.method === 'GET') {
    // every workspace record plus workspace dirs on disk; lastChange also covers board activity
    const list = [];
    for (const d of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
      if (d.isDirectory() && d.name !== 'backups' && safeName(d.name)) ensureWorkspace(d.name);
    }
    for (const w of workspaces.values()) {
      let lastChange = w.lastChange;
      const seen = new Set();
      for (const room of rooms.values()) {
        if (room.name.startsWith(w.id + '/')) {
          seen.add(room.name.split('/').pop());
          lastChange = Math.max(lastChange, room.lastChange || 0);
        }
      }
      const dir = path.join(DATA_DIR, w.id);
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith('.bin')) continue;
          const base = f.slice(0, -4);
          if (!seen.has(base)) seen.add(base);
          try { lastChange = Math.max(lastChange, fs.statSync(path.join(dir, f)).mtimeMs); } catch {}
        }
      }
      list.push({ id: w.id, name: w.name, lastChange, boards: seen.size });
    }
    list.sort((a, b) => b.lastChange - a.lastChange);
    json(200, list);
    return;
  }
  const wsMatch = /^\/api\/workspaces\/([^/]+)(?:\/(boards)(?:\/([^/]+))?)?$/.exec(url.pathname);
  if (wsMatch) {
    const ws = decodeURIComponent(wsMatch[1]).slice(0, 64);
    if (!safeName(ws)) { json(400, { error: 'bad name' }); return; }
    if (!wsMatch[2]) {
      if (req.method === 'POST') {
        // "using is creating": opening a workspace URL registers it
        const body = await readBody();
        const w = ensureWorkspace(ws, typeof body.name === 'string' ? body.name : '');
        json(200, w);
        return;
      }
      if (req.method === 'PUT') {
        const body = await readBody();
        const w = workspaces.get(ws);
        if (!w) { json(404, { error: 'no such workspace' }); return; }
        const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 128);
        if (name) { w.name = name; w.lastChange = Date.now(); saveWorkspaces(); }
        json(200, w);
        return;
      }
      if (req.method === 'DELETE') {
        // deleting a workspace deletes all boards inside it
        for (const name of [...rooms.keys()]) {
          if (name.startsWith(ws + '/')) deleteRoom(name);
        }
        workspaces.delete(ws);
        saveWorkspaces();
        fs.rmSync(path.join(DATA_DIR, ws), { recursive: true, force: true });
        fs.rmSync(path.join(BACKUP_DIR, ws), { recursive: true, force: true });
        json(200, { ok: true });
        return;
      }
      json(405, { error: 'method not allowed' });
      return;
    }
    if (wsMatch[2] === 'boards' && !wsMatch[3] && req.method === 'GET') {
      ensureWorkspace(ws);
      json(200, listBoards(ws));
      return;
    }
    if (wsMatch[2] === 'boards' && wsMatch[3] && req.method === 'PUT') {
      const board = decodeURIComponent(wsMatch[3]).slice(0, 64);
      const full = `${ws}/${board}`;
      if (!safeRoom(full)) { json(400, { error: 'bad name' }); return; }
      const body = await readBody();
      const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 128) || `Untitled_${board}`;
      const room = rooms.get(full);
      if (room) {
        room.saving = true; // keep the title update out of the broadcast path
        try { room.doc.getMap('meta').set('title', name); } finally { room.saving = false; }
        room.dirty = true;
        schedulePersist(room);
      } else {
        const file = roomFile(full);
        const d = new Y.Doc();
        if (fs.existsSync(file)) { try { Y.applyUpdate(d, fs.readFileSync(file)); } catch {} }
        d.getMap('meta').set('title', name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, Y.encodeStateAsUpdate(d));
        fs.renameSync(tmp, file);
      }
      json(200, { ok: true, name });
      return;
    }
    if (wsMatch[2] === 'boards' && wsMatch[3] && req.method === 'DELETE') {
      const board = decodeURIComponent(wsMatch[3]).slice(0, 64);
      if (!safeRoom(`${ws}/${board}`)) { json(400, { error: 'bad name' }); return; }
      deleteRoom(`${ws}/${board}`);
      json(200, { ok: true });
      return;
    }
    json(405, { error: 'method not allowed' });
    return;
  }
  if (url.pathname === '/api/rooms' && req.method === 'GET') {
    // all boards across all workspaces (readiness probe + flat list), newest first
    json(200, listBoards(null));
    return;
  }
  if (url.pathname.startsWith('/api/rooms/') && req.method === 'DELETE') {
    const name = decodeURIComponent(url.pathname.slice('/api/rooms/'.length)).slice(0, 130);
    if (!safeRoom(name)) { json(400, { error: 'bad name' }); return; }
    deleteRoom(name);
    json(200, { ok: true });
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(STATIC_DIR, p));
  // path-boundary check: a plain startsWith would also allow sibling dirs like "dist-backup"
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + path.sep)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/ws/')) {
    socket.destroy();
    return;
  }
  // room names are "<ws>/<board>"; tolerate the provider appending the room again
  // (/ws/ws/board/ws/board) by collapsing a doubled tail
  let seg = decodeURIComponent(url.pathname.slice(4)).split('/').filter(Boolean).map((s) => s.slice(0, 64));
  if (seg.length > 2 && seg.slice(0, 2).join('/') === seg.slice(2, 4).join('/')) seg = seg.slice(0, 2);
  const name = seg.slice(0, 2).join('/');
  if (!safeRoom(name)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleConnection(ws, getRoom(name));
  });
});

function shutdown() {
  console.log('[shutdown] persisting all rooms...');
  for (const room of rooms.values()) {
    if (room.timer) clearTimeout(room.timer);
    try { persist(room); } catch (e) { console.error('[shutdown] persist failed', room.name, e); }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`turtle-sketch listening on :${PORT}, data dir ${DATA_DIR}, static ${STATIC_DIR}`);
});
