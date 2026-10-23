import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle, createEnemy } from '../src/battle.ts';
import { BATTLE_CONFIG as CFG } from '../src/battle-config.ts';
import { center, contains, expand, overlaps } from '../src/battle-geometry.ts';

// 플레이어(중심 1500,1500) 주변을 비추는 고정 카메라.
const VIEW = { x: 860, y: 1140, width: 1280, height: 720 };
const view = () => VIEW;
const seeded = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const run = (battle, ms, frame = 20, input = { x: 0, y: 0 }) => {
  for (let elapsed = 0; elapsed < ms - 1e-9;) {
    const dt = Math.min(frame, ms - elapsed);
    battle.update(dt, input, view);
    elapsed += dt;
  }
};
// 데스 나이트는 반경 100px 밖의 보스를 공격하지 않아 보스 체력이 그대로다.
const knightBattle = (options = {}) => new Battle(options.obstacles ?? [], { character: 'deathKnight', spawning: false, random: seeded(5) });
// 보스를 직접 놓는다. 테스트 준비를 위해 다음 행동 순번과 시각을 직접 정한다.
const placeBoss = (battle, x, y, action = 0, at = 0) => {
  const boss = createEnemy(500, 'commander', x, y);
  battle.enemies.push(boss);
  battle.boss = boss;
  battle['bossActionIndex'] = action;
  battle['nextBossActionAt'] = at;
  return boss;
};
const ACTIONS = ['brand', 'cross', 'rally', 'brand', 'cross', 'aegis'];

test('the commander appears once at 5:00 off-screen even with the enemy cap full, and is not counted in the cap', () => {
  const battle = new Battle([], { character: 'deathKnight', random: seeded(3) });
  battle['nextSpawnAt'] = Infinity; battle['nextGroupAt'] = Infinity; battle['nextRingAt'] = Infinity;
  // 적이 움직이지 않도록 플레이어를 공격 불가로 두고, 4:00 단계 최대 60마리를 화면 밖 왼쪽 위에 채운다.
  battle.player.attackable = false;
  for (let i = 0; i < 60; i++) battle.enemies.push(createEnemy(1000 + i, 'soldier', 60 + i % 10 * 50, 60 + Math.floor(i / 10) * 50));
  battle.time = 299_960;
  run(battle, 20);
  assert.equal(battle.boss, null);
  run(battle, 20);
  const boss = battle.boss;
  assert.ok(boss && boss.kind === 'commander');
  assert.deepEqual([boss.width, boss.height, boss.hp], [70, 90, 1800]);
  assert.ok(contains(CFG.world, boss));
  assert.ok(!overlaps(boss, expand(VIEW, CFG.spawnMargin)));
  assert.equal(battle.enemies.length, 61);
  // 일반 적이 59마리면 보스와 관계없이 1마리를 더 생성할 수 있다(한 번에 2마리 중 1마리).
  battle.enemies.splice(0, 1);
  battle['nextSpawnAt'] = 0;
  run(battle, 20);
  assert.equal(battle.enemies.filter((enemy) => enemy.kind !== 'commander').length, 60);
  battle['nextSpawnAt'] = Infinity;
  battle.time = 600_000;
  run(battle, 1000);
  assert.equal(battle.enemies.filter((enemy) => enemy.kind === 'commander').length, 1);
});

test('the commander acts every 4s in a fixed order regardless of frame size', () => {
  for (const frame of [1000 / 60, 20, 45]) {
    const battle = knightBattle();
    battle.player.hp = battle.player.maxHp = 100000;
    const boss = placeBoss(battle, 2300, 1455, 0, 4000);
    const events = [];
    const seenHazards = new Set();
    let soldiers = 0, guard = battle.bossGuardUntil;
    for (let i = Math.round(26_000 / frame); i > 0; i--) {
      battle.update(frame, { x: 0, y: 0 }, view);
      for (const hazard of battle.hazards) {
        if (!seenHazards.has(hazard.id)) { seenHazards.add(hazard.id); events.push([battle.time, hazard.kind]); }
      }
      const count = battle.enemies.filter((enemy) => enemy.kind === 'soldier').length;
      if (count > soldiers) events.push([battle.time, 'rally']);
      soldiers = count;
      if (battle.bossGuardUntil !== guard) { events.push([battle.time, 'aegis']); guard = battle.bossGuardUntil; }
    }
    assert.ok(boss.hp > 0);
    assert.deepEqual(events.map(([, action]) => action), ACTIONS, `${frame}ms`);
    // k번째 행동은 4초 + 4k초에 준비되어 그 시점부터 한 프레임 안에 일어난다. 1e-6ms는 부동소수점 합의 오차다.
    events.forEach(([time], k) => {
      const due = 4000 + 4000 * k;
      assert.ok(time >= due - 1e-6 && time < due + frame + 1e-6, `${frame}ms #${k}: ${time}`);
    });
  }
});

test('the judgment brand hits a body touching the 100px circle once, exactly when the 1s warning ends', () => {
  const brand = (setup = () => {}) => {
    const battle = knightBattle();
    placeBoss(battle, 2300, 1455, 0, 0);
    run(battle, 20);
    const [hazard] = battle.hazards;
    assert.deepEqual([hazard.kind, hazard.x, hazard.y, hazard.hitAt - hazard.castAt], ['brand', 1500, 1500, 1000]);
    setup(battle);
    // 20ms에 시전했으므로 1.00초에는 아직, 1.02초에 피해가 들어간다.
    run(battle, 980);
    const before = battle.player.hp;
    run(battle, 20);
    return { battle, before, after: battle.player.hp };
  };
  // 낙인을 시전한 순간의 플레이어 중심에 원이 생긴다. 그대로 있으면 경고가 끝나는 1.0초에 35 피해다.
  const stay = brand();
  assert.deepEqual([stay.before, stay.after], [140, 105]);
  assert.deepEqual(stay.battle.hazards, []);
  // 원 중심에서 몸체까지 정확히 100px이면 닿은 것이고, 100.5px이면 닿지 않는다.
  assert.equal(brand((battle) => { battle.player.x = 1600; }).after, 105);
  assert.equal(brand((battle) => { battle.player.x = 1600.5; }).after, 140);
  // 직전에 피격되어 피격 간격 3초 안이면 피해가 없다.
  assert.equal(brand((battle) => { battle.player.lastHitAt = battle.time; }).after, 140);
});

test('the radiant cross hits through obstacles along its arms, and the commander stands still while it warns', () => {
  const cross = (bossY, obstacles = []) => {
    const battle = knightBattle({ obstacles });
    const boss = placeBoss(battle, 1700, bossY, 1, 0);
    run(battle, 20);
    const start = boss.x;
    // 20ms에 시전했으므로 1.20초까지 경고하며 멈춰 있고, 1.22초에 피해가 들어간다.
    run(battle, 1180);
    assert.equal(boss.x, start, 'still while warning');
    const before = battle.player.hp;
    run(battle, 20);
    const hit = battle.player.hp;
    run(battle, 500);
    assert.ok(boss.x < start, 'moves again after the warning');
    return [before, hit];
  };
  // 보스 중심(1735,1500)의 가로 팔(y 1470~1530)이 벽 너머 플레이어(y 1480~1520)에 닿는다.
  assert.deepEqual(cross(1455, [{ x: 1600, y: 1400, width: 20, height: 200 }]), [140, 110]);
  // 보스 중심이 y 1600이면 가로 팔(y 1570~1630)과 세로 팔(x 1705~1765) 모두 플레이어에 닿지 않는다.
  assert.deepEqual(cross(1555), [140, 140]);
});

test('the rally summons four soldiers within 90px of the commander, on screen if needed, within the enemy cap', () => {
  const battle = knightBattle();
  battle.player.attackable = false;
  const boss = placeBoss(battle, 1640, 1300, 2, 0);
  battle.player.attackable = true;
  run(battle, 20);
  const soldiers = battle.enemies.filter((enemy) => enemy.kind === 'soldier');
  assert.equal(soldiers.length, 4);
  const around = expand({ ...center(boss), width: 0, height: 0 }, 90);
  for (const soldier of soldiers) {
    assert.ok(contains(around, soldier));
    assert.ok(battle.enemies.every((other) => other === soldier || !overlaps(soldier, other)));
    assert.ok(!overlaps(soldier, battle.player));
  }
  assert.ok(soldiers.some((soldier) => overlaps(soldier, VIEW)), 'summoned on screen');

  // 0:00 단계 최대 30마리 중 28마리가 이미 있으면 2마리만 소환한다.
  const full = knightBattle();
  for (let i = 0; i < 28; i++) full.enemies.push(createEnemy(1000 + i, 'soldier', 60 + i % 10 * 50, 60 + Math.floor(i / 10) * 50));
  placeBoss(full, 1640, 1300, 2, 0);
  run(full, 20);
  assert.equal(full.enemies.filter((enemy) => enemy.kind === 'soldier').length, 30);
});

test('the holy aegis cuts damage to the commander by 70% for exactly 5s', () => {
  const battle = knightBattle();
  const boss = placeBoss(battle, 2300, 1455, 5, 0);
  run(battle, 20);
  assert.equal(battle.bossGuardUntil, 5020);
  run(battle, 4980);
  // 10 × 30% = 3. 방벽은 5.02초에 끝나므로 이 시점에는 아직 유지된다.
  assert.equal(battle.time, 5000);
  battle.dealDamage(boss, 10);
  assert.equal(boss.hp, 1797);
  run(battle, 20);
  battle.dealDamage(boss, 10);
  assert.equal(boss.hp, 1787);
});

test('killing the commander cancels pending attacks, drops one 30-experience orb, and stops its actions', () => {
  const battle = knightBattle();
  const boss = placeBoss(battle, 2300, 1455, 0, 0);
  run(battle, 20);
  assert.equal(battle.hazards.length, 1);
  const point = center(boss);
  battle.dealDamage(boss, 1800);
  assert.deepEqual(battle.hazards, []);
  assert.equal(battle.orbs.length, 1);
  assert.equal(battle.orbs[0].value, 30);
  assert.deepEqual(center(battle.orbs[0]), point);
  run(battle, 10_000);
  assert.equal(battle.player.hp, 140);
  assert.deepEqual(battle.hazards, []);
  assert.ok(!battle.enemies.includes(boss));
});
