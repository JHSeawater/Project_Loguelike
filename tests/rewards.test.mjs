import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CHOICES, BOSS_REWARD_IDS, REWARDS, REWARD_IDS, REWARD_TIERS, SKILL_IDS, emptyStacks, maxHpFor, rewardWeight, rollChoices,
  statsFor } from '../src/rewards.ts';

const seeded = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const maxed = () => {
  const stacks = emptyStacks();
  for (const id of REWARD_IDS) if (Number.isFinite(REWARDS[id].maxStacks)) stacks[id] = REWARDS[id].maxStacks;
  return stacks;
};

test('base stats match the fixed player values and max stacks match the design table', () => {
  assert.deepEqual(statsFor(emptyStacks()),
    { damage: 10, attackMs: 500, speed: 230, shotSpeed: 700, pickupRadius: 100, choiceCount: 3 });
  // 공격력·최대 체력·이동속도 강화는 최대 중첩이 없으므로 maxed()에서 0중첩이다.
  assert.deepEqual(statsFor(maxed()),
    { damage: 10, attackMs: 250, speed: 230, shotSpeed: 1015, pickupRadius: 225, choiceCount: 5 });
  const max = Object.fromEntries(REWARD_IDS.map((id) => [id, REWARDS[id].maxStacks]));
  assert.deepEqual(max, { damage: Infinity, attackSpeed: 5, maxHp: Infinity, moveSpeed: Infinity, shotSpeed: 3,
    pickupRadius: 5, choices: 2, heal: Infinity, soulHarvest: Infinity });
});

test('class stat rewards add a percentage of the class starting value per stack, without compounding or a cap', () => {
  const stats = (character, id, count) => {
    const stacks = emptyStacks();
    stacks[id] = count;
    return { ...statsFor(stacks, character), maxHp: maxHpFor(stacks, character) };
  };
  // 워록(공격력 10, 공격 간격 500, 이동속도 230, 체력 100): 공격력 +20%, 체력·이동속도 +10%, 공격 간격 −10%.
  assert.equal(stats('warlock', 'damage', 1).damage, 12);
  assert.equal(stats('warlock', 'damage', 50).damage, 110);
  assert.equal(stats('warlock', 'moveSpeed', 1).speed, 253);
  assert.equal(stats('warlock', 'moveSpeed', 20).speed, 690);
  assert.equal(stats('warlock', 'attackSpeed', 1).attackMs, 450);
  assert.equal(stats('warlock', 'attackSpeed', 5).attackMs, 250);
  assert.equal(stats('warlock', 'maxHp', 1).maxHp, 110);
  assert.equal(stats('warlock', 'maxHp', 15).maxHp, 250);
  // 데스 나이트(공격력 16, 공격 간격 800, 이동속도 250, 체력 160)는 같은 비율을 자기 시작값에 적용한다. 정수로 반올림한다.
  assert.equal(stats('deathKnight', 'damage', 1).damage, 19);
  assert.equal(stats('deathKnight', 'damage', 2).damage, 22);
  // 복리가 아니다: 10중첩은 16 × 3 = 48이다(복리면 16 × 1.2^10 ≈ 99).
  assert.equal(stats('deathKnight', 'damage', 10).damage, 48);
  assert.equal(stats('deathKnight', 'moveSpeed', 1).speed, 275);
  assert.equal(stats('deathKnight', 'attackSpeed', 1).attackMs, 720);
  assert.equal(stats('deathKnight', 'attackSpeed', 5).attackMs, 400);
  assert.equal(stats('deathKnight', 'maxHp', 1).maxHp, 176);
  assert.equal(stats('deathKnight', 'maxHp', 3).maxHp, 208);
});

test('level-up rewards have the designed tiers and tier weights, and boss rewards have no tier', () => {
  const tiers = Object.fromEntries([...REWARD_IDS, ...SKILL_IDS].map((id) => [id, REWARDS[id].tier]));
  assert.deepEqual(tiers, {
    damage: 'common', maxHp: 'common', moveSpeed: 'common', shotSpeed: 'common', heal: 'common',
    attackSpeed: 'uncommon', pickupRadius: 'uncommon', bloodThirst: 'uncommon',
    corpseBoost: 'uncommon', legion: 'uncommon',
    choices: 'rare', soulHarvest: 'rare', multiShot: 'rare', explosion: 'rare', swingRange: 'rare', plague: 'rare',
    homing: 'epic', surgeTuning: 'epic', bloodFrenzy: 'epic', deathLord: 'epic', contagion: 'epic', corpseBlast: 'epic',
  });
  assert.deepEqual(Object.fromEntries(Object.entries(REWARD_TIERS).map(([tier, { name, weight }]) => [tier, [name, weight]])),
    { common: ['커먼', 1], uncommon: ['언커먼', 0.6], rare: ['레어', 0.3], epic: ['에픽', 0.1] });
  // 특수 특기는 모두 에픽이다.
  for (const id of SKILL_IDS) assert.equal(REWARDS[id].special === true, REWARDS[id].tier === 'epic', id);
  for (const id of BOSS_REWARD_IDS) {
    assert.equal(REWARDS[id].tier, undefined, id);
    assert.equal(rewardWeight(id), 1, id);
  }
});

test('choices are drawn by tier weight: each candidate owns a slice of the total weight', () => {
  // 후보 [공격력(커먼 1), 공격 속도(언커먼 0.6), 선택지 추가(레어 0.3), 다중 시전(레어 0.3), 추적 마탄(에픽 0.1)]: 합 2.3.
  const pool = ['damage', 'attackSpeed', 'choices', 'multiShot', 'homing'];
  const pick = (roll) => rollChoices(emptyStacks(), 1, () => roll / 2.3, pool)[0];
  assert.equal(pick(0.99), 'damage');
  assert.equal(pick(1.01), 'attackSpeed');
  assert.equal(pick(1.59), 'attackSpeed');
  assert.equal(pick(1.61), 'choices');
  assert.equal(pick(1.89), 'choices');
  assert.equal(pick(1.91), 'multiShot');
  assert.equal(pick(2.19), 'multiShot');
  assert.equal(pick(2.21), 'homing');
  // 많이 뽑으면 등급 가중치에 비례한다. 고정 난수 2만 회이며, 허용 오차 ±1%p는 가장 큰 표본 표준편차(약 0.35%p)의 약 3배다.
  const random = seeded(11), counts = Object.fromEntries(pool.map((id) => [id, 0]));
  for (let i = 0; i < 20000; i++) counts[rollChoices(emptyStacks(), 1, random, pool)[0]]++;
  for (const id of pool) assert.ok(Math.abs(counts[id] / 20000 - rewardWeight(id) / 2.3) < 0.01, `${id} ${counts[id]}`);
});

test('choices are unique, sized by the choice count, and reproducible with a fixed random source', () => {
  for (let seed = 1; seed <= 50; seed++) {
    for (const choiceStacks of [0, 1, 2]) {
      const stacks = emptyStacks();
      stacks.choices = choiceStacks;
      const count = statsFor(stacks).choiceCount;
      const picked = rollChoices(stacks, count, seeded(seed));
      assert.equal(picked.length, BASE_CHOICES + choiceStacks);
      assert.equal(new Set(picked).size, picked.length);
      assert.deepEqual(rollChoices(stacks, count, seeded(seed)), picked);
    }
  }
  // 난수가 1에 가까워도 범위를 벗어나지 않는다.
  assert.equal(rollChoices(emptyStacks(), 3, () => 0.9999999999).length, 3);
});

test('maxed rewards are never offered while uncapped rewards and heal always remain as candidates', () => {
  const unlimited = ['damage', 'maxHp', 'moveSpeed', 'heal', 'soulHarvest'];
  const stacks = maxed();
  stacks.attackSpeed = REWARDS.attackSpeed.maxStacks - 1;
  for (let seed = 1; seed <= 30; seed++) {
    assert.deepEqual(new Set(rollChoices(stacks, 6, seeded(seed))), new Set(['attackSpeed', ...unlimited]));
  }
  assert.deepEqual(new Set(rollChoices(maxed(), 6, seeded(3))), new Set(unlimited));
  const veteran = maxed();
  for (const id of ['damage', 'maxHp', 'moveSpeed', 'soulHarvest']) veteran[id] = 1000;
  assert.deepEqual(new Set(rollChoices(veteran, 5, seeded(4))), new Set(unlimited));
  const almost = emptyStacks();
  almost.attackSpeed = REWARDS.attackSpeed.maxStacks;
  for (let seed = 1; seed <= 30; seed++) assert.ok(!rollChoices(almost, 5, seeded(seed)).includes('attackSpeed'));
});
