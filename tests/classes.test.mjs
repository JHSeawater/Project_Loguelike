import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle, circleTouches, createEnemy } from '../src/battle.ts';
import { BATTLE_CONFIG as CFG, CHARACTER_STATS, SKILL_CONFIG as SKILL } from '../src/battle-config.ts';
import { center } from '../src/battle-geometry.ts';
import { REWARDS, REWARD_IDS, emptyStacks, maxHpFor, rewardPool, rollChoices, skillStatsFor, statsFor } from '../src/rewards.ts';

// 플레이어(1480,1480, 40×40, 중심 1500,1500) 주변을 비추는 고정 카메라.
const stillView = () => ({ x: 860, y: 1140, width: 1280, height: 720 });
const step = (battle, ms, size = 20, input = { x: 0, y: 0 }) => {
  for (let remaining = ms; remaining > 0; remaining -= size) battle.update(Math.min(size, remaining), input, stillView);
};
// 적이 대상을 찾지 못해 제자리에 있도록 플레이어를 공격 불가로 둔다. 플레이어의 공격에는 영향이 없다.
const frozenBattle = (character, obstacles = []) => {
  const battle = new Battle(obstacles, { spawning: false, character });
  battle.player.attackable = false;
  return battle;
};
const tough = (id, kind, x, y, hp = 100000) => {
  const enemy = createEnemy(id, kind, x, y);
  enemy.hp = enemy.maxHp = hp;
  return enemy;
};
const orbAt = (id, cx, cy, value) => ({ id, x: cx - CFG.expOrb.size / 2, y: cy - CFG.expOrb.size / 2,
  width: CFG.expOrb.size, height: CFG.expOrb.size, value, pulled: false });
const degrees = (shot) => Math.atan2(shot.vy, shot.vx) * 180 / Math.PI;

test('each class starts from its own stats and the warlock keeps the original values', () => {
  const warlock = new Battle([], { spawning: false });
  assert.equal(warlock.character, 'warlock');
  assert.deepEqual([warlock.player.hp, warlock.player.maxHp, warlock.player.width], [100, 100, 40]);
  assert.deepEqual(statsFor(emptyStacks(), 'warlock'),
    { damage: 10, attackMs: 500, speed: 250, shotSpeed: 700, pickupRadius: 100, choiceCount: 3 });
  const knight = new Battle([], { spawning: false, character: 'deathKnight' });
  assert.deepEqual([knight.player.hp, knight.player.maxHp, knight.player.width], [140, 140, 40]);
  assert.deepEqual(statsFor(emptyStacks(), 'deathKnight'),
    { damage: 14, attackMs: 800, speed: 230, shotSpeed: 700, pickupRadius: 100, choiceCount: 3 });
  assert.deepEqual(skillStatsFor(emptyStacks(), 'deathKnight'),
    { shots: 1, explosionRadius: 0, expPercent: 100, homing: false, swingRadius: 100, killHeal: 1 });
});

test('reward pools mix common rewards with only the class skills and drop excluded rewards', () => {
  assert.deepEqual(rewardPool('warlock'), [...REWARD_IDS, 'multiShot', 'explosion', 'soulHarvest', 'homing']);
  assert.deepEqual(rewardPool('deathKnight'),
    [...REWARD_IDS.filter((id) => id !== 'shotSpeed'), 'swingRange', 'bloodThirst', 'deathLord']);
  for (const character of ['warlock', 'deathKnight']) {
    const pool = new Set(rewardPool(character));
    for (let seed = 1; seed <= 40; seed++) {
      let state = seed;
      const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
      for (const id of rollChoices(emptyStacks(), 5, random, rewardPool(character))) assert.ok(pool.has(id), `${character}: ${id}`);
    }
  }
});

test('special skills use a 0.1 weight, appear at most once, and infinite skills never run out', () => {
  // 후보 [공격력(1), 추적 마탄(0.1)]: 누적 가중치 1.1에서 1 미만은 공격력, 1 이상은 추적 마탄이다.
  const pool = ['damage', 'homing'];
  assert.deepEqual(rollChoices(emptyStacks(), 1, () => 0.9 / 1.1, pool), ['damage']);
  assert.deepEqual(rollChoices(emptyStacks(), 1, () => 0.99 / 1.1, pool), ['damage']);
  assert.deepEqual(rollChoices(emptyStacks(), 1, () => 1.01 / 1.1, pool), ['homing']);
  assert.deepEqual(rollChoices(emptyStacks(), 1, () => 1.09 / 1.1, pool), ['homing']);
  const owned = emptyStacks();
  owned.homing = 1;
  assert.deepEqual(rollChoices(owned, 3, () => 0.99, pool), ['damage']);
  assert.equal(REWARDS.homing.maxStacks, 1);
  assert.equal(REWARDS.deathLord.maxStacks, 1);
  const veteran = emptyStacks();
  for (const id of ['multiShot', 'explosion', 'soulHarvest']) veteran[id] = 1000;
  assert.deepEqual(new Set(rollChoices(veteran, 5, () => 0, ['multiShot', 'explosion', 'soulHarvest'])),
    new Set(['multiShot', 'explosion', 'soulHarvest']));
});

test('surge boosts warlock damage, speed and attack rate for 5s after a choice, without stacking', () => {
  const battle = frozenBattle('warlock');
  const player = center(battle.player);
  battle.orbs.push(orbAt(1, player.x, player.y, 5));
  step(battle, 20);
  assert.equal(battle.choices.length, 3);
  battle.choices = ['heal'];
  battle.choose(0);
  assert.equal(battle.surgeUntil, battle.time + SKILL.surge.durationMs);
  assert.deepEqual([battle.currentStats().damage, battle.currentStats().speed, battle.currentStats().attackMs], [12, 300, 400]);
  const start = battle.player.x;
  step(battle, 1000, 20, { x: 1, y: 0 });
  assert.ok(Math.abs(battle.player.x - start - 300) < 1e-9);
  // 끝나는 시점에 정확히 원래 값으로 돌아간다.
  step(battle, SKILL.surge.durationMs - 1000 - 20);
  assert.equal(battle.currentStats().damage, 12);
  step(battle, 20);
  assert.deepEqual([battle.currentStats().damage, battle.currentStats().speed, battle.currentStats().attackMs], [10, 250, 500]);
  const knight = frozenBattle('deathKnight');
  knight.orbs.push(orbAt(2, center(knight.player).x, center(knight.player).y, 5));
  step(knight, 20);
  knight.choices = ['heal'];
  knight.choose(0);
  assert.equal(knight.surgeUntil, -Infinity);
});

test('surged warlock shots carry the boosted damage and fire every 0.4s', () => {
  const battle = frozenBattle('warlock');
  battle.enemies.push(tough(100, 'paladin', 1700, 1440));
  battle.surgeUntil = 2000;
  const ids = new Set();
  for (let t = 0; t < 1000; t += 20) {
    step(battle, 20);
    for (const shot of battle.projectiles) ids.add(shot.id);
  }
  // 첫 발 20ms, 이후 0.4초 간격: 20·420·820ms의 3발. 기본 0.5초라면 2발이다.
  assert.equal(ids.size, 3);
  assert.equal(battle.projectiles[0].damage, 12);
});

test('multi cast fans shots 10° apart and squeezes them into 60° once more shots are added', () => {
  const fan = (stacks) => {
    const battle = frozenBattle('warlock');
    for (let i = 0; i < stacks; i++) battle.applyReward('multiShot');
    battle.enemies.push(tough(100, 'paladin', 1900, 1440));
    step(battle, 20);
    return battle.projectiles.map(degrees).sort((a, b) => a - b);
  };
  assert.deepEqual(fan(0).map(Math.round), [0]);
  // 허용 오차 1e-9°: 회전 계산의 부동소수점 오차 범위.
  const near = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-9, `${value} vs ${expected[i]}`));
  // fan(n)은 다중 시전 n중첩, 즉 n + 1발이다.
  near(fan(1), [-5, 5]);
  near(fan(2), [-10, 0, 10]);
  near(fan(5), [-25, -15, -5, 5, 15, 25]);
  near(fan(7), [-30, -30 + 60 / 7, -30 + 120 / 7, -30 + 180 / 7, 30 - 180 / 7, 30 - 120 / 7, 30 - 60 / 7, 30]);
  // 부채꼴로 나간 투사체도 각각 비관통이며 같은 공격력을 가진다.
  const battle = frozenBattle('warlock');
  battle.applyReward('multiShot'); battle.applyReward('multiShot');
  const enemy = tough(100, 'paladin', 1560, 1440);
  battle.enemies.push(enemy);
  step(battle, 200);
  assert.equal(enemy.hp, 100000 - 30);
});

// 화면 밖 성기사(2500,2000, 80×120)의 왼쪽 판정 경계 x=2496에 y=2050으로 닿는 투사체. 폭발 중심은 (2496, 2050)이다.
// 자동 공격의 영향을 받지 않도록 적을 화면 밖에 두고 투사체를 직접 넣는다.
const shotAtPaladin = (battle) => {
  battle.projectiles.push({ id: 900, team: 'ally', x: 2396, y: 2046, width: 8, height: 8,
    vx: 700, vy: 0, damage: 10, color: 0, expiresAt: 4000 });
};

test('explosions splash 50% damage onto other bodies touching the radius, through obstacles', () => {
  // 주변 병사는 폭발 중심 바로 아래에 있다(가로 2456~2496). 위쪽 면까지의 세로 거리 = distance.
  const run = (distance, obstacles = []) => {
    const battle = frozenBattle('warlock', obstacles);
    battle.applyReward('explosion');
    const primary = tough(100, 'paladin', 2500, 2000);
    const neighbor = tough(101, 'soldier', 2456, 2050 + distance);
    battle.enemies.push(primary, neighbor);
    shotAtPaladin(battle);
    step(battle, 400);
    return { primary: 100000 - primary.hp, neighbor: 100000 - neighbor.hp, effects: battle.effects };
  };
  assert.deepEqual([run(10).primary, run(10).neighbor], [10, 5]);
  // 반경 20px: 몸체 가장자리가 정확히 20px이면 포함, 20.5px이면 제외한다.
  assert.equal(run(20).neighbor, 5);
  assert.equal(run(20.5).neighbor, 0);
  assert.equal(run(10, [{ x: 2400, y: 2055, width: 120, height: 3 }]).neighbor, 5);
  assert.ok(circleTouches({ x: 0, y: 0 }, 20, { x: 20, y: -5, width: 10, height: 10 }));
  assert.ok(!circleTouches({ x: 0, y: 0 }, 20, { x: 20.5, y: -5, width: 10, height: 10 }));
  // 폭발이 없으면 주변 적은 피해가 없다.
  const plain = frozenBattle('warlock');
  const neighbor = tough(101, 'soldier', 2456, 2060);
  plain.enemies.push(tough(100, 'paladin', 2500, 2000), neighbor);
  shotAtPaladin(plain);
  step(plain, 400);
  assert.equal(neighbor.hp, 100000);
});

test('explosion kills count once and drop exactly one orb each', () => {
  const battle = frozenBattle('warlock');
  for (let i = 0; i < 3; i++) battle.applyReward('explosion');
  // 반경 60px 안, 투사체 경로(y=2050) 위아래에 체력 5의 궁사 둘을 둔다.
  const weak = [createEnemy(101, 'archer', 2456, 1990), createEnemy(102, 'archer', 2456, 2070)];
  for (const enemy of weak) enemy.hp = 5;
  battle.enemies.push(tough(100, 'paladin', 2500, 2000), ...weak);
  shotAtPaladin(battle);
  step(battle, 400);
  assert.equal(battle.kills, 2);
  assert.equal(battle.orbs.length, 2);
  assert.ok(weak.every((enemy) => enemy.hp === 0));
});

test('soul harvest multiplies experience exactly and carries the fraction to later orbs', () => {
  const collect = (stacks, values) => {
    const battle = frozenBattle('warlock');
    for (let i = 0; i < stacks; i++) battle.applyReward('soulHarvest');
    const total = () => {
      let sum = battle.experience;
      for (let level = 1; level < battle.level; level++) sum += [5, 10, 15, 20, 25, 30][level - 1];
      return sum;
    };
    values.forEach((value, i) => {
      const player = center(battle.player);
      battle.orbs.push(orbAt(i + 1, player.x, player.y, value));
      step(battle, 20);
      battle.choices = [];
    });
    return total();
  };
  assert.equal(collect(0, [1, 1, 1]), 3);
  // +10%: 1이 10번이면 11, 9번이면 9.9이므로 9다.
  assert.equal(collect(1, Array(10).fill(1)), 11);
  assert.equal(collect(1, Array(9).fill(1)), 9);
  // +30%: 3 → 3.9(3, 이월 0.9) → 7.8(7). 총량은 floor(6 × 1.3) = 7이다.
  assert.equal(collect(3, [3, 3]), 7);
});

test('homing shots turn toward the nearest enemy at no more than 270° per second and keep their speed', () => {
  const battle = frozenBattle('warlock');
  battle.applyReward('homing');
  battle.projectiles.push({ id: 900, team: 'ally', x: 1496, y: 1496, width: 8, height: 8,
    vx: 700, vy: 0, damage: 10, color: 0, expiresAt: 4000, homing: true });
  battle.enemies.push(tough(100, 'paladin', 1460, 1000));
  step(battle, 20);
  const shot = battle.projectiles[0];
  // 바로 위의 적을 향해 20ms 동안 최대 5.4°만 꺾는다.
  assert.ok(Math.abs(degrees(shot) - -5.4) < 1e-9);
  assert.ok(Math.abs(Math.hypot(shot.vx, shot.vy) - 700) < 1e-9);
  step(battle, 2000);
  assert.ok(battle.enemies[0].hp < 100000);
  const plain = frozenBattle('warlock');
  plain.projectiles.push({ id: 901, team: 'ally', x: 1496, y: 1496, width: 8, height: 8,
    vx: 700, vy: 0, damage: 10, color: 0, expiresAt: 4000 });
  plain.enemies.push(tough(100, 'paladin', 1460, 1000));
  step(plain, 20);
  assert.equal(plain.projectiles[0].vy, 0);
  // 추적 마탄을 얻은 뒤 발사한 투사체에만 표시된다.
  battle.enemies[0].x = 1700; battle.enemies[0].y = 1440;
  step(battle, 100);
  assert.ok(battle.projectiles.some((item) => item.id !== 900 && item.homing));
});

test('death knight swings hit every enemy touching the 100px radius once, but not through obstacles', () => {
  const hits = (edgeGap, obstacles = []) => {
    const battle = frozenBattle('deathKnight', obstacles);
    // 플레이어 중심 1500에서 병사 왼쪽 면까지의 거리 = 100 + edgeGap.
    const target = tough(100, 'soldier', 1600 + edgeGap, 1480);
    battle.enemies.push(target);
    step(battle, 20);
    return 100000 - target.hp;
  };
  assert.equal(hits(-0.5), 14);
  assert.equal(hits(0), 14);
  assert.equal(hits(0.5), 0);
  assert.equal(hits(0, [{ x: 1550, y: 1400, width: 10, height: 200 }]), 0);
  const battle = frozenBattle('deathKnight');
  const crowd = [tough(100, 'soldier', 1420, 1480), tough(101, 'soldier', 1540, 1480), tough(102, 'soldier', 1480, 1420)];
  battle.enemies.push(...crowd);
  step(battle, 20);
  assert.deepEqual(crowd.map((enemy) => 100000 - enemy.hp), [14, 14, 14]);
  assert.equal(battle.projectiles.length, 0);
  assert.equal(battle.effects.length, 1);
});

test('death knight swings keep the 0.8s interval at different frame sizes and wait without targets', () => {
  const swings = (frame) => {
    const battle = frozenBattle('deathKnight');
    const enemy = tough(100, 'soldier', 1550, 1480);
    battle.enemies.push(enemy);
    for (let t = 0; t < 2000; t += frame) battle.update(frame, { x: 0, y: 0 }, stillView);
    return (100000 - enemy.hp) / 14;
  };
  // 첫 단계 이후 0.8초마다: 2초 동안 3번이다.
  assert.equal(swings(20), 3);
  assert.equal(swings(100), 3);
  const idle = frozenBattle('deathKnight');
  step(idle, 1000);
  const late = tough(100, 'soldier', 1550, 1480);
  idle.enemies.push(late);
  step(idle, 20);
  assert.equal(100000 - late.hp, 14);
});

test('death knight heals on each kill, more with blood thirst, never above max health', () => {
  const battle = frozenBattle('deathKnight');
  battle.player.hp = 100;
  let nextId = 100;
  const prey = () => { const enemy = createEnemy(nextId++, 'archer', 1550, 1480); enemy.hp = 14; return enemy; };
  battle.enemies.push(prey());
  step(battle, 20);
  assert.deepEqual([battle.kills, battle.player.hp], [1, 101]);
  battle.applyReward('bloodThirst'); battle.applyReward('bloodThirst');
  battle.enemies.push(prey());
  step(battle, 800);
  assert.deepEqual([battle.kills, battle.player.hp], [2, 104]);
  battle.player.hp = 139;
  battle.enemies.push(prey());
  step(battle, 800);
  assert.equal(battle.player.hp, 140);
  // 궁사 3마리의 구슬(각 1)이 하나씩만 생겼다. 획득 반경 안에 떨어지므로 획득분과 남은 구슬을 합친다.
  assert.equal(battle.experience + battle.orbs.reduce((sum, orb) => sum + orb.value, 0), 3);
});

test('death lord raises damage, speed and max health by 20% and shortens the attack interval', () => {
  const stacks = emptyStacks();
  stacks.deathLord = 1;
  assert.deepEqual(statsFor(stacks, 'deathKnight'),
    { damage: 17, attackMs: 640, speed: 276, shotSpeed: 700, pickupRadius: 100, choiceCount: 3 });
  assert.equal(maxHpFor(stacks, 'deathKnight'), 168);
  const battle = new Battle([], { spawning: false, character: 'deathKnight' });
  battle.player.hp = 100;
  battle.applyReward('deathLord');
  assert.deepEqual([battle.player.hp, battle.player.maxHp], [128, 168]);
  // 이후 최대 체력 강화도 같은 비율로 적용된다: (140 + 20) × 1.2 = 192.
  battle.applyReward('maxHp');
  assert.deepEqual([battle.player.hp, battle.player.maxHp], [152, 192]);
});

test('level-up choices for each class only come from that class pool', () => {
  for (const character of ['warlock', 'deathKnight']) {
    const pool = new Set(rewardPool(character));
    for (let seed = 1; seed <= 20; seed++) {
      let state = seed;
      const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
      const battle = new Battle([], { spawning: false, character, random });
      battle.player.attackable = false;
      const player = center(battle.player);
      battle.orbs.push(orbAt(1, player.x, player.y, 5));
      step(battle, 20);
      assert.equal(battle.choices.length, 3);
      assert.ok(battle.choices.every((id) => pool.has(id)), `${character}: ${battle.choices}`);
    }
  }
  assert.equal(CHARACTER_STATS.deathKnight.attack, 'swing');
});
