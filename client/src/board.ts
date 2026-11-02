import { doc, shapes, awareness, commit, myUid, provider, boardId } from './sync';
import type { Shape } from './types';
import { uid, clamp, centerOf, contains, rectsIntersect, segIntersectsRect, normEp, borderPoint, insideShape, distToShape, distToOutline, distToFrameBorder, rotOf, rotOffset, localPoint, worldPoint, cornersOf } from './util';
import type { TextRun, Endpoint } from './types';

export type Tool = 'select' | 'hand' | 'rect' | 'ellipse' | 'diamond' | 'text' | 'arrow' | 'elbow' | 'frame';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('board') as unknown as SVGSVGElement;
const zoomEl = document.getElementById('zoom') as HTMLSpanElement;
const fmtbar = document.getElementById('fmtbar') as HTMLDivElement;
const usersEl = document.getElementById('users') as HTMLDivElement;

export const vp = { x: 60, y: 60, k: 1 };
export let tool: Tool = 'select';
export const selected = new Set<string>();

// layers inside the viewport use world coordinates; cursors use screen coordinates
const layers: Record<string, SVGGElement> = {};
for (const name of ['viewport', 'frames', 'shapes', 'selection', 'overlay', 'edit']) {
  layers[name] = document.createElementNS(SVGNS, 'g');
  layers[name].id = name;
}
layers.viewport.append(layers.frames, layers.shapes, layers.selection, layers.overlay, layers.edit);
svg.append(layers.viewport, layers.cursors = document.createElementNS(SVGNS, 'g'));
layers.cursors.id = 'cursors';
const shapeClips = el('g', { class: 'shape-clips' }, svg.querySelector('defs')!);

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
}

export function setTool(t: Tool): void {
  tool = t;
  svg.classList.toggle('hand', t === 'hand');
  document.querySelectorAll('#tools button[data-tool]').forEach((b) => {
    b.classList.toggle('active', (b as HTMLButtonElement).dataset.tool === t);
  });
}

function screenToWorld(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left - vp.x) / vp.k, y: (e.clientY - r.top - vp.y) / vp.k };
}

function applyTransform(): void {
  layers.viewport.setAttribute('transform', `translate(${vp.x} ${vp.y}) scale(${vp.k})`);
  zoomEl.textContent = `${Math.round(vp.k * 100)}%`;
  svg.style.backgroundPosition = `${vp.x}px ${vp.y}px`; // keep dot grid aligned with the world
  renderCursors();
  positionFmtBar();
}

// ---------- rendering ----------

let renderQueued = false;
export function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}
shapes.observe(() => scheduleRender());

type Align = NonNullable<Shape['align']>;
type VAlign = NonNullable<Shape['valign']>;
const effAlignOf = (s: Shape): Align => s.align ?? (s.type === 'frame' || s.type === 'text' ? 'left' : 'center');
const effValignOf = (s: Shape): VAlign => s.valign ?? (s.type === 'frame' || s.type === 'text' ? 'top' : 'middle');
// effective bold of the whole text: true only if every run is effectively bold (run override
// or shape base); used for the bold button state and toggle direction so run-level bold
// (e.g. applied via select-all in the editor) doesn't get mistaken for "not bold"
const effBoldOf = (s: Shape): boolean => {
  const runs = s.runs ?? [];
  if (!runs.length) return !!s.bold;
  return runs.every((r) => r.b ?? !!s.bold);
};
const effItalicOf = (s: Shape): boolean => {
  const runs = s.runs ?? [];
  if (!runs.length) return !!s.italic;
  return runs.every((r) => r.i ?? !!s.italic);
};

// ---------- rich text model <-> rendering ----------

// measure with a hidden SVG text node inside the board itself, so widths come from the
// same font rendering as the drawn tspans (canvas measureText disagrees with DOM layout,
// especially for bold, which made the wrapper hard-break words that fit fine)
const measureEl = el('text', { visibility: 'hidden', 'pointer-events': 'none', 'xml:space': 'preserve' }, svg);
function widthOf(t: string, size: number, bold: boolean, italic = false): number {
  measureEl.setAttribute('font-size', String(size));
  measureEl.setAttribute('font-weight', bold ? '700' : '400');
  if (italic) measureEl.setAttribute('font-style', 'italic');
  else measureEl.removeAttribute('font-style');
  measureEl.textContent = t;
  return measureEl.getComputedTextLength();
}
function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// normalize a CSS color to #rrggbb (browsers report inline styles as rgb()/rgba())
function toHexColor(c: string): string {
  const m = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((h) => h + h).join('').toLowerCase();
  return c;
}
// text color is independent of the border color
const textColorOf = (s: Shape): string => s.color ?? '#1a1a1a';
function shapeRuns(s: Shape): TextRun[] {
  if (s.runs && s.runs.length) return s.runs;
  const text = s.type === 'frame' ? (s.name ?? '') : (s.text ?? '');
  return text ? [{ t: text }] : [];
}
function runsToHtml(runs: TextRun[]): string {
  return runs
    .map((r) => {
      let h = escapeHtml(r.t).replace(/\n/g, '<br>');
      if (r.s) h = `<span style="font-size:${r.s}px">${h}</span>`;
      if (r.c) h = `<span style="color:${r.c}">${h}</span>`;
      if (r.b === true) h = `<b>${h}</b>`;
      else if (r.b === false) h = `<span style="font-weight:400">${h}</span>`; // explicit not-bold
      if (r.i === true) h = `<i>${h}</i>`;
      else if (r.i === false) h = `<span style="font-style:normal">${h}</span>`; // explicit not-italic
      return h;
    })
    .join('');
}
function mergeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.b === r.b && last.i === r.i && last.s === r.s && last.c === r.c) last.t += r.t;
    else out.push({ ...r });
  }
  return out;
}
function htmlToRuns(div: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];
  // a block element boundary is a newline, unless the previous run already ends with one
  // (e.g. <div><br></div> for an empty line must not produce two newlines)
  const pushNl = (): void => {
    const last = runs[runs.length - 1];
    if (!last || last.t === '\n' || last.t.endsWith('\n')) return;
    runs.push({ t: '\n' });
  };
  // b/i are tri-state: undefined = inherit the shape's base, true/false = explicit override;
  // c is the explicit text color (undefined = inherit the shape's base color)
  const walk = (node: Node, b: boolean | undefined, it: boolean | undefined, sz: number | undefined, col: string | undefined): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) runs.push({ t: node.textContent, ...(b !== undefined ? { b } : {}), ...(it !== undefined ? { i: it } : {}), ...(sz ? { s: sz } : {}), ...(col ? { c: col } : {}) });
    } else if (node.nodeName === 'BR') {
      runs.push({ t: '\n' });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const eln = node as HTMLElement;
      if (eln.nodeName === 'DIV' || eln.nodeName === 'P' || eln.nodeName === 'LI') pushNl();
      const fw = eln.style.fontWeight;
      let nb = b;
      if (eln.nodeName === 'B' || eln.nodeName === 'STRONG' || fw === '700' || fw === 'bold') nb = true;
      else if (fw === '400' || fw === 'normal') nb = false;
      const fs = eln.style.fontStyle;
      let ni = it;
      if (eln.nodeName === 'I' || eln.nodeName === 'EM' || fs === 'italic' || fs === 'oblique') ni = true;
      else if (fs === 'normal') ni = false;
      let ns = sz;
      if (eln.nodeName === 'SPAN' && eln.style.fontSize) {
        const p = parseInt(eln.style.fontSize);
        if (!isNaN(p)) ns = p;
      }
      let nc = col;
      if (eln.style.color) nc = toHexColor(eln.style.color);
      eln.childNodes.forEach((c) => walk(c, nb, ni, ns, nc));
    }
  };
  div.childNodes.forEach((c) => walk(c, undefined, undefined, undefined, undefined));
  return mergeRuns(runs);
}
interface LineSeg { t: string; b: boolean; i: boolean; s: number; c?: string }
// Greedy word-wrap of the whole run stream at maxW, like the contenteditable's pre-wrap:
// all runs are tokenized into words/whitespace first, so a word that doesn't fit the rest of
// the current line moves whole to the next line (never hard-broken mid-word unless it is
// longer than a full line), and spaces at run boundaries count toward the line width.
function splitLines(runs: TextRun[], baseFs: number, baseBold: boolean, baseItalic: boolean, maxW: number): { segs: LineSeg[]; lineH: number }[] {
  interface Tok { t: string; b: boolean; i: boolean; s: number; c?: string; nl?: boolean; ri: number }
  const toks: Tok[] = [];
  runs.forEach((r, ri) => {
    const s = r.s ?? baseFs;
    const b = r.b ?? baseBold;
    const it = r.i ?? baseItalic;
    const meta = { b, i: it, s, ...(r.c ? { c: r.c } : {}), ri };
    r.t.split('\n').forEach((p, i) => {
      if (i > 0) toks.push({ t: '\n', nl: true, ...meta });
      for (const u of p.match(/\S+\s*|\s+/g) || []) toks.push({ t: u, ...meta });
    });
  });
  const lines: { segs: LineSeg[]; lineH: number }[] = [];
  let cur: (LineSeg & { ri: number })[] = [];
  let curW = 0;
  const pushLine = () => {
    lines.push({ segs: cur.map(({ ri, ...seg }) => seg), lineH: Math.max(baseFs, ...cur.map((x) => x.s)) * 1.3 });
    cur = [];
    curW = 0;
  };
  const append = (tk: Tok) => {
    const w = widthOf(tk.t, tk.s, tk.b, tk.i);
    const last = cur[cur.length - 1];
    // merge adjacent tokens of the same run (same formatting) into one tspan
    if (last && last.ri === tk.ri && last.b === tk.b && last.i === tk.i && last.s === tk.s && last.c === tk.c) last.t += tk.t;
    else cur.push({ t: tk.t, b: tk.b, i: tk.i, s: tk.s, ...(tk.c ? { c: tk.c } : {}), ri: tk.ri });
    curW += w;
  };
  for (const tk of toks) {
    if (tk.nl) { pushLine(); continue; }
    if (/^\s+$/.test(tk.t)) {
      // keep the space if the line has content and it fits; at a wrap point it is dropped
      if (cur.length && curW + widthOf(tk.t, tk.s, tk.b, tk.i) <= maxW) append(tk);
      continue;
    }
    if (curW + widthOf(tk.t, tk.s, tk.b, tk.i) <= maxW) { append(tk); continue; }
    if (cur.length) pushLine(); // word doesn't fit the rest of the line: wrap whole to next line
    const word = tk.t.replace(/\s+$/, '');
    if (widthOf(word, tk.s, tk.b, tk.i) > maxW) {
      // longer than a full line: hard-break
      let piece = '';
      for (const ch of word) {
        if (piece !== '' && widthOf(piece + ch, tk.s, tk.b, tk.i) > maxW) { append({ ...tk, t: piece }); pushLine(); piece = ch; }
        else piece += ch;
      }
      append({ ...tk, t: piece });
    } else append(tk);
  }
  pushLine();
  if (lines.length > 1 && lines[lines.length - 1].segs.length === 0) lines.pop();
  return lines;
}
function drawRichText(parent: Element, s: Shape, x: number, y: number, w: number, h: number, pad: number): void {
  const baseFs = s.fontSize ?? 16;
  const runs = shapeRuns(s);
  if (!runs.length) return;
  const align = effAlignOf(s);
  const valign = effValignOf(s);
  // wrap at the inline editor's content width (foreignObject width = w - 2*6) so the
  // unfocused rendering wraps exactly where the contenteditable wrapped while editing
  const lines = splitLines(runs, baseFs, s.bold ?? false, s.italic ?? false, Math.max(20, w - 12));
  const totalH = lines.reduce((a, l) => a + l.lineH, 0);
  let top = valign === 'top' ? y + pad : valign === 'bottom' ? y + h - pad - totalH : y + (h - totalH) / 2;
  const fill = textColorOf(s);
  for (const l of lines) {
    const lw = l.segs.reduce((a, sg) => a + widthOf(sg.t, sg.s, sg.b, sg.i), 0);
    const lx = align === 'left' ? x + pad : align === 'right' ? x + w - pad - lw : x + (w - lw) / 2;
    // xml:space=preserve: SVG collapses whitespace at tspan edges by default, which would
    // eat the spaces at run boundaries (bold words etc.) that the HTML editor keeps
    const lt = el('text', { x: lx, y: top + l.lineH * 0.8, 'pointer-events': 'none', fill, 'text-anchor': 'start', 'xml:space': 'preserve' }, parent);
    let cx = lx;
    for (const sg of l.segs) {
      const ts = el('tspan', { x: cx, 'font-size': sg.s, 'font-weight': sg.b ? 700 : 400, ...(sg.i ? { 'font-style': 'italic' } : {}), ...(sg.c ? { fill: sg.c } : {}) }, lt);
      ts.textContent = sg.t;
      cx += widthOf(sg.t, sg.s, sg.b, sg.i);
    }
    top += l.lineH;
  }
}

function drawFrameLabel(parent: Element, s: Shape): void {
  if (!s.name) return;
  el('text', { x: s.x + 8, y: s.y + 20, 'font-size': 14, fill: '#55607a', 'pointer-events': 'none', 'font-weight': 600 }, parent)
    .textContent = s.name;
}

function drawClippedText(parent: Element, id: string, s: Shape, pad: number): void {
  const cp = el('clipPath', { id: `sclip-${id}` }, shapeClips);
  if (s.type === 'ellipse') el('ellipse', { cx: s.x + s.w / 2, cy: s.y + s.h / 2, rx: s.w / 2, ry: s.h / 2 }, cp);
  else if (s.type === 'diamond') {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    el('polygon', { points: `${cx},${s.y} ${s.x + s.w},${cy} ${cx},${s.y + s.h} ${s.x},${cy}` }, cp);
  } else el('rect', { x: s.x, y: s.y, width: s.w, height: s.h }, cp);
  drawRichText(el('g', { 'clip-path': `url(#sclip-${id})` }, parent), s, s.x, s.y, s.w, s.h, pad);
}

// wrap target for a possibly-rotated shape: the whole shape (incl. clipped text) rotates
// around its center; the clipPath stays in local coords because clip-path resolves in the
// referencing element's user space, which includes this transform
function rotWrap(parent: Element, s: Shape): Element {
  const rot = rotOf(s);
  if (!rot) return parent;
  return el('g', { transform: `rotate(${rot} ${s.x + s.w / 2} ${s.y + s.h / 2})` }, parent);
}

function drawShape(parent: Element, id: string, s: Shape): void {
  parent = rotWrap(parent, s);
  const common = { 'data-id': id, fill: s.fill ?? '#ffffff', stroke: s.stroke ?? '#1a1a1a', 'stroke-width': s.width ?? 2 };
  if (s.type === 'rect') {
    el('rect', { ...common, x: s.x, y: s.y, width: s.w, height: s.h, rx: 4 }, parent);
    if (id !== editingId) drawClippedText(parent, id, s, 6);
  } else if (s.type === 'ellipse') {
    el('ellipse', { ...common, cx: s.x + s.w / 2, cy: s.y + s.h / 2, rx: s.w / 2, ry: s.h / 2 }, parent);
    if (id !== editingId) drawClippedText(parent, id, s, 6);
  } else if (s.type === 'diamond') {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    el('polygon', { ...common, points: `${cx},${s.y} ${s.x + s.w},${cy} ${cx},${s.y + s.h} ${s.x},${cy}`, 'stroke-linejoin': 'round' }, parent);
    if (id !== editingId) drawClippedText(parent, id, s, 6);
  } else if (s.type === 'text') {
    const g = el('g', { 'data-id': id }, parent);
    // text boxes are transparent and borderless by default; a background or border is
    // drawn only once the user sets a fill or a border width (hit area otherwise)
    const hasFill = s.fill !== undefined && s.fill !== 'none';
    const hasBorder = s.width !== undefined;
    el('rect', {
      x: s.x - 4, y: s.y - 4, width: s.w + 8, height: s.h + 4, rx: 4,
      fill: hasFill ? s.fill! : 'none',
      stroke: hasBorder ? (s.stroke ?? '#1a1a1a') : 'none',
      'stroke-width': s.width ?? 2,
    }, g);
    // pad 6 matches the inline editor (enterEdit), so unfocused and edit-mode text align;
    // the editor itself sits 1px lower on purpose — the small hop signals edit mode
    if (id !== editingId) drawClippedText(g, id, s, 6);
  }
}

function drawFrame(parent: Element, id: string, s: Shape): void {
  parent = rotWrap(parent, s);
  el('rect', {
    'data-id': id,
    x: s.x, y: s.y, width: s.w, height: s.h, rx: 8,
    fill: s.fill ?? 'rgba(120,140,180,0.07)', stroke: s.stroke ?? '#7a86a8', 'stroke-width': s.width ?? 1.5, 'stroke-dasharray': '6 4',
  }, parent);
  if (id !== editingId) drawFrameLabel(parent, s);
}

// world position of a connector endpoint (dx/dy are center-relative in the shape's LOCAL
// axes, so they must be rotated by the shape's rotation to land in world coordinates)
function epPoint(ep: unknown): { x: number; y: number } {
  const e = normEp(ep);
  if (e.shape) {
    const s = shapes.get(e.shape);
    if (s) {
      const c = centerOf(s);
      const o = rotOffset(s, e.dx, e.dy);
      return { x: c.x + o.x, y: c.y + o.y };
    }
  }
  return { x: e.dx, y: e.dy };
}

// endpoint for a world dock point on s — dx/dy are stored in the shape's LOCAL axes so the
// point rides along when the shape rotates (epPoint rotates them back to world)
function epAt(s: Shape, worldBp: { x: number; y: number }): Endpoint {
  const c = centerOf(s);
  const lp = localPoint(s, worldBp);
  return { shape: s.id, dx: lp.x - c.x, dy: lp.y - c.y };
}
// Dock an endpoint at world point w: if a shape (rect/ellipse, not text/frame/connector/group)
// is under the cursor or its border is within snap distance, snap to that border (outside the
// shape); otherwise it stays a free world point. Exception: when both arrow ends are inside the
// SAME shape (e.g. a big shape used as a container), that shape is ignored as a dock target, so
// arrows inside it don't snap to its border. Text boxes and groups are never dock targets.
function dockAt(w: { x: number; y: number }, exclude?: string, fromPt?: { x: number; y: number }, centerRect = false, followCursor = false): Endpoint {
  const snap = 14 / vp.k; // constant screen-space snap radius
  let best: { id: string; bp: { x: number; y: number }; d: number } | null = null;
  for (const [id, s] of shapes) {
    if (s.type === 'connector' || s.type === 'frame' || s.type === 'text' || s.type === 'group' || id === exclude) continue;
    if (fromPt && insideShape(s, w) && insideShape(s, fromPt)) continue;
    const bp = borderPoint(s, w);
    const d = insideShape(s, w) ? 0 : Math.hypot(w.x - bp.x, w.y - bp.y);
    if (d <= snap && (!best || d < best.d)) best = { id, bp, d };
  }
  if (best) {
    const s = shapes.get(best.id)!;
    const c = centerOf(s);
    let bp: { x: number; y: number };
    if (s.type === 'diamond') {
      // slide along the border (border point toward the cursor); when the dock point gets
      // within snap distance of a corner, snap onto the corner — measured from the dock
      // point, not the cursor, so diagonal approaches snap too
      bp = best.bp;
      const v = nearestVertex(s, bp);
      if (Math.hypot(bp.x - v.x, bp.y - v.y) <= snap) bp = v;
    } else if (fromPt && !followCursor) {
      // dock on the side facing the start point (stable while hovering the target)
      const n = pickSide({ x: fromPt.x - c.x, y: fromPt.y - c.y });
      if (s.type === 'ellipse') bp = sideDockPoint(s, n, w);
      else if (centerRect) bp = sideCenterOf(s, n);
      else {
        bp = sideDockPoint(s, n, w);
        const mid = sideCenterOf(s, n);
        if (Math.hypot(w.x - mid.x, w.y - mid.y) <= snap) bp = mid;
      }
    } else {
      bp = best.bp;
      if (fromPt && s.type !== 'ellipse' && !rotOf(s)) { // axis-aligned side detection only
        const n = bp.x === s.x + s.w ? { x: 1, y: 0 } : bp.x === s.x ? { x: -1, y: 0 } : bp.y === s.y + s.h ? { x: 0, y: 1 } : { x: 0, y: -1 };
        const mid = sideCenterOf(s, n);
        if (Math.hypot(w.x - mid.x, w.y - mid.y) <= snap) bp = mid;
      }
    }
    return epAt(s, bp);
  }
  return { dx: w.x, dy: w.y };
}



function visibleWorld(): { x: number; y: number; w: number; h: number } {
  const r = svg.getBoundingClientRect();
  return { x: -vp.x / vp.k, y: -vp.y / vp.k, w: r.width / vp.k, h: r.height / vp.k };
}
function guidePositions(exclude: (id: string) => boolean): { vx: number[]; vy: number[] } {
  const vx: number[] = [];
  const vy: number[] = [];
  const vis = visibleWorld();
  for (const [id, s] of shapes) {
    if (s.type === 'connector' || exclude(id)) continue;
    const b = boundsOf(s);
    if (!rectsIntersect(b, vis)) continue; // off-screen shapes never snap
    vx.push(b.x, b.x + b.w / 2, b.x + b.w);
    vy.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { vx, vy };
}
// snapping (alignment + distance hints) only happens at zoom >= 50%
function snappingEnabled(): boolean {
  return vp.k >= 0.5;
}

// distance (spacing) hints along one axis: if the gap between the dragged box (ub moved by d0)
// and a nearby shape matches the gap between two other nearby shapes, snap to equal spacing and
// draw blue segment hints across both gaps. Only shapes within `near` of the dragged box count.
function spacingSnapAxis(axis: 'x' | 'y', ub: { x: number; y: number; w: number; h: number }, d0: number, items: { has(id: string): boolean }, thresh: number, out: SVGLineElement[]): number {
  if (!snappingEnabled()) return 0;
  const horiz = axis === 'x';
  // candidate box along the axis: [p, p+s], perpendicular range [q, e]
  const p = (horiz ? ub.x + d0 : ub.y + d0);
  const s = horiz ? ub.w : ub.h;
  const q = horiz ? ub.y : ub.x;
  const e = horiz ? ub.y + ub.h : ub.x + ub.w;
  const near = 150 / vp.k; // only local shapes participate
  const vis = visibleWorld();
  const boxOf = (sh: Shape) => {
    const b = boundsOf(sh);
    return horiz
      ? { start: b.x, end: b.x + b.w, q1: b.y, q2: b.y + b.h }
      : { start: b.y, end: b.y + b.h, q1: b.x, q2: b.x + b.w };
  };
  const nearEachOther = (a: { start: number; end: number; q1: number; q2: number }, b: { start: number; end: number; q1: number; q2: number }) =>
    Math.max(a.start - b.end, b.start - a.end) < near && Math.max(a.q1 - b.q2, b.q1 - a.q2) < near;
  // direct neighbors of the dragged box, plus shapes near those neighbors (one hop), so a
  // reference pair A-B counts when B is next to the dragged shape even if A is a bit further
  const dragBox = { start: p, end: p + s, q1: q, q2: e };
  const others: { start: number; end: number; q1: number; q2: number }[] = [];
  const inOthers = new Set<string>();
  const neighbors: typeof others = [];
  for (const [id, sh] of shapes) {
    if (sh.type === 'connector' || items.has(id) || inOthers.has(id)) continue;
    if (!rectsIntersect(boundsOf(sh), vis)) continue; // off-screen shapes never hint
    const o = boxOf(sh);
    if (nearEachOther(o, dragBox)) { others.push(o); inOthers.add(id); neighbors.push(o); }
  }
  for (const [id, sh] of shapes) {
    if (sh.type === 'connector' || items.has(id) || inOthers.has(id)) continue;
    if (!rectsIntersect(boundsOf(sh), vis)) continue;
    const o = boxOf(sh);
    if (neighbors.some((n) => nearEachOther(o, n))) { others.push(o); inOthers.add(id); }
  }
  const dragGaps: { gap: number; o: (typeof others)[number]; dir: 1 | -1 }[] = [];
  for (const o of others) {
    if (!(o.q1 < e && o.q2 > q)) continue;
    if (o.start >= p + s) dragGaps.push({ gap: o.start - (p + s), o, dir: 1 });
    else if (o.end <= p) dragGaps.push({ gap: p - o.end, o, dir: -1 });
  }
  const refGaps: { gap: number; a: (typeof others)[number]; b: (typeof others)[number] }[] = [];
  for (const a of others) for (const b of others) {
    if (a === b) continue;
    if (a.end <= b.start && a.q1 < b.q2 && a.q2 > b.q1) refGaps.push({ gap: b.start - a.end, a, b });
  }
  let bestDelta = 0;
  let bestAbs = Infinity;
  let best: { dg: (typeof dragGaps)[number]; rg: (typeof refGaps)[number] } | null = null;
  for (const dg of dragGaps) for (const rg of refGaps) {
    const delta = rg.gap - dg.gap;
    if (Math.abs(delta) <= thresh && Math.abs(delta) < bestAbs) { bestAbs = Math.abs(delta); bestDelta = delta; best = { dg, rg }; }
  }
  if (!best) return 0;
  const { dg, rg } = best;
  const dDelta = -dg.dir * bestDelta;
  const pSnapped = p + dDelta;
  const midY = (Math.max(q, dg.o.q1) + Math.min(e, dg.o.q2)) / 2;
  const seg = (a0: number, a1: number, perp: number) => {
    const ln = horiz
      ? el('line', { x1: a0, y1: perp, x2: a1, y2: perp }, layers.overlay)
      : el('line', { x1: perp, y1: a0, x2: perp, y2: a1 }, layers.overlay);
    ln.setAttribute('class', 'guide');
    ln.setAttribute('stroke', '#4a6cf7'); // blue: distance hint (red is edge/center alignment)
    ln.setAttribute('stroke-width', '1');
    ln.setAttribute('stroke-dasharray', '4 3');
    ln.setAttribute('vector-effect', 'non-scaling-stroke');
    ln.setAttribute('pointer-events', 'none');
    out.push(ln);
  };
  if (dg.dir === 1) seg(pSnapped + s, dg.o.start, midY); else seg(dg.o.end, pSnapped, midY);
  const refMid = (Math.max(rg.a.q1, rg.b.q1) + Math.min(rg.a.q2, rg.b.q2)) / 2;
  seg(rg.a.end, rg.b.start, refMid);
  return dDelta;
}

function snapAxis(vals: number[], guides: number[], vertical: boolean, thresh: number, out: SVGLineElement[]): number {
  if (!snappingEnabled()) return 0;
  let best = NaN;
  let bestDelta = 0;
  for (const v of vals) for (const g of guides) {
    const delta = g - v;
    if (Math.abs(delta) <= thresh && (isNaN(best) || Math.abs(delta) < Math.abs(bestDelta))) { best = g; bestDelta = delta; }
  }
  if (!isNaN(best)) {
    const vis = visibleWorld();
    const ln = vertical
      ? el('line', { x1: best, y1: vis.y, x2: best, y2: vis.y + vis.h }, layers.overlay)
      : el('line', { x1: vis.x, y1: best, x2: vis.x + vis.w, y2: best }, layers.overlay);
    ln.setAttribute('class', 'guide');
    ln.setAttribute('stroke', '#e5534b');
    ln.setAttribute('stroke-width', '1');
    ln.setAttribute('vector-effect', 'non-scaling-stroke');
    ln.setAttribute('pointer-events', 'none');
    out.push(ln);
  }
  return bestDelta;
}

// size snap: when the resized shape's new width/height comes within thresh of another
// on-screen shape's width/height, snap to that exact size and draw a dotted inner line
// through the center of both shapes, along the matched dimension (width -> horizontal,
// height -> vertical)
function sizeSnap(axis: 'x' | 'y', size: number, box: { x: number; y: number; w: number; h: number }, excludeId: string, thresh: number, out: SVGLineElement[]): number {
  if (!snappingEnabled()) return 0;
  const horiz = axis === 'x';
  const vis = visibleWorld();
  let bestDelta = NaN;
  let bestB: { x: number; y: number; w: number; h: number } | null = null;
  for (const [id, s] of shapes) {
    if (s.type === 'connector' || id === excludeId) continue;
    const b = boundsOf(s);
    if (!rectsIntersect(b, vis)) continue; // off-screen shapes never snap
    const delta = (horiz ? b.w : b.h) - size;
    if (Math.abs(delta) <= thresh && (isNaN(bestDelta) || Math.abs(delta) < Math.abs(bestDelta))) {
      bestDelta = delta;
      bestB = b;
    }
  }
  if (bestB === null) return 0;
  const pad = 4 / vp.k;
  const inner = (b: { x: number; y: number; w: number; h: number }) => {
    const ln = horiz
      ? el('line', { x1: b.x + pad, y1: b.y + b.h / 2, x2: b.x + b.w - pad, y2: b.y + b.h / 2 }, layers.overlay)
      : el('line', { x1: b.x + b.w / 2, y1: b.y + pad, x2: b.x + b.w / 2, y2: b.y + b.h - pad }, layers.overlay);
    ln.setAttribute('class', 'guide');
    ln.setAttribute('stroke', '#4a6cf7'); // blue: size match (red is edge/center alignment)
    ln.setAttribute('stroke-width', '1');
    ln.setAttribute('stroke-dasharray', '4 3');
    ln.setAttribute('vector-effect', 'non-scaling-stroke');
    ln.setAttribute('pointer-events', 'none');
    out.push(ln);
  };
  inner(horiz ? { ...box, w: box.w + bestDelta } : { ...box, h: box.h + bestDelta });
  inner(bestB);
  return bestDelta;
}

function connAssociated(c: Shape, frame: Shape, contained: Map<string, unknown>): boolean {
  const f = normEp(c.from);
  const t = normEp(c.to);
  if (f.shape === frame.id || t.shape === frame.id) return true;
  if ((f.shape && contained.has(f.shape)) || (t.shape && contained.has(t.shape))) return true;
  const p1 = epPoint(c.from);
  const p2 = epPoint(c.to);
  return insideShape(frame, p1) && insideShape(frame, p2);
}

function connPoints(c: Shape): { p1: { x: number; y: number }; p2: { x: number; y: number }; mid: { x: number; y: number }; bends: number } {
  const p1 = epPoint(c.from);
  const p2 = epPoint(c.to);
  const cv = c.curve ?? { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  let mid: { x: number; y: number };
  let bends: number;
  if (c.elbow) {
    // handle sits on the middle corner/segment of the elbow path
    const pts = elbowPts(c.from, c.to, p1, p2, c.curve, (c.width ?? 2) * 14);
    const m = pts.length;
    bends = m - 2;
    mid = m % 2 === 1 ? pts[(m - 1) / 2] : { x: (pts[m / 2 - 1].x + pts[m / 2].x) / 2, y: (pts[m / 2 - 1].y + pts[m / 2].y) / 2 };
  } else {
    // point on the quadratic bezier at t = 0.5
    bends = 1;
    mid = { x: 0.25 * p1.x + 0.5 * cv.x + 0.25 * p2.x, y: 0.25 * p1.y + 0.5 * cv.y + 0.25 * p2.y };
  }
  return { p1, p2, mid, bends };
}

// signed unit axis vector of the surface normal at a docked endpoint (rect edge normal,
// true ellipse normal); null for free endpoints
function dockNormal(ep: unknown): { x: number; y: number } | null {
  const e = normEp(ep);
  if (!e.shape) return null;
  const s = shapes.get(e.shape);
  if (!s || s.type === 'connector' || s.type === 'frame' || s.type === 'text' || s.type === 'group') return null;
  // rotated shapes have no axis-aligned sides: fall back to the dominant world axis of the
  // dock offset (same rule as free endpoints), so elbow segments stay horizontal/vertical
  if (rotOf(s) !== 0) {
    const o = rotOffset(s, e.dx, e.dy);
    return Math.abs(o.x) >= Math.abs(o.y) ? { x: Math.sign(o.x) || 1, y: 0 } : { x: 0, y: Math.sign(o.y) || 1 };
  }
  let nx: number, ny: number;
  if (s.type === 'ellipse') {
    const rx = Math.max(1, s.w / 2);
    const ry = Math.max(1, s.h / 2);
    nx = e.dx / (rx * rx);
    ny = e.dy / (ry * ry);
  } else {
    nx = e.dx / Math.max(1, s.w / 2);
    ny = e.dy / Math.max(1, s.h / 2);
  }
  if (Math.abs(nx) >= Math.abs(ny)) return { x: Math.sign(nx) || 1, y: 0 };
  return { x: 0, y: Math.sign(ny) || 1 };
}

// side whose outward normal best matches dir — arrow creation docks on the drag-direction
// side, not the cursor side
function pickSide(dir: { x: number; y: number }): { x: number; y: number } {
  const d = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / d;
  const uy = dir.y / d;
  const sides = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  let n = sides[0];
  for (const sd of sides) if (sd.x * ux + sd.y * uy > n.x * ux + n.y * uy) n = sd;
  return n;
}

function nearestVertex(s: Shape, p: { x: number; y: number }): { x: number; y: number } {
  const c = centerOf(s);
  const lp = localPoint(s, p); // vertices rotate with the shape: compare in local space
  const vs = [
    { x: c.x, y: s.y }, { x: s.x + s.w, y: c.y },
    { x: c.x, y: s.y + s.h }, { x: s.x, y: c.y },
  ];
  let best = vs[0];
  for (const v of vs) if (Math.hypot(lp.x - v.x, lp.y - v.y) < Math.hypot(lp.x - best.x, lp.y - best.y)) best = v;
  return worldPoint(s, best);
}

// dock point on side n of s closest to world point w (position follows w along the side);
// diamonds snap to the nearest corner
function sideDockPoint(s: Shape, n: { x: number; y: number }, w: { x: number; y: number }): { x: number; y: number } {
  if (s.type === 'ellipse' || s.type === 'diamond' || rotOf(s) !== 0) return borderPoint(s, w); // rotated shapes dock at the true border point
  if (n.x === 1) return { x: s.x + s.w, y: clamp(w.y, s.y, s.y + s.h) };
  if (n.x === -1) return { x: s.x, y: clamp(w.y, s.y, s.y + s.h) };
  if (n.y === 1) return { x: clamp(w.x, s.x, s.x + s.w), y: s.y + s.h };
  return { x: clamp(w.x, s.x, s.x + s.w), y: s.y };
}

function sideCenterOf(s: Shape, n: { x: number; y: number }): { x: number; y: number } {
  const c = centerOf(s);
  if (s.type === 'ellipse' || rotOf(s) !== 0) return borderPoint(s, { x: c.x + n.x * 1000, y: c.y + n.y * 1000 });
  return { x: c.x + n.x * s.w / 2, y: c.y + n.y * s.h / 2 };
}
function edgeDockPoint(s: Shape, dir: { x: number; y: number }): { x: number; y: number } {
  const c = centerOf(s);
  const n = pickSide(dir);
  if (s.type === 'ellipse' || rotOf(s) !== 0) return borderPoint(s, { x: c.x + n.x * 1000, y: c.y + n.y * 1000 });
  // rect: dock in the CENTER of the exit side; diamond: at the exit corner
  return sideCenterOf(s, n);
}

// Elbow routing rules:
// a) first/last segment run along the surface normal (0/90/180/270) with a minimum stub
//    length (arrowhead + 100%); free ends use the dominant axis toward the other end
// b) fewest bends possible (even a single one), tried in bend order
// c) never cross a docked shape nor come closer than the stub length to it; if the minimal
//    path would, detour with a 3-bend staircase (bystanding shapes are not avoided)
// d) a manual bend anchor survives shape/endpoint moves: it is kept and clamped to the stub
//    rules, and recalculated only when the clamped path would cross a docked shape
// e) the bend node never changes the bend count: it only repositions the bends of the
//    automatically chosen path (0 bends = straight, no node; 1 = the L corner; 2 = slides
//    the Z's middle segment; 3 = the staircase's middle bend)
function elbowPts(from: unknown, to: unknown, p1: { x: number; y: number }, p2: { x: number; y: number }, anchor?: { x: number; y: number }, stub = 28): { x: number; y: number }[] {
  const n1 = dockNormal(from);
  const n2 = dockNormal(to);
  const manual = !!anchor;
  const a = anchor ? { ...anchor } : { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const toward = (p: { x: number; y: number }, q: { x: number; y: number }): { x: number; y: number } =>
    Math.abs(q.x - p.x) >= Math.abs(q.y - p.y)
      ? { x: Math.sign(q.x - p.x) || 1, y: 0 }
      : { x: 0, y: Math.sign(q.y - p.y) || 1 };
  const v1 = n1 ?? toward(p1, p2); // travel direction of the first segment
  const v2 = n2 ? { x: -n2.x, y: -n2.y } : toward(p1, p2); // travel direction of the last segment
  const d1 = Math.abs(v1.x) >= Math.abs(v1.y) ? 'h' : 'v';
  const d2 = Math.abs(v2.x) >= Math.abs(v2.y) ? 'h' : 'v';

  // clamp the anchor so the first/last segment keep their normal direction and stub length;
  // when both ends constrain the same coordinate and the constraints conflict (back-to-back
  // docks closer than 2 stubs), keep the corner within the gap between the dock points so it
  // stays movable yet can never end up inside a shape
  const clampAnchor = (): void => {
    const clamp1 = (val: number, p: number, v: number): number => (v > 0 ? Math.max(val, p + stub) : Math.min(val, p - stub));
    if (d1 === d2) {
      const coord = d1 === 'h' ? 'x' : 'y';
      const p1v = coord === 'x' ? p1.x : p1.y;
      const p2v = coord === 'x' ? p2.x : p2.y;
      const v1s = coord === 'x' ? v1.x : v1.y;
      const v2s = coord === 'x' ? v2.x : v2.y;
      const lo = Math.max(v1s > 0 ? p1v + stub : -Infinity, v2s > 0 ? -Infinity : p2v + stub);
      const hi = Math.min(v1s > 0 ? Infinity : p1v - stub, v2s > 0 ? p2v - stub : Infinity);
      // on conflict (back-to-back docks closer than 2 stubs) keep the corner inside the gap
      // between the two dock points: still movable, but never inside a shape
      a[coord] = lo > hi ? clamp(a[coord], Math.min(p1v, p2v), Math.max(p1v, p2v)) : clamp(a[coord], lo, hi);
    } else {
      // first end: corner sits at p1 + v1*stub; second end: corner sits at p2 - v2*stub
      // (v2 is the travel direction INTO p2, so its sign is flipped for the clamp)
      if (d1 === 'h') a.x = clamp1(a.x, p1.x, v1.x);
      else a.y = clamp1(a.y, p1.y, v1.y);
      if (d2 === 'h') a.x = clamp1(a.x, p2.x, -v2.x);
      else a.y = clamp1(a.y, p2.y, -v2.y);
    }
  };
  const zPath = (aa: { x: number; y: number }): { x: number; y: number }[] =>
    d1 === 'h'
      ? [p1, { x: aa.x, y: p1.y }, { x: aa.x, y: p2.y }, p2]
      : [p1, { x: p1.x, y: aa.y }, { x: p2.x, y: aa.y }, p2];
  // clearance check covers the docked shapes; the path must not cross them nor come closer
  // than the stub length. Exemptions: the first/last stub-length near the dock point, and the
  // stub-length around a free end placed inside the shape (that placement is intentional)
  const fEp = normEp(from);
  const tEp = normEp(to);
  // a free end placed inside (or right next to) a shape is intentional, but only the
  // stub-length around that end is exempt from the crossing check — the path must not
  // wander through the shape
  const skipShape = new Set<string>();
  const freePts: { x: number; y: number }[] = [];
  for (const [ep, pp] of [[fEp, p1], [tEp, p2]] as const) {
    if (ep.shape) continue;
    for (const s of shapes.values()) {
      if (s.type === 'connector' || s.type === 'group') continue;
      if (insideShape(s, pp) || distToShape(s, pp) < 2 * stub) { skipShape.add(s.id); freePts.push(pp); }
    }
  }
  // only the shapes this arrow is docked to are routing obstacles
  const targets: { s: Shape; dockP: { x: number; y: number } }[] = [];
  for (const s of shapes.values()) {
    if (s.type === 'connector' || s.type === 'group') continue;
    if (fEp.shape === s.id) targets.push({ s, dockP: p1 });
    else if (tEp.shape === s.id) targets.push({ s, dockP: p2 });
  }
  // strict: also reject coming closer than stub to a shape; non-strict: only actual crossings
  const hitShapes = (pts: { x: number; y: number }[], strict = true): { cross: Shape[]; near: number } => {
    const cross: Shape[] = [];
    let near = 0;
    for (const { s, dockP } of targets) {
      for (let i = 0; i < pts.length - 1; i++) {
        const A = pts[i];
        const B = pts[i + 1];
        const len = Math.hypot(B.x - A.x, B.y - A.y);
        if (len < 1) continue;
        const n = Math.max(2, Math.ceil(len / 3));
        for (let j = 0; j <= n; j++) {
          const t = j / n;
          const pt = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
          const dDock = dockP ? Math.hypot(pt.x - dockP.x, pt.y - dockP.y) : Infinity;
          const nearFree = skipShape.has(s.id) && freePts.some((fp) => Math.hypot(pt.x - fp.x, pt.y - fp.y) < 2 * stub);
          if (insideShape(s, pt)) {
            // the stub corridor at an endpoint is intentional (exempt up to stub+1);
            // anywhere else, crossing a docked shape is a hard hit
            if (dDock < stub + 1 || nearFree) continue;
            if (!cross.includes(s)) cross.push(s);
            break;
          }
          // near-misses within 2 stubs of an endpoint are exempt approach corridors
          if (dDock < 2 * stub || nearFree) continue;
          if (strict && i > 0 && i < pts.length - 2 && distToShape(s, pt) < stub) { // first/last segment: only actual crossings count
            near++;
            break;
          }
        }
      }
    }
    return { cross, near };
  };
  const mergeCollinear = (pts: { x: number; y: number }[]): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = [];
    for (const p of pts) {
      const n = out.length;
      if (n >= 2) {
        const A = out[n - 2];
        const B = out[n - 1];
        const cross = (B.x - A.x) * (p.y - A.y) - (B.y - A.y) * (p.x - A.x);
        const dot = (B.x - A.x) * (p.x - B.x) + (B.y - A.y) * (p.y - B.y);
        if (Math.abs(cross) < 0.01 && dot >= -0.01) {
          out[n - 1] = p;
          continue;
        }
      }
      out.push(p);
    }
    return out;
  };
  // automatic route: stub out along the normals (rule a), then pick the candidate with the
  // fewest bends (0 -> 1 -> 2 -> 3) that crosses no docked shape (rules b+c)
  const autoRoute = (): { x: number; y: number }[] => {
    const q1 = { x: p1.x + v1.x * stub, y: p1.y + v1.y * stub };
    const q2 = { x: p2.x - v2.x * stub, y: p2.y - v2.y * stub };
    const mx = (q1.x + q2.x) / 2;
    const my = (q1.y + q2.y) / 2;
    const candidates: { x: number; y: number }[][] = [];
    // straight only when the stub points are aligned (otherwise it would be a diagonal)
    if (Math.abs(q1.x - q2.x) < 0.5 || Math.abs(q1.y - q2.y) < 0.5) {
      candidates.push(mergeCollinear([p1, q1, q2, p2]));
    }
    candidates.push(mergeCollinear([p1, q1, { x: q2.x, y: q1.y }, q2, p2]));
    candidates.push(mergeCollinear([p1, q1, { x: q1.x, y: q2.y }, q2, p2]));
    candidates.push(mergeCollinear(
      d1 === 'h'
        ? [p1, q1, { x: mx, y: q1.y }, { x: mx, y: q2.y }, q2, p2]
        : [p1, q1, { x: q1.x, y: my }, { x: q2.x, y: my }, q2, p2],
    ));
    candidates.sort((a, b) => a.length - b.length); // fewest bends first
    let crossed: Shape[] = [];
    // least-violating fallback: if no candidate is clean, prefer the one with the fewest
    // actual crossings (a path may come near a shape, but must never cross one), then the
    // fewest near-misses
    const state: { worst: { cand: { x: number; y: number }[]; cross: number; near: number } | null } = { worst: null };
    const consider = (cand: { x: number; y: number }[]): boolean => {
      const { cross, near } = hitShapes(cand);
      if (cross.length === 0 && near === 0) return true;
      if (!state.worst
        || cross.length < state.worst.cross
        || (cross.length === state.worst.cross && near < state.worst.near)) {
        state.worst = { cand, cross: cross.length, near };
      }
      crossed = crossed.concat(cross);
      return false;
    };
    for (const cand of candidates) if (consider(cand)) return cand;
    // every direct candidate crosses a shape: wrap around the bounding box of the crossed
    // shapes via a corner on the nearer side (left/right x top/bottom), first clean one wins
    if (targets.length === 0) return candidates[0];
    const box = (crossed.length > 0 ? crossed : targets.map(({ s }) => s)).map((s) => boundsOf(s)); // AABB (rotated shapes included)
    const minX = Math.min(...box.map((b) => b.x)) - stub - 4;
    const maxX = Math.max(...box.map((b) => b.x + b.w)) + stub + 4;
    const minY = Math.min(...box.map((b) => b.y)) - stub - 4;
    const maxY = Math.max(...box.map((b) => b.y + b.h)) + stub + 4;
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const sideXs = Math.abs(minX - midX) <= Math.abs(maxX - midX) ? [minX, maxX] : [maxX, minX];
    const sideYs = Math.abs(minY - midY) <= Math.abs(maxY - midY) ? [minY, maxY] : [maxY, minY];
    // 2-bend detour: swing out to a side of the crossed bbox (fewer bends than the staircase)
    const detours: { x: number; y: number }[][] = [];
    if (d1 === 'h') {
      for (const sx0 of sideXs) {
        const sx = v1.x > 0 ? Math.max(sx0, p1.x + stub) : Math.min(sx0, p1.x - stub);
        detours.push(mergeCollinear([p1, q1, { x: sx, y: q1.y }, { x: sx, y: q2.y }, q2, p2]));
      }
    } else {
      for (const sy0 of sideYs) {
        const sy = v1.y > 0 ? Math.max(sy0, p1.y + stub) : Math.min(sy0, p1.y - stub);
        detours.push(mergeCollinear([p1, q1, { x: q1.x, y: sy }, { x: q2.x, y: sy }, q2, p2]));
      }
    }
    for (const cand of detours) if (consider(cand)) return cand;
    for (const sx0 of sideXs) {
      for (const sy0 of sideYs) {
        // keep the route lines clear of the stub points so the first/last segment keep their
        // normal direction and full stub length (otherwise the end zigzags into a short stub)
        let sx = sx0;
        let sy = sy0;
        if (d1 === 'h') sx = v1.x > 0 ? Math.max(sx, p1.x + stub) : Math.min(sx, p1.x - stub);
        if (d2 === 'v') sy = v2.y > 0 ? Math.min(sy, p2.y - stub) : Math.max(sy, p2.y + stub);
        const cand = mergeCollinear([p1, q1, { x: sx, y: q1.y }, { x: sx, y: sy }, { x: q2.x, y: sy }, { x: q2.x, y: q2.y }, q2, p2]);
        if (consider(cand)) return cand;
      }
    }
    return state.worst ? state.worst.cand : candidates[0];
  };
  if (manual) {
    // the bend node never changes the bend count: morph the automatically chosen path
    // (same topology) with the anchor instead of replacing it
    const base = autoRoute();
    const bends = base.length - 2;
    if (bends <= 0) return base; // straight connection: no bend node
    clampAnchor();
    let path: { x: number; y: number }[];
    if (bends === 1) {
      // 1 bend: only the two L corners are possible; pick the valid one nearest the anchor
      const corners = [{ x: p2.x, y: p1.y }, { x: p1.x, y: p2.y }];
      const segOk = (c: { x: number; y: number }): boolean => {
        const l1 = Math.hypot(c.x - p1.x, c.y - p1.y);
        const l2 = Math.hypot(c.x - p2.x, c.y - p2.y);
        const dir1 = v1.x !== 0 ? Math.sign(c.x - p1.x) === v1.x : Math.sign(c.y - p1.y) === v1.y;
        const dir2 = v2.x !== 0 ? Math.sign(p2.x - c.x) === v2.x : Math.sign(p2.y - c.y) === v2.y;
        return l1 >= stub - 1e-6 && l2 >= stub - 1e-6 && dir1 && dir2;
      };
      const opts = corners.filter(segOk);
      if (opts.length === 0) return base;
      const pick = opts.reduce((best, c) => (Math.hypot(c.x - a.x, c.y - a.y) < Math.hypot(best.x - a.x, best.y - a.y) ? c : best));
      path = mergeCollinear([p1, pick, p2]);
    } else if (bends === 2) {
      path = zPath(a); // slides the middle straight of the Z back and forth
    } else {
      // 3+ bends (staircase): move the middle bend / middle segment to the anchor, sliding
      // the adjacent corners along their segment axis so the bend count stays unchanged
      const m = base.length;
      const pts = base.map((p) => ({ x: p.x, y: p.y }));
      const k = Math.floor((m - 1) / 2); // middle corner (odd m) or corner before the middle segment (even m)
      if (m % 2 === 1) {
        const old = pts[k];
        pts[k] = { x: a.x, y: a.y };
        if (k > 0) {
          if (Math.abs(pts[k - 1].x - old.x) < 0.01) pts[k - 1] = { x: a.x, y: pts[k - 1].y };
          else pts[k - 1] = { x: pts[k - 1].x, y: a.y };
        }
        if (k < m - 1) {
          if (Math.abs(pts[k + 1].x - old.x) < 0.01) pts[k + 1] = { x: a.x, y: pts[k + 1].y };
          else pts[k + 1] = { x: pts[k + 1].x, y: a.y };
        }
      } else {
        // middle segment pts[k] -> pts[k+1]: slide it perpendicular to its axis
        if (Math.abs(pts[k].x - pts[k + 1].x) < 0.01) {
          pts[k] = { x: a.x, y: pts[k].y };
          pts[k + 1] = { x: a.x, y: pts[k + 1].y };
        } else {
          pts[k] = { x: pts[k].x, y: a.y };
          pts[k + 1] = { x: pts[k + 1].x, y: a.y };
        }
      }
      path = mergeCollinear(pts);
    }
    // a manually placed bend must never cross a docked shape; if it would, recalculate (auto)
    if (hitShapes(path, false).cross.length === 0) return path;
    return base;
  }
  return autoRoute();
}
function elbowPathD(from: unknown, to: unknown, p1: { x: number; y: number }, p2: { x: number; y: number }, anchor?: { x: number; y: number }, stub = 28): string {
  return 'M ' + elbowPts(from, to, p1, p2, anchor, stub).map((p) => `${p.x} ${p.y}`).join(' L ');
}

// On creation, choose the start dock point so the connection is straight (0 bends) when
// possible: try axis-aligned border points of the start shape (aligned with the end point)
// plus a radial fallback; keep the one closest to the current dock that yields a 2-point path.
// For elbow-arrow creation: try docking the target on each of its 4 sides/vertices and keep
// the dock that routes with the fewest bends (ties -> closest to the cursor). Rect sides dock
// at the side center, diamond vertices at the corner, ellipses at the border point.
function bestDockForElbow(s: Shape, w: { x: number; y: number }, fromEp: Endpoint, p1: { x: number; y: number }): Endpoint {
  const c = centerOf(s);
  const sides = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  let best: { ep: Endpoint; bends: number; d: number } | null = null;
  for (const n of sides) {
    const bp = s.type === 'ellipse' || rotOf(s) !== 0
      ? borderPoint(s, { x: c.x + n.x * 1000, y: c.y + n.y * 1000 })
      : { x: c.x + n.x * s.w / 2, y: c.y + n.y * s.h / 2 };
    const ep: Endpoint = epAt(s, bp);
    const bends = elbowPts(fromEp, ep, p1, bp, undefined, 28).length - 2;
    const d = Math.hypot(bp.x - w.x, bp.y - w.y);
    if (!best || bends < best.bends || (bends === best.bends && d < best.d)) best = { ep, bends, d };
  }
  return best!.ep;
}

function alignStartForZeroBend(from: Endpoint, to: Endpoint): Endpoint {
  if (!from.shape) return from;
  const src = shapes.get(from.shape);
  if (!src || src.type === 'connector') return from;
  const c = centerOf(src);
  const cur = epPoint(from);
  const p2 = epPoint(to);
  const cands: { x: number; y: number }[] = [cur];
  if (rotOf(src) !== 0) {
    // rotated shapes have no axis-aligned outline points: only the radial border point qualifies
    cands.push(borderPoint(src, p2));
  } else if (src.type === 'ellipse') {
    const rx = src.w / 2, ry = src.h / 2;
    if (Math.abs(p2.x - c.x) <= rx) {
      const dy = ry * Math.sqrt(1 - ((p2.x - c.x) / rx) ** 2);
      cands.push({ x: p2.x, y: c.y + (p2.y >= c.y ? dy : -dy) });
    }
    if (Math.abs(p2.y - c.y) <= ry) {
      const dx = rx * Math.sqrt(1 - ((p2.y - c.y) / ry) ** 2);
      cands.push({ x: c.x + (p2.x >= c.x ? dx : -dx), y: p2.y });
    }
  } else if (src.type === 'diamond') {
    // diamond corners are the only outline points that can give a 0-bend elbow
    cands.push({ x: c.x, y: src.y }, { x: src.x + src.w, y: c.y }, { x: c.x, y: src.y + src.h }, { x: src.x, y: c.y });
  } else {
    if (p2.x >= src.x && p2.x <= src.x + src.w) cands.push({ x: p2.x, y: p2.y >= c.y ? src.y + src.h : src.y });
    if (p2.y >= src.y && p2.y <= src.y + src.h) cands.push({ x: p2.x >= c.x ? src.x + src.w : src.x, y: p2.y });
  }
  cands.push(borderPoint(src, p2));
  let best: Endpoint | null = null;
  let bestD = Infinity;
  for (const cp of cands) {
    const f2: Endpoint = epAt(src, cp);
    if (elbowPts(f2, to, cp, p2, undefined, 28).length === 2) {
      const dist = Math.hypot(cp.x - cur.x, cp.y - cur.y);
      if (dist < bestD) { best = f2; bestD = dist; }
    }
  }
  return best ?? from;
}

function sampleConn(c: Shape, n = 24): { x: number; y: number }[] {
  const { p1, p2 } = connPoints(c);
  const pts: { x: number; y: number }[] = [];
  if (c.elbow) {
    const corners = elbowPts(c.from, c.to, p1, p2, c.curve, (c.width ?? 2) * 14);
    for (let i = 0; i < corners.length - 1; i++) {
      const a = corners[i];
      const b = corners[i + 1];
      for (let j = 0; j < n; j++) {
        const t = j / n;
        pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    pts.push(p2);
    return pts;
  }
  const cv = c.curve;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (cv) {
      const mt = 1 - t;
      pts.push({ x: mt * mt * p1.x + 2 * mt * t * cv.x + t * t * p2.x, y: mt * mt * p1.y + 2 * mt * t * cv.y + t * t * p2.y });
    } else {
      pts.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t });
    }
  }
  return pts;
}

function distToConn(c: Shape, w: { x: number; y: number }): number {
  let m = Infinity;
  for (const p of sampleConn(c)) m = Math.min(m, Math.hypot(p.x - w.x, p.y - w.y));
  return m;
}

// bounding box of any shape: groups union their (possibly nested) members and connectors
// use their actual path; the stored x/y/w/h of a group can be stale, so always compute it
function boundsOf(s: Shape, seen = new Set<string>()): { x: number; y: number; w: number; h: number } {
  if (s.type === 'group') {
    if (seen.has(s.id)) return { x: s.x, y: s.y, w: s.w, h: s.h };
    seen.add(s.id);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cid of s.children ?? []) {
      const c = shapes.get(cid);
      if (!c) continue;
      const b = boundsOf(c, seen);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    if (minX === Infinity) return { x: s.x, y: s.y, w: s.w, h: s.h };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (s.type === 'connector') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of sampleConn(s)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const lb = connLabelBox(s); // the label pill can extend past the path
    if (lb) {
      minX = Math.min(minX, lb.x);
      minY = Math.min(minY, lb.y);
      maxX = Math.max(maxX, lb.x + lb.w);
      maxY = Math.max(maxY, lb.y + lb.h);
    }
    const pad = s.width ?? 2;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  }
  if (rotOf(s) !== 0) {
    const cs = cornersOf(s);
    const minX = Math.min(...cs.map((p) => p.x));
    const minY = Math.min(...cs.map((p) => p.y));
    const maxX = Math.max(...cs.map((p) => p.x));
    const maxY = Math.max(...cs.map((p) => p.y));
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

function groupParents(): Map<string, string> {
  const p = new Map<string, string>();
  for (const [id, s] of shapes) {
    if (s.type !== 'group') continue;
    for (const c of s.children ?? []) if (!p.has(c)) p.set(c, id);
  }
  return p;
}
function topGroupOf(id: string, parents?: Map<string, string>): string | null {
  const p = parents ?? groupParents();
  let cur = id;
  const seen = new Set<string>();
  while (p.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = p.get(cur)!;
  }
  return cur !== id ? cur : null;
}

// the frame's label text sits at the top-left just inside the border; it is a hit target too,
// so double-clicking the label opens renaming even though the frame interior is not clickable
function frameLabelHit(s: Shape, w: { x: number; y: number }): boolean {
  if (!s.name) return false;
  const q = localPoint(s, w); // the label rotates with the frame
  const tw = widthOf(s.name, 14, true);
  return q.x >= s.x + 4 && q.x <= s.x + 12 + tw && q.y >= s.y + 4 && q.y <= s.y + 26;
}

// topmost element at world point w: connectors first, then shapes by z (high first), frames always last
function hitTest(w: { x: number; y: number }): string | null {
  const all = [...shapes.values()];
  const byZDesc = (a: Shape, b: Shape) => (b.z ?? 0) - (a.z ?? 0);
  const parents = groupParents();
  // clicking a member of a group selects the (outermost) group instead
  const owner = (id: string): string => topGroupOf(id, parents) ?? id;
  for (const c of all.filter((s) => s.type === 'connector').sort(byZDesc)) {
    // clickable surface is 2x the arrow's actual stroke surface
    const ctol = 2 * (6 + (c.width ?? 2) / 2) / vp.k;
    if (distToConn(c, w) <= ctol) return owner(c.id);
  }
  for (const s of all.filter((s) => s.type !== 'connector' && s.type !== 'frame' && s.type !== 'group').sort(byZDesc)) {
    if (insideShape(s, w)) return owner(s.id);
  }
  // empty area inside a group's bounds selects the group itself
  for (const g of all.filter((s) => s.type === 'group').sort(byZDesc)) {
    const b = boundsOf(g);
    if (w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h) return owner(g.id);
  }
  for (const s of all.filter((s) => s.type === 'frame')) {
    // frames are selectable only on their border band or their label, never their interior area
    const ftol = (6 + (s.width ?? 1.5) / 2) / vp.k;
    if (distToFrameBorder(s, w) <= ftol || frameLabelHit(s, w)) return owner(s.id);
  }
  return null;
}

function drawConnector(parent: Element, id: string, c: Shape): void {
  const { p1, p2 } = connPoints(c);
  const cv = c.curve;
  const d = c.elbow
    ? elbowPathD(c.from, c.to, p1, p2, cv, (c.width ?? 2) * 14)
    : cv
      ? `M ${p1.x} ${p1.y} Q ${cv.x} ${cv.y} ${p2.x} ${p2.y}`
      : `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  // invisible fat stroke so the pointer cursor/hit area covers the full 2x click surface
  el('path', {
    'data-id': id,
    d,
    fill: 'none',
    stroke: 'transparent',
    'stroke-width': 2 * (6 + (c.width ?? 2) / 2),
    'pointer-events': 'stroke',
    cursor: 'pointer',
  }, parent);
  el('path', {
    'data-id': id,
    d,
    fill: 'none', stroke: c.stroke ?? '#444', 'stroke-width': c.width ?? 2,
    ...(c.dash ? { 'stroke-dasharray': '6 5' } : {}),
    'marker-end': c.arrowEnd === false ? '' : 'url(#arrow)',
    'marker-start': c.arrowStart ? 'url(#arrow)' : '',
    'pointer-events': 'stroke', cursor: 'pointer',
  }, parent);
  if (id !== editingId) drawConnLabel(parent, id, c);
}

function connLabelBox(c: Shape): { x: number; y: number; w: number; h: number } | null {
  const runs = shapeRuns(c);
  if (!runs.length) return null;
  const fs = c.fontSize ?? 16;
  const lines = splitLines(runs, fs, c.bold ?? false, c.italic ?? false, 280);
  const w = Math.max(...lines.map((l) => l.segs.reduce((a, sg) => a + widthOf(sg.t, sg.s, sg.b, sg.i), 0)));
  const h = lines.reduce((a, l) => a + l.lineH, 0);
  const { mid } = connPoints(c);
  return { x: mid.x - w / 2 - 6, y: mid.y - h / 2 - 4, w: w + 12, h: h + 8 };
}

// rendered connector label: opaque pill behind centered rich text, so the arrow line and
// anything underneath don't show through
function drawConnLabel(parent: Element, id: string, c: Shape): void {
  const box = connLabelBox(c);
  if (!box) return;
  const g = el('g', { 'data-id': id, 'pointer-events': 'none' }, parent);
  el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 6, fill: '#ffffff', stroke: '#d5d9e0', 'stroke-width': 1 }, g);
  drawRichText(g, c, box.x, box.y, box.w, box.h, 6);
}

function drawSelection(): void {
  const sel = layers.selection;
  for (const id of selected) {
    const s = shapes.get(id);
    if (!s) continue;
    if (s.type === 'connector') {
      const { p1, p2, mid, bends } = connPoints(s);
      el('circle', { cx: p1.x, cy: p1.y, r: 5, fill: '#fff', stroke: '#4a6cf7', 'stroke-width': 1.5, 'data-id': id, 'data-ep': 'from', cursor: 'move' }, sel);
      el('circle', { cx: p2.x, cy: p2.y, r: 5, fill: '#fff', stroke: '#4a6cf7', 'stroke-width': 1.5, 'data-id': id, 'data-ep': 'to', cursor: 'move' }, sel);
      // a straight (0-bend) elbow has no bend node; while the label editor is open the mid
      // knob would sit on top of the input field, so it is hidden then
      if ((!s.elbow || bends > 0) && id !== editingId) {
        el('circle', { cx: mid.x, cy: mid.y, r: 5, fill: '#4a6cf7', stroke: '#fff', 'stroke-width': 1.5, 'data-id': id, 'data-ep': 'mid', cursor: 'move', title: 'Drag to curve' }, sel);
      }
      continue;
    }
    const b = boundsOf(s); // groups: live bounds of the members
    el('rect', { class: 'sel-box', x: b.x - 3, y: b.y - 3, width: b.w + 6, height: b.h + 6 }, sel);
  }
  if (selected.size === 1) {
    const s = shapes.get([...selected][0]);
    if (s && s.type !== 'connector' && s.type !== 'group') {
      // groups can only be moved, not resized; rotated shapes can't be resized either (v1:
      // the resize handle would have to drag along the rotated axes) — they get a rotate handle
      if (!rotOf(s)) {
        const h = 9 / vp.k;
        el('rect', { class: 'sel-handle', 'data-id': s.id, 'data-handle': 'se', x: s.x + s.w - h, y: s.y + s.h - h, width: h, height: h }, sel);
      }
      const b = boundsOf(s);
      const hx = b.x + b.w / 2;
      // 29 screen px above the box top: clear of the format bar, which floats 76px above it
      const hy = b.y - 29 / vp.k;
      el('line', { x1: b.x + b.w / 2, y1: b.y - 3, x2: hx, y2: hy, stroke: '#4a6cf7', 'stroke-width': 1.5 / vp.k, 'pointer-events': 'none' }, sel);
      el('circle', { cx: hx, cy: hy, r: 6 / vp.k, fill: '#fff', stroke: '#4a6cf7', 'stroke-width': 1.5 / vp.k, 'data-id': s.id, 'data-handle': 'rot', cursor: 'grab' }, sel);
    }
  }
}

function render(): void {
  if (editingId && !shapes.get(editingId)) exitEdit(false);
  layers.frames.replaceChildren();
  layers.shapes.replaceChildren();
  layers.selection.replaceChildren();
  shapeClips.replaceChildren();
  const all = [...shapes.entries()];
  // frames are always behind everything; all other shapes/arrows stack by z (stable for equal z)
  for (const [id, s] of all) if (s.type === 'frame') drawFrame(layers.frames, id, s);
  const rest = all
    .filter(([, s]) => s.type !== 'frame')
    .sort((a, b) => (a[1].z ?? 0) - (b[1].z ?? 0));
  for (const [id, s] of rest) {
    if (s.type === 'connector') drawConnector(layers.shapes, id, s);
    else if (s.type !== 'group') drawShape(layers.shapes, id, s); // groups render only via their members
  }
  drawSelection();
  syncEditStyle();
  positionFmtBar();
}

// ---------- remote cursors ----------

// awareness states that are alive: drop ghosts not heard from in 5s and merge duplicate
// tabs of the same browser (same uid) into a single entry
const STALE_MS = 5000;
function liveStates(): [number, any][] {
  const now = Date.now();
  const out: [number, any][] = [];
  const byUid = new Map<string, [number, any]>();
  awareness.getStates().forEach((state: any, clientID: number) => {
    if (clientID === doc.clientID) {
      out.push([clientID, state]);
      return;
    }
    if (state?.uid === myUid) return; // another tab of this browser
    if (typeof state?.t === 'number' && now - state.t > STALE_MS) return;
    const key = state?.uid ?? `cid-${clientID}`;
    const prev = byUid.get(key);
    if (!prev || (state.t ?? 0) > (prev[1].t ?? 0)) byUid.set(key, [clientID, state]);
  });
  for (const v of byUid.values()) out.push(v);
  return out;
}

function renderCursors(): void {
  layers.cursors.replaceChildren();
  for (const [clientID, state] of liveStates()) {
    if (clientID === doc.clientID || !state.cursor) continue;
    const sx = vp.x + state.cursor.x * vp.k;
    const sy = vp.y + state.cursor.y * vp.k;
    const g = el('g', { transform: `translate(${sx} ${sy})`, 'pointer-events': 'none' }, layers.cursors);
    el('path', { d: 'M0 0 L0 15 L4 11.5 L6.5 17 L9 16 L6.5 10.5 L11 10 Z', fill: state.color || '#e5534b', stroke: '#fff', 'stroke-width': 1 }, g);
    el('text', { x: 12, y: 20, 'font-size': 11, fill: state.color || '#e5534b', 'font-weight': 600 }, g).textContent = state.name || '?';
  }
}
function renderUsers(): void {
  usersEl.replaceChildren();
  for (const [clientID, state] of liveStates()) {
    if (!state.name) continue;
    const a = document.createElement('div');
    a.className = 'avatar';
    a.style.background = state.color || '#888';
    a.textContent = String(state.name).trim().charAt(0).toUpperCase() || '?';
    a.title = state.name + (clientID === doc.clientID ? ' (you)' : '');
    usersEl.appendChild(a);
  }
}
awareness.on('update', () => { renderCursors(); renderUsers(); });
renderUsers();

setInterval(() => {
  awareness.setLocalStateField('t', Date.now());
  renderCursors();
  renderUsers();
}, 1000);

let lastCursorSent = 0;
function sendCursor(w: { x: number; y: number }): void {
  const now = performance.now();
  if (now - lastCursorSent < 50) return;
  lastCursorSent = now;
  awareness.setLocalStateField('cursor', { x: Math.round(w.x), y: Math.round(w.y) });
}

// ---------- inline text editing (foreignObject + contenteditable) ----------

let editingId: string | null = null;
let editingOriginal = '';
let editWrap: HTMLDivElement | null = null;
let editDiv: HTMLDivElement | null = null;

function syncEditStyle(): void {
  if (!editingId || !editDiv || !editWrap) return;
  const s = shapes.get(editingId);
  if (!s) return;
  const isFrame = s.type === 'frame';
  editDiv.style.fontSize = `${isFrame ? 14 : (s.fontSize ?? 16)}px`;
  editDiv.style.fontWeight = String(isFrame ? 600 : s.bold ? 700 : 400);
  editDiv.style.fontStyle = isFrame || !(s.italic ?? false) ? 'normal' : 'italic';
  editDiv.style.textAlign = effAlignOf(s);
  editDiv.style.color = isFrame ? '#55607a' : textColorOf(s);
  editWrap.style.justifyContent = flexValign(effValignOf(s));
}

const flexValign = (v: VAlign | undefined) => (v === 'bottom' ? 'flex-end' : v === 'middle' ? 'center' : 'flex-start');

function enterEdit(id: string): void {
  const s = shapes.get(id);
  if (!s || s.type === 'group') return; // groups have no editable text
  if (editingId === id) return;
  if (editingId) exitEdit(true);
  editingId = id;
  const isFrame = s.type === 'frame';
  const isConn = s.type === 'connector';
  editingOriginal = isFrame ? (s.name ?? '') : (s.text ?? '');

  const fs = isFrame ? 14 : (s.fontSize ?? 16);
  const pad = isFrame ? 8 : 6;
  // the editor rotates with the shape: fo coordinates stay in local shape space
  const foParent = rotWrap(layers.edit, s);
  const fo = el('foreignObject', { class: isConn ? 'wb-edit-fo conn' : 'wb-edit-fo' }, foParent);
  let connMid: { x: number; y: number } | null = null;
  if (isConn) {
    connMid = connPoints(s).mid;
    fo.setAttribute('x', String(connMid.x - 80));
    fo.setAttribute('y', String(connMid.y - 15));
    fo.setAttribute('width', '160');
    fo.setAttribute('height', '30');
  } else {
    fo.setAttribute('x', String(s.x + (isFrame ? 8 : pad)));
    // +2px vertically (the editor's line box starts 1px above the fo): every alignment then hops exactly ~1px down when edit mode starts
    fo.setAttribute('y', String(s.y + (isFrame ? 2 : pad + 2)));
    fo.setAttribute('width', String(Math.max(60, s.w - 2 * pad)));
    fo.setAttribute('height', String(Math.max(24, s.h - 2 * pad)));
  }
  // vertical alignment via a flex wrapper; the contenteditable itself is a plain block so
  // text-align reliably applies to every line while editing, matching the rendered text
  const wrap = document.createElement('div');
  wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrap.className = 'wb-edit-wrap';
  wrap.style.cssText =
    `display:flex;flex-direction:column;justify-content:${flexValign(effValignOf(s))};` +
    `width:100%;height:100%;overflow:hidden;`;
  const div = document.createElement('div');
  div.className = 'wb-editing';
  div.contentEditable = 'true';
  div.spellcheck = false;
  div.style.cssText =
    // line-height 1.3 matches the SVG renderer so text does not hop when entering edit mode
    `width:100%;font-size:${fs}px;line-height:1.3;font-family:system-ui,sans-serif;white-space:pre-wrap;` +
    `overflow:hidden;outline:none;text-align:${effAlignOf(s)};` +
    `color:${isFrame ? '#55607a' : textColorOf(s)};font-weight:${isFrame ? 600 : s.bold ? 700 : 400};font-style:${isFrame || !(s.italic ?? false) ? 'normal' : 'italic'};`;
  if (isFrame) div.textContent = editingOriginal;
  else div.innerHTML = runsToHtml(shapeRuns(s));
  // copying text must carry this shape's base font size/weight/color: the editor div's own
  // styles are not part of the copied fragment, so without this wrapper the pasted text
  // would fall back to the target shape's base formatting on paste
  div.addEventListener('copy', (e) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const frag = sel.getRangeAt(0).cloneContents();
    const base = document.createElement('span');
    if (!isFrame && !isConn) {
      base.style.fontSize = `${fs}px`;
      base.style.fontWeight = s.bold ? '700' : '400';
      base.style.fontStyle = s.italic ? 'italic' : 'normal';
      base.style.color = textColorOf(s);
    }
    base.appendChild(frag);
    e.clipboardData?.setData('text/html', base.outerHTML);
    e.clipboardData?.setData('text/plain', sel.toString());
    e.preventDefault();
  });
  wrap.appendChild(div);
  fo.appendChild(wrap);
  editWrap = wrap;
  editDiv = div;

  // connector label editor grows with its content (up to 360 screen px wide, then it wraps
  // and grows downward); stays centered on the path midpoint
  const growConnEditor = (): void => {
    if (!isConn || !connMid || !editDiv) return;
    const div = editDiv;
    div.style.width = 'auto';
    const cw = Math.min(360, Math.max(90, div.scrollWidth + 12));
    const ww = cw / vp.k;
    fo.setAttribute('width', String(ww));
    div.style.width = '100%';
    const ch = Math.max(30, div.scrollHeight + 6);
    const hh = ch / vp.k;
    fo.setAttribute('height', String(hh));
    fo.setAttribute('x', String(connMid.x - ww / 2));
    fo.setAttribute('y', String(connMid.y - hh / 2));
  };

  div.addEventListener('input', () => {
    const cur = shapes.get(id);
    if (!cur) return;
    if (cur.type === 'frame') {
      commit(() => shapes.set(id, { ...cur, name: div.innerText.replace(/\n+$/, '') }));
    } else {
      const runs = htmlToRuns(div);
      const plain = runs.map((r) => r.t).join('');
      // shapes keep their fixed size (overflowing text is clipped); the connector label
      // editor grows with its content instead
      commit(() => shapes.set(id, { ...cur, runs, text: plain }));
      growConnEditor();
    }
  });
  div.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); revertEdit(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); exitEdit(true); }
  });
  div.addEventListener('blur', (e) => {
    // don't exit when focus moves into the format bar, or while the native color
    // picker (opened from the bar's color input) owns the focus
    const rt = (e as FocusEvent).relatedTarget as Node | null;
    if (rt && fmtbar.contains(rt)) return;
    if (pickerActive) return;
    exitEdit(true);
  });

  growConnEditor();
  scheduleRender();
  positionFmtBar();
  div.focus();
  const range = document.createRange();
  range.selectNodeContents(div);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function exitEdit(_commit: boolean): void {
  if (!editingId) return;
  const id = editingId;
  editingId = null;
  editingOriginal = '';
  editWrap = null;
  editDiv = null;
  layers.edit.replaceChildren();
  fmtbar.style.display = 'none';
  // a standalone text box left empty (or only whitespace) vanishes on exit; shapes keep
  // their (possibly empty) text
  const s = shapes.get(id);
  if (s && s.type === 'text' && !(s.text ?? '').trim()) {
    commit(() => shapes.delete(id));
    if (selected.has(id)) selected.delete(id);
  }
  // a connector label left empty is removed again
  if (s && s.type === 'connector' && !(s.text ?? '').trim()) {
    commit(() => {
      const rest = { ...s };
      delete rest.text;
      delete rest.runs;
      shapes.set(id, rest);
    });
  }
  scheduleRender();
}

function revertEdit(): void {
  if (!editingId) return;
  const id = editingId;
  const s = shapes.get(id);
  if (s) {
    if (s.type === 'frame') commit(() => shapes.set(id, { ...s, name: editingOriginal }));
    else commit(() => shapes.set(id, { ...s, text: editingOriginal, runs: [{ t: editingOriginal }] }));
  }
  exitEdit(false);
}

// effective format of a text range inside the editor (uniform values only). Besides the
// cloned contents, inline styles of ancestors up to the editor count too (innermost wins,
// like CSS) — the selection usually sits inside the wrap element of the previous change.
function rangeFormat(range: Range): { size?: number; bold?: boolean; italic?: boolean; color?: string } | null {
  if (!editDiv) return null;
  const tmp = document.createElement('div');
  tmp.appendChild(range.cloneContents());
  const runs = htmlToRuns(tmp);
  let ancS: number | undefined;
  let ancB: boolean | undefined;
  let ancI: boolean | undefined;
  let ancC: string | undefined;
  let node: Node | null = range.commonAncestorContainer;
  while (node && node !== editDiv) {
    const eln = node as HTMLElement;
    const st = eln.style;
    if (st && st.fontSize && ancS === undefined) { const p = parseInt(st.fontSize); if (!isNaN(p)) ancS = p; }
    if (eln.nodeName === 'B' || eln.nodeName === 'STRONG' || st?.fontWeight === '700' || st?.fontWeight === 'bold') { if (ancB === undefined) ancB = true; }
    else if (st && (st.fontWeight === '400' || st.fontWeight === 'normal')) { if (ancB === undefined) ancB = false; }
    if (eln.nodeName === 'I' || eln.nodeName === 'EM' || st?.fontStyle === 'italic' || st?.fontStyle === 'oblique') { if (ancI === undefined) ancI = true; }
    else if (st && st.fontStyle === 'normal') { if (ancI === undefined) ancI = false; }
    if (st && st.color && ancC === undefined) ancC = toHexColor(st.color);
    node = node.parentNode;
  }
  const s = editingId ? shapes.get(editingId) : undefined;
  const baseFs = s?.fontSize ?? 16;
  const baseB = s?.bold ?? false;
  const baseI = s?.italic ?? false;
  const baseC = s ? toHexColor(textColorOf(s)) : '#1a1a1a';
  if (!runs.length && ancS === undefined && ancB === undefined && ancI === undefined && ancC === undefined) return null;
  const sizes = new Set(runs.map((r) => r.s ?? ancS ?? baseFs));
  const bolds = new Set(runs.map((r) => r.b ?? ancB ?? baseB));
  const italics = new Set(runs.map((r) => r.i ?? ancI ?? baseI));
  const colors = new Set(runs.map((r) => r.c ?? ancC ?? baseC));
  return {
    size: sizes.size === 1 ? [...sizes][0] : undefined,
    bold: bolds.size === 1 ? [...bolds][0] : undefined,
    italic: italics.size === 1 ? [...italics][0] : undefined,
    color: colors.size === 1 ? toHexColor([...colors][0]) : undefined,
  };
}

function selectionFormat(): { size?: number; bold?: boolean; italic?: boolean; color?: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editDiv || !editingId) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed || !editDiv.contains(range.commonAncestorContainer)) return null;
  return rangeFormat(range);
}

function applySelectionFormat(id: string, k: 'bold' | 'italic' | 'fontSize' | 'color', delta: number, range: Range, colorVal?: string): void {
  if (!editDiv || range.collapsed || !editDiv.contains(range.commonAncestorContainer)) return;
  const s = shapes.get(id);
  const fmt = rangeFormat(range);
  const baseFs = s?.fontSize ?? 16;
  const baseB = s?.bold ?? false;
  const baseI = s?.italic ?? false;
  let wrap: HTMLElement;
  let cur = false;
  if (k === 'bold' || k === 'italic') {
    // toggle: if the whole selection is already bold/italic, remove it instead of nesting
    cur = k === 'bold' ? (fmt?.bold ?? baseB) : (fmt?.italic ?? baseI);
    wrap = document.createElement(k === 'bold' ? (cur ? 'span' : 'b') : (cur ? 'span' : 'i'));
    if (cur) (k === 'bold' ? (wrap.style.fontWeight = '400') : (wrap.style.fontStyle = 'normal'));
  } else if (k === 'color') {
    wrap = document.createElement('span');
    wrap.style.color = colorVal ?? '#1a1a1a';
  } else {
    const curSize = fmt?.size ?? baseFs;
    wrap = document.createElement('span');
    wrap.style.fontSize = `${clamp(curSize + delta, 8, 96)}px`;
  }
  if ((k === 'bold' || k === 'italic') && cur) {
    // toggling OFF: unwrap the wrappers inside the selection first — otherwise
    // surroundContents would nest the reset span inside the existing wrapper and it would win
    const frag = range.extractContents();
    frag.querySelectorAll(k === 'bold' ? 'b, strong' : 'i, em').forEach((b) => b.replaceWith(...b.childNodes));
    frag.querySelectorAll('*').forEach((eln) => {
      const st = (eln as HTMLElement).style;
      if (!st) return;
      if (k === 'bold' && (st.fontWeight === '700' || st.fontWeight === 'bold')) st.fontWeight = '400';
      if (k === 'italic' && (st.fontStyle === 'italic' || st.fontStyle === 'oblique')) st.fontStyle = 'normal';
    });
    wrap.appendChild(frag);
    range.insertNode(wrap);
    // the range sat inside the wrapper element, so extractContents left it in place and the
    // reset span got nested inside it — unwrap that wrapper now that it only holds the reset
    const p = wrap.parentElement;
    if (p && ((k === 'bold' && (p.nodeName === 'B' || p.nodeName === 'STRONG')) || (k === 'italic' && (p.nodeName === 'I' || p.nodeName === 'EM')))) {
      p.replaceWith(...p.childNodes);
    }
  } else {
    // NOTE: surroundContents inserts the new wrap INSIDE any existing wrapper around the
    // selection, and htmlToRuns reads the innermost style — so repeated clicks keep stepping.
    try { range.surroundContents(wrap); } catch {
      const frag = range.extractContents();
      // applying bold/italic ON: drop opposite reset spans inside, or they would win as innermost
      if (k === 'bold' || k === 'italic') {
        frag.querySelectorAll('span').forEach((sp) => {
          const st = (sp as HTMLElement).style;
          if (k === 'bold' && st.fontWeight === '400') sp.replaceWith(...sp.childNodes);
          if (k === 'italic' && st.fontStyle === 'normal') sp.replaceWith(...sp.childNodes);
        });
      }
      wrap.appendChild(frag);
      range.insertNode(wrap);
    }
  }
  editDiv.normalize();
  // keep the selection on the wrapped text, otherwise the next +/- click would capture a
  // collapsed selection and fall back to reformatting the whole shape
  const r2 = document.createRange();
  r2.selectNodeContents(wrap);
  const sel = window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(r2); }
  const runs = htmlToRuns(editDiv);
  commit(() => {
    const cur = shapes.get(id);
    if (cur) shapes.set(id, { ...cur, runs, text: runs.map((r) => r.t).join('') });
  });
}

// ---------- formatting toolbar ----------

function fmtTarget(): Shape | undefined {
  const id = editingId ?? (selected.size === 1 ? [...selected][0] : null);
  return id ? shapes.get(id) : undefined;
}

function setZ(id: string, mode: 'top' | 'bottom' | 'up' | 'down'): void {
  commit(() => {
    const cur = shapes.get(id);
    if (!cur || cur.type === 'frame' || cur.type === 'group') return;
    const others = [...shapes.values()].filter((o) => o.type !== 'frame' && o.id !== id);
    const zs = others.map((o) => o.z ?? 0);
    const cz = cur.z ?? 0;
    if (mode === 'top') {
      shapes.set(id, { ...cur, z: Math.max(cz, ...zs, 0) + 1 });
    } else if (mode === 'bottom') {
      shapes.set(id, { ...cur, z: Math.min(cz, ...zs, 0) - 1 });
    } else {
      const dir = mode === 'up' ? 1 : -1;
      const next = zs.filter((z) => (z - cz) * dir > 0).sort((a, b) => (a - b) * dir)[0];
      if (next === undefined) {
        shapes.set(id, { ...cur, z: cz + dir });
      } else {
        const other = others.find((o) => (o.z ?? 0) === next)!;
        shapes.set(other.id, { ...other, z: cz });
        shapes.set(id, { ...cur, z: next });
      }
    }
  });
}

function selectionBoundsOf(ids: Iterable<string>): { x: number; y: number; w: number; h: number } | null {
  let b: { x: number; y: number; w: number; h: number } | null = null;
  for (const id of ids) {
    const s = shapes.get(id);
    if (!s) continue;
    const bb = boundsOf(s);
    if (!b) { b = bb; continue; }
    const x = Math.min(b.x, bb.x);
    const y = Math.min(b.y, bb.y);
    b = { x, y, w: Math.max(b.x + b.w, bb.x + bb.w) - x, h: Math.max(b.y + b.h, bb.y + bb.h) - y };
  }
  return b;
}
const selectionBounds = (): { x: number; y: number; w: number; h: number } | null => selectionBoundsOf(selected);

function positionFmtBar(): void {
  // multi-selection or a single group: only the group menu (group / ungroup) is offered,
  // a group can only be moved — no format, color, z or resize controls
  const single = selected.size === 1 ? shapes.get([...selected][0]) : undefined;
  if (!editingId && (selected.size > 1 || single?.type === 'group')) {
    const b = selectionBounds();
    if (!b) {
      fmtbar.style.display = 'none';
      return;
    }
    for (const id of ['textctl', 'stylectl', 'connctl', 'zctl', 'multictl']) (document.getElementById(id) as HTMLElement).style.display = 'none';
    (document.getElementById('groupctl') as HTMLElement).style.display = 'contents';
    (document.getElementById('multictl') as HTMLElement).style.display = selected.size > 1 ? 'contents' : 'none';
    (document.getElementById('fb-group') as HTMLElement).style.display = selected.size >= 2 ? '' : 'none';
    (document.getElementById('fb-ungroup') as HTMLElement).style.display = [...selected].some((id) => shapes.get(id)?.type === 'group') ? '' : 'none';
    fmtbar.style.display = 'flex';
    const cx = vp.x + (b.x + b.w / 2) * vp.k;
    fmtbar.style.left = `${clamp(cx - 40, 60, window.innerWidth - 160)}px`;
    fmtbar.style.top = `${Math.max(52, vp.y + b.y * vp.k - 48)}px`;
    return;
  }
  const s = fmtTarget();
  if (!s) {
    fmtbar.style.display = 'none';
    return;
  }
  (document.getElementById('groupctl') as HTMLElement).style.display = 'none';
  (document.getElementById('multictl') as HTMLElement).style.display = 'none';
  const isConn = s.type === 'connector';
  const isFrame = s.type === 'frame';
  // text controls also apply to a connector's label, whether the arrow is selected or being edited
  (document.getElementById('textctl') as HTMLElement).style.display = 'contents';
  (document.getElementById('stylectl') as HTMLElement).style.display = isConn ? 'none' : 'contents';
  (document.getElementById('connctl') as HTMLElement).style.display = isConn ? 'contents' : 'none';
  (document.getElementById('zctl') as HTMLElement).style.display = isFrame ? 'none' : 'contents';
  let sx: number;
  let top: number;
  if (isConn) {
    // center horizontally on the arrow, above its highest point; if there is no room
    // above within the visible area, place it below the lowest point instead
    const pts = sampleConn(s);
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const midX = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    sx = vp.x + midX * vp.k;
    const BAR_H = 40;
    top = vp.y + minY * vp.k - (BAR_H + 8);
    if (top < 52) top = vp.y + maxY * vp.k + 10;
    top = clamp(top, 52, window.innerHeight - BAR_H - 8);
  } else {
    const b = boundsOf(s); // AABB: for rotated shapes the bar floats above the rotated outline
    sx = vp.x + s.x * vp.k;
    top = vp.y + b.y * vp.k - 76; // clears the rotation handle at 29px above the box
    if (top < 52) top = vp.y + (b.y + b.h) * vp.k + 10; // no room above (would cover the handle): below the box
    top = clamp(top, 52, window.innerHeight - 48);
  }
  fmtbar.style.display = 'flex';
  fmtbar.style.left = `${clamp(sx, 60, window.innerWidth - 660)}px`;
  fmtbar.style.top = `${top}px`;
  // font size / bold / italic / color don't apply to frame labels
  fmtbar.querySelectorAll('[data-k="fontSize"],[data-k="bold"],[data-k="italic"]').forEach((b) => {
    (b as HTMLElement).style.display = isFrame ? 'none' : '';
  });
  (document.getElementById('fb-color-wrap') as HTMLElement).style.display = isFrame ? 'none' : '';
  // while editing with a text selection, the size/bold/color controls reflect the selection
  const selFmt = editingId === s.id ? selectionFormat() : null;
  document.getElementById('fb-size')!.textContent = String(selFmt?.size ?? (s.fontSize ?? 16));
  if (!isConn) {
    const effCol = toHexColor(selFmt?.color ?? textColorOf(s));
    (document.getElementById('fb-color-bar') as HTMLElement).style.background = effCol;
    (document.getElementById('fb-color-input') as HTMLInputElement).value = effCol;
    const defFill = s.type === 'frame' ? 'rgba(120,140,180,0.07)' : s.type === 'text' ? 'none' : '#ffffff';
    const effFill = s.fill ?? defFill;
    const fillNone = effFill === 'none';
    const fillBar = document.getElementById('fb-fill-bar') as HTMLElement;
    if (fillNone) {
      fillBar.style.background = '#e5534b';
      fillBar.style.height = '2px';
      fillBar.style.borderRadius = '1px';
      fillBar.style.transform = 'rotate(7deg) translateY(-2px)';
    } else {
      fillBar.style.background = toHexColor(effFill);
      fillBar.style.height = '';
      fillBar.style.borderRadius = '';
      fillBar.style.transform = '';
    }
    (document.getElementById('fb-fill-input') as HTMLInputElement).value = fillNone ? '#ffffff' : toHexColor(effFill);
    (document.getElementById('fb-fill-none') as HTMLButtonElement).classList.toggle('active', fillNone);
    (document.getElementById('fb-stroke-none') as HTMLButtonElement).classList.toggle('active', (s.width ?? 2) === 0);
    const effStroke = s.stroke ?? (s.type === 'frame' ? '#7a86a8' : '#1a1a1a');
    (document.getElementById('fb-stroke-bar') as HTMLElement).style.background = toHexColor(effStroke);
    (document.getElementById('fb-stroke-input') as HTMLInputElement).value = toHexColor(effStroke);
  } else {
    const effConn = toHexColor(s.stroke ?? '#444');
    (document.getElementById('fb-conn-color-bar') as HTMLElement).style.background = effConn;
    (document.getElementById('fb-conn-color-input') as HTMLInputElement).value = effConn;
  }
  const effAlign = effAlignOf(s);
  const effValign = effValignOf(s);
  fmtbar.querySelectorAll('button[data-k]').forEach((b) => {
    const bb = b as HTMLButtonElement;
    const k = bb.dataset.k!;
    if (isConn && (k === 'dash' || k === 'elbow' || k === 'width' || k === 'arrowStart' || k === 'arrowEnd')) {
      if (k === 'dash') bb.classList.toggle('active', !!s.dash);
      else if (k === 'elbow') bb.classList.toggle('active', !!s.elbow);
      else if (k === 'width') bb.classList.toggle('active', (s.width ?? 2) === Number(bb.dataset.v));
      else if (k === 'arrowStart') bb.classList.toggle('active', !!s.arrowStart);
      else if (k === 'arrowEnd') bb.classList.toggle('active', s.arrowEnd !== false);
    } else if (k === 'bold') bb.classList.toggle('active', selFmt ? (selFmt.bold ?? false) : effBoldOf(s));
    else if (k === 'italic') bb.classList.toggle('active', selFmt ? (selFmt.italic ?? false) : effItalicOf(s));
    else if (k === 'fontSize' || k === 'z') bb.classList.remove('active');
    else if (k === 'width') bb.classList.toggle('active', (s.width ?? 2) === Number(bb.dataset.v));
    else bb.classList.toggle('active', (k === 'align' ? effAlign : effValign) === bb.dataset.v);
  });
}

// editor text selection captured at mousedown, before the click can disturb it
let pendingEditRange: Range | null = null;
// true between opening a native color picker from the format bar and its input/cancel
let pickerActive = false;

fmtbar.querySelectorAll('button[data-k]').forEach((b) => {
  const bb = b as HTMLButtonElement;
  bb.addEventListener('mousedown', (e) => {
    e.preventDefault(); // keep editor focus
    const sel = window.getSelection();
    pendingEditRange =
      editDiv && sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed && editDiv.contains(sel.getRangeAt(0).commonAncestorContainer)
        ? sel.getRangeAt(0).cloneRange()
        : null;
  });
  bb.addEventListener('click', () => {
    const s = fmtTarget();
    if (!s || s.type === 'group') return; // groups cannot be formatted
    const id = s.id;
    const k = bb.dataset.k!;
    if (k === 'z' && s.type !== 'frame') {
      setZ(id, bb.dataset.v as 'top' | 'bottom' | 'up' | 'down');
      positionFmtBar();
      return;
    }
    // arrow-style keys are connector-only; the text keys (size/bold/italic/align/color)
    // fall through to the normal text handling and apply to the connector's label
    if (s.type === 'connector' && (k === 'dash' || k === 'elbow' || k === 'width' || k === 'arrowStart' || k === 'arrowEnd')) {
      if (k === 'dash') commit(() => shapes.set(id, { ...s, dash: !s.dash }));
      else if (k === 'elbow') commit(() => shapes.set(id, { ...s, elbow: !s.elbow }));
      else if (k === 'width') commit(() => shapes.set(id, { ...s, width: Number(bb.dataset.v) }));
      else if (k === 'arrowStart') commit(() => shapes.set(id, { ...s, arrowStart: !s.arrowStart }));
      else if (k === 'arrowEnd') commit(() => shapes.set(id, { ...s, arrowEnd: s.arrowEnd === false }));
      positionFmtBar();
      return;
    }
    // while editing with a text selection, bold/italic/size apply to the selection only
    if ((k === 'bold' || k === 'italic' || k === 'fontSize') && editingId === id && editDiv && pendingEditRange) {
      const range = pendingEditRange;
      pendingEditRange = null;
      applySelectionFormat(id, k as 'bold' | 'italic' | 'fontSize', Number(bb.dataset.d || 0), range);
      positionFmtBar();
      return;
    }
    pendingEditRange = null;
    if (k === 'fontSize' || k === 'bold' || k === 'italic') {
      // no text selection: the change applies to the whole text and overwrites all per-run
      // values of THAT property only — size, bold and italic stay independent of each other
      const d = Number(bb.dataset.d || 0);
      commit(() => {
        const cur = shapes.get(id);
        if (!cur) return;
        const runs = cur.runs?.map((r) => (k === 'fontSize' ? { t: r.t, b: r.b, i: r.i, c: r.c } : k === 'bold' ? { t: r.t, s: r.s, i: r.i, c: r.c } : { t: r.t, b: r.b, s: r.s, c: r.c }));
        shapes.set(id, {
          ...cur,
          ...(runs ? { runs, text: runs.map((r) => r.t).join('') } : {}),
          ...(k === 'fontSize' ? { fontSize: clamp((cur.fontSize ?? 16) + d, 8, 96) } : k === 'bold' ? { bold: !effBoldOf(cur) } : { italic: !effItalicOf(cur) }),
        });
      });
      if (editingId === id && editDiv) {
        const cur = shapes.get(id);
        if (cur) {
          if (cur.type === 'frame') editDiv.textContent = cur.name ?? '';
          else editDiv.innerHTML = runsToHtml(shapeRuns(cur));
          const sel = window.getSelection();
          const r = document.createRange();
          r.selectNodeContents(editDiv);
          r.collapse(false);
          sel?.removeAllRanges();
          sel?.addRange(r);
        }
      }
    } else if (k === 'width') {
      // border thickness, same 1/2/4 steps as the arrow widths
      commit(() => shapes.set(id, { ...s, width: Number(bb.dataset.v) }));
    } else {
      commit(() => shapes.set(id, { ...s, [k]: bb.dataset.v } as Shape));
    }
    positionFmtBar();
  });
});
// shared color popup for every color picking (text, fill, border, arrow): swatch clicks drive
// the hidden input with mousedown+input events, so all wiring stays unchanged
const DEFAULT_COLORS = [
  '#1a1a1a', '#3f4450', '#7a7f8c', '#b0b7c3', '#d0d4dc', '#e8eaf0', '#f2f4f8', '#ffffff',
  '#e5534b', '#b03a30', '#f28b82', '#eb5aa0', '#c2477f', '#8a2b56', '#f2994a', '#d97b29',
  '#f0e75e', '#d9a521', '#8a5a2b', '#6b4423', '#27ae60', '#1d8a4c', '#6fcf97', '#2e7d32',
  '#56ccf2', '#2d9cdb', '#1f7ab0', '#2f80ed', '#4a6cf7', '#3451c4', '#9b51e0', '#7a3bb8',
];
const colorPop = document.getElementById('colorpop') as HTMLElement;
const colorPopGrid = document.getElementById('colorpop-grid') as HTMLElement;
let colorPopInput: HTMLInputElement | null = null;
for (const c of DEFAULT_COLORS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.c = c;
  b.style.background = c;
  b.title = c;
  b.addEventListener('click', () => {
    const inp = colorPopInput;
    closeColorPop();
    if (!inp) return;
    inp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    inp.value = c;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  colorPopGrid.appendChild(b);
}
function closeColorPop(): void {
  colorPop.style.display = 'none';
  colorPopInput = null;
}
function openColorPop(btn: HTMLElement, input: HTMLInputElement): void {
  if (colorPopInput === input && colorPop.style.display !== 'none') { closeColorPop(); return; } // toggle
  colorPopInput = input;
  const r = btn.getBoundingClientRect();
  colorPop.style.display = 'block';
  const pw = colorPop.offsetWidth, ph = colorPop.offsetHeight;
  colorPop.style.left = `${clamp(r.left, 8, window.innerWidth - pw - 8)}px`;
  colorPop.style.top = `${r.bottom + 6 + ph > window.innerHeight ? Math.max(8, r.top - ph - 6) : r.bottom + 6}px`;
}
document.getElementById('colorpop-custom')!.addEventListener('click', () => {
  const inp = colorPopInput;
  closeColorPop();
  inp?.click();
});
document.addEventListener('pointerdown', (e) => {
  if (colorPop.style.display === 'none') return;
  const t = e.target as Element | null;
  if (t?.closest?.('#colorpop') || t?.closest?.('.fb-swatch-btn')) return;
  closeColorPop();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeColorPop(); });
for (const [btnId, inputId] of [
  ['fb-color-btn', 'fb-color-input'],
  ['fb-fill-btn', 'fb-fill-input'],
  ['fb-stroke-btn', 'fb-stroke-input'],
  ['fb-conn-color-btn', 'fb-conn-color-input'],
] as const) {
  document.getElementById(btnId)!.addEventListener('click', (e) => {
    e.stopPropagation();
    openColorPop(e.currentTarget as HTMLElement, document.getElementById(inputId) as HTMLInputElement);
  });
}

const fbColorInput = document.getElementById('fb-color-input') as HTMLInputElement;
fbColorInput.addEventListener('mousedown', (e) => {
  e.preventDefault(); // keep editor focus
  pickerActive = true;
  const sel = window.getSelection();
  pendingEditRange =
    editDiv && sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed && editDiv.contains(sel.getRangeAt(0).commonAncestorContainer)
      ? sel.getRangeAt(0).cloneRange()
      : null;
});
function applyTextColor(val: string): void {
  const s = fmtTarget();
  pickerActive = false;
  if (!s || s.type === 'frame' || s.type === 'group') return;
  const id = s.id;
  let range = pendingEditRange;
  pendingEditRange = null;
  // fallback: the selection can still be alive even if the mousedown capture missed it
  if (!range && editingId === id && editDiv) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed && editDiv.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      range = sel.getRangeAt(0);
    }
  }
  if (editingId === id && editDiv && range) {
    applySelectionFormat(id, 'color', 0, range, val);
  } else {
    // whole-text color: set the shape color and strip per-run colors (like size/bold)
    commit(() => {
      const cur = shapes.get(id);
      if (!cur) return;
      const runs = cur.runs?.map((r) => ({ t: r.t, b: r.b, s: r.s }));
      shapes.set(id, { ...cur, ...(runs ? { runs, text: runs.map((r) => r.t).join('') } : {}), color: val });
    });
    if (editingId === id && editDiv) {
      const cur = shapes.get(id);
      if (cur) {
        if (cur.type === 'frame') editDiv.textContent = cur.name ?? '';
        else editDiv.innerHTML = runsToHtml(shapeRuns(cur));
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(editDiv);
        r.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
    }
  }
  if (editingId === id && editDiv) editDiv.focus(); // the picker may have taken focus
  positionFmtBar();
}
fbColorInput.addEventListener('input', () => applyTextColor(toHexColor(fbColorInput.value)));
fbColorInput.addEventListener('cancel', () => {
  pickerActive = false;
  if (editingId && editDiv) editDiv.focus();
});

function wireShapeColor(inputId: string, key: 'fill' | 'stroke'): void {
  const input = document.getElementById(inputId) as HTMLInputElement;
  input.addEventListener('mousedown', (e) => {
    e.preventDefault(); // keep editor focus
    pickerActive = true;
  });
  input.addEventListener('input', () => {
    pickerActive = false;
    const s = fmtTarget();
    if (s && s.type !== 'group') {
      commit(() => {
        const cur = shapes.get(s.id);
        if (!cur) return;
        // a border color on a borderless text box implies a visible border
        const extra = key === 'stroke' && cur.type === 'text' && cur.width === undefined ? { width: 2 } : {};
        shapes.set(s.id, { ...cur, [key]: toHexColor(input.value), ...extra } as Shape);
      });
    }
    if (editingId && editDiv) editDiv.focus();
    positionFmtBar();
  });
  input.addEventListener('cancel', () => {
    pickerActive = false;
    if (editingId && editDiv) editDiv.focus();
  });
}
wireShapeColor('fb-fill-input', 'fill');
wireShapeColor('fb-stroke-input', 'stroke');
wireShapeColor('fb-conn-color-input', 'stroke');
const fbStrokeNone = document.getElementById('fb-stroke-none') as HTMLButtonElement;
fbStrokeNone.addEventListener('mousedown', (e) => e.preventDefault());
fbStrokeNone.addEventListener('click', () => {
  const s = fmtTarget();
  if (!s || s.type === 'connector' || s.type === 'group') return;
  commit(() => {
    const cur = shapes.get(s.id);
    if (cur) shapes.set(s.id, { ...cur, width: 0 });
  });
  if (editingId && editDiv) editDiv.focus();
  positionFmtBar();
});
const fbFillNone = document.getElementById('fb-fill-none') as HTMLButtonElement;
fbFillNone.addEventListener('mousedown', (e) => e.preventDefault());
fbFillNone.addEventListener('click', () => {
  const s = fmtTarget();
  if (!s || s.type === 'connector' || s.type === 'group') return;
  commit(() => {
    const cur = shapes.get(s.id);
    if (cur) shapes.set(s.id, { ...cur, fill: 'none' });
  });
  if (editingId && editDiv) editDiv.focus();
  positionFmtBar();
});
document.getElementById('fb-delete')!.addEventListener('click', () => deleteSelected());
document.addEventListener('selectionchange', () => {
  if (editingId && editDiv) positionFmtBar();
});

// ---------- pointer interaction ----------

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; startX: number; startY: number; items: Map<string, { x: number; y: number }>; conns: Map<string, Shape>; connDirect: Set<string>; guides: SVGLineElement[] }
  | { kind: 'create'; startX: number; startY: number; preview: SVGElement }
  | { kind: 'maybeCreate'; tool: Tool; startX: number; startY: number; downTime: number }
  | { kind: 'resize'; id: string; x: number; y: number; guides: SVGLineElement[] }
  | { kind: 'bresize'; id: string; startX: number; startY: number; edges: { l: boolean; r: boolean; t: boolean; b: boolean }; moved: boolean; guides: SVGLineElement[] }
  | { kind: 'rotate'; id: string; cx: number; cy: number; startAngle: number; startRot: number }
  | { kind: 'marquee'; startX: number; startY: number; rect: SVGRectElement }
  | { kind: 'arrow'; from: Endpoint; startX: number; startY: number; line: SVGPathElement | null; elbow: boolean }
  | { kind: 'endpoint'; id: string; ep: 'from' | 'to' | 'mid' };

let drag: Drag | null = null;
let downInfo: { id: string; x: number; y: number; time: number } | null = null;
let lastClick: { id: string; time: number } | null = null;

function closestAttr(e: { target: EventTarget | null }, attr: string): string | null {
  const t = e.target as Element | null;
  const found = t?.closest?.(`[${attr}]`);
  return found ? found.getAttribute(attr) : null;
}

// after a shape was resized, re-snap endpoints docked to it back onto its border (offsets are
// relative to the center, so a resize can leave them inside the shape); manual bend anchors are
// kept and clamped/recalculated by elbowPts as needed
function resnapDockedTo(id: string): void {
  const ns = shapes.get(id);
  if (!ns) return;
  const c = centerOf(ns);
  for (const [cid, cc] of shapes) {
    if (cc.type !== 'connector') continue;
    const f = normEp(cc.from);
    const t = normEp(cc.to);
    if (f.shape !== id && t.shape !== id) continue;
    const snap = (ep: Endpoint): Endpoint => {
      if (ep.shape !== id) return ep;
      const wo = rotOffset(ns, ep.dx, ep.dy); // current world offset of the dock point
      const bp = borderPoint(ns, { x: c.x + wo.x, y: c.y + wo.y });
      return epAt(ns, bp);
    };
    shapes.set(cid, { ...cc, from: snap(f), to: snap(t) });
  }
}

function cursorForEdges(e: { l: boolean; r: boolean; t: boolean; b: boolean }): string {
  const horiz = e.l || e.r;
  const vert = e.t || e.b;
  if (horiz && vert) return (e.l && e.t) || (e.r && e.b) ? 'nwse-resize' : 'nesw-resize';
  if (horiz) return 'ew-resize';
  if (vert) return 'ns-resize';
  return 'move';
}

// hover cursor for the select tool: border band of an unrotated shape/text = side-resize cursor,
// interior = move; frames/groups only move (their border drag is a move)
function hoverCursor(id: string | null, w: { x: number; y: number }): string {
  if (!id) return '';
  const s = shapes.get(id);
  if (!s || s.type === 'connector') return '';
  if (s.type === 'frame' || s.type === 'group' || rotOf(s)) return 'move';
  const tol = 8 / vp.k;
  if (distToOutline(s, w) <= tol) return cursorForEdges(borderEdgesOf(s, w, tol));
  return 'move';
}

function borderEdgesOf(s: Shape, w: { x: number; y: number }, tol: number): { l: boolean; r: boolean; t: boolean; b: boolean } {
  const e = {
    l: Math.abs(w.x - s.x) <= tol,
    r: Math.abs(w.x - (s.x + s.w)) <= tol,
    t: Math.abs(w.y - s.y) <= tol,
    b: Math.abs(w.y - (s.y + s.h)) <= tol,
  };
  if (!e.l && !e.r && !e.t && !e.b) {
    const c = centerOf(s);
    if (Math.abs(w.x - c.x) / Math.max(1, s.w / 2) >= Math.abs(w.y - c.y) / Math.max(1, s.h / 2)) e[w.x < c.x ? 'l' : 'r'] = true;
    else e[w.y < c.y ? 't' : 'b'] = true;
  }
  return e;
}

function onPointerDown(e: PointerEvent): void {
  // clicks inside the inline editor must reach the contenteditable div
  if (editingId && (e.target as Element).closest?.('#edit')) return;
  e.preventDefault(); // stop native text selection / drag from starting
  if (editingId) exitEdit(true);
  svg.setPointerCapture(e.pointerId);
  if (e.button === 1 || (e.button === 0 && tool === 'hand')) {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y };
    svg.classList.add('panning');
    return;
  }
  if (e.button !== 0) return;
  const w = screenToWorld(e);
  lastCursor = w;
  const handleId = closestAttr(e, 'data-handle');
  const ep = closestAttr(e, 'data-ep');
  // geometric hit test with z-order (connectors > shapes > frames); DOM ids only for handles/endpoint dots
  const id = ep || handleId ? closestAttr(e, 'data-id') : hitTest(w);

  // a plain click on a shape is always a select, even when a drawing tool is active;
  // with an arrow tool, an existing arrow is selected/moved — a new arrow only starts on a shape or empty space
  const shapeTools: Tool[] = ['rect', 'ellipse', 'diamond', 'text', 'frame'];
  const hitConn = id ? shapes.get(id)?.type === 'connector' : false;
  // shape tool pressed on an UNSELECTED shape: defer — a short click (<=200ms, no drag) selects
  // the shape, a long click/drag creates the tool's shape from the press point instead of moving
  // (an already-selected shape falls through and moves immediately, as before)
  if (shapeTools.includes(tool) && id && !e.shiftKey && !handleId && !ep && !selected.has(id)) {
    downInfo = { id, x: e.clientX, y: e.clientY, time: performance.now() };
    drag = { kind: 'maybeCreate', tool, startX: w.x, startY: w.y, downTime: performance.now() };
    return;
  }
  if (tool === 'select' || (shapeTools.includes(tool) && !!id) || ((tool === 'arrow' || tool === 'elbow') && hitConn)) {
    // remember the press even on a handle so double-click-to-edit also works when the
    // press lands on an endpoint/mid dot (the native dblclick is unreliable there)
    if (id) downInfo = { id, x: e.clientX, y: e.clientY, time: performance.now() };
    if (ep && id) {
      layers.selection.style.pointerEvents = 'none'; // let elementFromPoint see shapes below
      drag = { kind: 'endpoint', id, ep: ep as 'from' | 'to' | 'mid' };
      return;
    }
    if (handleId && id) {
      const s = shapes.get(id);
      if (s && handleId === 'rot') {
        const c = centerOf(s);
        drag = { kind: 'rotate', id, cx: c.x, cy: c.y, startAngle: Math.atan2(w.y - c.y, w.x - c.x) * 180 / Math.PI, startRot: rotOf(s) };
      } else if (s) {
        drag = { kind: 'resize', id, x: s.x, y: s.y, guides: [] };
      }
      return;
    }
    if (id) {
      // border press on an unrotated shape/text (frames and groups excluded — their border drag
      // moves them): a plain click selects, a drag scales only the grabbed side(s)
      const bs = shapes.get(id);
      if (tool === 'select' && !e.shiftKey && bs && bs.type !== 'frame' && bs.type !== 'group' && bs.type !== 'connector' && !rotOf(bs) && distToOutline(bs, w) <= 8 / vp.k) {
        downInfo = { id, x: e.clientX, y: e.clientY, time: performance.now() };
        const edges = borderEdgesOf(bs, w, 8 / vp.k);
        svg.style.cursor = cursorForEdges(edges);
        drag = { kind: 'bresize', id, startX: w.x, startY: w.y, edges, moved: false, guides: [] };
        return;
      }
      if (e.shiftKey) {
        if (selected.has(id)) selected.delete(id); else selected.add(id);
      } else if (!selected.has(id)) {
        selected.clear();
        selected.add(id);
      }
      if (selected.has(id)) {
        const items = new Map<string, { x: number; y: number }>();
        const conns = new Map<string, Shape>();
        const connDirect = new Set<string>();
        const addItem = (sid: string): void => {
          const s = shapes.get(sid);
          if (!s || items.has(sid) || conns.has(sid)) return;
          if (s.type === 'connector') { conns.set(sid, s); return; }
          items.set(sid, { x: s.x, y: s.y });
          if (s.type === 'group') for (const c of s.children ?? []) addItem(c);
        };
        for (const sid of selected) {
          const s = shapes.get(sid);
          if (!s) continue;
          if (s.type === 'connector') {
            conns.set(sid, s);
            connDirect.add(sid); // dragged directly (not carried by a frame/group)
            continue;
          }
          addItem(sid);
        }
        // everything inside a frame moves with it: shapes by center, connectors by
        // association (also when the frame itself is moved as part of a group)
        for (const fid of [...items.keys()]) {
          const f = shapes.get(fid);
          if (!f || f.type !== 'frame') continue;
          for (const o of shapes.values()) {
            if (o.type === 'connector' || o.type === 'frame' || o.id === fid) continue;
            if (contains(f, { ...o, ...boundsOf(o) })) addItem(o.id);
          }
          for (const [cid, c] of shapes) {
            if (c.type !== 'connector' || conns.has(cid)) continue;
            if (connAssociated(c, f, items)) conns.set(cid, c);
          }
        }
        drag = { kind: 'move', startX: w.x, startY: w.y, items, conns, connDirect, guides: [] };
      }
      scheduleRender();
      return;
    }
    const rect = el('rect', { class: 'marquee', x: w.x, y: w.y, width: 0, height: 0 }, layers.overlay) as SVGRectElement;
    drag = { kind: 'marquee', startX: w.x, startY: w.y, rect };
    return;
  }

  if (tool === 'arrow' || tool === 'elbow') {
    // with a drawing tool active, dragging on an existing arrow still creates a NEW arrow;
    // only a plain click (no drag) selects what is under the cursor
    if (id) downInfo = { id, x: e.clientX, y: e.clientY, time: performance.now() };
    const s = id ? shapes.get(id) : undefined;
    let from: Endpoint;
    // frames, text boxes and groups are never dock targets: starting inside them begins a
    // free arrow, otherwise the arrow would always attach to them
    if (s && s.type !== 'connector' && s.type !== 'frame' && s.type !== 'text' && s.type !== 'group') {
      const c = centerOf(s);
      const bp = edgeDockPoint(s, { x: w.x - c.x, y: w.y - c.y });
      from = epAt(s, bp);
    } else {
      from = { dx: w.x, dy: w.y };
    }
    // the preview line is only created once the pointer actually moves past the click
    // threshold, so a plain click never flashes a half-drawn arrow before selecting
    drag = { kind: 'arrow', from, startX: w.x, startY: w.y, line: null, elbow: tool === 'elbow' };
    return;
  }

  const preview = tool === 'ellipse'
    ? el('ellipse', { class: 'preview', cx: w.x, cy: w.y, rx: 0, ry: 0 }, layers.overlay)
    : tool === 'diamond'
      ? el('polygon', { class: 'preview', points: `${w.x},${w.y} ${w.x},${w.y} ${w.x},${w.y} ${w.x},${w.y}` }, layers.overlay)
      : el('rect', { class: 'preview', x: w.x, y: w.y, width: 0, height: 0 }, layers.overlay);
  drag = { kind: 'create', startX: w.x, startY: w.y, preview };
}

function updateCreatePreview(w: { x: number; y: number }): void {
  if (!drag || drag.kind !== 'create') return;
  const d = drag;
  const x = Math.min(d.startX, w.x);
  const y = Math.min(d.startY, w.y);
  const ww = Math.abs(w.x - d.startX);
  const hh = Math.abs(w.y - d.startY);
  const p = d.preview as any;
  if (p.tagName === 'rect') Object.entries({ x, y, width: ww, height: hh }).forEach(([k, v]) => p.setAttribute(k, String(v)));
  else if (p.tagName === 'polygon') p.setAttribute('points', `${x + ww / 2},${y} ${x + ww},${y + hh / 2} ${x + ww / 2},${y + hh} ${x},${y + hh / 2}`);
  else Object.entries({ cx: x + ww / 2, cy: y + hh / 2, rx: ww / 2, ry: hh / 2 }).forEach(([k, v]) => p.setAttribute(k, String(v)));
}

function onPointerMove(e: PointerEvent): void {
  const w = screenToWorld(e);
  lastCursor = w;
  sendCursor(w);
  const d = drag;
  if (!d) {
    svg.style.cursor = tool === 'select' ? hoverCursor(hitTest(w), w) : '';
    return;
  }
  switch (d.kind) {
    case 'pan':
      vp.x = d.vx + (e.clientX - d.sx);
      vp.y = d.vy + (e.clientY - d.sy);
      applyTransform();
      break;
    case 'move': {
      let dx = w.x - d.startX;
      let dy = w.y - d.startY;
      // alignment guides: snap the dragged selection's edges/center to the edges/centers of all
      // other (non-connector) shapes within 4 screen px and show ephemeral red lines for it
      d.guides.forEach((g) => g.remove());
      d.guides = [];
      if (d.items.size) {
        // union of the dragged items at their ORIGINAL positions (d.items stores those; the
        // shapes themselves are already moved by the previous commit, so don't read them here).
        // group members are in items too, so groups themselves can be skipped
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [id, o] of d.items) {
          const s = shapes.get(id);
          if (!s || s.type === 'group') continue;
          const b = boundsOf({ ...s, x: o.x, y: o.y }); // AABB of the rotated outline when rotated
          minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
        }
        const ub = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        const thresh = 4 / vp.k; // 4 screen px
        const { vx, vy } = guidePositions((id) => d.items.has(id));
        const sx = snapAxis([ub.x + dx, ub.x + ub.w / 2 + dx, ub.x + ub.w + dx], vx, true, thresh, d.guides);
        const sy = snapAxis([ub.y + dy, ub.y + ub.h / 2 + dy, ub.y + ub.h + dy], vy, false, thresh, d.guides);
        dx += sx;
        dy += sy;
        // distance hints (equal spacing to a nearby pair) apply only when no edge/center snap won
        if (!sx) dx += spacingSnapAxis('x', ub, dx, d.items, thresh, d.guides);
        if (!sy) dy += spacingSnapAxis('y', ub, dy, d.items, thresh, d.guides);
      }
      commit(() => {
        for (const [id, o] of d.items) {
          const s = shapes.get(id);
          if (s) shapes.set(id, { ...s, x: o.x + dx, y: o.y + dy });
        }
        // connectors move as a whole: free endpoints and the curve anchor are absolute and get
        // translated; docked endpoints keep their offset when their shape moves too (frame drag),
        // otherwise the offset itself is shifted so the arrow stays docked but moves along.
        // a connector dragged directly that is still attached to a shape does not move at all —
        // the user has to disconnect its endpoints first
        for (const [id, orig] of d.conns) {
          const c = shapes.get(id);
          if (!c || c.type !== 'connector') continue;
          const f = normEp(orig.from);
          const t = normEp(orig.to);
          if (d.connDirect.has(id) && (f.shape || t.shape)) continue;
          const shift = (ep: Endpoint): Endpoint =>
            ep.shape && d.items.has(ep.shape) ? ep : { ...ep, dx: ep.dx + dx, dy: ep.dy + dy };
          const cv = orig.curve ? { x: orig.curve.x + dx, y: orig.curve.y + dy } : undefined;
          shapes.set(id, { ...c, from: shift(f), to: shift(t), ...(cv ? { curve: cv } : {}) });
        }
        // manual bend anchors are kept when a docked shape moves; elbowPts clamps them to
        // the stub rules and recalculates only if the clamped path would cross a docked shape
      });
      break;
    }
    case 'rotate': {
      const s = shapes.get(d.id);
      if (!s) break;
      // delta of the pointer angle around the shape center, wrapped to (-180, 180]
      let delta = (Math.atan2(w.y - d.cy, w.x - d.cx) * 180 / Math.PI) - d.startAngle;
      delta = ((delta + 540) % 360) - 180;
      let rot = d.startRot + delta;
      if (e.shiftKey) rot = Math.round(rot / 15) * 15; // shift snaps to 15° steps
      else {
        // snap to 90° multiples when close, so it's easy to rotate back to the original
        const q = Math.round(rot / 90) * 90;
        if (Math.abs(q - rot) <= 6) rot = q;
      }
      rot = Math.round(rot * 100) / 100;
      commit(() => shapes.set(d.id, { ...s, rot }));
      break;
    }
    case 'create':
      updateCreatePreview(w);
      break;
    case 'maybeCreate': {
      // convert to a real create-drag once the pointer actually moves (or after a long hold
      // while moving); the preview starts at the original press point
      const moved = Math.hypot(w.x - d.startX, w.y - d.startY);
      const held = performance.now() - d.downTime;
      if (moved > 8 || (held > 200 && moved > 2)) {
        const preview = d.tool === 'ellipse'
          ? el('ellipse', { class: 'preview', cx: d.startX, cy: d.startY, rx: 0, ry: 0 }, layers.overlay)
          : d.tool === 'diamond'
            ? el('polygon', { class: 'preview', points: `${d.startX},${d.startY} ${d.startX},${d.startY} ${d.startX},${d.startY} ${d.startX},${d.startY}` }, layers.overlay)
            : el('rect', { class: 'preview', x: d.startX, y: d.startY, width: 0, height: 0 }, layers.overlay);
        drag = { kind: 'create', startX: d.startX, startY: d.startY, preview };
        updateCreatePreview(w);
      }
      break;
    }
    case 'resize': {
      const s = shapes.get(d.id);
      if (s) {
        // snap the moving right/bottom edges to other shapes' edges/centers within 4 screen px
        let nw = Math.max(20, w.x - d.x);
        let nh = Math.max(20, w.y - d.y);
        d.guides.forEach((g) => g.remove());
        d.guides = [];
        const thresh = 4 / vp.k;
        const { vx, vy } = guidePositions((id) => id === d.id);
        nw += snapAxis([d.x + nw], vx, true, thresh, d.guides);
        nh += snapAxis([d.y + nh], vy, false, thresh, d.guides);
        // size snap: match another on-screen shape's width/height, inner dotted line in both
        nw += sizeSnap('x', nw, { x: d.x, y: d.y, w: nw, h: nh }, d.id, thresh, d.guides);
        nh += sizeSnap('y', nh, { x: d.x, y: d.y, w: nw, h: nh }, d.id, thresh, d.guides);
        nw = Math.max(20, nw);
        nh = Math.max(20, nh);
        // 1:1 aspect snap: near-square resizes snap to equal width/height; while snapped, show a
        // thick X across the shape (ephemeral guide lines, removed on the next move frame / drop)
        if (snappingEnabled() && Math.abs(nw - nh) <= thresh) {
          nh = nw;
          for (const [x1, y1, x2, y2] of [[d.x, d.y, d.x + nw, d.y + nh], [d.x, d.y + nh, d.x + nw, d.y]] as const) {
            const ln = el('line', { x1, y1, x2, y2 }, layers.overlay);
            ln.setAttribute('class', 'guide');
            ln.setAttribute('stroke', '#4a6cf7');
            ln.setAttribute('stroke-width', '3');
            ln.setAttribute('vector-effect', 'non-scaling-stroke');
            ln.setAttribute('pointer-events', 'none');
            d.guides.push(ln);
          }
        }
        commit(() => {
        shapes.set(d.id, { ...s, w: nw, h: nh });
        resnapDockedTo(d.id);
        });
      }
      break;
    }
    case 'bresize': {
      const s = shapes.get(d.id);
      if (s) {
        if (Math.hypot(w.x - d.startX, w.y - d.startY) > 3 / vp.k) d.moved = true;
        if (d.moved) {
          const min = 20;
          let left = s.x, right = s.x + s.w, top = s.y, bottom = s.y + s.h;
          if (d.edges.l) left = Math.min(w.x, right - min);
          if (d.edges.r) right = Math.max(w.x, left + min);
          if (d.edges.t) top = Math.min(w.y, bottom - min);
          if (d.edges.b) bottom = Math.max(w.y, top + min);
          d.guides.forEach((g) => g.remove());
          d.guides = [];
          const thresh = 4 / vp.k;
          const { vx, vy } = guidePositions((id) => id === d.id);
          if (d.edges.l) left += snapAxis([left], vx, true, thresh, d.guides);
          if (d.edges.r) right += snapAxis([right], vx, true, thresh, d.guides);
          if (d.edges.t) top += snapAxis([top], vy, false, thresh, d.guides);
          if (d.edges.b) bottom += snapAxis([bottom], vy, false, thresh, d.guides);
          // size snap on the axes being resized: match another on-screen shape's
          // width/height, with an inner dotted line in both shapes
          if (d.edges.l || d.edges.r) {
            const w0 = right - left;
            const dw = sizeSnap('x', w0, { x: left, y: top, w: w0, h: bottom - top }, d.id, thresh, d.guides);
            if (dw !== 0) { if (d.edges.l && !d.edges.r) left = right - w0 - dw; else right = left + w0 + dw; }
          }
          if (d.edges.t || d.edges.b) {
            const h0 = bottom - top;
            const dh = sizeSnap('y', h0, { x: left, y: top, w: right - left, h: h0 }, d.id, thresh, d.guides);
            if (dh !== 0) { if (d.edges.t && !d.edges.b) top = bottom - h0 - dh; else bottom = top + h0 + dh; }
          }
          if (right - left < min) { if (d.edges.l) left = right - min; else right = left + min; }
          if (bottom - top < min) { if (d.edges.t) top = bottom - min; else bottom = top + min; }
          commit(() => {
            shapes.set(d.id, { ...s, x: left, y: top, w: right - left, h: bottom - top });
            resnapDockedTo(d.id);
          });
        }
      }
      break;
    }
    case 'marquee': {
      const x = Math.min(d.startX, w.x);
      const y = Math.min(d.startY, w.y);
      d.rect.setAttribute('x', String(x));
      d.rect.setAttribute('y', String(y));
      d.rect.setAttribute('width', String(Math.abs(w.x - d.startX)));
      d.rect.setAttribute('height', String(Math.abs(w.y - d.startY)));
      break;
    }
    case 'arrow': {
      // the start end follows the drag direction around the start shape's sides (rule f)
      if (d.from.shape) {
        const s = shapes.get(d.from.shape);
        if (s && !insideShape(s, w)) {
          const c = centerOf(s);
          const bp = edgeDockPoint(s, { x: w.x - c.x, y: w.y - c.y });
          d.from = epAt(s, bp);
        }
      }
      // both ends inside the SAME shape: it never connects — the start is a free point then
      const startS = d.from.shape ? shapes.get(d.from.shape) : undefined;
      const from: Endpoint = startS && insideShape(startS, w) ? { dx: d.startX, dy: d.startY } : d.from;
      const p = epPoint(from);
      let end = dockAt(w, d.from.shape, p, true);
      // elbow creation: choose the target dock side with the fewest bends (least-bend rule)
      if (d.elbow) {
        if (d.from.shape) d.from = alignStartForZeroBend(d.from, end);
        if (end.shape) {
          const ts = shapes.get(end.shape);
          if (ts) end = bestDockForElbow(ts, w, d.from, epPoint(d.from));
        }
        if (d.from.shape) d.from = alignStartForZeroBend(d.from, end);
      }
      const p2 = epPoint(from);
      const q = epPoint(end);
      if (!d.line) {
        if (Math.hypot(w.x - d.startX, w.y - d.startY) <= 8) break;
        d.line = el('path', { class: 'arrow-preview', d: '' }, layers.overlay);
      }
      d.line.setAttribute('d', d.elbow ? elbowPathD(d.from, end, p2, q, undefined, 28) : `M ${p2.x} ${p2.y} L ${q.x} ${q.y}`);
      break;
    }
    case 'endpoint': {
      const c = shapes.get(d.id);
      if (!c || c.type !== 'connector') break;
      if (d.ep === 'mid') {
        commit(() => shapes.set(d.id, { ...c, curve: { x: w.x, y: w.y } }));
      } else {
        const otherEp = d.ep === 'from' ? c.to : c.from;
        const other = normEp(otherEp).shape;
        // followCursor: the endpoint can move around the whole shape, not just one side
        // (fromPt is still used for the same-surrounding-shape rule and the midpoint snap)
        const newEp = dockAt(w, other, epPoint(otherEp), false, true);
        // keep the manual bend anchor across dock changes; elbowPts clamps it to the stub
        // rules and recalculates only if the clamped path would cross a docked shape
        commit(() => shapes.set(d.id, { ...c, [d.ep]: newEp }));
      }
      break;
    }
  }
}

function onPointerUp(e: PointerEvent): void {
  svg.classList.remove('panning');
  if (!drag) return;
  const w = screenToWorld(e);
  if (drag.kind === 'maybeCreate') {
    selected.clear();
    if (downInfo) selected.add(downInfo.id);
    scheduleRender();
  } else if (drag.kind === 'bresize') {
    drag.guides.forEach((g) => g.remove());
    svg.style.cursor = '';
    if (!drag.moved) {
      selected.clear();
      selected.add(drag.id);
      scheduleRender();
    }
  } else if (drag.kind === 'create') {
    const d = drag;
    const x = Math.min(d.startX, w.x);
    const y = Math.min(d.startY, w.y);
    const ww = Math.abs(w.x - d.startX);
    const hh = Math.abs(w.y - d.startY);
    d.preview.remove();
    if (tool === 'text') {
      if (ww > 8 && hh > 8) {
        const s: Shape = { id: uid(), type: 'text', x, y, w: ww, h: hh, text: '', fontSize: 18, stroke: '#1a1a1a' };
        commit(() => shapes.set(s.id, s));
        selected.clear();
        selected.add(s.id);
        scheduleRender();
        enterEdit(s.id);
      } else {
        selected.clear();
        scheduleRender();
      }
    } else if (ww > 8 && hh > 8) {
      const s: Shape = tool === 'frame'
        ? { id: uid(), type: 'frame', x, y, w: ww, h: hh, name: 'Frame', fill: 'rgba(120,140,180,0.07)', stroke: '#7a86a8' }
        : { id: uid(), type: tool as 'rect' | 'ellipse' | 'diamond', x, y, w: ww, h: hh, text: '', fill: '#ffffff', stroke: '#1a1a1a' };
      commit(() => shapes.set(s.id, s));
      if (tool === 'frame') {
        selected.clear();
        selected.add(s.id);
        scheduleRender();
      }
    } else {
      selected.clear();
      scheduleRender();
    }
  } else if (drag.kind === 'marquee') {
    const d = drag;
    const x = Math.min(d.startX, w.x);
    const y = Math.min(d.startY, w.y);
    const box = { x, y, w: Math.abs(w.x - d.startX), h: Math.abs(w.y - d.startY) };
    d.rect.remove();
    if (!e.shiftKey) selected.clear();
    // a plain click (no real drag) is not a marquee: don't bbox-select shapes whose outline
    // doesn't contain the point (e.g. diamond/ellipse corners) — hit-testing already ran on down
    if (box.w >= 4 || box.h >= 4) for (const [id, s] of shapes) {
      if (s.type === 'connector') {
        const { mid } = connPoints(s);
        if (mid.x >= box.x && mid.x <= box.x + box.w && mid.y >= box.y && mid.y <= box.y + box.h) selected.add(id);
      } else if (s.type === 'group') {
        if (rectsIntersect(box, boundsOf(s))) selected.add(id);
      } else if (s.type === 'frame') {
        // a frame is marquee-selected only when the box crosses its border outline
        const cs = cornersOf(s); // world coords, rotation-aware
        if (cs.some((c, i) => segIntersectsRect(c, cs[(i + 1) % 4], box))) selected.add(id);
      } else if (rectsIntersect(box, boundsOf(s))) selected.add(id); // boundsOf = rotated AABB
    }
    // members of a group are selected as the group itself
    const norm = new Set<string>();
    for (const id of selected) norm.add(topGroupOf(id) ?? id);
    selected.clear();
    for (const id of norm) selected.add(id);
    scheduleRender();
  } else if (drag.kind === 'arrow') {
    const d = drag;
    d.line?.remove();
    const dist = Math.hypot(w.x - d.startX, w.y - d.startY);
    if (dist > 8) {
      const p1 = epPoint(d.from);
      let to = dockAt(w, d.from.shape, p1, true);
      // both ends inside the SAME shape: it never connects — the start becomes a free point
      let from = d.from;
      const startS = d.from.shape ? shapes.get(d.from.shape) : undefined;
      if (startS && insideShape(startS, w)) from = { dx: d.startX, dy: d.startY };
      // elbow creation: choose the target dock side with the fewest bends (least-bend rule)
      if (d.elbow) {
        if (from.shape) from = alignStartForZeroBend(from, to);
        if (to.shape) {
          const ts = shapes.get(to.shape);
          if (ts) to = bestDockForElbow(ts, w, from, epPoint(from));
        }
        if (from.shape) from = alignStartForZeroBend(from, to);
      }
      const id = uid();
      commit(() => {
        // arrow started on a shape but ends in empty space: clone the start shape at the
        // drop point and dock the arrow end to its border facing the start (but not when both
        // ends are inside the same shape — that end stays a free point)
        // the clone is suppressed only when the drop point is inside the SAME shape the arrow
        // started on (both ends within one box); ending in clear space — even inside a bigger
        // surrounding box — clones as usual
        const src0 = from.shape ? shapes.get(from.shape) : undefined;
        if (!to.shape && src0 && src0.type !== 'connector' && !insideShape(src0, w)) {
          const src = src0;
          if (src && src.type !== 'connector') {
            // place the clone so the dock point on its near side sits exactly at the
            // release point: the arrow stops there and the shape starts there
            const nid = uid();
            const bp0 = edgeDockPoint({ ...src, id: nid, x: 0, y: 0 }, { x: p1.x - w.x, y: p1.y - w.y });
            const ns: Shape = { ...src, id: nid, x: w.x - bp0.x, y: w.y - bp0.y };
            shapes.set(nid, ns);
            to = { shape: nid, dx: bp0.x - src.w / 2, dy: bp0.y - src.h / 2 };
          }
        }
        // on creation prefer a 0-bend connection by choosing the start dock point nicely
        if (from.shape && d.elbow) from = alignStartForZeroBend(from, to);
        shapes.set(id, { id, type: 'connector', x: 0, y: 0, w: 0, h: 0, from, to, arrowEnd: true, width: 2, stroke: '#444', ...(d.elbow ? { elbow: true } : {}) });
      });
    } else {
      selected.clear();
      if (downInfo) selected.add(downInfo.id);
      scheduleRender();
    }
  } else if (drag.kind === 'endpoint') {
    // the move handler already docked/undocked the endpoint continuously; just restore hit-testing
    layers.selection.style.pointerEvents = '';
  }
  // manual double-click detection (dblclick event is unreliable with pointer capture)
  if (e.button === 0 && downInfo) {
    const moved = Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y);
    if (moved < 5) {
      const now = performance.now();
      if (lastClick && lastClick.id === downInfo.id && now - lastClick.time < 400) {
        enterEdit(downInfo.id);
        lastClick = null;
      } else {
        lastClick = { id: downInfo.id, time: now };
      }
    }
  }
  if (drag.kind === 'move' || drag.kind === 'resize' || drag.kind === 'bresize') drag.guides.forEach((g) => g.remove()); // ephemeral alignment lines
  downInfo = null;
  drag = null;
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  const sx = e.clientX - r.left;
  const sy = e.clientY - r.top;
  const wx = (sx - vp.x) / vp.k;
  const wy = (sy - vp.y) / vp.k;
  vp.k = clamp(vp.k * Math.exp(-e.deltaY * 0.0012), 0.1, 5);
  vp.x = sx - wx * vp.k;
  vp.y = sy - wy * vp.k;
  applyTransform();
  scheduleRender(); // re-render so the selection knobs keep their constant screen size at the new zoom
}

function onDblClick(e: MouseEvent): void {
  if (editingId) return;
  const id = hitTest(screenToWorld(e));
  if (id) enterEdit(id);
}

svg.addEventListener('pointerdown', onPointerDown);
svg.addEventListener('pointermove', onPointerMove);
svg.addEventListener('pointerup', onPointerUp);
svg.addEventListener('pointercancel', () => { drag = null; layers.overlay.replaceChildren(); layers.selection.style.pointerEvents = ''; svg.classList.remove('panning'); });
svg.addEventListener('wheel', onWheel, { passive: false });
svg.addEventListener('contextmenu', (e) => e.preventDefault());
svg.addEventListener('dblclick', onDblClick);

export function downloadSvg(): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const s of shapes.values()) {
    if (s.type === 'connector') {
      const { p1, p2 } = connPoints(s);
      grow(p1.x, p1.y);
      grow(p2.x, p2.y);
      if (s.curve) grow(s.curve.x, s.curve.y);
      const lb = connLabelBox(s);
      if (lb) { grow(lb.x, lb.y); grow(lb.x + lb.w, lb.y + lb.h); }
    } else {
      const b = boundsOf(s);
      grow(b.x, b.y);
      grow(b.x + b.w, b.y + b.h);
    }
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 200; maxY = 150; }
  const pad = 24;
  const x0 = minX - pad, y0 = minY - pad, w = maxX - minX + 2 * pad, h = maxY - minY + 2 * pad;

  const c = svg.cloneNode(true) as SVGSVGElement;
  c.querySelector('#selection')?.remove();
  c.querySelector('#overlay')?.remove();
  c.querySelector('#cursors')?.remove();
  c.querySelector('#edit')?.remove();
  c.querySelectorAll('path[stroke="transparent"]').forEach((p) => p.remove()); // invisible connector hit paths
  const vpG = c.querySelector('#viewport') as SVGGElement;
  vpG.removeAttribute('transform');
  const bg = el('rect', { x: x0, y: y0, width: w, height: h, fill: '#fafafb' }, vpG);
  vpG.prepend(bg);
  c.setAttribute('xmlns', SVGNS);
  c.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
  c.setAttribute('width', String(w));
  c.setAttribute('height', String(h));
  c.setAttribute('style', 'background:#fafafb');
  // the on-screen text inherits the body font via CSS; the standalone file has no CSS, so pin it
  c.setAttribute('font-family', 'system-ui, sans-serif');
  const data = new XMLSerializer().serializeToString(c);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'image/svg+xml' }));
  a.download = `turtle-sketch-${boardId || 'board'}.svg`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// arrow-key nudge of the whole selection; groups expand to their (nested) members
export function moveSelected(dx: number, dy: number): void {
  if ((!dx && !dy) || selected.size === 0) return;
  if (editingId && selected.has(editingId)) exitEdit(true);
  const ids = new Set<string>();
  const expand = (id: string): void => {
    const s = shapes.get(id);
    if (s?.type === 'group') { for (const c of s.children ?? []) expand(c); return; }
    ids.add(id);
  };
  for (const id of selected) expand(id);
  commit(() => {
    for (const id of ids) {
      const s = shapes.get(id);
      if (s && s.type !== 'connector') shapes.set(id, { ...s, x: s.x + dx, y: s.y + dy });
    }
    // connectors move as a whole: free endpoints and the curve anchor are translated;
    // an endpoint docked to a shape that is also moving keeps its offset
    for (const id of selected) {
      const c = shapes.get(id);
      if (!c || c.type !== 'connector') continue;
      const shift = (ep: Endpoint): Endpoint =>
        ep.shape && ids.has(ep.shape) ? ep : { ...ep, dx: ep.dx + dx, dy: ep.dy + dy };
      const cv = c.curve ? { x: c.curve.x + dx, y: c.curve.y + dy } : undefined;
      shapes.set(id, { ...c, from: shift(normEp(c.from)), to: shift(normEp(c.to)), ...(cv ? { curve: cv } : {}) });
    }
  });
}

export function deleteSelected(): void {
  if (selected.size === 0) return;
  if (editingId && selected.has(editingId)) exitEdit(false);
  commit(() => {
    // deleting a group removes the whole group, including nested groups and their members
    const gone = new Set<string>();
    const addGone = (id: string): void => {
      if (gone.has(id)) return;
      gone.add(id);
      const s = shapes.get(id);
      if (s?.type === 'group') for (const c of s.children ?? []) addGone(c);
    };
    for (const id of selected) addGone(id);
    // deleting a frame only removes the frame itself; its contents stay
    for (const id of gone) shapes.delete(id);
    // connectors docked to a deleted shape are removed as well
    const connIds: string[] = [];
    for (const [cid, c] of shapes) {
      if (c.type !== 'connector') continue;
      const f = normEp(c.from);
      const t = normEp(c.to);
      if ((f.shape && gone.has(f.shape)) || (t.shape && gone.has(t.shape))) connIds.push(cid);
    }
    for (const cid of connIds) shapes.delete(cid);
  });
  selected.clear();
  scheduleRender();
}

// group the current selection into a new group object (members may be groups themselves,
// which makes the new group a nested one); needs at least two objects
export function groupSelected(): void {
  const ids = new Set<string>();
  const parents = groupParents();
  for (const id of selected) {
    if (!shapes.get(id)) continue;
    ids.add(topGroupOf(id, parents) ?? id);
  }
  const list = [...ids];
  if (list.length < 2) return;
  const b = selectionBoundsOf(list);
  if (!b) return;
  const g: Shape = {
    id: uid(),
    type: 'group',
    x: b.x,
    y: b.y,
    w: b.w,
    h: b.h,
    children: list,
    z: Math.max(0, ...[...shapes.values()].map((s) => s.z ?? 0)) + 1,
  };
  commit(() => shapes.set(g.id, g));
  selected.clear();
  selected.add(g.id);
  scheduleRender();
}

// dissolve the selected groups; their direct children become the new selection
// (nested groups stay intact as selectable groups)
export function ungroupSelected(): void {
  const groups = [...selected].map((id) => shapes.get(id)).filter((s): s is Shape => !!s && s.type === 'group');
  if (!groups.length) return;
  const children = groups.flatMap((g) => g.children ?? []);
  commit(() => {
    for (const g of groups) shapes.delete(g.id);
  });
  selected.clear();
  for (const c of children) if (shapes.get(c)) selected.add(c);
  scheduleRender();
}

document.getElementById('fb-group')!.addEventListener('click', () => groupSelected());
document.getElementById('fb-ungroup')!.addEventListener('click', () => ungroupSelected());

// ---------- multi-select bar operations (space evenly h/v, align top/bottom) ----------

// the movable selected items with their bounds; groups expand to their members (nested too),
// connectors and frames are skipped (connectors have no x/y of their own — they move via
// endpoints; frames are containers and stay put)
function multiItems(): { id: string; b: { x: number; y: number; w: number; h: number } }[] {
  const out: { id: string; b: { x: number; y: number; w: number; h: number } }[] = [];
  const seen = new Set<string>();
  const add = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const s = shapes.get(id);
    if (!s || s.type === 'connector' || s.type === 'frame') return;
    if (s.type === 'group') {
      for (const c of s.children ?? []) add(c);
      return;
    }
    out.push({ id, b: boundsOf(s) });
  };
  for (const id of selected) add(id);
  return out;
}

function applyMultiOp(act: string): void {
  const items = multiItems();
  if (items.length < 2) return;
  if (act === 'spaceH' || act === 'spaceV') {
    const horiz = act === 'spaceH';
    const arr = [...items].sort((a, b) => (horiz ? a.b.x - b.b.x : a.b.y - b.b.y));
    // the gap between the first two (leftmost/topmost) is applied to all of them,
    // but never less than a 10px edge-to-edge minimum
    const rawGap = horiz ? arr[1].b.x - (arr[0].b.x + arr[0].b.w) : arr[1].b.y - (arr[0].b.y + arr[0].b.h);
    const gap = Math.max(10, rawGap);
    commit(() => {
      let pos = horiz ? arr[0].b.x : arr[0].b.y;
      for (const it of arr) {
        const s = shapes.get(it.id);
        if (!s) continue;
        const b = boundsOf(s);
        const d = pos - (horiz ? b.x : b.y);
        shapes.set(it.id, horiz ? { ...s, x: s.x + d } : { ...s, y: s.y + d });
        pos += (horiz ? it.b.w : it.b.h) + gap;
      }
    });
  } else if (act === 'alignTop' || act === 'alignBottom') {
    const target = act === 'alignTop'
      ? Math.min(...items.map((it) => it.b.y))
      : Math.max(...items.map((it) => it.b.y + it.b.h));
    commit(() => {
      for (const it of items) {
        const s = shapes.get(it.id);
        if (!s) continue;
        const b = boundsOf(s);
        const d = act === 'alignTop' ? target - b.y : target - (b.y + b.h);
        shapes.set(it.id, { ...s, y: s.y + d });
      }
    });
  }
  scheduleRender();
}

fmtbar.querySelectorAll('#multictl button[data-act]').forEach((b) => {
  (b as HTMLButtonElement).addEventListener('click', () => applyMultiOp((b as HTMLButtonElement).dataset.act!));
});

// ---------- copy & paste ----------

// internal clipboard (always available) + system clipboard (best effort, for cross-tab paste)
let clip: { top: string[]; shapes: Shape[] } | null = null;
let pasteCount = 0;
// last known cursor position in world coords (paste lands under it) and where the last
// paste landed (repeated pastes without moving the mouse cascade instead of stacking)
let lastCursor: { x: number; y: number } | null = null;
let lastPasteCursor: { x: number; y: number } | null = null;

function clipBounds(list: Shape[]): { x: number; y: number; w: number; h: number } {
  const byId = new Map(list.map((s) => [s.id, s]));
  const epW = (ep: unknown): { x: number; y: number } => {
    const e = normEp(ep);
    const t = e.shape ? byId.get(e.shape) ?? shapes.get(e.shape) : undefined;
    if (t) return { x: t.x + t.w / 2 + e.dx, y: t.y + t.h / 2 + e.dy };
    return { x: e.dx, y: e.dy };
  };
  const one = (s: Shape, seen: Set<string>): { x: number; y: number; w: number; h: number } => {
    if (s.type === 'group') {
      if (seen.has(s.id)) return { x: s.x, y: s.y, w: s.w, h: s.h };
      seen.add(s.id);
      let b: { x: number; y: number; w: number; h: number } | null = null;
      for (const c of s.children ?? []) {
        const cs = byId.get(c);
        if (!cs) continue;
        const cb = one(cs, seen);
        if (!b) { b = cb; continue; }
        const x = Math.min(b.x, cb.x);
        const y = Math.min(b.y, cb.y);
        b = { x, y, w: Math.max(b.x + b.w, cb.x + cb.w) - x, h: Math.max(b.y + b.h, cb.y + cb.h) - y };
      }
      return b ?? { x: s.x, y: s.y, w: s.w, h: s.h };
    }
    if (s.type === 'connector') {
      const pts = [epW(s.from), epW(s.to)];
      if (s.curve) pts.push(s.curve);
      const pad = s.width ?? 2;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x = Math.min(...xs) - pad;
      const y = Math.min(...ys) - pad;
      return { x, y, w: Math.max(...xs) - x + pad, h: Math.max(...ys) - y + pad };
    }
    return { x: s.x, y: s.y, w: s.w, h: s.h };
  };
  let b: { x: number; y: number; w: number; h: number } | null = null;
  for (const s of list) {
    const sb = one(s, new Set());
    if (!b) { b = sb; continue; }
    const x = Math.min(b.x, sb.x);
    const y = Math.min(b.y, sb.y);
    b = { x, y, w: Math.max(b.x + b.w, sb.x + sb.w) - x, h: Math.max(b.y + b.h, sb.y + sb.h) - y };
  }
  return b ?? { x: 0, y: 0, w: 0, h: 0 };
}

function expandSelection(ids: Iterable<string>): Shape[] {
  const out = new Map<string, Shape>();
  const add = (id: string): void => {
    const s = shapes.get(id);
    if (!s || out.has(id)) return;
    out.set(id, s);
    if (s.type === 'group') for (const c of s.children ?? []) add(c);
  };
  for (const id of ids) add(id);
  return [...out.values()];
}

export function copySelected(): void {
  if (selected.size === 0) return;
  const parents = groupParents();
  const top = [...selected].map((id) => topGroupOf(id, parents) ?? id).filter((id) => shapes.get(id));
  const list = expandSelection(top);
  if (!list.length) return;
  clip = { top, shapes: list.map((s) => JSON.parse(JSON.stringify(s))) };
  pasteCount = 0;
  try {
    navigator.clipboard?.writeText(JSON.stringify({ app: 'turtle-sketch', v: 1, ...clip })).catch(() => {});
  } catch { /* clipboard unavailable (permissions) — the internal clipboard still works */ }
}

export async function pasteClipboard(): Promise<void> {
  let data = clip;
  try {
    const text = await Promise.race([
      navigator.clipboard!.readText(),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 800)),
    ]);
    const parsed = JSON.parse(text);
    if (parsed && parsed.app === 'turtle-sketch' && Array.isArray(parsed.shapes) && Array.isArray(parsed.top)) data = parsed;
  } catch { /* not our format / unavailable — fall back to the internal clipboard */ }
  if (!data || !data.shapes.length) return;
  const list = data.shapes;
  const idMap = new Map<string, string>();
  for (const s of list) idMap.set(s.id, uid());
  // translation applied to every absolute coordinate: with a known cursor the pasted
  // content lands centered under it; repeated pastes without moving the mouse cascade
  // by 24 instead of stacking exactly (moving the mouse resets the cascade)
  let shiftX: number;
  let shiftY: number;
  if (lastCursor) {
    if (lastPasteCursor && Math.hypot(lastCursor.x - lastPasteCursor.x, lastCursor.y - lastPasteCursor.y) > 4) pasteCount = 0;
    const b = clipBounds(list);
    shiftX = lastCursor.x - (b.x + b.w / 2) + 24 * pasteCount;
    shiftY = lastCursor.y - (b.y + b.h / 2) + 24 * pasteCount;
    lastPasteCursor = { ...lastCursor };
  } else {
    shiftX = 24 * (pasteCount + 1);
    shiftY = 24 * (pasteCount + 1);
    lastPasteCursor = null;
  }
  pasteCount++;
  const maxZ = Math.max(0, ...[...shapes.values()].map((s) => s.z ?? 0));
  // keep the relative stacking order of the copied shapes
  const ordered = [...list].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  commit(() => {
    let zi = maxZ + 1;
    for (const s of ordered) {
      const nid = idMap.get(s.id)!;
      const ns: Shape = JSON.parse(JSON.stringify(s));
      ns.id = nid;
      ns.z = zi++;
      if (s.type === 'connector') {
        // docks to a copied shape stay docked (the shape moves with the paste); docks to
        // anything else become free points at their world position plus the shift
        const remapEp = (ep: unknown): Endpoint => {
          const e = normEp(ep);
          if (e.shape && idMap.has(e.shape)) return { shape: idMap.get(e.shape)!, dx: e.dx, dy: e.dy };
          const p = epPoint(e);
          return { dx: p.x + shiftX, dy: p.y + shiftY };
        };
        ns.from = remapEp(s.from);
        ns.to = remapEp(s.to);
        if (s.curve) ns.curve = { x: s.curve.x + shiftX, y: s.curve.y + shiftY };
        ns.x = 0; ns.y = 0; ns.w = 0; ns.h = 0;
      } else {
        ns.x = s.x + shiftX;
        ns.y = s.y + shiftY;
      }
      if (s.type === 'group' && s.children) ns.children = s.children.map((c) => idMap.get(c) ?? c);
      shapes.set(nid, ns);
    }
  });
  selected.clear();
  for (const id of data.top) {
    const nid = idMap.get(id);
    if (nid) selected.add(nid);
  }
  scheduleRender();
}

export function initBoard(): void {
  applyTransform();
  scheduleRender();
  // when a document opens, center the view on the object nearest to the origin (0,0), so a
  // document whose content is far from the origin still opens on something visible
  provider?.once('sync', () => {
    if (!shapes.size) return;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const s of shapes.values()) {
      const b = boundsOf(s);
      const dx = Math.max(b.x, -b.x - b.w, 0); // distance from origin to the bounds
      const dy = Math.max(b.y, -b.y - b.h, 0);
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      }
    }
    if (best) {
      const r = svg.getBoundingClientRect();
      vp.x = r.width / 2 - best.x * vp.k;
      vp.y = r.height / 2 - best.y * vp.k;
      applyTransform();
    }
  });
}
