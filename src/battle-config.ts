export type EnemyKind = 'soldier' | 'knight' | 'paladin' | 'archer' | 'mage';

export const BATTLE_CONFIG = {
  world: { x: 50, y: 50, width: 2900, height: 2900 },
  player: { size: 40, hp: 100, damage: 10, speed: 250, attackMs: 500, hurtMs: 3000 },
  playerShot: { speed: 700, size: 8, lifeMs: 4000, color: 0xf5e6a8 },
  enemyShot: { speed: 280, size: 10, lifeMs: 6000 },
  spawnMs: 1800,
  spawnMargin: 96,
  maxEnemies: 30,
  targetMs: 250,
  pathMs: 750,
  pathBudget: 4,
} as const;

export interface EnemyStats {
  name: string;
  size: number;
  hp: number;
  damage: number;
  speed: number;
  range: number;
  attackMs: number;
  ranged: boolean;
  color: number;
}

// 문서의 크기·사거리 1을 40px, 원거리 공격 간격을 초 단위로 임시 해석한다.
export const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  soldier: { name: '병사', size: 40, hp: 25, damage: 10, speed: 100, range: 40, attackMs: 0, ranged: false, color: 0xdb6464 },
  knight: { name: '기사', size: 120, hp: 75, damage: 20, speed: 140, range: 80, attackMs: 0, ranged: false, color: 0x819ce0 },
  paladin: { name: '성기사', size: 120, hp: 125, damage: 25, speed: 65, range: 40, attackMs: 0, ranged: false, color: 0xdfbe5d },
  archer: { name: '궁사', size: 40, hp: 10, damage: 5, speed: 110, range: 280, attackMs: 5000, ranged: true, color: 0xa7c26b },
  mage: { name: '마법사', size: 40, hp: 15, damage: 10, speed: 90, range: 200, attackMs: 10000, ranged: true, color: 0xbc83d6 },
};

export const SPAWN_ORDER: readonly EnemyKind[] = [
  'soldier', 'archer', 'soldier', 'knight', 'mage', 'soldier', 'paladin', 'soldier', 'archer', 'mage',
];
