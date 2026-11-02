import type { Shape, Endpoint } from './types';

// legacy connectors stored from/to as a plain shape id
export function normEp(e: unknown): Endpoint {
  if (typeof e === 'string') return { shape: e, dx: 0, dy: 0 };
  const ep = (e ?? {}) as Endpoint;
  return { shape: ep.shape, dx: ep.dx ?? 0, dy: ep.dy ?? 0 };
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function centerOf(s: Shape): { x: number; y: number } {
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
}

export function rotOf(s: Shape): number {
  return s.rot ?? 0;
}

// rotate point p around c by deg degrees (SVG convention: positive = clockwise on screen)
export function rotAround(p: { x: number; y: number }, c: { x: number; y: number }, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

// rotate a center-relative endpoint offset (dx,dy) into world axes
export function rotOffset(s: Shape, dx: number, dy: number): { x: number; y: number } {
  const r = (rotOf(s) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

// world point -> shape-local (unrotated) coordinates; all outline math runs in local space
export function localPoint(s: Shape, p: { x: number; y: number }): { x: number; y: number } {
  return rotAround(p, centerOf(s), -rotOf(s));
}
export function worldPoint(s: Shape, p: { x: number; y: number }): { x: number; y: number } {
  return rotAround(p, centerOf(s), rotOf(s));
}

export function cornersOf(s: Shape): { x: number; y: number }[] {
  const c = centerOf(s);
  const hw = s.w / 2;
  const hh = s.h / 2;
  return [
    { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
  ].map((p) => rotAround({ x: c.x + p.x, y: c.y + p.y }, c, rotOf(s)));
}

export function borderPoint(s: Shape, towards: { x: number; y: number }): { x: number; y: number } {
  const c = centerOf(s);
  // run the ray math in shape-local space, then rotate the result back to world
  const lt = localPoint(s, towards);
  const dx = lt.x - c.x;
  const dy = lt.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const finish = (lp: { x: number; y: number }): { x: number; y: number } => worldPoint(s, lp);
  if (s.type === 'ellipse') {
    const rx = s.w / 2;
    const ry = s.h / 2;
    const t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
    return finish({ x: c.x + dx * t, y: c.y + dy * t });
  }
  if (s.type === 'diamond') {
    // diamond |x|/a + |y|/b = 1: ray (dx*t, dy*t) crosses at t = 1 / (|dx|/a + |dy|/b)
    const a = s.w / 2;
    const b = s.h / 2;
    const t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
    return finish({ x: c.x + dx * t, y: c.y + dy * t });
  }
  const hw = s.w / 2;
  const hh = s.h / 2;
  const tx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const ty = dy === 0 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(tx, ty);
  return finish({ x: c.x + dx * t, y: c.y + dy * t });
}

export function insideShape(s: Shape, p: { x: number; y: number }): boolean {
  p = localPoint(s, p); // rotation is undone first; the equations below stay axis-aligned
  if (s.type === 'ellipse' || s.type === 'diamond') {
    const rx = s.w / 2;
    const ry = s.h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const c = centerOf(s);
    const nx = (p.x - c.x) / rx;
    const ny = (p.y - c.y) / ry;
    return s.type === 'ellipse' ? nx * nx + ny * ny <= 1 : Math.abs(nx) + Math.abs(ny) <= 1;
  }
  return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
}

export function distToShape(s: Shape, p: { x: number; y: number }): number {
  if (insideShape(s, p)) return 0; // insideShape unrotates internally
  p = localPoint(s, p); // distances are rotation-invariant, so the math can stay local
  if (s.type === 'diamond') {
    const c = centerOf(s);
    const vs = [
      { x: c.x, y: s.y }, { x: s.x + s.w, y: c.y },
      { x: c.x, y: s.y + s.h }, { x: s.x, y: c.y },
    ];
    let best = Infinity;
    for (let i = 0; i < 4; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % 4];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby)));
      best = Math.min(best, Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t)));
    }
    return best;
  }
  if (s.type === 'ellipse') {
    // exact-enough distance: sample the outline (128 points) and take the min point distance —
    // radial formulas underestimate off-axis by a few px, which caused false clearance hits
    const rx = Math.max(1, s.w / 2);
    const ry = Math.max(1, s.h / 2);
    const c = centerOf(s);
    let best = Infinity;
    for (let i = 0; i < 128; i++) {
      const th = (i / 128) * 2 * Math.PI;
      const ex = c.x + rx * Math.cos(th);
      const ey = c.y + ry * Math.sin(th);
      best = Math.min(best, Math.hypot(p.x - ex, p.y - ey));
    }
    return best;
  }
  const dx = Math.max(s.x - p.x, 0, p.x - (s.x + s.w));
  const dy = Math.max(s.y - p.y, 0, p.y - (s.y + s.h));
  return Math.hypot(dx, dy);
}

export function contains(outer: Shape, inner: Shape): boolean {
  return insideShape(outer, centerOf(inner)); // rotation-aware when outer is rotated
}

export function distToOutline(s: Shape, p: { x: number; y: number }): number {
  if (!insideShape(s, p)) return distToShape(s, p); // both unrotate internally
  const q = localPoint(s, p);
  const c = centerOf(s);
  if (s.type === 'ellipse' || s.type === 'diamond') {
    // normalized-space distance to the curve, scaled back to px (approximate, fine for a thin band)
    const nx = (q.x - c.x) / Math.max(1, s.w / 2);
    const ny = (q.y - c.y) / Math.max(1, s.h / 2);
    const r = s.type === 'ellipse' ? Math.sqrt(nx * nx + ny * ny) : Math.abs(nx) + Math.abs(ny);
    return (1 - r) * Math.min(s.w, s.h) / 2;
  }
  return Math.min(q.x - s.x, s.x + s.w - q.x, q.y - s.y, s.y + s.h - q.y);
}

export function distToFrameBorder(s: Shape, p: { x: number; y: number }): number {
  const q = localPoint(s, p); // rotation undone first; the rect math stays axis-aligned
  const dx = Math.max(s.x - q.x, 0, q.x - (s.x + s.w));
  const dy = Math.max(s.y - q.y, 0, q.y - (s.y + s.h));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy); // outside the rect
  return Math.min(q.x - s.x, s.x + s.w - q.x, q.y - s.y, s.y + s.h - q.y); // inside: nearest edge
}

export function segIntersectsRect(a: { x: number; y: number }, b: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean {
  const inRect = (p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  if (inRect(a) || inRect(b)) return true;
  const cs = [
    { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
  ];
  const orient = (p: { x: number; y: number }, q: { x: number; y: number }, t: { x: number; y: number }) =>
    (q.x - p.x) * (t.y - p.y) - (q.y - p.y) * (t.x - p.x);
  const onSeg = (p: { x: number; y: number }, q: { x: number; y: number }, t: { x: number; y: number }) =>
    orient(p, q, t) === 0 && Math.min(p.x, q.x) <= t.x && t.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= t.y && t.y <= Math.max(p.y, q.y);
  const crosses = (p1: { x: number; y: number }, q1: { x: number; y: number }, p2: { x: number; y: number }, q2: { x: number; y: number }) => {
    const o1 = orient(p1, q1, p2), o2 = orient(p1, q1, q2), o3 = orient(p2, q2, p1), o4 = orient(p2, q2, q1);
    return (o1 * o2 < 0 && o3 * o4 < 0) || onSeg(p1, q1, p2) || onSeg(p1, q1, q2) || onSeg(p2, q2, p1) || onSeg(p2, q2, q1);
  };
  for (let i = 0; i < 4; i++) if (crosses(a, b, cs[i], cs[(i + 1) % 4])) return true;
  return false;
}

export function rectsIntersect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
