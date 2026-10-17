import type { Box } from './collision';

export interface Point { x: number; y: number }

export function center(body: Box): Point {
  return { x: body.x + body.width / 2, y: body.y + body.height / 2 };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function contains(bounds: Box, body: Box): boolean {
  return body.x >= bounds.x && body.y >= bounds.y
    && body.x + body.width <= bounds.x + bounds.width
    && body.y + body.height <= bounds.y + bounds.height;
}

export function distanceSquared(a: Box, b: Box): number {
  const ac = center(a), bc = center(b);
  return (ac.x - bc.x) ** 2 + (ac.y - bc.y) ** 2;
}

export function edgeDistance(a: Box, b: Box): number {
  return Math.hypot(Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0),
    Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0));
}

export function centerInView(body: Box, view: Box): boolean {
  const point = center(body);
  return point.x >= view.x && point.x <= view.x + view.width
    && point.y >= view.y && point.y <= view.y + view.height;
}

// 선분과 사각형의 첫 교점을 구해 빠른 투사체도 프레임 사이의 적을 놓치지 않게 한다.
export function segmentHit(start: Point, end: Point, box: Box): number | null {
  let near = 0, far = 1;
  for (const axis of ['x', 'y'] as const) {
    const delta = end[axis] - start[axis];
    const min = box[axis];
    const max = min + (axis === 'x' ? box.width : box.height);
    if (Math.abs(delta) < 1e-10) {
      if (start[axis] < min || start[axis] > max) return null;
    } else {
      const a = (min - start[axis]) / delta;
      const b = (max - start[axis]) / delta;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (near > far) return null;
    }
  }
  return near;
}

export function expand(box: Box, padding: number): Box {
  return { x: box.x - padding, y: box.y - padding,
    width: box.width + padding * 2, height: box.height + padding * 2 };
}
