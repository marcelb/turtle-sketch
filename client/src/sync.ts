import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Awareness } from 'y-protocols/awareness';
import type { Shape } from './types';

export const doc = new Y.Doc();
export const shapes = doc.getMap<Shape>('shapes');
export const meta = doc.getMap<string>('meta'); // room-level key/values (title)

// Undo only local edits, keep a bounded number of steps.
export const undoManager = new Y.UndoManager(shapes, {
  trackedOrigins: new Set(['local']),
  captureTimeout: 300,
});
const MAX_STEPS = 30;
export function pruneUndo(): void {
  while (undoManager.undoStack.length > MAX_STEPS) undoManager.undoStack.shift();
  while (undoManager.redoStack.length > MAX_STEPS) undoManager.redoStack.shift();
}

export function commit(fn: () => void): void {
  doc.transact(fn, 'local');
  pruneUndo();
}

export const MAX_TITLE = 128;
export function getTitle(): string {
  return meta.get('title') || `Untitled_${boardId || 'board'}`;
}
export function setTitle(t: string): void {
  const v = t.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  commit(() => meta.set('title', v || `Untitled_${boardId || 'board'}`));
}

// URL routing: no hash = index (workspace list), #ws = workspace page (board list),
// #ws/board = the whiteboard app
function parseHash(): { ws: string; board: string } {
  let h = location.hash.replace(/^#/, '');
  try { h = decodeURIComponent(h); } catch { /* keep raw */ }
  const seg = h.split('/').filter(Boolean).map((s) => s.slice(0, 64)).slice(0, 2);
  return { ws: seg[0] || '', board: seg[1] || '' };
}
const parsed = parseHash();
export const wsId = parsed.ws;
export const boardId = parsed.board;

const proto = location.protocol === 'https:' ? 'wss' : 'ws';
export const room = boardId ? `${wsId}/${boardId}` : ''; // empty outside a board
export const provider = room ? new WebsocketProvider(`${proto}://${location.host}/ws`, room, doc) : null;
export const awareness = provider ? provider.awareness : new Awareness(doc);

const PALETTE = ['#e5534b', '#d29922', '#57ab5a', '#4a6cf7', '#9a6ee8', '#e36f9d', '#3aa7a3', '#e8702a'];

// stable identity for this browser, so a reconnecting tab isn't shown as a new user
export function getUid(): string {
  let u = localStorage.getItem('wb-uid');
  if (!u) {
    u = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('wb-uid', u);
  }
  return u;
}
export const myUid = getUid();

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
// color derives from the stable uid, so it survives page refreshes
export const myColor = PALETTE[hashStr(myUid) % PALETTE.length];

export function getName(): string {
  let n = localStorage.getItem('wb-name');
  if (!n) {
    n = 'User-' + Math.random().toString(36).slice(2, 6);
    localStorage.setItem('wb-name', n);
  }
  return n;
}

export function setName(n: string): void {
  localStorage.setItem('wb-name', n);
  awareness.setLocalStateField('name', n);
}

if (provider) {
  awareness.setLocalStateField('name', getName());
  awareness.setLocalStateField('color', myColor);
  awareness.setLocalStateField('uid', myUid);
  awareness.setLocalStateField('t', Date.now()); // heartbeat; board.ts refreshes it every second
  awareness.setLocalStateField('cursor', null);
}
