import { BATTLE_CONFIG as CFG } from './battle-config.ts';

export type RewardId = 'damage' | 'attackSpeed' | 'maxHp' | 'moveSpeed' | 'shotSpeed' | 'pickupRadius' | 'choices' | 'heal';

export interface RewardDef {
  name: string;
  effect: string;
  maxStacks: number;
}

// 기본값 기준 고정 증가량을 더한다. 효과량과 최대 중첩은 플레이 테스트로 조정한다.
export const REWARD_STEP = {
  damage: 2, attackMs: 50, maxHp: 20, speed: 25, shotSpeed: 105, pickupRadius: 25, choices: 1, healPercent: 30,
} as const;

export const BASE_CHOICES = 3;

export const REWARDS: Record<RewardId, RewardDef> = {
  damage: { name: '공격력 강화', effect: `공격력 +${REWARD_STEP.damage}`, maxStacks: 10 },
  attackSpeed: { name: '공격 속도 강화', effect: `공격 간격 −${REWARD_STEP.attackMs / 1000}초`, maxStacks: 5 },
  maxHp: { name: '최대 체력 강화', effect: `최대 체력 +${REWARD_STEP.maxHp}\n현재 체력 +${REWARD_STEP.maxHp}`, maxStacks: 10 },
  moveSpeed: { name: '이동속도 강화', effect: `이동속도 +${REWARD_STEP.speed}`, maxStacks: 5 },
  shotSpeed: { name: '투사체 속도 강화', effect: `투사체 속도 +${REWARD_STEP.shotSpeed}`, maxStacks: 3 },
  pickupRadius: { name: '획득 반경 확대', effect: `획득 반경 +${REWARD_STEP.pickupRadius}`, maxStacks: 5 },
  choices: { name: '선택지 추가', effect: `레벨업 선택지 +${REWARD_STEP.choices}`, maxStacks: 2 },
  heal: { name: '체력 회복', effect: `최대 체력의 ${REWARD_STEP.healPercent}% 회복`, maxStacks: Infinity },
};

export const REWARD_IDS = Object.keys(REWARDS) as RewardId[];

export type RewardStacks = Record<RewardId, number>;

export function emptyStacks(): RewardStacks {
  return Object.fromEntries(REWARD_IDS.map((id) => [id, 0])) as RewardStacks;
}

export interface PlayerStats {
  damage: number;
  attackMs: number;
  speed: number;
  shotSpeed: number;
  pickupRadius: number;
  choiceCount: number;
}

// 최대 체력과 회복은 현재 체력과 함께 바뀌므로 전투에서 직접 적용하고, 나머지는 중첩 수로 계산한다.
export function statsFor(stacks: RewardStacks): PlayerStats {
  return {
    damage: CFG.player.damage + stacks.damage * REWARD_STEP.damage,
    attackMs: CFG.player.attackMs - stacks.attackSpeed * REWARD_STEP.attackMs,
    speed: CFG.player.speed + stacks.moveSpeed * REWARD_STEP.speed,
    shotSpeed: CFG.playerShot.speed + stacks.shotSpeed * REWARD_STEP.shotSpeed,
    pickupRadius: CFG.player.pickupRadius + stacks.pickupRadius * REWARD_STEP.pickupRadius,
    choiceCount: BASE_CHOICES + stacks.choices * REWARD_STEP.choices,
  };
}

// 최대 중첩에 도달하지 않은 보상 중 중복 없이 같은 확률로 고른다. 후보가 부족하면 남은 보상만 돌려준다.
export function rollChoices(stacks: RewardStacks, count: number, random: () => number): RewardId[] {
  const pool = REWARD_IDS.filter((id) => stacks[id] < REWARDS[id].maxStacks);
  const picked: RewardId[] = [];
  while (picked.length < count && pool.length) {
    const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    picked.push(pool.splice(index, 1)[0]);
  }
  return picked;
}
