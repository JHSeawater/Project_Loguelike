export type EnemyKind = 'soldier' | 'knight' | 'paladin' | 'archer' | 'mage';
export type CharacterId = 'warlock' | 'deathKnight';

export const BATTLE_CONFIG = {
  world: { x: 50, y: 50, width: 2900, height: 2900 },
  // 모든 직업에 공통인 플레이어 값이다. 획득 반경은 '획득 반경 확대' 보상으로 늘어난다.
  player: { size: 40, hurtMs: 3000, pickupRadius: 100 },
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

export interface CharacterStats {
  name: string;
  hp: number;
  damage: number;
  speed: number;
  attackMs: number;
  attack: 'shot' | 'swing';
  // 휘두르기 직업의 기본 공격 반경과 처치 시 회복량. 해당 패시브가 없는 직업은 0이다.
  swingRadius: number;
  killHeal: number;
  color: number;
}

// 직업별 시작 능력치. 크기 40×40과 피격 간격 3초는 모든 직업이 같다.
export const CHARACTER_STATS: Record<CharacterId, CharacterStats> = {
  warlock: { name: '워록', hp: 100, damage: 10, speed: 250, attackMs: 500, attack: 'shot', swingRadius: 0, killHeal: 0, color: 0x66ddaa },
  deathKnight: { name: '데스 나이트', hp: 140, damage: 14, speed: 230, attackMs: 800, attack: 'swing', swingRadius: 100, killHeal: 1, color: 0xe0d8c3 },
};

// 직업 패시브와 특기의 초기값. 플레이 테스트로 조정한다.
export const SKILL_CONFIG = {
  surge: { durationMs: 5000, percent: 20 },
  multiShot: { spreadDeg: 10, maxSpreadDeg: 60 },
  explosion: { radiusStep: 20, damagePercent: 50 },
  soulHarvest: { percentStep: 10 },
  homing: { turnDegPerSec: 270 },
  swingRange: { radiusStep: 15 },
  bloodThirst: { healStep: 1 },
  deathLord: { percent: 20 },
  // 특수 특기가 선택지에 뽑힐 가중치. 다른 후보는 1이다.
  specialWeight: 0.1,
  effectMs: 150,
} as const;

export const SPAWN_ORDER: readonly EnemyKind[] = [
  'soldier', 'archer', 'soldier', 'knight', 'mage', 'soldier', 'paladin', 'soldier', 'archer', 'mage',
];
