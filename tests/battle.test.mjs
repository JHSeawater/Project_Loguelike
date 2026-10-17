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
  assert.equal(near.hp, 115);
  assert.equal(far.hp, 125);
  assert.ok(!battle.projectiles.some((shot) => shot.id === 700));
});

test('player damage has a 3s shared cooldown, enemies have no damage cooldown', () => {
  const battle = new Battle([], { spawning: false });
  assert.ok(battle.dealDamage(battle.player, 10));
  assert.equal(battle.player.hp, 90);
  assert.equal(battle.dealDamage(battle.player, 10), false);
  tick(battle, 2980);
  assert.equal(battle.dealDamage(battle.player, 10), false);
  tick(battle, 20);
  assert.ok(battle.dealDamage(battle.player, 20));
  assert.equal(battle.player.hp, 70);
  const enemy = createEnemy(100, 'knight', 2000, 2000);
  battle.dealDamage(enemy, 10); battle.dealDamage(enemy, 10);
  assert.equal(enemy.hp, 55);
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
  battle.projectiles.push({ id: 700, team: 'ally', x: 2500, y: 2000, width: 8, height: 8,
    vx: 1, vy: 0, damage: 10, color: 0xffffff, expiresAt: 10 });
  tick(battle, 20);
  assert.equal(enemy.hp, 125);
  assert.ok(!battle.projectiles.some((shot) => shot.id === 700));
  assert.equal(segmentHit({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 50, width: 10, height: 10 }), 0.5);
});

test('live dungeon simulation keeps bodies out of obstacles and each other', () => {
  const battle = new Battle(dungeonObstacles, { random: seeded(726) });
  battle.player.hp = 10000;
  for (let frame = 0; frame < 900; frame++) {
    battle.update(20, { x: 0, y: 0 }, viewAt);
    if (frame % 5 !== 0) continue;
    const actors = [battle.player, ...battle.enemies];
    for (let i = 0; i < actors.length; i++) {
      assert.ok(contains(CFG.world, actors[i]));
      assert.ok(dungeonObstacles.every((obstacle) => !overlaps(actors[i], obstacle)));
      for (let j = i + 1; j < actors.length; j++) assert.ok(!overlaps(actors[i], actors[j]));
    }
  }
  assert.ok(battle.time >= 18000);
});
