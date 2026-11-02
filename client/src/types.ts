export type ShapeType = 'rect' | 'ellipse' | 'diamond' | 'text' | 'frame' | 'connector' | 'group';

// rich text: a run is a text segment with optional bold / italic / font-size / color override
export interface TextRun {
  t: string;
  b?: boolean;
  i?: boolean;
  s?: number;
  c?: string; // hex color
}

export interface Shape {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;      // plain text inside rect/ellipse/standalone text (runs is the rich version)
  runs?: TextRun[];   // rich text runs; when present they are the source of truth
  name?: string;      // frame label
  fill?: string;
  stroke?: string;
  fontSize?: number;
  color?: string;     // text color (hex); falls back to #1a1a1a, independent of stroke
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  bold?: boolean;
  italic?: boolean;
  z?: number;         // stacking order among non-frame shapes (frames are always behind)
  rot?: number;       // rotation in degrees around the shape center (undefined/0 = axis-aligned)
  children?: string[]; // group members (may be groups themselves = nested groups)
  // connector fields:
  from?: Endpoint;
  to?: Endpoint;
  arrowEnd?: boolean;
  arrowStart?: boolean;
  dash?: boolean;
  width?: number;     // stroke width: 1 | 2 | 4
  curve?: { x: number; y: number }; // quadratic control point / elbow anchor (world coords)
  elbow?: boolean;    // orthogonal path: starts straight, then two 90° bends to the target
  // connector label uses the same text/runs fields as shapes; rendered at the path midpoint
}

// connector endpoint: docked to a shape (dx/dy relative to its center) or a free world point
export interface Endpoint {
  shape?: string;
  dx: number;
  dy: number;
}
