import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle, createEnemy, hpPercentAt, pickSpawnKind, stageAt } from '../src/battle.ts';
import { BATTLE_CONFIG as CFG, ENEMY_STATS } from '../src/battle-config.ts';
import { center, contains, expand, overlaps } from '../src/battle-geometry.ts';
import { dungeonObstacles } from '../src/dungeon-layout.ts';

// 플레이어(중심 1500,1500) 주변을 비추는 고정 카메라.
const VIEW = { x: 860, y: 1140, width: 1280, height: 720 };
const stillView = () => VIEW;
const step = (battle, ms, size = 20) => {
  for (let remaining = ms; remaining > 0; remaining -= size) battle.update(Math.min(size, remaining), { x: 0, y: 0 }, stillView);
};
const seeded = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
// 적이 대상을 찾지 못해 제자리에 있도록 플레이어를 공격 불가로 둔다. 데스 나이트는 반경 100px 밖의 적을 공격하지 않는다.
const quietBattle = (options = {}) => {
  const battle = new Battle(options.obstacles ?? [], { character: 'deathKnight', random: seeded(options.seed ?? 7), spawning: options.spawning ?? true });
  battle.player.attackable = false;
  return battle;
};
// 지정한 생성 패턴만 남긴다. 테스트 준비를 위해 내부 예약 시각을 직접 조정한다.
const only = (battle, keep) => {
  if (keep !== 'regular') battle['nextSpawnAt'] = Infinity;
  if (keep !== 'group') battle['nextGroupAt'] = Infinity;
  if (keep !== 'ring') battle['nextRingAt'] = Infinity;
  return battle;
};
const legalSpawn = (battle, enemy, view = VIEW) => {
  assert.ok(contains(CFG.world, enemy), 'inside world');
  assert.ok(!overlaps(enemy, expand(view, CFG.spawnMargin)), 'outside view and margin');
  assert.ok(battle['obstacles'].every((obstacle) => !overlaps(enemy, obstacle)), 'outside obstacles');
  assert.ok(battle.enemies.every((other) => other === enemy || !overlaps(enemy, other)), 'no overlap');
};

test('spawn stages switch exactly at their boundaries with the documented values', () => {
  const table = [
    [0, 1000, 1, 30], [60_000, 900, 1, 40], [120_000, 1200, 2, 50], [180_000, 1200, 2, 50],
    [240_000, 1000, 2, 60], [360_000, 800, 3, 70], [480_000, 700, 3, 80], [600_000, 600, 4, 90],
  ];
  const values = (stage) => [stage.at, stage.everyMs, stage.count, stage.max];
  table.forEach((row, i) => {
    assert.deepEqual(values(stageAt(row[0])), row, `at ${row[0]}`);
    assert.deepEqual(values(stageAt(row[0] + 50)), row, `after ${row[0]}`);
    if (i > 0) assert.deepEqual(values(stageAt(row[0] - 50)), table[i - 1], `before ${row[0]}`);
  });
  assert.deepEqual(values(stageAt(3_600_000)), table.at(-1));
});

test('spawn kinds unlock by stage, follow the weights, and never include zealots', () => {
  // 0:00 단계는 병사 4 : 궁사 2. 누적 가중치 6에서 4 미만은 병사, 4 이상은 궁사다.
  assert.equal(pickSpawnKind(0, () => 3.9 / 6), 'soldier');
  assert.equal(pickSpawnKind(0, () => 4.1 / 6), 'archer');
  // 1:00 단계는 병사 4, 궁사 2, 기사 2, 마법사 2(합 10).
  assert.equal(pickSpawnKind(60_000, () => 0.65), 'knight');
  assert.equal(pickSpawnKind(60_000, () => 0.95), 'mage');
  const kindsAt = (time) => new Set(Array.from({ length: 2000 }, (_, i) => pickSpawnKind(time, () => i / 2000)));
  assert.deepEqual(kindsAt(59_999), new Set(['soldier', 'archer']));
  assert.deepEqual(kindsAt(119_999), new Set(['soldier', 'archer', 'knight', 'mage']));
  assert.deepEqual(kindsAt(120_000), new Set(['soldier', 'archer', 'knight', 'mage', 'paladin']));
  assert.ok(!kindsAt(179_999).has('crossbowman'));
  assert.ok(kindsAt(180_000).has('crossbowman'));
  assert.ok(!kindsAt(239_999).has('priest'));
  assert.deepEqual(kindsAt(240_000), new Set(['soldier', 'archer', 'knight', 'mage', 'paladin', 'crossbowman', 'priest']));
  assert.ok(!kindsAt(3_600_000).has('zealot'));
  // 난수가 1에 가까워도 범위를 벗어나지 않는다.
  assert.equal(pickSpawnKind(240_000, () => 0.9999999999), 'priest');
});

test('regular spawns follow the stage interval and count across a boundary', () => {
  const battle = only(quietBattle(), 'regular');
  battle.time = 59_000;
  step(battle, 20);
  assert.equal(battle.enemies.length, 1);
  // 다음 생성은 59.02초 + 1.0초 = 60.02초. 그 사이 1:00 단계(0.9초)가 시작된다.
  step(battle, 980);
  assert.equal(battle.enemies.length, 1);
  step(battle, 20);
  assert.equal(battle.enemies.length, 2);
  step(battle, 880);
  assert.equal(battle.enemies.length, 2);
  step(battle, 20);
  assert.equal(battle.enemies.length, 3);
  // 2:00 단계에서는 한 번에 2마리다.
  const pair = only(quietBattle(), 'regular');
  pair.time = 130_000;
  step(pair, 20);
  assert.equal(pair.enemies.length, 2);
  for (const enemy of pair.enemies) legalSpawn(pair, enemy);
});

test('spawns stop at the stage maximum even when one batch would exceed it', () => {
  const battle = only(quietBattle(), 'regular');
  battle.time = 130_000;
  // 화면 밖 왼쪽 위에 49마리를 미리 둔다. 2:00 단계 최대는 50, 한 번에 2마리다.
  for (let i = 0; i < 49; i++) battle.enemies.push(createEnemy(1000 + i, 'soldier', 60 + i % 7 * 50, 60 + Math.floor(i / 7) * 50));
  step(battle, 20);
  assert.equal(battle.enemies.length, 50);
  step(battle, 3000);
  assert.equal(battle.enemies.length, 50);
});

test('zealot groups of five appear every 30s from 2:00 around one off-screen point', () => {
  const battle = only(quietBattle(), 'group');
  battle['nextGroupAt'] = 120_000;
  battle.time = 119_960;
  step(battle, 20);
  assert.equal(battle.enemies.length, 0);
  step(battle, 20);
  const zealots = battle.enemies.filter((enemy) => enemy.kind === 'zealot');
  assert.equal(zealots.length, 5);
  const leader = center(zealots[0]);
  for (const zealot of zealots) {
    assert.deepEqual([zealot.width, zealot.height], [30, 30]);
    legalSpawn(battle, zealot);
    // 무리는 첫 광신도 중심에서 ±90px 범위 안에 놓인다.
    assert.ok(Math.abs(center(zealot).x - leader.x) <= 90 && Math.abs(center(zealot).y - leader.y) <= 90);
  }
  // 120.00초 → 149.98초에는 아직 없고, 150.00초에 다음 무리가 나온다.
  step(battle, 29_980);
  assert.equal(battle.enemies.length, 5);
  step(battle, 20);
  assert.equal(battle.enemies.length, 10);
});

test('zealot groups keep every spawn rule on the real map', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const battle = only(quietBattle({ obstacles: dungeonObstacles, seed }), 'group');
    battle['nextGroupAt'] = 120_000;
    battle.time = 119_980;
    step(battle, 20);
    assert.ok(battle.enemies.length >= 1 && battle.enemies.length <= 5);
    for (const enemy of battle.enemies) legalSpawn(battle, enemy);
  }
});

test('encircling waves place 16 soldiers around the view from 2:30 and every 2:30 after', () => {
  const battle = only(quietBattle(), 'ring');
  battle['nextRingAt'] = 150_000;
  battle.time = 149_960;
  step(battle, 20);
  assert.equal(battle.enemies.length, 0);
  step(battle, 20);
  assert.equal(battle.enemies.length, 16);
  assert.ok(battle.enemies.every((enemy) => enemy.kind === 'soldier'));
  const middle = center(VIEW);
  const quadrants = [0, 0, 0, 0];
  for (const enemy of battle.enemies) {
    legalSpawn(battle, enemy);
    // 22.5° 간격이므로 11.25°씩 돌려 나누면 각 사분면에 정확히 4마리씩 들어간다.
    const angle = (Math.atan2(center(enemy).y - middle.y, center(enemy).x - middle.x) * 180 / Math.PI + 360 + 11.25) % 360;
    quadrants[Math.floor(angle / 90)]++;
    // 화면 밖 여유 거리 바로 바깥(1px)에 붙어 있다.
    const gap = Math.max(VIEW.x - CFG.spawnMargin - (enemy.x + enemy.width), enemy.x - (VIEW.x + VIEW.width + CFG.spawnMargin),
      VIEW.y - CFG.spawnMargin - (enemy.y + enemy.height), enemy.y - (VIEW.y + VIEW.height + CFG.spawnMargin));
    assert.ok(gap > 0 && gap < 2, `gap ${gap}`);
  }
  assert.deepEqual(quadrants, [4, 4, 4, 4]);
  // 다음 웨이브는 5:00, 그다음은 7:30이다. 그 사이에는 다시 나오지 않는다.
  step(battle, 10_000);
  assert.equal(battle.enemies.length, 16);
  for (const due of [300_000, 450_000]) {
    // 앞 웨이브의 적을 치워 같은 자리에 다시 놓을 수 있게 한다.
    battle.enemies = [];
    battle.time = due - 40;
    step(battle, 20);
    assert.equal(battle.enemies.length, 0, `before ${due}`);
    step(battle, 20);
    assert.equal(battle.enemies.length, 16, `at ${due}`);
  }
});

test('encircling waves skip blocked directions at the world corner and on the real map', () => {
  const corner = { x: 0, y: 0, width: 1280, height: 720 };
  const battle = only(new Battle([], { random: seeded(3) }), 'ring');
  battle.player.attackable = false;
  battle['nextRingAt'] = 150_000;
  battle.time = 149_980;
  battle.update(20, { x: 0, y: 0 }, () => corner);
  assert.ok(battle.enemies.length > 0 && battle.enemies.length < 16);
  for (const enemy of battle.enemies) legalSpawn(battle, enemy, corner);
  const mapped = only(quietBattle({ obstacles: dungeonObstacles }), 'ring');
  mapped['nextRingAt'] = 150_000;
  mapped.time = 149_980;
  step(mapped, 20);
  for (const enemy of mapped.enemies) legalSpawn(mapped, enemy);
});

test('enemy health grows 10% per minute after 10:00, fixed at spawn time', () => {
  assert.deepEqual([0, 599_999, 600_000, 659_999, 660_000, 720_000, 1_200_000].map(hpPercentAt), [100, 100, 100, 100, 110, 120, 200]);
  // 병사 25 × 110% = 27.5 → 반올림 28, 광신도 12 × 110% = 13.2 → 13.
  assert.deepEqual([createEnemy(1, 'soldier', 0, 0, 0, 110).hp, createEnemy(2, 'zealot', 0, 0, 0, 110).hp], [28, 13]);
  const battle = only(quietBattle(), 'regular');
  battle.time = 659_000;
  step(battle, 20);
  const early = battle.enemies.map((enemy) => [enemy, enemy.hp]);
  assert.ok(early.length > 0 && early.every(([enemy, hp]) => hp === ENEMY_STATS[enemy.kind].hp));
  battle.time = 660_000;
  battle['nextSpawnAt'] = 0;
  step(battle, 20);
  const late = battle.enemies.filter((enemy) => !early.some(([old]) => old === enemy));
  assert.ok(late.length > 0 && late.every((enemy) => enemy.hp === Math.round(ENEMY_STATS[enemy.kind].hp * 1.1) && enemy.maxHp === enemy.hp));
  assert.ok(early.every(([enemy, hp]) => enemy.hp === hp));
});

// 사제(중심 1700,1500)는 플레이어(중심 1500,1500)에서 200px로 사거리 240px 안이라 움직이지 않는다.
// 회복 대상 궁사는 사제 바로 위, 아래쪽 면까지 160 + gap 거리에 둔다. 플레이어까지 약 269px로 궁사 사거리 안이라 움직이지 않는다.
const priestScene = (gap, frame = 20) => {
  const battle = new Battle([], { character: 'deathKnight', spawning: false });
  battle.player.hp = battle.player.maxHp = 100000;
  const priest = createEnemy(100, 'priest', 1680, 1480);
  const archer = createEnemy(101, 'archer', 1680, 1300 - gap);
  archer.hp = 1; archer.maxHp = 100000;
  battle.enemies.push(priest, archer);
  return { battle, priest, archer, frame };
};

test('priests heal other enemies touching the 160px radius by 10, never themselves or past max', () => {
  const heal = (gap) => {
    const { battle, archer } = priestScene(gap);
    step(battle, 20);
    return archer.hp - 1;
  };
  assert.equal(heal(-0.5), 10);
  assert.equal(heal(0), 10);
  assert.equal(heal(0.5), 0);
  const { battle, priest, archer } = priestScene(0);
  priest.hp = 5;
  archer.hp = 99_995;
  step(battle, 20);
  assert.equal(priest.hp, 5);
  assert.equal(archer.hp, 100000);
  assert.ok(battle.effects.some((effect) => effect.kind === 'heal'));
});

test('priests heal every 3s regardless of frame size and never attack', () => {
  for (const frame of [20, 100]) {
    const { battle, archer } = priestScene(0, frame);
    const before = battle.player.hp;
    for (let t = 0; t < 7000; t += frame) battle.update(frame, { x: 0, y: 0 }, stillView);
    // 첫 단계, 3초 뒤, 6초 뒤: 7초 동안 3번 회복한다.
    assert.equal(archer.hp, 1 + 30, `${frame}ms frames`);
    assert.ok(battle.projectiles.every((shot) => shot.color !== ENEMY_STATS.priest.color));
    assert.ok(before - battle.player.hp <= ENEMY_STATS.archer.damage * 2, 'only the archer deals damage');
  }
  const battle = new Battle([], { character: 'deathKnight', spawning: false });
  const priest = createEnemy(100, 'priest', 1980, 1480);
  battle.enemies.push(priest);
  step(battle, 5000);
  const distance = Math.hypot(center(priest).x - 1500, center(priest).y - 1500);
  // 이동속도 85px/초, 단계당 최대 4.25px이므로 240px 직전 4.25px 안에서 멈춘다.
  assert.ok(distance <= 240 && distance > 240 - 4.25, `stopped at ${distance}`);
  assert.equal(battle.player.hp, battle.player.maxHp);
});

test('crossbowmen shoot faster, stronger bolts than archers every 6s within 320px', () => {
  const shots = (kind, x) => {
    const battle = new Battle([], { character: 'deathKnight', spawning: false });
    battle.player.hp = battle.player.maxHp = 100000;
    battle.enemies.push(createEnemy(100, kind, x, 1480));
    const seen = new Map();
    for (let t = 0; t < 13_000; t += 20) {
      step(battle, 20);
      for (const shot of battle.projectiles) if (shot.team === 'enemy') seen.set(shot.id, shot);
    }
    return [...seen.values()];
  };
  const bolts = shots('crossbowman', 1780);
  assert.equal(bolts.length, 3);
  assert.ok(bolts.every((bolt) => Math.abs(Math.hypot(bolt.vx, bolt.vy) - 500) < 1e-9 && bolt.damage === 15));
  const arrows = shots('archer', 1720);
  assert.ok(arrows.every((arrow) => Math.abs(Math.hypot(arrow.vx, arrow.vy) - 280) < 1e-9 && arrow.damage === 5));
  // 320px 밖에서는 쏘지 않고 다가온다.
  const battle = new Battle([], { character: 'deathKnight', spawning: false });
  const far = createEnemy(100, 'crossbowman', 1830, 1480);
  battle.enemies.push(far);
  step(battle, 20);
  assert.equal(battle.projectiles.length, 0);
  assert.ok(far.x < 1830);
});

test('half-point orbs from zealots and priests add up exactly, also with soul harvest', () => {
  const collect = (values, harvest = 0) => {
    const battle = new Battle([], { spawning: false });
    battle.player.attackable = false;
    for (let i = 0; i < harvest; i++) battle.applyReward('soulHarvest');
    values.forEach((value, i) => {
      const point = center(battle.player);
      battle.orbs.push({ id: i + 1, x: point.x - 6, y: point.y - 6, width: 12, height: 12, value, pulled: false });
      step(battle, 20);
      battle.choices = [];
    });
    return battle.experience + (battle.level > 1 ? 5 : 0);
  };
  assert.equal(collect([0.5]), 0);
  assert.equal(collect([0.5, 0.5]), 1);
  assert.equal(collect([2.5, 2.5]), 5);
  // 영혼 흡수 1중첩: 0.5 × 110% = 0.55씩. 2개면 1.1이므로 1이다.
  assert.equal(collect([0.5, 0.5], 1), 1);
  assert.deepEqual([ENEMY_STATS.zealot.exp, ENEMY_STATS.crossbowman.exp, ENEMY_STATS.priest.exp], [0.5, 2, 2.5]);
});
