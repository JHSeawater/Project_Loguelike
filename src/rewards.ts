import { BATTLE_CONFIG as CFG, BLESS_CONFIG as BLESS, CHARACTER_STATS, SKILL_CONFIG as SKILL, type CharacterId } from './battle-config.ts';

export type CommonRewardId = 'damage' | 'attackSpeed' | 'maxHp' | 'moveSpeed' | 'shotSpeed' | 'pickupRadius' | 'choices' | 'heal'
  | 'soulHarvest';
export type SkillId = 'multiShot' | 'explosion' | 'homing' | 'surgeTuning' | 'swingRange' | 'bloodThirst' | 'bloodFrenzy'
  | 'deathLord' | 'plague' | 'corpseBoost' | 'legion' | 'contagion' | 'corpseBlast';
export type BossRewardId = 'bossSkill' | 'might' | 'barrier' | 'restore';
export type BlessId = 'blessHp' | 'blessSpeed' | 'blessDamage';
export type RewardId = CommonRewardId | SkillId | BossRewardId | BlessId;
export type RewardTier = 'common' | 'uncommon' | 'rare' | 'epic';

// 레벨업 보상의 등급. 등급이 높을수록 선택지에 뽑힐 가중치가 낮다. 효과량은 등급과 관계없다.
export const REWARD_TIERS: Record<RewardTier, { name: string; weight: number }> = {
  common: { name: '커먼', weight: 1 },
  uncommon: { name: '언커먼', weight: 0.6 },
  rare: { name: '레어', weight: 0.3 },
  epic: { name: '에픽', weight: 0.1 },
};

export interface RewardDef {
  name: string;
  effect: string;
  maxStacks: number;
  // 레벨업 보상만 가진다. 보스 보상은 등급 없이 같은 확률로 뽑는다.
  tier?: RewardTier;
  // 직업 특기만 가진다. 특수 특기는 에픽 등급이며 한 번만 얻는다.
  character?: CharacterId;
  special?: boolean;
  // 보스 처치 보상 선택창에만 나온다.
  boss?: boolean;
  // 가호 선택창에만 나온다. 고르면 적이 강해진다.
  blessing?: boolean;
}

// 보스 처치 보상의 효과량. 선택지 수는 '선택지 추가' 보상과 관계없이 고정이다.
export const BOSS_REWARD = {
  choices: 3, mightDamagePercent: 30, mightSpeedPercent: 10, barrierPercent: 15, barrierRegenMs: 8000, restoreMaxHp: 30,
} as const;

// 직업 시작 능력치(공격력·공격 간격·최대 체력·이동속도)는 시작값의 일정 비율(%)을, 나머지는 기본값 기준 고정 증가량을 더한다.
// 효과량과 최대 중첩은 플레이 테스트로 조정한다.
export const REWARD_STEP = {
  damagePercent: 20, attackPercent: 10, maxHpPercent: 10, speedPercent: 10, shotSpeed: 105, pickupRadius: 25, choices: 1, healPercent: 30,
  expPercent: 10,
} as const;

export const BASE_CHOICES = 3;

export const REWARDS: Record<RewardId, RewardDef> = {
  damage: { name: '공격력 강화', effect: `공격력 +${REWARD_STEP.damagePercent}%`, maxStacks: Infinity, tier: 'common' },
  attackSpeed: { name: '공격 속도 강화', effect: `공격 간격 −${REWARD_STEP.attackPercent}%`, maxStacks: 5, tier: 'uncommon' },
  maxHp: { name: '최대 체력 강화', effect: `최대 체력 +${REWARD_STEP.maxHpPercent}%\n현재 체력도 같은 만큼 증가`, maxStacks: Infinity,
    tier: 'common' },
  moveSpeed: { name: '이동속도 강화', effect: `이동속도 +${REWARD_STEP.speedPercent}%`, maxStacks: Infinity, tier: 'common' },
  shotSpeed: { name: '투사체 속도 강화', effect: `투사체 속도 +${REWARD_STEP.shotSpeed}`, maxStacks: 3, tier: 'common' },
  pickupRadius: { name: '획득 반경 확대', effect: `획득 반경 +${REWARD_STEP.pickupRadius}`, maxStacks: 5, tier: 'uncommon' },
  choices: { name: '선택지 추가', effect: `레벨업 선택지 +${REWARD_STEP.choices}`, maxStacks: 2, tier: 'rare' },
  heal: { name: '체력 회복', effect: `최대 체력의 ${REWARD_STEP.healPercent}% 회복`, maxStacks: Infinity, tier: 'common' },
  soulHarvest: { name: '영혼 흡수', effect: `경험치 획득량 +${REWARD_STEP.expPercent}%`, maxStacks: Infinity, tier: 'rare' },
  multiShot: { name: '다중 시전', effect: '발사 수 +1', maxStacks: Infinity, character: 'warlock', tier: 'rare' },
  explosion: { name: '마력 폭발', effect: `폭발 반경 +${SKILL.explosion.radiusStep}\n주변 적에게 공격력의 ${SKILL.explosion.damagePercent}%`,
    maxStacks: Infinity, character: 'warlock', tier: 'rare' },
  homing: { name: '추적 마탄', effect: '투사체가 가까운 적을\n향해 방향을 바꾼다', maxStacks: 1, character: 'warlock', special: true,
    tier: 'epic' },
  surgeTuning: { name: '마력 조정', effect: `마력 폭주 지속 시간 ${SKILL.surgeTuning.durationMultiplier}배\n`
    + `능력치 변화량 ${SKILL.surgeTuning.percentMultiplier}배`,
    maxStacks: 1, character: 'warlock', special: true, tier: 'epic' },
  swingRange: { name: '참격 확장', effect: `공격 반경 +${SKILL.swingRange.radiusStep}`, maxStacks: Infinity, character: 'deathKnight',
    tier: 'rare' },
  bloodThirst: { name: '피의 갈증', effect: `처치 시 회복 +${SKILL.bloodThirst.healStep}`, maxStacks: Infinity, character: 'deathKnight',
    tier: 'uncommon' },
  bloodFrenzy: { name: '피의 광란', effect: `처치하면 다음 1회 공격의\n공격력 ${SKILL.bloodFrenzy.damageMultiplier}배`,
    maxStacks: 1, character: 'deathKnight', special: true, tier: 'epic' },
  deathLord: { name: '죽음의 군주', effect: `공격력·이동속도·최대 체력 +${SKILL.deathLord.percent}%\n공격 간격 −${SKILL.deathLord.percent}%`,
    maxStacks: 1, character: 'deathKnight', special: true, tier: 'epic' },
  // 역병 확산은 좀비화 확률이 상한에 닿으면 더 나오지 않는다.
  plague: { name: '역병 확산', effect: `좀비화 확률 +${SKILL.plague.percentStep}%p\n(최대 ${SKILL.plague.maxPercent}%)`,
    maxStacks: (SKILL.plague.maxPercent - SKILL.raise.chancePercent) / SKILL.plague.percentStep, character: 'necromancer', tier: 'rare' },
  corpseBoost: { name: '시체 강화', effect: `좀비 공격력·체력 +${SKILL.corpseBoost.percent}%`, maxStacks: Infinity,
    character: 'necromancer', tier: 'uncommon' },
  legion: { name: '망자의 군세', effect: `최대 좀비 수 +${SKILL.legion.maxStep}`, maxStacks: Infinity, character: 'necromancer',
    tier: 'uncommon' },
  contagion: { name: '전염', effect: `좀비에게 죽은 적의\n좀비화 확률 +${SKILL.contagion.percent}%p`, maxStacks: 1,
    character: 'necromancer', special: true, tier: 'epic' },
  corpseBlast: { name: '시체 폭발', effect: `좀비가 죽을 때 주변 적에게\n공격력의 ${SKILL.corpseBlast.damagePercent}% 피해`, maxStacks: 1,
    character: 'necromancer', special: true, tier: 'epic' },
  bossSkill: { name: '직업 특수 특기', effect: '이 직업의 특수 특기 하나를\n바로 얻는다', maxStacks: 1, boss: true },
  might: { name: '기사단장의 힘', effect: `공격력 +${BOSS_REWARD.mightDamagePercent}%\n이동속도 +${BOSS_REWARD.mightSpeedPercent}%`,
    maxStacks: 1, boss: true },
  barrier: { name: '성스러운 방벽', effect: `최대 체력의 ${BOSS_REWARD.barrierPercent}%를 막는 배리어\n`
    + `${BOSS_REWARD.barrierRegenMs / 1000}초간 피해가 없으면 재생`, maxStacks: 1, boss: true },
  restore: { name: '완전 회복', effect: `최대 체력 +${BOSS_REWARD.restoreMaxHp}\n체력 모두 회복`, maxStacks: 1, boss: true },
  blessHp: { name: '신앙심', effect: `이후 나오는 적의\n체력 +${BLESS.percent}%`, maxStacks: Infinity, blessing: true },
  blessSpeed: { name: '인도', effect: `모든 적의\n이동속도 +${BLESS.percent}%`, maxStacks: Infinity, blessing: true },
  blessDamage: { name: '정화', effect: `모든 적의\n공격력 +${BLESS.percent}%`, maxStacks: Infinity, blessing: true },
};

// 모든 직업에 공통인 보상. 직업 특기는 SKILL_IDS에 따로 둔다.
export const REWARD_IDS: CommonRewardId[] = ['damage', 'attackSpeed', 'maxHp', 'moveSpeed', 'shotSpeed', 'pickupRadius', 'choices', 'heal',
  'soulHarvest'];
export const SKILL_IDS: SkillId[] = ['multiShot', 'explosion', 'homing', 'surgeTuning', 'swingRange', 'bloodThirst', 'bloodFrenzy', 'deathLord',
  'plague', 'corpseBoost', 'legion', 'contagion', 'corpseBlast'];
export const BOSS_REWARD_IDS: BossRewardId[] = ['bossSkill', 'might', 'barrier', 'restore'];
// 가호 선택창은 항상 이 세 가호를 이 순서로 보여 준다.
export const BLESS_IDS: BlessId[] = ['blessHp', 'blessSpeed', 'blessDamage'];

// 직업의 특수 특기 중 아직 얻지 않은 것. 보스 보상 '직업 특수 특기'는 이 중 하나를 준다.
export function missingSpecialSkills(stacks: RewardStacks, character: CharacterId): SkillId[] {
  return SKILL_IDS.filter((id) => REWARDS[id].character === character && REWARDS[id].special && stacks[id] === 0);
}

// 보스 보상 후보. 특수 특기를 모두 가졌으면 '직업 특수 특기'를 뺀다.
export function bossRewardPool(stacks: RewardStacks, character: CharacterId): RewardId[] {
  return BOSS_REWARD_IDS.filter((id) => id !== 'bossSkill' || missingSpecialSkills(stacks, character).length > 0);
}

// 직업 컨셉에 맞지 않는 공통 보상. 투사체가 없는 데스 나이트는 투사체 속도 강화를 받지 않는다.
const EXCLUDED_REWARDS: Record<CharacterId, readonly CommonRewardId[]> = {
  warlock: [],
  deathKnight: ['shotSpeed'],
  necromancer: [],
};

// 직업의 선택지 후보: 제외 항목을 뺀 공통 보상과 그 직업의 특기를 같은 목록에 섞는다.
export function rewardPool(character: CharacterId): RewardId[] {
  return [...REWARD_IDS.filter((id) => !EXCLUDED_REWARDS[character].includes(id)),
    ...SKILL_IDS.filter((id) => REWARDS[id].character === character)];
}

export type RewardStacks = Record<RewardId, number>;

export function emptyStacks(): RewardStacks {
  return Object.fromEntries([...REWARD_IDS, ...SKILL_IDS, ...BOSS_REWARD_IDS, ...BLESS_IDS].map((id) => [id, 0])) as RewardStacks;
}

export interface PlayerStats {
  damage: number;
  attackMs: number;
  speed: number;
  shotSpeed: number;
  pickupRadius: number;
  choiceCount: number;
}

// 죽음의 군주는 공통 보상까지 더한 값에 비율로 적용한다.
const lordScale = (stacks: RewardStacks): number => stacks.deathLord ? SKILL.deathLord.percent / 100 : 0;
// 보스 보상 '기사단장의 힘'은 공통 보상과 직업 특기까지 더한 값에 곱한다.
const mightScale = (stacks: RewardStacks, percent: number): number => 1 + (stacks.might ? percent / 100 : 0);

// 직업 시작값에 중첩 수만큼의 비율을 더한다(복리 아님). 백분율 정수로 곱해 소수 오차를 줄인다.
const raised = (base: number, stackCount: number, percent: number): number => base * (100 + stackCount * percent) / 100;

// 최대 체력과 회복은 현재 체력과 함께 바뀌므로 전투에서 직접 적용하고, 나머지는 중첩 수로 계산한다.
export function statsFor(stacks: RewardStacks, character: CharacterId = 'warlock'): PlayerStats {
  const base = CHARACTER_STATS[character], lord = lordScale(stacks);
  return {
    damage: Math.round(raised(base.damage, stacks.damage, REWARD_STEP.damagePercent) * (1 + lord)
      * mightScale(stacks, BOSS_REWARD.mightDamagePercent)),
    attackMs: Math.round(raised(base.attackMs, stacks.attackSpeed, -REWARD_STEP.attackPercent) * (1 - lord)),
    speed: Math.round(raised(base.speed, stacks.moveSpeed, REWARD_STEP.speedPercent) * (1 + lord)
      * mightScale(stacks, BOSS_REWARD.mightSpeedPercent)),
    shotSpeed: CFG.playerShot.speed + stacks.shotSpeed * REWARD_STEP.shotSpeed,
    pickupRadius: CFG.player.pickupRadius + stacks.pickupRadius * REWARD_STEP.pickupRadius,
    choiceCount: BASE_CHOICES + stacks.choices * REWARD_STEP.choices,
  };
}

export function maxHpFor(stacks: RewardStacks, character: CharacterId = 'warlock'): number {
  return Math.round((raised(CHARACTER_STATS[character].hp, stacks.maxHp, REWARD_STEP.maxHpPercent) + stacks.restore * BOSS_REWARD.restoreMaxHp)
    * (1 + lordScale(stacks)));
}

export interface SkillStats {
  shots: number;
  explosionRadius: number;
  // 경험치 획득 배율(백분율). 정수로 계산해 소수점 이월이 정확하도록 한다.
  expPercent: number;
  homing: boolean;
  // 마력 폭주의 지속 시간과 능력치 변화량(%). 마력 조정을 얻으면 함께 커진다.
  surgeMs: number;
  surgePercent: number;
  swingRadius: number;
  killHeal: number;
  frenzy: boolean;
  // 네크로맨서의 좀비화 확률(%), 좀비 공격력·체력 배율(%), 동시에 있을 수 있는 최대 좀비 수. 다른 직업은 좀비화 확률과 최대 수가 0이다.
  raisePercent: number;
  zombiePercent: number;
  zombieMax: number;
  contagion: boolean;
  corpseBlast: boolean;
}

export function skillStatsFor(stacks: RewardStacks, character: CharacterId = 'warlock'): SkillStats {
  const base = CHARACTER_STATS[character];
  const tuned = stacks.surgeTuning > 0;
  return {
    shots: 1 + stacks.multiShot,
    explosionRadius: stacks.explosion * SKILL.explosion.radiusStep,
    expPercent: 100 + stacks.soulHarvest * REWARD_STEP.expPercent,
    homing: stacks.homing > 0,
    surgeMs: SKILL.surge.durationMs * (tuned ? SKILL.surgeTuning.durationMultiplier : 1),
    surgePercent: SKILL.surge.percent * (tuned ? SKILL.surgeTuning.percentMultiplier : 1),
    swingRadius: base.swingRadius + stacks.swingRange * SKILL.swingRange.radiusStep,
    killHeal: base.killHeal + stacks.bloodThirst * SKILL.bloodThirst.healStep,
    frenzy: stacks.bloodFrenzy > 0,
    raisePercent: character === 'necromancer'
      ? Math.min(SKILL.plague.maxPercent, SKILL.raise.chancePercent + stacks.plague * SKILL.plague.percentStep) : 0,
    zombiePercent: 100 + stacks.corpseBoost * SKILL.corpseBoost.percent,
    zombieMax: character === 'necromancer' ? SKILL.raise.max + stacks.legion * SKILL.legion.maxStep : 0,
    contagion: stacks.contagion > 0,
    corpseBlast: stacks.corpseBlast > 0,
  };
}

// 레벨업 보상은 등급 가중치로, 등급이 없는 보스 보상은 같은 가중치 1로 뽑는다.
export const rewardWeight = (id: RewardId): number => {
  const tier = REWARDS[id].tier;
  return tier ? REWARD_TIERS[tier].weight : 1;
};

// 최대 중첩에 도달하지 않은 후보 중 중복 없이 가중치에 따라 고른다.
// 후보가 부족하면 남은 보상만 돌려준다. 후보를 주지 않으면 공통 보상에서 고른다.
export function rollChoices(stacks: RewardStacks, count: number, random: () => number,
  pool: readonly RewardId[] = REWARD_IDS): RewardId[] {
  const candidates = pool.filter((id) => stacks[id] < REWARDS[id].maxStacks);
  const picked: RewardId[] = [];
  while (picked.length < count && candidates.length) {
    const weights = candidates.map(rewardWeight);
    let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
    let index = 0;
    while (index < candidates.length - 1 && roll >= weights[index]) roll -= weights[index++];
    picked.push(candidates.splice(index, 1)[0]);
  }
  return picked;
}
