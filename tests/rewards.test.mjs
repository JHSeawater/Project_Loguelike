import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CHOICES, REWARDS, REWARD_IDS, emptyStacks, rollChoices, statsFor } from '../src/rewards.ts';

const seeded = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const maxed = () => {
  const stacks = emptyStacks();
  for (const id of REWARD_IDS) if (Number.isFinite(REWARDS[id].maxStacks)) stacks[id] = REWARDS[id].maxStacks;
  return stacks;
};

test('base stats match the fixed player values and max stacks match the design table', () => {
  assert.deepEqual(statsFor(emptyStacks()),
    { damage: 10, attackMs: 500, speed: 250, shotSpeed: 700, pickupRadius: 100, choiceCount: 3 });
  assert.deepEqual(statsFor(maxed()),
    { damage: 30, attackMs: 250, speed: 375, shotSpeed: 1015, pickupRadius: 225, choiceCount: 5 });
  const max = Object.fromEntries(REWARD_IDS.map((id) => [id, REWARDS[id].maxStacks]));
  assert.deepEqual(max, { damage: 10, attackSpeed: 5, maxHp: 10, moveSpeed: 5, shotSpeed: 3,
    pickupRadius: 5, choices: 2, heal: Infinity });
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

test('maxed rewards are never offered and heal always remains as a candidate', () => {
  const stacks = maxed();
  stacks.moveSpeed = REWARDS.moveSpeed.maxStacks - 1;
  for (let seed = 1; seed <= 30; seed++) {
    assert.deepEqual(new Set(rollChoices(stacks, 5, seeded(seed))), new Set(['moveSpeed', 'heal']));
  }
  assert.deepEqual(rollChoices(maxed(), 5, seeded(3)), ['heal']);
  const almost = emptyStacks();
  almost.damage = REWARDS.damage.maxStacks;
  for (let seed = 1; seed <= 30; seed++) assert.ok(!rollChoices(almost, 5, seeded(seed)).includes('damage'));
});
