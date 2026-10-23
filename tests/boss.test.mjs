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
  // 가호 선택창은 게임을 멈추므로 이 검사에서는 끈다.
  battle['nextBlessAt'] = Infinity;
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
  assert.deepEqual([stay.before, stay.after], [160, 125]);
  assert.deepEqual(stay.battle.hazards, []);
  // 원 중심에서 몸체까지 정확히 100px이면 닿은 것이고, 100.5px이면 닿지 않는다.
  assert.equal(brand((battle) => { battle.player.x = 1600; }).after, 125);
  assert.equal(brand((battle) => { battle.player.x = 1600.5; }).after, 160);
  // 피해 시점(1.02초) 0.3초 이내에 피격되었으면 피격 간격 안이라 피해가 없고, 정확히 0.3초 전이면 피해가 들어간다.
  assert.equal(brand((battle) => { battle.player.lastHitAt = battle.hazards[0].hitAt - 299; }).after, 160);
  assert.equal(brand((battle) => { battle.player.lastHitAt = battle.hazards[0].hitAt - 300; }).after, 125);
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
  assert.deepEqual(cross(1455, [{ x: 1600, y: 1400, width: 20, height: 200 }]), [160, 130]);
  // 보스 중심이 y 1600이면 가로 팔(y 1570~1630)과 세로 팔(x 1705~1765) 모두 플레이어에 닿지 않는다.
  assert.deepEqual(cross(1555), [160, 160]);
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

test('the holy aegis cuts damage by 70% for exactly 5s to the commander and enemies touching its 160px radius', () => {
  const battle = knightBattle();
  const boss = placeBoss(battle, 2300, 1455, 5, 0);
  run(battle, 20);
  assert.equal(battle.bossGuardUntil, 5020);
  run(battle, 4980);
  // 10 × 30% = 3. 방벽은 5.02초에 끝나므로 이 시점에는 아직 유지된다.
  assert.equal(battle.time, 5000);
  battle.dealDamage(boss, 10);
  assert.equal(boss.hp, 1797);
  // 보스 중심에서 병사 몸체까지 정확히 160px이면 범위 안, 160.5px이면 범위 밖이다.
  const { x, y } = center(boss);
  const inside = createEnemy(600, 'soldier', x + 160, y - 20);
  const outside = createEnemy(601, 'soldier', x + 160.5, y + 30);
  battle.enemies.push(inside, outside);
  battle.dealDamage(inside, 10);
  battle.dealDamage(outside, 10);
  assert.deepEqual([inside.hp, outside.hp], [22, 15]);
  // 플레이어는 방벽의 영향을 받지 않는다.
  battle.dealDamage(battle.player, 10);
  assert.equal(battle.player.hp, 150);
  run(battle, 20);
  battle.dealDamage(boss, 10);
  battle.dealDamage(inside, 10);
  assert.deepEqual([boss.hp, inside.hp], [1787, 12]);
});

test('killing the commander opens a boss reward window of 3 before pending level-ups, and game over still wins', () => {
  const battle = knightBattle();
  const boss = placeBoss(battle, 2300, 1455, 0, Infinity);
  battle.dealDamage(boss, 1800);
  // 같은 단계에 경험치 5를 얻어 레벨도 오른다.
  const player = center(battle.player);
  battle.orbs.push({ id: 900, x: player.x - 6, y: player.y - 6, width: 12, height: 12, value: 5, pulled: false });
  run(battle, 20);
  assert.equal(battle.choiceSource, 'boss');
  assert.equal(battle.choices.length, 3);
  assert.equal(new Set(battle.choices).size, 3);
  assert.ok(battle.choices.every((id) => ['bossSkill', 'might', 'barrier', 'restore'].includes(id)));
  const time = battle.time;
  run(battle, 1000);
  assert.equal(battle.time, time, 'paused while choosing');
  assert.ok(battle.choose(0));
  assert.equal(battle.choiceSource, 'level');
  assert.equal(battle.choices.length, 3);
  assert.ok(battle.choices.every((id) => !['bossSkill', 'might', 'barrier', 'restore'].includes(id)));

  // 특수 특기를 모두 가졌으면 나머지 3개만 나온다.
  const owned = knightBattle();
  owned.applyReward('deathLord');
  owned.applyReward('bloodFrenzy');
  owned.dealDamage(placeBoss(owned, 2300, 1455, 0, Infinity), 1800);
  run(owned, 20);
  assert.deepEqual(new Set(owned.choices), new Set(['might', 'barrier', 'restore']));

  // 보스 처치와 플레이어 사망이 같은 단계면 게임 종료가 우선한다.
  const dying = knightBattle();
  dying.player.hp = 5;
  dying.dealDamage(placeBoss(dying, 2300, 1455, 0, Infinity), 1800);
  dying.projectiles.push({ id: 901, team: 'enemy', x: 1460, y: 1496, width: 10, height: 10,
    vx: 10000, vy: 0, damage: 10, color: 0xffffff, expiresAt: 5000 });
  run(dying, 20);
  assert.ok(dying.gameOver);
  assert.deepEqual(dying.choices, []);
});

test('the class special skill reward picks one missing special when the window opens and grants exactly that one', () => {
  // 난수를 차례로 돌려준다: 선택지 3개를 고르는 데 3번, 특수 특기를 고르는 데 1번 쓴다.
  const queued = (values) => () => values.shift();
  const killBoss = (battle) => {
    battle.dealDamage(placeBoss(battle, 2300, 1455, 0, Infinity), 1800);
    run(battle, 20);
  };
  // 0이면 후보 첫 번째인 '직업 특수 특기'가 먼저 뽑힌다. 아직 없는 특기는 [피의 광란, 죽음의 군주] 순서다.
  const battle = new Battle([], { character: 'deathKnight', spawning: false, random: queued([0, 0, 0, 0.99]) });
  killBoss(battle);
  assert.equal(battle.choices[0], 'bossSkill');
  assert.equal(battle.bossSpecial, 'deathLord');
  battle.choose(0);
  assert.deepEqual([battle.rewardStacks.deathLord, battle.rewardStacks.bloodFrenzy, battle.bossSpecial], [1, 0, null]);
  // 하나만 남았으면 그 특기다.
  const second = new Battle([], { character: 'warlock', spawning: false, random: queued([0, 0, 0, 0]) });
  second.applyReward('homing');
  killBoss(second);
  assert.equal(second.bossSpecial, 'surgeTuning');
  second.choose(0);
  assert.equal(second.rewardStacks.surgeTuning, 1);
  // '직업 특수 특기'가 선택지에 없으면 정하지 않는다.
  const none = new Battle([], { character: 'warlock', spawning: false, random: queued([0.99, 0.99, 0.99]) });
  killBoss(none);
  assert.ok(!none.choices.includes('bossSkill'));
  assert.equal(none.bossSpecial, null);
});

test('boss rewards grant the class special skill, the commander\'s might and a full restore, without a warlock surge', () => {
  const warlock = new Battle([], { spawning: false });
  warlock.applyReward('bossSkill');
  assert.equal(warlock.rewardStacks.homing, 1);
  assert.equal(warlock.skills.homing, true);
  // 기사단장의 힘: 공격력 ×1.3(반올림), 이동속도 ×1.1. 공격력 강화 3회(16)면 20.8 → 21이다.
  const strong = new Battle([], { spawning: false });
  for (let i = 0; i < 3; i++) strong.applyReward('damage');
  strong.applyReward('might');
  assert.deepEqual([strong.stats.damage, strong.stats.speed], [21, 275]);
  // 데스 나이트는 죽음의 군주(×1.2)까지 곱한다: 16 × 1.2 × 1.3 = 24.96 → 25, 230 × 1.2 × 1.1 = 303.6 → 304.
  const knight = knightBattle();
  knight.bossSpecial = 'deathLord';
  knight.applyReward('bossSkill');
  knight.applyReward('might');
  assert.equal(knight.rewardStacks.deathLord, 1);
  assert.deepEqual([knight.stats.damage, knight.stats.speed, knight.player.maxHp], [25, 304, 192]);
  // 완전 회복: 최대 체력 +30, 체력을 최대치까지 회복한다.
  const hurt = new Battle([], { spawning: false });
  hurt.player.hp = 50;
  hurt.applyReward('restore');
  assert.deepEqual([hurt.player.hp, hurt.player.maxHp], [130, 130]);
  // 보스 보상을 골라도 워록의 마력 폭주는 시작되지 않는다.
  const chooser = new Battle([], { spawning: false });
  chooser.dealDamage(placeBoss(chooser, 2600, 1455, 0, Infinity), 1800);
  run(chooser, 20);
  assert.equal(chooser.choiceSource, 'boss');
  chooser.choose(0);
  assert.equal(chooser.surgeUntil, -Infinity);
});

test('the holy barrier absorbs damage before health, keeps the 0.3s hurt cooldown, and refills after 8s without damage', () => {
  const battle = new Battle([], { spawning: false });
  battle.applyReward('barrier');
  // 최대 체력 100의 15% = 15.
  assert.deepEqual([battle.barrier, battle.barrierMax], [15, 15]);
  battle.dealDamage(battle.player, 10);
  assert.deepEqual([battle.barrier, battle.player.hp], [5, 100]);
  // 배리어가 막아도 피격 간격 0.3초가 시작된다.
  assert.equal(battle.dealDamage(battle.player, 20), false);
  run(battle, 280);
  assert.equal(battle.dealDamage(battle.player, 20), false);
  run(battle, 20);
  battle.dealDamage(battle.player, 25);
  assert.deepEqual([battle.barrier, battle.player.hp], [0, 80]);
  // 마지막 피격(0.3초)에서 8초가 지난 8.3초에 다시 가득 찬다.
  run(battle, 7980);
  assert.equal(battle.barrier, 0);
  run(battle, 20);
  assert.equal(battle.barrier, 15);
  // 최대 체력이 늘면 배리어 최대치도 늘어난다(110의 15% = 16.5 → 17).
  battle.applyReward('maxHp');
  assert.equal(battle.barrierMax, 17);
});

test('killing the commander cancels pending attacks, drops 30 experience as 60 orbs, and stops its actions', () => {
  const battle = knightBattle();
  const boss = placeBoss(battle, 2300, 1455, 0, 0);
  run(battle, 20);
  assert.equal(battle.hazards.length, 1);
  const body = { x: boss.x, y: boss.y, width: boss.width, height: boss.height };
  battle.dealDamage(boss, 1800);
  assert.deepEqual(battle.hazards, []);
  // 경험치 30 = 0.5 구슬 60개가 보스 몸체 안에 생긴다.
  assert.equal(battle.orbs.length, 60);
  assert.ok(battle.orbs.every((orb) => orb.value === 0.5 && contains(body, orb)));
  run(battle, 10_000);
  assert.equal(battle.player.hp, 160);
  assert.deepEqual(battle.hazards, []);
  assert.ok(!battle.enemies.includes(boss));
});
