import type { Box } from './collision';

type BaseObstacleKind = 'grave' | 'broken-grave' | 'rock' | 'stump' | 'log';
export type ObstacleKind = BaseObstacleKind | 'cross-grave' | 'dead-tree';

export interface Obstacle extends Box {
  kind: ObstacleKind;
  imageX: number;
  imageY: number;
  flipX: boolean;
}

export function getObstacleVisual(obstacle: Obstacle): { x: number; y: number; width: number; height: number; flipX: boolean } {
  const isTree = obstacle.kind === 'dead-tree';
  const width = isTree ? 108 : 96;
  const height = isTree ? 120 : 96;
  const normalX = obstacle.imageX - (isTree ? 6 : 0);
  // 확대해도 뿌리의 발밑 높이를 고정한다. 반전은 충돌 영역의 중심을 기준으로 한다.
  const x = obstacle.flipX ? 2 * (obstacle.x + obstacle.width / 2) - normalX - width : normalX;
  return { x, y: obstacle.imageY - (isTree ? 22 : 0), width, height, flipX: obstacle.flipX };
}

// 배치 판정에는 원래 크기를 사용해 충돌 영역 조정으로 장애물 위치가 바뀌지 않게 한다.
const footprints: Record<BaseObstacleKind, Box> = {
  grave: { x: 22, y: 8, width: 52, height: 74 },
  'broken-grave': { x: 14, y: 34, width: 66, height: 50 },
  rock: { x: 10, y: 28, width: 78, height: 54 },
  stump: { x: 14, y: 14, width: 68, height: 74 },
  log: { x: 4, y: 40, width: 88, height: 42 },
};
const counts: readonly [ObstacleKind, number][] = [
  ['grave', 6], ['cross-grave', 10], ['broken-grave', 16],
  ['rock', 16], ['stump', 8], ['dead-tree', 8], ['log', 16],
];

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

function gap(a: Box, b: Box): number {
  return Math.hypot(
    Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0),
    Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0),
  );
}

export function createDungeonLayout(seed = 0x71c39a): readonly Obstacle[] {
  // 고정 시드로 다시 실행해도 같은 지형을 만든다. 위치를 격자나 묶음에 맞추지 않는다.
  const random = (): number => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const kinds = counts.flatMap(([kind, count]) => Array.from({ length: count }, () => kind));
  for (let i = kinds.length - 1; i > 0; i--) {
    const other = Math.floor(random() * (i + 1));
    [kinds[i], kinds[other]] = [kinds[other], kinds[i]];
  }

  const obstacles: Obstacle[] = [];
  const corridors: readonly Box[] = [
    { x: 1380, y: 50, width: 240, height: 2900 },
    { x: 50, y: 1380, width: 2900, height: 240 },
  ];
  const spawn = { x: 1500, y: 1500, width: 0, height: 0 };

  for (let attempt = 0; obstacles.length < kinds.length && attempt < 50000; attempt++) {
    const kind = kinds[obstacles.length];
    const footprintKind = kind === 'cross-grave' ? 'grave' : kind === 'dead-tree' ? 'stump' : kind;
    const footprint = footprints[footprintKind];
    // 96픽셀 그림 전체를 울타리에서 떨어뜨려 외곽 순환로도 확보한다.
    const imageX = 170 + Math.floor(random() * 2565);
    const imageY = 170 + Math.floor(random() * 2565);
    const obstacle: Obstacle = { ...footprint,
      x: imageX + footprint.x, y: imageY + footprint.y, imageX, imageY, kind, flipX: false };

    if (gap(obstacle, spawn) < 340) continue;
    if (corridors.some((corridor) => overlaps(obstacle, corridor))) continue;
    // 충돌 사각형 사이에 여유를 두어 좁은 틈이나 밀집 구역이 생기지 않게 한다.
    if (obstacles.some((other) => gap(obstacle, other) < 145)) continue;
    obstacles.push(obstacle);
  }

  if (obstacles.length !== kinds.length) throw new Error('Unable to place all dungeon obstacles');
  return obstacles.map((obstacle) => {
    // 배치 난수와 별개로 방향을 결정해 위치나 종류가 달라지지 않게 한다.
    const flipX = ((Math.imul(obstacle.imageX, 73856093) ^ Math.imul(obstacle.imageY, 19349663)) & 1) === 1;
    const topInset = obstacle.kind === 'dead-tree' ? 28
      : obstacle.kind === 'grave' || obstacle.kind === 'cross-grave' ? 20 : 0;
    // 윗부분 뒤로 들어가되 받침대·뿌리의 하단은 고정한다.
    return { ...obstacle, flipX, y: obstacle.y + topInset, height: obstacle.height - topInset };
  });
}

export const dungeonObstacles = createDungeonLayout();
