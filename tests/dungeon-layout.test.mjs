import test from 'node:test';
import assert from 'node:assert/strict';
import { createDungeonLayout, dungeonObstacles, getObstacleVisual } from '../src/dungeon-layout.ts';
import { moveAndSlide } from '../src/collision.ts';
import { getFootDepth } from '../src/render-depth.ts';

const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;
const gap = (a, b) => Math.hypot(
  Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0),
  Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0),
);

test('scattered placement is reproducible and preserves all 80 obstacle varieties', () => {
  assert.deepEqual(createDungeonLayout(), dungeonObstacles);
  assert.notDeepEqual(createDungeonLayout(12345), dungeonObstacles);
  const counts = {};
  for (const obstacle of dungeonObstacles) counts[obstacle.kind] = (counts[obstacle.kind] ?? 0) + 1;
  assert.deepEqual(counts, { grave: 6, 'cross-grave': 10, 'broken-grave': 16,
    rock: 16, stump: 8, 'dead-tree': 8, log: 16 });
});

test('spacing, spawn clearing, cross passages and perimeter loop stay open', () => {
  const corridors = [
    { x: 1380, y: 50, width: 240, height: 2900 },
    { x: 50, y: 1380, width: 2900, height: 240 },
  ];
  for (const [index, obstacle] of dungeonObstacles.entries()) {
    assert.ok(obstacle.imageX >= 170 && obstacle.imageX + 96 <= 2830);
    assert.ok(obstacle.imageY >= 170 && obstacle.imageY + 96 <= 2830);
    assert.ok(gap(obstacle, { x: 1500, y: 1500, width: 0, height: 0 }) >= 340);
    assert.ok(corridors.every((corridor) => !overlaps(obstacle, corridor)));
    for (const other of dungeonObstacles.slice(index + 1)) assert.ok(gap(obstacle, other) >= 145);
  }
  // 맵을 크게 나눈 구역마다 장애물이 분산되어 있는지 확인한다.
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    assert.ok(dungeonObstacles.some((obstacle) => Math.floor(obstacle.x / 1000) === column
      && Math.floor(obstacle.y / 1000) === row));
  }
});

test('all sampled walkable areas connect to spawn using the actual collision resolver', () => {
  const count = 72;
  const bounds = { x: 50, y: 50, width: 2900, height: 2900 };
  const bodyAt = (column, row) => ({ x: 60 + column * 40, y: 60 + row * 40, width: 40, height: 40 });
  const walkable = new Set();
  for (let row = 0; row < count; row++) for (let column = 0; column < count; column++) {
    if (!dungeonObstacles.some((obstacle) => overlaps(bodyAt(column, row), obstacle))) {
      walkable.add(row * count + column);
    }
  }
  const start = 35 * count + 35;
  assert.ok(walkable.has(start));
  const visited = new Set([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const column = index % count;
    const row = Math.floor(index / count);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nextColumn = column + dx;
      const nextRow = row + dy;
      const next = nextRow * count + nextColumn;
      if (nextColumn < 0 || nextColumn >= count || nextRow < 0 || nextRow >= count
        || !walkable.has(next) || visited.has(next)) continue;
      const target = bodyAt(nextColumn, nextRow);
      const moved = moveAndSlide(bodyAt(column, row), dx * 40, dy * 40, bounds, dungeonObstacles);
      if (Math.abs(moved.x - target.x) < 1e-8 && Math.abs(moved.y - target.y) < 1e-8) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  assert.equal(visited.size, walkable.size, 'No isolated walkable pockets');
});

test('intact and cross gravestones allow partial cover from behind while keeping their bases solid', () => {
  const bounds = { x: 50, y: 50, width: 2900, height: 2900 };
  const graves = dungeonObstacles.filter((obstacle) => obstacle.kind === 'grave' || obstacle.kind === 'cross-grave');
  assert.equal(graves.length, 16);
  for (const grave of graves) {
    assert.equal(grave.y - grave.imageY, 28);
    assert.equal(grave.height, 54);
    assert.equal(grave.y + grave.height, grave.imageY + 82);
    // 40픽셀 플레이어와 추후 크기가 다른 적도 같은 충돌 영역과 발밑 정렬을 쓴다.
    for (const size of [40, 24]) {
      const x = grave.x + (grave.width - size) / 2;
      const behind = moveAndSlide({ x, y: grave.imageY - size - 10, width: size, height: size },
        0, 200, bounds, [grave]);
      assert.equal(behind.y + size, grave.y);
      assert.ok(!overlaps(behind, grave));
      const oldSilhouette = { ...grave, y: grave.imageY + 8, height: 74 };
      assert.ok(overlaps(behind, oldSilhouette), 'Actor can overlap the upper visual region');
      assert.ok(getFootDepth(behind) < getFootDepth(grave), 'Gravestone draws over actor behind it');

      const front = moveAndSlide({ x, y: grave.y + grave.height + 80, width: size, height: size },
        0, -200, bounds, [grave]);
      assert.equal(front.y, grave.y + grave.height);
      assert.ok(getFootDepth(front) > getFootDepth(grave), 'Actor in front draws over gravestone');
    }
  }
});

test('other obstacle collision dimensions are unchanged', () => {
  const dimensions = { 'broken-grave': [34, 66, 50], rock: [28, 78, 54],
    stump: [14, 68, 74], log: [40, 88, 42] };
  for (const obstacle of dungeonObstacles) {
    if (!(obstacle.kind in dimensions)) continue;
    const [top, width, height] = dimensions[obstacle.kind];
    assert.equal(obstacle.y - obstacle.imageY, top);
    assert.equal(obstacle.width, width);
    assert.equal(obstacle.height, height);
  }
});

test('taller dead trees allow actors behind the branches while roots remain solid', () => {
  const bounds = { x: 50, y: 50, width: 2900, height: 2900 };
  const trees = dungeonObstacles.filter((obstacle) => obstacle.kind === 'dead-tree');
  assert.equal(trees.length, 8);
  for (const tree of trees) {
    const visual = getObstacleVisual(tree);
    assert.equal(visual.width, 108);
    assert.equal(visual.height, 120);
    assert.equal(visual.y, tree.imageY - 22);
    assert.equal(tree.y - tree.imageY, 42);
    assert.equal(tree.height, 46);
    assert.equal(tree.y + tree.height, tree.imageY + 88);
    for (const size of [40, 24]) {
      const x = tree.x + (tree.width - size) / 2;
      const behind = moveAndSlide({ x, y: visual.y - size - 10, width: size, height: size },
        0, 200, bounds, [tree]);
      assert.equal(behind.y + size, tree.y);
      assert.ok(overlaps(behind, visual), 'Actor can enter the visual region behind the tree');
      assert.ok(!overlaps(behind, tree));
      assert.ok(getFootDepth(behind) < getFootDepth(tree), 'Tree draws over actor behind it');
      const front = moveAndSlide({ x, y: tree.y + tree.height + 80, width: size, height: size },
        0, -200, bounds, [tree]);
      assert.equal(front.y, tree.y + tree.height);
      assert.ok(getFootDepth(front) > getFootDepth(tree));
    }
  }
});

test('horizontal mirroring stays deterministic and aligned with asymmetric collision boxes', () => {
  const flippedCount = dungeonObstacles.filter((obstacle) => obstacle.flipX).length;
  assert.ok(flippedCount > 0 && flippedCount < dungeonObstacles.length);
  for (const kind of new Set(dungeonObstacles.map((obstacle) => obstacle.kind))) {
    const variants = dungeonObstacles.filter((obstacle) => obstacle.kind === kind);
    assert.ok(variants.some((obstacle) => obstacle.flipX));
    assert.ok(variants.some((obstacle) => !obstacle.flipX));
  }
  for (const obstacle of dungeonObstacles) {
    const normal = getObstacleVisual({ ...obstacle, flipX: false });
    const mirrored = getObstacleVisual({ ...obstacle, flipX: true });
    const pivot = obstacle.x + obstacle.width / 2;
    assert.equal(mirrored.x, 2 * pivot - normal.x - normal.width);
    assert.equal(mirrored.y, normal.y);
    assert.equal(mirrored.width, normal.width);
    assert.equal(getFootDepth(obstacle), obstacle.y + obstacle.height);
  }
  // 부서진 비석과 바위는 좌우 여백이 다르므로 반전 시 그림 위치를 보정해야 한다.
  for (const [kind, offset] of [['broken-grave', -2], ['rock', 2]]) {
    const obstacle = dungeonObstacles.find((item) => item.kind === kind);
    assert.equal(getObstacleVisual({ ...obstacle, flipX: true }).x, obstacle.imageX + offset);
  }
});
