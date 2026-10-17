export type EnemyKind = 'soldier' | 'knight' | 'paladin' | 'archer' | 'mage';

export const BATTLE_CONFIG = {
  world: { x: 50, y: 50, width: 2900, height: 2900 },
  // 획득 반경은 향후 성장할 수 있는 플레이어 능력치다. 현재는 초기값으로 고정한다.
  player: { size: 40, hp: 100, damage: 10, speed: 250, attackMs: 500, hurtMs: 3000, pickupRadius: 100 },
  playerShot: { speed: 700, size: 8, lifeMs: 4000, color: 0xf5e6a8 },
  enemyShot: { speed: 280, size: 10, lifeMs: 6000 },
  expOrb: { size: 12, pullSpeed: 450, max: 300 },
  spawnMs: 1800,
  spawnMargin: 96,
  maxEnemies: 30,
  targetMs: 250,
  pathMs: 750,
  pathBudget: 4,
  // 한 프레임의 경과 시간은 50ms 이하 단계로 나눠 모두 진행하되, 긴 정지 뒤에는 250ms까지만 반영한다.
  stepMs: 50,
  maxFrameMs: 250,
} as const;

export interface EnemyStats {
  name: string;
  width: number;
  height: number;
  hp: number;
  damage: number;
  speed: number;
  range: number;
  attackMs: number;
  ranged: boolean;
  color: number;
  exp: number;
}

// 크기·사거리 1은 40px, 원거리 공격 간격은 초 단위다. 기사는 가로형, 성기사는 세로형 몸체를 쓴다.
export const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  soldier: { name: '병사', width: 40, height: 40, hp: 25, damage: 10, speed: 100, range: 40, attackMs: 0, ranged: false, color: 0xdb6464, exp: 1 },
  knight: { name: '기사', width: 120, height: 80, hp: 75, damage: 20, speed: 140, range: 40, attackMs: 0, ranged: false, color: 0x819ce0, exp: 3 },
  paladin: { name: '성기사', width: 80, height: 120, hp: 125, damage: 25, speed: 65, range: 40, attackMs: 0, ranged: false, color: 0xdfbe5d, exp: 4 },
  archer: { name: '궁사', width: 40, height: 40, hp: 10, damage: 5, speed: 110, range: 280, attackMs: 5000, ranged: true, color: 0xa7c26b, exp: 1 },
  mage: { name: '마법사', width: 40, height: 40, hp: 15, damage: 10, speed: 90, range: 200, attackMs: 10000, ranged: true, color: 0xbc83d6, exp: 2 },
};

export const SPAWN_ORDER: readonly EnemyKind[] = [
  'soldier', 'archer', 'soldier', 'knight', 'mage', 'soldier', 'paladin', 'soldier', 'archer', 'mage',
];
