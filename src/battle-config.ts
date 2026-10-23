export type EnemyKind = 'soldier' | 'knight' | 'paladin' | 'archer' | 'mage' | 'zealot' | 'crossbowman' | 'priest' | 'commander';
export type CharacterId = 'warlock' | 'deathKnight';

export const BATTLE_CONFIG = {
  world: { x: 50, y: 50, width: 2900, height: 2900 },
  // 모든 직업에 공통인 플레이어 값이다. 획득 반경은 '획득 반경 확대' 보상으로 늘어난다.
  player: { size: 40, hurtMs: 3000, pickupRadius: 100 },
  playerShot: { speed: 700, size: 8, lifeMs: 4000, color: 0xf5e6a8 },
  enemyShot: { speed: 280, size: 10, lifeMs: 6000 },
  expOrb: { size: 12, pullSpeed: 450, max: 300 },
  // 적끼리는 몸체 위쪽 이 비율만큼 겹칠 수 있다. 장애물의 위쪽 통과 영역처럼 다른 적 뒤로 살짝 들어간다.
  enemyPassTop: 0.25,
  spawnMargin: 96,
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
  // 사거리까지 접근한 뒤 멈추는 적. 원거리 적과 사제가 해당한다.
  ranged: boolean;
  color: number;
  exp: number;
  // 원거리 적의 투사체 속도. 없으면 공통 적 투사체 속도를 쓴다.
  shotSpeed?: number;
  // 사제는 공격 대신 공격 간격마다 반경 안의 다른 적을 회복한다.
  heal?: { radius: number; amount: number };
}

// 크기·사거리 1은 40px, 원거리 공격 간격은 초 단위다. 기사는 가로형, 성기사는 세로형 몸체를 쓴다.
export const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  soldier: { name: '병사', width: 40, height: 40, hp: 25, damage: 10, speed: 110, range: 40, attackMs: 0, ranged: false, color: 0xdb6464, exp: 1 },
  knight: { name: '기사', width: 80, height: 60, hp: 75, damage: 20, speed: 160, range: 40, attackMs: 0, ranged: false, color: 0x819ce0, exp: 3 },
  paladin: { name: '성기사', width: 60, height: 80, hp: 130, damage: 25, speed: 75, range: 40, attackMs: 0, ranged: false, color: 0xdfbe5d, exp: 4 },
  archer: { name: '궁사', width: 30, height: 40, hp: 15, damage: 5, speed: 120, range: 280, attackMs: 5000, ranged: true, color: 0xa7c26b, exp: 1 },
  mage: { name: '마법사', width: 40, height: 40, hp: 20, damage: 10, speed: 100, range: 200, attackMs: 10000, ranged: true, color: 0xbc83d6, exp: 2 },
  zealot: { name: '광신도', width: 25, height: 30, hp: 12, damage: 6, speed: 250, range: 40, attackMs: 0, ranged: false, color: 0xe08a3c, exp: 0.5 },
  crossbowman: { name: '석궁병', width: 40, height: 40, hp: 20, damage: 15, speed: 120, range: 320, attackMs: 6000, ranged: true, color: 0x4fb8b0, exp: 2,
    shotSpeed: 500 },
  priest: { name: '사제', width: 30, height: 40, hp: 25, damage: 0, speed: 100, range: 240, attackMs: 3000, ranged: true, color: 0xe58fb8, exp: 2.5,
    heal: { radius: 160, amount: 10 } },
  // 보스. 일반 생성에는 나오지 않고 BOSS_CONFIG에 따라 등장한다.
  commander: { name: '성기사단장', width: 70, height: 90, hp: 1800, damage: 30, speed: 70, range: 40, attackMs: 0, ranged: false, color: 0x8c9099, exp: 30 },
};

export type BossAction = 'brand' | 'cross' | 'rally' | 'aegis';

// 성기사단장의 등장과 행동. 범위 공격은 경고 시간이 끝나는 순간 범위에 닿은 아군에게 한 번 피해를 준다.
export const BOSS_CONFIG = {
  kind: 'commander',
  at: 300_000,
  strokeColor: 0xe0b84a,
  // 등장 후 첫 행동까지, 이후 행동 사이의 간격. 행동은 cycle 순서대로 반복한다.
  firstActionMs: 4000,
  everyMs: 4000,
  cycle: ['brand', 'cross', 'rally', 'brand', 'cross', 'aegis'] as readonly BossAction[],
  brand: { radius: 100, warnMs: 1000, damage: 35 },
  // 보스 중심에서 상하좌우로 뻗는 십자. 경고하는 동안 보스는 멈춘다.
  cross: { width: 60, length: 500, warnMs: 1200, damage: 30 },
  rally: { kind: 'soldier', count: 4, spread: 90 },
  aegis: { durationMs: 5000, reducePercent: 70 },
} as const;

export interface SpawnStage {
  // 이 단계가 시작되는 게임 시간(ms). 일시정지 시간은 게임 시간에 포함되지 않는다.
  at: number;
  everyMs: number;
  count: number;
  max: number;
  // 이 단계에서 새로 일반 생성 후보에 추가되는 종류.
  adds: readonly EnemyKind[];
}

// 시간에 따른 생성 증가. 단계 경계 시점부터 다음 단계 값을 적용한다.
export const SPAWN_STAGES: readonly SpawnStage[] = [
  { at: 0, everyMs: 1000, count: 1, max: 30, adds: ['soldier', 'archer'] },
  { at: 60_000, everyMs: 900, count: 1, max: 40, adds: ['knight', 'mage'] },
  { at: 120_000, everyMs: 1200, count: 2, max: 50, adds: ['paladin'] },
  // 3:00은 석궁병만 추가한다. 생성 주기와 최대 수는 2:00 단계와 같다.
  { at: 180_000, everyMs: 1200, count: 2, max: 50, adds: ['crossbowman'] },
  { at: 240_000, everyMs: 1000, count: 2, max: 60, adds: ['priest'] },
  { at: 360_000, everyMs: 800, count: 3, max: 70, adds: [] },
  { at: 480_000, everyMs: 700, count: 3, max: 80, adds: [] },
  { at: 600_000, everyMs: 600, count: 4, max: 90, adds: [] },
];

// 일반 생성에서 종류를 고르는 가중치. 광신도는 무리 패턴으로만 등장한다.
export const SPAWN_WEIGHTS: Partial<Record<EnemyKind, number>> = {
  soldier: 4, archer: 2, knight: 2, mage: 2, paladin: 1, crossbowman: 2, priest: 1,
};

export const SPAWN_PATTERNS = {
  // 10:00에는 +0%, 이후 1분마다 기본 체력의 10%씩 더한다. 생성 시점에 정하고 반올림한다.
  hpGrowth: { from: 600_000, everyMs: 60_000, percent: 10 },
  zealotGroup: { from: 120_000, everyMs: 30_000, count: 5, spread: 90 },
  ring: { from: 150_000, everyMs: 150_000, kind: 'soldier', count: 16 },
} as const;

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
