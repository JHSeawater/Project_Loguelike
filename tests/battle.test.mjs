import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle, createEnemy, nearestTarget } from '../src/battle.ts';
import { BATTLE_CONFIG as CFG, ENEMY_STATS } from '../src/battle-config.ts';
import { center, contains, edgeDistance, expand, overlaps, segmentHit } from '../src/battle-geometry.ts';
import { dungeonObstacles } from '../src/dungeon-layout.ts';

const actor = (id, x, y, size = 40) => ({ id, x, y, width: size, height: size,
  hp: 100, maxHp: 100, attackable: true, lastHitAt: -Infinity });
const viewAt = (player) => ({ x: Math.max(0, Math.min(1720, center(player).x - 640)),
  y: Math.max(0, Math.min(2280, center(player).y - 360)), width: 1280, height: 720 });
const tick = (battle, ms, input = { x: 0, y: 0 }) => {
  for (let remaining = ms; remaining > 0; remaining -= 20) battle.update(Math.min(20, remaining), input, viewAt);
};
const seeded = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

test('nearest targeting ignores dead/unattackable/out-of-view actors and has stable ties', () => {
  const source = actor(0, 100, 100);
  const left = actor(1, 50, 100), right = actor(2, 150, 100);
  assert.equal(nearestTarget(source, [right, left]).id, 1);
  assert.equal(nearestTarget(source, [left, right], undefined, 2).id, 2);
  left.hp = 0;
  assert.equal(nearestTarget(source, [left, right]).id, 2);
  right.attackable = false;
  assert.equal(nearestTarget(source, [left, right]), null);
  assert.equal(nearestTarget(source, [actor(3, 400, 100)], { x: 0, y: 0, width: 200, height: 200 }), null);
});

test('every enemy type spawns entirely outside central and edge camera views', () => {
  for (const view of [viewAt(actor(0, 1480, 1480)), { x: 0, y: 0, width: 1280, height: 720 },
    { x: 1720, y: 2280, width: 1280, height: 720 }]) {
    const battle = new Battle(dungeonObstacles, { random: seeded(117) });
    for (const kind of Object.keys(ENEMY_STATS)) {
      const enemy = battle.spawnEnemy(kind, view);
      assert.ok(enemy, kind);
      assert.ok(!overlaps(enemy, expand(view, CFG.spawnMargin)));
      assert.ok(contains(CFG.world, enemy));
      assert.ok(dungeonObstacles.every((obstacle) => !overlaps(enemy, obstacle)));
      assert.ok(battle.enemies.every((other) => other === enemy || !overlaps(enemy, other)));
    }
  }
});

test('spawn failure is deferred rather than spawning on screen or through walls', () => {
  const battle = new Battle([CFG.world], { random: seeded(17) });
  assert.equal(battle.spawnEnemy('soldier', viewAt(battle.player)), null);
  assert.equal(battle.enemies.length, 0);
  const empty = new Battle([], { random: seeded(17) });
  assert.equal(empty.spawnEnemy('soldier', { x: 0, y: 0, width: 3000, height: 3000 }), null);
});

test('enemies select the closest summon and reacquire the player when it dies', () => {
  const battle = new Battle([], { spawning: false });
  const summon = actor(1000, 1370, 1480, 24);
  const enemy = createEnemy(100, 'soldier', 1300, 1480);
  enemy.hp = 1000;
  battle.enemies.push(enemy); battle.allies.push(summon);
  tick(battle, 20);
  assert.equal(enemy.targetId, summon.id);
  summon.hp = 0;
  tick(battle, 20);
  assert.equal(enemy.targetId, battle.player.id);
});

test('automatic fire starts when a target appears, has a 500ms cooldown and continues while moving', () => {
  const battle = new Battle([], { spawning: false });
  tick(battle, 1000);
  assert.equal(battle.projectiles.length, 0);
  const enemy = createEnemy(100, 'paladin', 1950, 1480);
  battle.enemies.push(enemy);
  tick(battle, 20, { x: 0, y: 1 });
  assert.equal(battle.projectiles.filter((shot) => shot.team === 'ally').length, 1);
  const firstId = battle.projectiles[0].id;
  const velocity = { x: battle.projectiles[0].vx, y: battle.projectiles[0].vy };
  tick(battle, 480, { x: 0, y: 1 });
  assert.ok(battle.projectiles.every((shot) => shot.team !== 'ally' || shot.id === firstId));
  const first = battle.projectiles.find((shot) => shot.id === firstId);
  assert.equal(first.vx, velocity.x); assert.equal(first.vy, velocity.y);
  tick(battle, 20);
  assert.ok(battle.projectiles.some((shot) => shot.id !== firstId && shot.team === 'ally'));
  assert.ok(battle.player.y > 1480);
});

test('new auto attacks stop when target center leaves the viewport', () => {
  const battle = new Battle([], { spawning: false });
  const enemy = createEnemy(100, 'paladin', 1950, 1480);
  battle.enemies.push(enemy);
  tick(battle, 20);
  enemy.x = 2700;
  const nextId = battle.projectiles[0].id;
  tick(battle, 1000);
  assert.ok(battle.projectiles.every((shot) => shot.team !== 'ally' || shot.id === nextId));
});

test('swept projectiles hit the first enemy, pass obstacles, and still damage offscreen', () => {
  const battle = new Battle([{ x: 2100, y: 1400, width: 100, height: 200 }], { spawning: false });
  const far = createEnemy(101, 'paladin', 2520, 1480);
  const near = createEnemy(100, 'paladin', 2400, 1480);
  battle.enemies.push(far, near);
  battle.projectiles.push({ id: 700, team: 'ally', x: 2050, y: 1490, width: 8, height: 8,
    vx: 10000, vy: 0, damage: 10, color: 0xffffff, expiresAt: 5000 });
  battle.update(50, { x: 0, y: 0 }, () => ({ x: 0, y: 0, width: 1280, height: 720 }));
  assert.equal(near.hp, 120);
  assert.equal(far.hp, 130);
  assert.ok(!battle.projectiles.some((shot) => shot.id === 700));
});

test('player damage has a 0.3s shared cooldown, enemies have no damage cooldown', () => {
  const battle = new Battle([], { spawning: false });
  assert.ok(battle.dealDamage(battle.player, 10));
  assert.equal(battle.player.hp, 90);
  assert.equal(battle.dealDamage(battle.player, 10), false);
  tick(battle, 280);
  assert.equal(battle.dealDamage(battle.player, 10), false);
  tick(battle, 20);
  assert.ok(battle.dealDamage(battle.player, 20));
  assert.equal(battle.player.hp, 70);
  const enemy = createEnemy(100, 'knight', 2000, 2000);
  battle.dealDamage(enemy, 10); battle.dealDamage(enemy, 10);
  assert.equal(enemy.hp, 55);
});

test('melee enemies hit once on contact and then every attack interval, regardless of frame size', () => {
  assert.deepEqual(['soldier', 'knight', 'paladin', 'zealot', 'commander'].map((kind) => ENEMY_STATS[kind].attackMs),
    [800, 1800, 2200, 500, 1500]);
  // 플레이어(1480~1520) 오른쪽 0.5px 옆에 붙은 적. 체력을 크게 두어 자동 공격으로 죽지 않게 한다.
  const hitsIn = (kind, frame) => {
    const battle = new Battle([], { spawning: false });
    battle.player.hp = battle.player.maxHp = 100000;
    const enemy = createEnemy(100, kind, 1520.5, 1480);
    enemy.hp = enemy.maxHp = 100000;
    battle.enemies.push(enemy);
    for (let t = 0; t < 2500; t += frame) battle.update(Math.min(frame, 2500 - t), { x: 0, y: 0 }, stillView);
    return (100000 - battle.player.hp) / ENEMY_STATS[kind].damage;
  };
  // 첫 단계에 닿자마자 한 번, 이후 간격마다: 2.5초 동안 병사 4번(0·0.8·1.6·2.4초), 기사 2번(0·1.8초),
  // 성기사 2번(0·2.2초), 광신도 5번, 성기사단장 2번.
  const expected = { soldier: 4, knight: 2, paladin: 2, zealot: 5, commander: 2 };
  for (const frame of [20, 45, 50]) {
    for (const [kind, hits] of Object.entries(expected)) assert.equal(hitsIn(kind, frame), hits, `${kind} ${frame}ms`);
  }
});

test('ranged enemies shoot through obstacles and respect their independent attack interval', () => {
  const battle = new Battle([{ x: 1590, y: 1400, width: 40, height: 200 }], { spawning: false });
  const archer = createEnemy(100, 'archer', 1690, 1480);
  battle.enemies.push(archer);
  tick(battle, 20);
  assert.equal(battle.projectiles.filter((shot) => shot.team === 'enemy').length, 1);
  const shotId = battle.projectiles.find((shot) => shot.team === 'enemy').id;
  archer.hp = 1000;
  tick(battle, 2000);
  assert.ok(battle.player.hp < 100, 'shot crosses the obstacle');
  assert.ok(!battle.projectiles.some((shot) => shot.team === 'enemy' && shot.id !== shotId));
});

test('player cannot pass through enemy bodies during diagonal movement', () => {
  const battle = new Battle([], { spawning: false });
  const enemy = createEnemy(100, 'paladin', 1540, 1480);
  enemy.hp = 10000;
  battle.enemies.push(enemy);
  tick(battle, 1000, { x: 1, y: 1 });
  assert.ok(!overlaps(battle.player, enemy));
  assert.ok(battle.player.y > 1480);
});

test('an enemy actually follows a detour to reach the player instead of pushing into an obstacle', () => {
  const wall = { x: 1250, y: 1350, width: 100, height: 300 };
  const battle = new Battle([wall], { spawning: false });
  const enemy = createEnemy(100, 'soldier', 1080, 1480);
  enemy.hp = 10000;
  battle.player.hp = 10000;
  battle.enemies.push(enemy);
  let detoured = false;
  for (let frame = 0; frame < 650; frame++) {
    battle.update(20, { x: 0, y: 0 }, viewAt);
    assert.ok(!overlaps(enemy, wall));
    assert.ok(!overlaps(enemy, battle.player));
    if (enemy.y > 1650 || enemy.y + enemy.height < 1350) detoured = true;
  }
  assert.ok(detoured);
  assert.ok(edgeDistance(enemy, battle.player) <= 0.75);
});

test('game over kills summons, clears shots and freezes simulation', () => {
  const battle = new Battle([], { spawning: false });
  const summon = actor(1000, 1000, 1000);
  battle.allies.push(summon);
  battle.dealDamage(battle.player, 100);
  assert.ok(battle.gameOver); assert.equal(summon.hp, 0);
  const before = { ...battle.player };
  tick(battle, 2000, { x: 1, y: 0 });
  assert.deepEqual(battle.player, before);
  assert.equal(battle.time, 0);
  assert.equal(battle.projectiles.length, 0);
});

test('expired projectiles cannot deal damage and shots are cleaned at world bounds', () => {
  const battle = new Battle([], { spawning: false });
  const enemy = createEnemy(100, 'paladin', 2500, 2000);
  battle.enemies.push(enemy);
  // 수명이 이미 끝난 투사체를 적과 겹쳐 둔다. 수명 안의 적중은 아래 경계 테스트에서 따로 검사한다.
  tick(battle, 20);
  battle.projectiles.push({ id: 700, team: 'ally', x: 2500, y: 2000, width: 8, height: 8,
    vx: 1, vy: 0, damage: 10, color: 0xffffff, expiresAt: 10 });
  tick(battle, 20);
  assert.equal(enemy.hp, 130);
  assert.ok(!battle.projectiles.some((shot) => shot.id === 700));
  assert.equal(segmentHit({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 50, width: 10, height: 10 }), 0.5);
});

test('shots hit within their remaining lifetime inside one frame, but not at or after expiry', () => {
  // 화면 밖 성기사(왼쪽 판정 경계 2496)를 향해 700px/초로 날아가는 남은 수명 20ms의 투사체다.
  // 거리 8px은 약 11.4ms, 13px은 약 18.6ms, 14px은 정확히 20ms, 15px은 약 21.4ms 뒤에 닿는다.
  const hpAfter = (gap, frame) => {
    const battle = new Battle([], { spawning: false });
    // 적이 대상을 찾지 못해 제자리에 있도록 플레이어를 공격 불가로 둔다.
    battle.player.attackable = false;
    const enemy = createEnemy(100, 'paladin', 2500, 2000);
    battle.enemies.push(enemy);
    battle.projectiles.push({ id: 700, team: 'ally', x: 2496 - gap - 4, y: 2046, width: 8, height: 8,
      vx: 700, vy: 0, damage: 10, color: 0xffffff, expiresAt: 20 });
    for (let t = 0; t < 100; t += frame) battle.update(frame, { x: 0, y: 0 }, viewAt);
    assert.ok(!battle.projectiles.some((shot) => shot.id === 700));
    return enemy.hp;
  };
  for (const frame of [5, 20, 50, 100]) {
    assert.equal(hpAfter(8, frame), 120, `11.4ms hit, ${frame}ms frames`);
    assert.equal(hpAfter(13, frame), 120, `18.6ms hit, ${frame}ms frames`);
    // 만료 시점에 정확히 닿으면 이미 소멸한 것으로 보아 피해가 없다.
    assert.equal(hpAfter(14, frame), 130, `hit exactly at expiry, ${frame}ms frames`);
    assert.equal(hpAfter(15, frame), 130, `21.4ms hit, ${frame}ms frames`);
  }
});

// 적끼리 막는 몸체: 위쪽 통과 영역(높이의 25%)을 뺀 아래쪽
const footprint = (enemy) => ({ x: enemy.x, y: enemy.y + enemy.height / 4, width: enemy.width, height: enemy.height * 3 / 4 });

test('live dungeon simulation keeps bodies out of obstacles and each other', () => {
  const battle = new Battle(dungeonObstacles, { random: seeded(726) });
  battle.player.hp = 10000;
  for (let frame = 0; frame < 900; frame++) {
    battle.update(20, { x: 0, y: 0 }, viewAt);
    if (frame % 5 !== 0) continue;
    for (const actor of [battle.player, ...battle.enemies]) {
      assert.ok(contains(CFG.world, actor));
      assert.ok(dungeonObstacles.every((obstacle) => !overlaps(actor, obstacle)));
    }
    // 플레이어와 적은 몸체 전체로, 적끼리는 위쪽 통과 영역을 뺀 아래쪽으로 겹치지 않는다.
    // 사거리 안에서 멈춘 원거리 적·사제는 근접 적이 지나갈 수 있으므로 그 쌍만 검사에서 뺀다. 원거리 적·사제끼리는 검사한다.
    const passable = (stopped, other) => stopped.holding && !ENEMY_STATS[other.kind].ranged;
    for (let i = 0; i < battle.enemies.length; i++) {
      assert.ok(!overlaps(battle.player, battle.enemies[i]));
      for (let j = i + 1; j < battle.enemies.length; j++) {
        const [a, b] = [battle.enemies[i], battle.enemies[j]];
        if (passable(a, b) || passable(b, a)) continue;
        assert.ok(!overlaps(footprint(a), footprint(b)));
      }
    }
  }
  assert.ok(battle.time >= 18000);
});

test('an enemy can step behind another enemy only as far as its 25% top pass area', () => {
  // 앞 병사(1480,1440)는 플레이어 위에 붙어 멈춰 있고, 뒤 병사는 그 위에서 아래로 다가온다. 병사 높이 40의 25%는 10px이다.
  const battle = new Battle([], { spawning: false });
  battle.player.hp = battle.player.maxHp = 10000;
  const front = createEnemy(100, 'soldier', 1480, 1440);
  const back = createEnemy(101, 'soldier', 1480, 1400);
  for (const enemy of [front, back]) enemy.hp = enemy.maxHp = 10000;
  battle.enemies.push(front, back);
  // 초당 110px이므로 20ms마다 2.2px씩 내려와 5번째 단계에 1410에서 멈춘다.
  tick(battle, 100);
  assert.deepEqual([front.x, front.y], [1480, 1440]);
  assert.equal(back.y, 1410);
  assert.equal(back.y + back.height - front.y, 10);
  for (let frame = 0; frame < 100; frame++) {
    tick(battle, 20);
    assert.ok(!overlaps(footprint(back), footprint(front)));
  }
  // 앞 병사 쪽에서도 같다. 뒤 병사의 위쪽 10px까지만 겹칠 수 있고, 플레이어 몸체와는 겹치지 않는다.
  assert.ok(!overlaps(back, battle.player) && !overlaps(front, battle.player));
});

test('ranged enemies and priests do not walk into a ranged enemy that has stopped within its range', () => {
  // 앞 궁사(1745,1480)는 사거리 안에서 멈춰 있다. 정확히 같은 줄 뒤에서 오는 궁사·사제는 사거리 밖이라 움직이며, 앞 궁사에 막혀 옆으로 비킨다.
  // 정면으로 막히는 가장 나쁜 경우라 비켜 서는 데 몇 초 걸린다(현재 궁사 약 3.4초, 사제 약 4.6초). 5초 안에 자기 사거리 안에서 멈춰야 한다.
  for (const kind of ['archer', 'priest']) {
    const battle = new Battle([], { spawning: false });
    battle.player.hp = battle.player.maxHp = 10000;
    const front = createEnemy(100, 'archer', 1745, 1480);
    const back = createEnemy(101, kind, 1800, 1480);
    for (const enemy of [front, back]) enemy.hp = enemy.maxHp = 10000;
    battle.enemies.push(front, back);
    for (let t = 0; t < 5000; t += 20) {
      tick(battle, 20);
      assert.ok(front.holding, kind);
      assert.ok(!overlaps(footprint(back), footprint(front)), `${kind} at ${t}ms`);
    }
    assert.ok(back.holding, kind);
  }
});

test('enemies walk straight through a ranged enemy that has stopped within its range', () => {
  // 궁사(30×40, 중심 1760,1500)는 플레이어 중심에서 260px로 사거리 280px 안이라 멈춰 있다.
  // 같은 줄 뒤의 병사(1800,1480)는 옆으로 비키지 않고 궁사를 지나 2.5초 안에 플레이어에게 닿는다(남은 거리 280px, 초당 110px).
  const battle = new Battle([], { spawning: false });
  battle.player.hp = battle.player.maxHp = 10000;
  const archer = createEnemy(100, 'archer', 1745, 1480);
  const soldier = createEnemy(101, 'soldier', 1800, 1480);
  for (const enemy of [archer, soldier]) enemy.hp = enemy.maxHp = 10000;
  battle.enemies.push(archer, soldier);
  let passed = false;
  for (let t = 0; t < 2600; t += 20) {
    tick(battle, 20);
    assert.ok(archer.holding);
    assert.deepEqual([archer.x, archer.y], [1745, 1480]);
    assert.equal(soldier.y, 1480);
    if (overlaps(soldier, archer)) passed = true;
  }
  assert.ok(passed);
  assert.ok(edgeDistance(soldier, battle.player) <= 0.75);
  assert.ok(!overlaps(soldier, battle.player));

  // 아직 사거리 밖이라 움직이는 궁사는 평소처럼 막는다.
  const moving = new Battle([], { spawning: false });
  moving.player.attackable = false;
  const far = createEnemy(100, 'archer', 2100, 1480);
  const behind = createEnemy(101, 'soldier', 2135, 1480);
  moving.enemies.push(far, behind);
  moving.player.attackable = true;
  tick(moving, 200);
  assert.equal(far.holding, false);
  assert.ok(!overlaps(footprint(behind), footprint(far)));
});

test('knight and paladin bodies use the decided rectangular sizes and melee range 1', () => {
  const knight = createEnemy(1, 'knight', 500, 500);
  const paladin = createEnemy(2, 'paladin', 500, 500);
  assert.deepEqual([knight.width, knight.height], [80, 60]);
  assert.deepEqual([paladin.width, paladin.height], [60, 80]);
  assert.equal(ENEMY_STATS.knight.range, 40);
  const battle = new Battle(dungeonObstacles, { random: seeded(29) });
  const view = viewAt(battle.player);
  for (const kind of ['knight', 'paladin']) {
    const enemy = battle.spawnEnemy(kind, view);
    assert.ok(enemy, kind);
    assert.deepEqual([enemy.width, enemy.height], [ENEMY_STATS[kind].width, ENEMY_STATS[kind].height]);
    assert.ok(!overlaps(enemy, expand(view, CFG.spawnMargin)));
    assert.ok(dungeonObstacles.every((obstacle) => !overlaps(enemy, obstacle)));
  }
});

const orbAt = (id, cx, cy, value = 1) => ({ id, x: cx - CFG.expOrb.size / 2, y: cy - CFG.expOrb.size / 2,
  width: CFG.expOrb.size, height: CFG.expOrb.size, value, pulled: false });
const stillView = () => ({ x: 860, y: 1140, width: 1280, height: 720 });
const step = (battle, ms, size, input = { x: 0, y: 0 }) => {
  for (let remaining = ms; remaining > 0; remaining -= size) battle.update(Math.min(size, remaining), input, stillView);
};

test('every enemy kind drops 0.5-point orbs adding up to its table experience, spread inside its body', () => {
  // 경험치 ÷ 0.5개: 광신도 1, 병사·궁사 2, 마법사·석궁병 4, 사제 5, 기사 6, 성기사 8, 성기사단장 60.
  const expected = { soldier: [1, 2], knight: [3, 6], paladin: [4, 8], archer: [1, 2], mage: [2, 4], zealot: [0.5, 1],
    crossbowman: [2, 4], priest: [2.5, 5], commander: [30, 60] };
  assert.equal(CFG.expOrb.value, 0.5);
  for (const [kind, [exp, count]] of Object.entries(expected)) {
    assert.equal(ENEMY_STATS[kind].exp, exp);
    const battle = new Battle([], { spawning: false });
    const enemy = createEnemy(100, kind, 2000, 2000);
    battle.enemies.push(enemy);
    battle.dealDamage(enemy, 100000);
    assert.equal(battle.orbs.length, count, kind);
    assert.ok(battle.orbs.every((orb) => orb.value === 0.5 && contains(enemy, orb)), kind);
    // 같은 위치에 겹치지 않는다.
    assert.equal(new Set(battle.orbs.map((orb) => `${orb.x},${orb.y}`)).size, count, kind);
    if (count === 1) assert.deepEqual(center(battle.orbs[0]), center(enemy));
    // 처치 주체와 관계없이 발생하고, 이미 죽은 적에게 다시 피해를 주어도 중복되지 않는다.
    battle.dealDamage(enemy, 1000);
    assert.equal(battle.orbs.length, count);
  }
});

test('several shots killing one enemy in the same frame count one kill and drop its orbs once', () => {
  const battle = new Battle([], { spawning: false });
  const enemy = createEnemy(100, 'soldier', 1700, 1480);
  enemy.hp = 10;
  battle.enemies.push(enemy);
  for (const id of [700, 701, 702]) {
    battle.projectiles.push({ id, team: 'ally', x: 1650, y: 1496, width: 8, height: 8,
      vx: 10000, vy: 0, damage: 10, color: 0xffffff, expiresAt: 5000 });
  }
  battle.update(20, { x: 0, y: 0 }, stillView);
  assert.equal(battle.kills, 1);
  // 병사 경험치 1 = 0.5 구슬 2개가 한 번만 생긴다.
  assert.equal(battle.orbs.length, 2);
  assert.equal(battle.enemies.length, 0);
  assert.equal(battle.orbs.reduce((sum, orb) => sum + orb.value, 0), 1);
});

test('orbs over the cap merge into the oldest orb and preserve total experience', () => {
  const battle = new Battle([], { spawning: false });
  let total = 0;
  // 병사 150마리(구슬 2개씩)로 상한 300개를 채운 뒤 병사·성기사를 더 처치한다. 상한에 걸리면 남은 구슬도 모두 합친다.
  const kinds = [...Array(CFG.expOrb.max / 2).fill('soldier'), 'soldier', 'paladin'];
  kinds.forEach((kind, i) => {
    const enemy = createEnemy(100 + i, kind, 200 + i % 20 * 100, 200 + Math.floor(i / 20) * 100);
    battle.enemies.push(enemy);
    battle.dealDamage(enemy, 1000);
    total += ENEMY_STATS[enemy.kind].exp;
  });
  assert.equal(battle.orbs.length, CFG.expOrb.max);
  assert.equal(battle.orbs.reduce((sum, orb) => sum + orb.value, 0), total);
  // 첫 구슬(0.5)에 상한을 넘긴 병사 1(0.5 × 2)과 성기사 4(0.5 × 8)가 더해진다.
  assert.equal(battle.orbs[0].value, 0.5 + 1 + 4);
  assert.ok(battle.orbs.slice(1).every((orb) => orb.value === 0.5));
});

test('orbs never expire and only orbs within the pickup radius are pulled', () => {
  const battle = new Battle([], { spawning: false });
  const player = center(battle.player);
  const r = CFG.player.pickupRadius;
  // 경계를 포함한다: 정확히 반경 거리의 구슬은 끌려오고, 반경 바로 밖의 구슬은 움직이지 않는다.
  battle.orbs.push(orbAt(1, player.x + r, player.y), orbAt(2, player.x - r - 0.01, player.y),
    orbAt(3, player.x, player.y + r - 0.01));
  step(battle, 20, 20);
  assert.ok(battle.orbs.find((orb) => orb.id === 1).pulled);
  assert.ok(battle.orbs.find((orb) => orb.id === 3).pulled);
  assert.equal(battle.orbs.find((orb) => orb.id === 2).pulled, false);
  step(battle, 60000, 50);
  assert.deepEqual(battle.orbs.map((orb) => orb.id), [2]);
  assert.equal(center(battle.orbs[0]).x, player.x - r - 0.01);
  assert.deepEqual({ level: battle.level, experience: battle.experience }, { level: 1, experience: 2 });
});

test('orb pull movement and pickup time do not depend on frame size', () => {
  const run = (size) => {
    const battle = new Battle([], { spawning: false });
    const player = center(battle.player);
    battle.orbs.push(orbAt(1, player.x + CFG.player.pickupRadius, player.y, 3));
    step(battle, 100, size);
    const x = center(battle.orbs[0]).x;
    step(battle, 100, size);
    return { x, collected: battle.orbs.length === 0, experience: battle.experience };
  };
  // 반경 100px에서 몸체가 닿을 때까지 (100 - 20 - 6)px를 700px/초로 이동하므로 약 106ms에 획득한다. 0.1초에는 70px 이동한 상태다.
  assert.equal(CFG.expOrb.pullSpeed, 700);
  const results = [10, 20, 50].map(run);
  for (const result of results) {
    assert.ok(Math.abs(result.x - (1500 + 100 - 70)) < 1e-9);
    assert.deepEqual([result.collected, result.experience], [true, 3]);
  }
});

test('pulled orbs keep chasing a fleeing player and are never overshot', () => {
  const battle = new Battle([], { spawning: false });
  const player = center(battle.player);
  battle.orbs.push(orbAt(1, player.x + CFG.player.pickupRadius, player.y, 2));
  step(battle, 20, 20);
  step(battle, 1000, 50, { x: -1, y: 0 });
  assert.equal(battle.orbs.length, 0);
  assert.equal(battle.experience, 2);
  const near = new Battle([], { spawning: false });
  near.orbs.push(orbAt(2, center(near.player).x + 27, center(near.player).y));
  near.update(50, { x: 0, y: 0 }, stillView);
  assert.equal(near.orbs.length, 0);
  assert.equal(near.experience, 1);
});

test('picking up enough orbs levels up with carry-over, and nothing is gained after game over', () => {
  const battle = new Battle([], { spawning: false });
  const player = center(battle.player);
  battle.orbs.push(orbAt(1, player.x, player.y, 4), orbAt(2, player.x, player.y, 4));
  battle.update(20, { x: 0, y: 0 }, stillView);
  assert.deepEqual({ level: battle.level, experience: battle.experience }, { level: 2, experience: 3 });

  const dying = new Battle([], { spawning: false });
  dying.player.hp = 5;
  dying.orbs.push(orbAt(3, center(dying.player).x, center(dying.player).y, 4));
  dying.projectiles.push({ id: 900, team: 'enemy', x: 1460, y: 1496, width: 10, height: 10,
    vx: 10000, vy: 0, damage: 10, color: 0xffffff, expiresAt: 5000 });
  dying.update(20, { x: 0, y: 0 }, stillView);
  assert.ok(dying.gameOver);
  assert.deepEqual({ level: dying.level, experience: dying.experience }, { level: 1, experience: 0 });
  dying.update(20, { x: 0, y: 0 }, stillView);
  assert.equal(dying.experience, 0);
  // 게임 종료 후에는 피해와 처치가 일어나지 않으므로 새 구슬도 생기지 않는다.
  const enemy = createEnemy(100, 'soldier', 2000, 2000);
  dying.enemies.push(enemy);
  dying.dealDamage(enemy, 1000);
  assert.deepEqual(dying.orbs.map((orb) => orb.id), [3]);
});

const levelUp = (battle, value = 5) => {
  const player = center(battle.player);
  battle.orbs.push(orbAt(9000 + battle.orbs.length, player.x, player.y, value));
  battle.update(20, { x: 0, y: 0 }, stillView);
};

test('leveling up pauses everything until a reward is chosen, then resumes without a burst', () => {
  const battle = new Battle(dungeonObstacles, { random: seeded(5) });
  step(battle, 3000, 20);
  levelUp(battle);
  assert.equal(battle.level, 2);
  assert.equal(battle.choices.length, 3);
  assert.equal(new Set(battle.choices).size, 3);
  const snapshot = JSON.stringify({ time: battle.time, player: battle.player, enemies: battle.enemies,
    projectiles: battle.projectiles, orbs: battle.orbs });
  for (const size of [10, 50, 1000]) step(battle, 3000, size, { x: 1, y: 1 });
  assert.equal(JSON.stringify({ time: battle.time, player: battle.player, enemies: battle.enemies,
    projectiles: battle.projectiles, orbs: battle.orbs }), snapshot);
  assert.equal(battle.choose(3), false);
  assert.ok(battle.choose(0));
  assert.deepEqual(battle.choices, []);
  const before = battle.time;
  // 긴 정지 뒤의 프레임도 한 프레임 상한 250ms까지만 진행되어 몰아서 처리되지 않는다.
  battle.update(5000, { x: 0, y: 0 }, stillView);
  assert.equal(battle.time - before, 250);
});

test('multiple levels gained at once open one choice window per level in order', () => {
  const battle = new Battle([], { spawning: false, random: seeded(8) });
  levelUp(battle, 20);
  assert.equal(battle.level, 3);
  assert.equal(battle.choices.length, 3);
  assert.ok(battle.choose(1));
  assert.equal(battle.choices.length, 3);
  assert.ok(battle.choose(2));
  assert.deepEqual(battle.choices, []);
  assert.equal(battle.choose(0), false);
});

test('the choice reward widens the very next window up to five options', () => {
  const battle = new Battle([], { spawning: false, random: seeded(2) });
  levelUp(battle, 5 + 10 + 15);
  assert.equal(battle.choices.length, 3);
  battle.choices = ['choices', ...battle.choices.filter((id) => id !== 'choices').slice(0, 2)];
  battle.choose(0);
  assert.equal(battle.choices.length, 4);
  battle.choices = ['choices', ...battle.choices.filter((id) => id !== 'choices').slice(0, 3)];
  battle.choose(0);
  assert.equal(battle.choices.length, 5);
  assert.ok(!battle.choices.includes('choices'));
});

test('stat rewards change attack damage, move speed, shot speed and pickup radius', () => {
  const battle = new Battle([], { spawning: false });
  for (const id of ['damage', 'moveSpeed', 'shotSpeed', 'pickupRadius']) battle.applyReward(id);
  const start = battle.player.x;
  step(battle, 1000, 20, { x: 1, y: 0 });
  // 워록 이동속도 230 × 110% = 253.
  assert.ok(Math.abs(battle.player.x - start - 253) < 1e-9);
  const enemy = createEnemy(100, 'paladin', 1950, 1480);
  enemy.hp = 10000;
  battle.enemies.push(enemy);
  battle.update(20, { x: 0, y: 0 }, stillView);
  const shot = battle.projectiles.find((item) => item.team === 'ally');
  assert.equal(shot.damage, 12);
  assert.ok(Math.abs(Math.hypot(shot.vx, shot.vy) - 805) < 1e-9);
  const player = center(battle.player);
  battle.orbs.push(orbAt(1, player.x, player.y + 125));
  battle.update(20, { x: 0, y: 0 }, stillView);
  assert.ok(battle.orbs.find((orb) => orb.id === 1).pulled);
});

test('attack speed rewards shorten the auto attack interval', () => {
  const countShots = (stacks) => {
    const battle = new Battle([], { spawning: false });
    for (let i = 0; i < stacks; i++) battle.applyReward('attackSpeed');
    const enemy = createEnemy(100, 'paladin', 1950, 1480);
    enemy.hp = 100000;
    battle.enemies.push(enemy);
    const ids = new Set();
    for (let t = 0; t < 1000; t += 20) {
      battle.update(20, { x: 0, y: 0 }, stillView);
      for (const shot of battle.projectiles) if (shot.team === 'ally') ids.add(shot.id);
    }
    return ids.size;
  };
  // 첫 발은 20ms에 발사된다. 1초 동안 0.5초 간격은 2발, 0.45초는 3발, 0.25초는 4발이다.
  assert.equal(countShots(0), 2);
  assert.equal(countShots(1), 3);
  assert.equal(countShots(5), 4);
});

test('max health rewards raise current health and healing never exceeds max health', () => {
  const battle = new Battle([], { spawning: false });
  battle.player.hp = 50;
  // 최대 체력 강화는 시작값 100의 10%씩: 1회 110, 10회 200.
  battle.applyReward('maxHp');
  assert.deepEqual([battle.player.hp, battle.player.maxHp], [60, 110]);
  // 체력 회복은 최대 체력 110의 30% = 33.
  battle.applyReward('heal');
  assert.equal(battle.player.hp, 93);
  battle.applyReward('heal');
  assert.equal(battle.player.hp, 110);
  for (let i = 0; i < 9; i++) battle.applyReward('maxHp');
  assert.deepEqual([battle.player.hp, battle.player.maxHp], [200, 200]);
  battle.player.hp = 1;
  battle.applyReward('heal');
  assert.equal(battle.player.hp, 61);
});

test('a level up in the same frame as player death keeps the game over without a choice window', () => {
  const battle = new Battle([], { spawning: false });
  battle.player.hp = 5;
  battle.orbs.push(orbAt(3, center(battle.player).x, center(battle.player).y, 5));
  battle.projectiles.push({ id: 900, team: 'enemy', x: 1460, y: 1496, width: 10, height: 10,
    vx: 10000, vy: 0, damage: 10, color: 0xffffff, expiresAt: 5000 });
  battle.update(20, { x: 0, y: 0 }, stillView);
  assert.ok(battle.gameOver);
  assert.deepEqual(battle.choices, []);
  assert.equal(battle.choose(0), false);
});

test('game time and movement follow real elapsed time for short, long and irregular frames', () => {
  const irregular = [16, 33, 100, 51, 200, 7, 93, 150, 180, 170];
  for (const frames of [Array(50).fill(20), Array(10).fill(100), irregular]) {
    const battle = new Battle([], { spawning: false });
    const start = battle.player.x;
    for (const ms of frames) battle.update(ms, { x: 1, y: 0 }, stillView);
    assert.equal(battle.time, 1000, `${frames.length} frames`);
    // 이동량은 워록 이동속도 230 × dt / 1000의 부동소수점 합이므로 1e-9px 안에서 비교한다.
    assert.ok(Math.abs(battle.player.x - start - 230) < 1e-9, `${frames.length} frames`);
  }
});

test('auto attack and spawning keep their intervals at 100ms frames', () => {
  const shotsIn = (frame) => {
    const battle = new Battle([], { spawning: false });
    const enemy = createEnemy(100, 'paladin', 1950, 1480);
    enemy.hp = 100000;
    battle.enemies.push(enemy);
    const ids = new Set();
    for (let t = 0; t < 1000; t += frame) {
      battle.update(frame, { x: 0, y: 0 }, stillView);
      for (const shot of battle.projectiles) if (shot.team === 'ally') ids.add(shot.id);
    }
    return ids.size;
  };
  // 첫 발 이후 0.5초 간격이므로 1초 동안 2발이다.
  assert.equal(shotsIn(20), 2);
  assert.equal(shotsIn(100), 2);

  const spawnsIn = (frame) => {
    const battle = new Battle([], { random: seeded(31) });
    battle.player.hp = 10000;
    const ids = new Set();
    for (let t = 0; t < 3700; t += frame) {
      battle.update(frame, { x: 0, y: 0 }, stillView);
      for (const enemy of battle.enemies) ids.add(enemy.id);
    }
    return ids.size;
  };
  // 첫 단계와 이후 1.0초마다 생성되므로 3.7초 동안 4마리다.
  assert.equal(spawnsIn(20), 4);
  assert.equal(spawnsIn(100), 4);
});

test('attack, heal and spawn intervals do not stretch at frame sizes that do not divide them', () => {
  // 60FPS(약 16.7ms)·30ms·30FPS(약 33.3ms)·45ms 프레임은 0.5·0.8·1·3·5초 간격을 나누어떨어지게 하지 못한다.
  // 프레임이 50ms 이하라 update 한 번이 한 단계이므로, 새 id가 처음 보인 시각이 그 동작이 일어난 단계의 시각이다.
  const frames = [1000 / 60, 30, 1000 / 30, 45];
  const watch = (battle, frame, ms, sources) => {
    const logs = sources.map(() => ({ seen: new Set(), times: [] }));
    for (let i = Math.round(ms / frame); i > 0; i--) {
      battle.update(frame, { x: 0, y: 0 }, stillView);
      sources.forEach((items, index) => {
        for (const item of items(battle)) {
          if (logs[index].seen.has(item.id)) continue;
          logs[index].seen.add(item.id); logs[index].times.push(battle.time);
        }
      });
    }
    return logs.map((log) => log.times);
  };
  // k번째 동작은 첫 동작 + k × 간격에 준비되므로 그 시점부터 한 프레임 안에 일어나야 한다. 늦어진 만큼이 다음 간격에 쌓이면 안 된다.
  // 시각은 프레임 간격의 부동소수점 합이므로 1e-6ms 오차를 허용한다.
  const expectEvery = (times, interval, frame, end, label) => {
    assert.equal(times.length, Math.floor((end - times[0]) / interval + 1e-6) + 1, `${label} count`);
    times.forEach((time, k) => {
      const due = times[0] + k * interval;
      assert.ok(time >= due - 1e-6 && time < due + frame + 1e-6, `${label} #${k}: ${time} (due ${due})`);
    });
  };
  // 플레이어를 벽으로 둘러싸 근접 적이 닿지 못하게 한다. 투사체와 회복은 장애물에 막히지 않는다.
  const walls = [{ x: 1460, y: 1460, width: 80, height: 10 }, { x: 1460, y: 1530, width: 80, height: 10 },
    { x: 1460, y: 1460, width: 10, height: 80 }, { x: 1530, y: 1460, width: 10, height: 80 }];
  // 성기사(1760,1440, 60×80)도 벽으로 둘러 회복 반경 안에 묶어 둔다. 멈춘 사제는 막지 않으므로 벽이 없으면 걸어 나간다.
  const pen = [{ x: 1750, y: 1430, width: 10, height: 100 }, { x: 1820, y: 1430, width: 10, height: 100 },
    { x: 1750, y: 1430, width: 80, height: 10 }, { x: 1750, y: 1520, width: 80, height: 10 }];
  for (const frame of frames) {
    const label = `${frame.toFixed(1)}ms`;
    const battle = new Battle([...walls, ...pen], { spawning: false });
    const archer = createEnemy(100, 'archer', 1480, 1700);
    const priest = createEnemy(101, 'priest', 1700, 1480);
    // 사제 회복 반경에 닿아 있고, 회복해도 최대 체력에 닿지 않는 성기사
    const wounded = createEnemy(102, 'paladin', 1760, 1440);
    for (const enemy of [archer, priest]) enemy.hp = enemy.maxHp = 1e9;
    wounded.maxHp = 1e9; wounded.hp = 1e8;
    battle.enemies.push(archer, priest, wounded);
    const [shots, bolts, heals] = watch(battle, frame, 36_000, [
      (b) => b.projectiles.filter((shot) => shot.team === 'ally'),
      (b) => b.projectiles.filter((shot) => shot.team === 'enemy'),
      (b) => b.effects.filter((effect) => effect.kind === 'heal'),
    ]);
    // 워록 0.5초, 궁사 5초, 사제 3초
    expectEvery(shots, 500, frame, battle.time, `warlock ${label}`);
    expectEvery(bolts, 5000, frame, battle.time, `archer ${label}`);
    expectEvery(heals, 3000, frame, battle.time, `priest ${label}`);

    const knight = new Battle([], { spawning: false, character: 'deathKnight' });
    knight.player.hp = knight.player.maxHp = 1e6;
    const dummy = createEnemy(100, 'soldier', 1530, 1480);
    dummy.hp = dummy.maxHp = 1e9;
    knight.enemies.push(dummy);
    const [swings] = watch(knight, frame, 36_000, [(b) => b.effects.filter((effect) => effect.kind === 'swing')]);
    expectEvery(swings, 800, frame, knight.time, `death knight ${label}`);

    const spawning = new Battle([], { random: seeded(31) });
    spawning.player.hp = 10000;
    const [spawns] = watch(spawning, frame, 18_000, [(b) => b.enemies]);
    expectEvery(spawns, 1000, frame, spawning.time, `spawn ${label}`);
  }
});

test('a level up or death inside a long frame stops the rest of that frame', () => {
  const leveling = new Battle([], { spawning: false });
  const player = center(leveling.player);
  leveling.orbs.push(orbAt(1, player.x, player.y, 5));
  leveling.update(200, { x: 1, y: 0 }, stillView);
  assert.equal(leveling.choices.length, 3);
  assert.equal(leveling.time, 50);
  // 첫 50ms 단계만 진행된다: 230 × 0.05 = 11.5px.
  assert.equal(leveling.player.x, 1480 + 11.5);

  const dying = new Battle([], { spawning: false });
  dying.player.hp = 5;
  dying.projectiles.push({ id: 900, team: 'enemy', x: 1460, y: 1496, width: 10, height: 10,
    vx: 10000, vy: 0, damage: 10, color: 0xffffff, expiresAt: 5000 });
  dying.update(200, { x: 1, y: 0 }, stillView);
  assert.ok(dying.gameOver);
  assert.equal(dying.time, 50);
});
