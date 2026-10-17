import type { Box } from './collision';
import { contains, expand, overlaps, segmentHit, type Point } from './battle-geometry.ts';

class MinHeap {
  private items: { index: number; score: number }[] = [];
  get size(): number { return this.items.length; }
  push(index: number, score: number): void {
    const item = { index, score };
    let i = this.items.length;
    this.items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].score <= score) break;
      this.items[i] = this.items[parent]; i = parent;
    }
    this.items[i] = item;
  }
  pop(): number {
    const first = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.items.length && this.items[child + 1].score < this.items[child].score) child++;
        if (this.items[child].score >= last.score) break;
        this.items[i] = this.items[child]; i = child;
      }
      this.items[i] = last;
    }
    return first.index;
  }
}

export class Navigation {
  private readonly bounds: Box;
  private readonly obstacles: readonly Box[];
  private readonly cell: number;
  private readonly columns: number;
  private readonly rows: number;
  private grids = new Map<string, Uint8Array>();

  constructor(bounds: Box, obstacles: readonly Box[], cell = 20) {
    this.bounds = bounds; this.obstacles = obstacles; this.cell = cell;
    this.columns = Math.ceil(bounds.width / cell);
    this.rows = Math.ceil(bounds.height / cell);
  }

  canTravel(from: Point, to: Point, width: number, height = width): boolean {
    const halfX = width / 2, halfY = height / 2;
    const at = (point: Point): Box => ({ x: point.x - halfX, y: point.y - halfY, width, height });
    if (!contains(this.bounds, at(from)) || !contains(this.bounds, at(to))) return false;
    const minX = Math.min(from.x, to.x) - halfX, maxX = Math.max(from.x, to.x) + halfX;
    const minY = Math.min(from.y, to.y) - halfY, maxY = Math.max(from.y, to.y) + halfY;
    for (const obstacle of this.obstacles) {
      if (obstacle.x > maxX || obstacle.x + obstacle.width < minX
        || obstacle.y > maxY || obstacle.y + obstacle.height < minY) continue;
      if (segmentHit(from, to, expand(obstacle, halfX - 0.001, halfY - 0.001)) !== null) return false;
    }
    return true;
  }

  private point(index: number): Point {
    return { x: this.bounds.x + (index % this.columns + 0.5) * this.cell,
      y: this.bounds.y + (Math.floor(index / this.columns) + 0.5) * this.cell };
  }

  private grid(width: number, height: number): Uint8Array {
    const key = `${width}x${height}`;
    const cached = this.grids.get(key);
    if (cached) return cached;
    const grid = new Uint8Array(this.columns * this.rows);
    for (let i = 0; i < grid.length; i++) {
      const point = this.point(i);
      const body = { x: point.x - width / 2, y: point.y - height / 2, width, height };
      if (!contains(this.bounds, body) || this.obstacles.some((obstacle) => overlaps(body, obstacle))) grid[i] = 1;
    }
    this.grids.set(key, grid);
    return grid;
  }

  private nearest(point: Point, grid: Uint8Array, width: number, height: number, connect: boolean): number | null {
    const cx = Math.floor((point.x - this.bounds.x) / this.cell);
    const cy = Math.floor((point.y - this.bounds.y) / this.cell);
    for (let radius = 0; radius <= 12; radius++) {
      let best: number | null = null, distance = Infinity;
      for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
        if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) continue;
        if (radius > 0 && Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== radius) continue;
        const index = y * this.columns + x;
        if (grid[index]) continue;
        const candidate = this.point(index);
        const d = (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2;
        if (d < distance && (!connect || this.canTravel(point, candidate, width, height))) { best = index; distance = d; }
      }
      if (best !== null) return best;
    }
    return null;
  }

  findPath(from: Point, to: Point, width: number, height = width): Point[] | null {
    if (this.canTravel(from, to, width, height)) return [to];
    const grid = this.grid(width, height);
    const start = this.nearest(from, grid, width, height, true);
    const goal = this.nearest(to, grid, width, height, false);
    if (start === null || goal === null) return null;
    const cost = new Float64Array(grid.length).fill(Infinity);
    const parent = new Int32Array(grid.length).fill(-1);
    const closed = new Uint8Array(grid.length);
    const open = new MinHeap();
    const heuristic = (index: number): number => {
      const dx = Math.abs(index % this.columns - goal % this.columns);
      const dy = Math.abs(Math.floor(index / this.columns) - Math.floor(goal / this.columns));
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    cost[start] = 0; open.push(start, heuristic(start));
    let visited = 0;
    while (open.size && visited++ < 6000) {
      const current = open.pop();
      if (closed[current]) continue;
      if (current === goal) {
        const path: Point[] = [];
        for (let index = goal; index !== -1; index = parent[index]) path.push(this.point(index));
        path.reverse();
        if (this.canTravel(path[path.length - 1], to, width, height)) path.push(to);
        return path;
      }
      closed[current] = 1;
      const x = current % this.columns, y = Math.floor(current / this.columns);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || y + dy < 0 || x + dx >= this.columns || y + dy >= this.rows) continue;
        const next = (y + dy) * this.columns + x + dx;
        if (grid[next] || closed[next]) continue;
        if (dx && dy && (grid[y * this.columns + x + dx] || grid[(y + dy) * this.columns + x])) continue;
        // 셀 사이의 얇은 장애물도 실제 크기로 확인해 통과하지 못하게 한다.
        if (!this.canTravel(this.point(current), this.point(next), width, height)) continue;
        const nextCost = cost[current] + (dx && dy ? Math.SQRT2 : 1);
        if (nextCost >= cost[next]) continue;
        cost[next] = nextCost; parent[next] = current;
        open.push(next, nextCost + heuristic(next));
      }
    }
    return null;
  }
}
