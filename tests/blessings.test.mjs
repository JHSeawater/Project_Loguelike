import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle, createEnemy } from '../src/battle.ts';
import { BOSS_CONFIG, BLESS_CONFIG, ENEMY_STATS } from '../src/battle-config.ts';
import { center } from '../src/battle-geometry.ts';
import { BLESS_IDS, REWARDS } from '../src/rewards.ts';

// 플레이어(중심 1500,1500) 주변을 비추는 고정 카메라.
const VIEW = { x: 860, y: 1140, width: 1280, height: 720 };
const view = () => VIEW;
const seeded = (seed) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const run = (battle, ms, frame = 20) => {
  for (let elapsed = 0; elapsed < ms - 1e-9;) {
    const dt = Math.min(frame, ms - elapsed);
    battle.update(dt, { x: 0, y: 0 }, view);
    elapsed += dt;
  }
};
// 데스 나이트는 반경 100px 밖의 적을 공격하지 않으므로 멀리 둔 적이 그대로 남는다.
const knightBattle = () => new Battle([], { character: 'deathKnight', spawning: false, random: seeded(5) });
const blessing = (battle, id, times = 1) => { for (let i = 0; i < times; i++) battle.applyReward(id); };

test('every 2 minutes of game time a blessing window offers the three blessings and pauses the game', () => {
  assert.equal(BLESS_CONFIG.everyMs, 120_000);
  const battle = new Battle([], { spawning: false });
  battle.time = 119_960;
  run(battle, 20);
  assert.deepEqual(battle.choices, []);
  // 정확히 2:00에 열린다.
  run(battle, 20);
  assert.equal(battle.time, 120_000);
  assert.equal(battle.choiceSource, 'blessing');
  assert.deepEqual(battle.choices, ['blessHp', 'blessSpeed', 'blessDamage']);
  assert.ok(BLESS_IDS.every((id) => REWARDS[id].blessing && REWARDS[id].tier === undefined && REWARDS[id].maxStacks === Infinity));
  // 고르기 전에는 게임 시간이 흐르지 않는다.
  run(battle, 1000);
  assert.equal(battle.time, 120_000);
  assert.ok(battle.choose(1));
  assert.deepEqual([battle.choices, battle.rewardStacks.blessSpeed, battle.blessPercent('blessSpeed')], [[], 1, 110]);
  // 가호를 골라도 워록의 마력 폭주는 시작되지 않는다.
  assert.equal(battle.surgeUntil, -Infinity);
  // 다음 가호는 4:00이며, 같은 가호를 다시 고를 수 있다.
  battle.time = 239_960;
  run(battle, 20);
  assert.deepEqual(battle.choices, []);
  run(battle, 20);
  assert.deepEqual(battle.choices, BLESS_IDS);
  battle.choose(1);
  assert.equal(battle.blessPercent('blessSpeed'), 120);
});

test('the blessing window opens after the boss reward and before level-ups, and game over still wins', () => {
  const battle = knightBattle();
  battle.time = 119_980;
  const boss = createEnemy(500, BOSS_CONFIG.kind, 2300, 1455);
  battle.enemies.push(boss);
  battle.boss = boss;
  battle['nextBossActionAt'] = Infinity;
  battle.dealDamage(boss, 1800);
  // 보스 구슬은 멀리 떨어져 있으므로 플레이어 자리에 경험치 5를 따로 둔다.
  const player = center(battle.player);
  battle.orbs.push({ id: 900, x: player.x - 6, y: player.y - 6, width: 12, height: 12, value: 5, pulled: false });
  run(battle, 20);
  assert.equal(battle.choiceSource, 'boss');
  battle.choose(0);
  assert.equal(battle.choiceSource, 'blessing');
  battle.choose(2);
  assert.equal(battle.choiceSource, 'level');
  assert.equal(battle.choices.length, 3);
  assert.equal(battle.rewardStacks.blessDamage, 1);

  const dying = knightBattle();
  dying.time = 119_980;
  dying.player.hp = 5;
  dying.projectiles.push({ id: 901, team: 'enemy', x: 1460, y: 1496, width: 10, height: 10,
    vx: 10000, vy: 0, damage: 10, color: 0xffffff, expiresAt: 200_000 });
  run(dying, 20);
  assert.ok(dying.gameOver);
  assert.deepEqual(dying.choices, []);
});

test('the health blessing adds 10% per pick to enemies spawned afterwards, summed with time growth, and leaves existing ones', () => {
  const battle = knightBattle();
  battle['nextBlessAt'] = Infinity;
  const spawn = () => battle.spawnEnemy('paladin', VIEW);
  const before = spawn();
  assert.equal(before.hp, ENEMY_STATS.paladin.hp);
  blessing(battle, 'blessHp', 2);
  // 130 × 120% = 156. 이미 있던 적은 그대로다.
  assert.deepEqual([spawn().maxHp, before.hp, before.maxHp], [156, 130, 130]);
  // 11:00의 시간 증가 +10%와 더한다(복리 아님): 130 × 130% = 169.
  battle.time = 660_000;
  assert.equal(spawn().maxHp, 169);
  // 보스와 소집된 병사도 같은 규칙으로 생성된다: 1800 × 130% = 2340.
  assert.equal(battle.spawnEnemy(BOSS_CONFIG.kind, VIEW).maxHp, 2340);
});

test('the speed blessing makes every enemy, including ones already on the field, move 10% faster per pick', () => {
  const travel = (picks) => {
    const battle = knightBattle();
    battle['nextBlessAt'] = Infinity;
    const soldier = createEnemy(100, 'soldier', 2300, 1480);
    battle.enemies.push(soldier);
    blessing(battle, 'blessSpeed', picks);
    const start = soldier.x;
    run(battle, 1000);
    return start - soldier.x;
  };
  const base = ENEMY_STATS.soldier.speed;
  assert.ok(Math.abs(travel(0) - base) < 1e-6);
  assert.ok(Math.abs(travel(1) - base * 1.1) < 1e-6);
  assert.ok(Math.abs(travel(3) - base * 1.3) < 1e-6);
});

test('the damage blessing raises contact, projectile and boss attack damage by 10% per pick, rounded', () => {
  const { knight, archer } = ENEMY_STATS;
  // 접촉 피해: 플레이어 바로 오른쪽에 붙은 기사.
  const contact = new Battle([], { character: 'deathKnight', spawning: false });
  contact['nextBlessAt'] = Infinity;
  blessing(contact, 'blessDamage');
  const brute = createEnemy(100, 'knight', 1520, 1480);
  brute.hp = brute.maxHp = 100000;
  contact.enemies.push(brute);
  run(contact, 20);
  assert.equal(160 - contact.player.hp, Math.round(knight.damage * 1.1));
  // 원거리 공격: 이미 있던 궁사가 쏜 투사체에도 적용된다.
  const ranged = knightBattle();
  ranged['nextBlessAt'] = Infinity;
  ranged.enemies.push(createEnemy(101, 'archer', 1700, 1480));
  blessing(ranged, 'blessDamage', 2);
  run(ranged, 20);
  const shot = ranged.projectiles.find((item) => item.team === 'enemy');
  assert.equal(shot.damage, Math.round(archer.damage * 1.2));
  // 보스 범위 공격: 심판의 낙인 35 × 110% = 38.5 → 39.
  const brand = knightBattle();
  brand['nextBlessAt'] = Infinity;
  blessing(brand, 'blessDamage');
  const boss = createEnemy(500, BOSS_CONFIG.kind, 2300, 1455);
  brand.enemies.push(boss);
  brand.boss = boss;
  brand['bossActionIndex'] = 0;
  brand['nextBossActionAt'] = 0;
  run(brand, 20);
  run(brand, 1000);
  assert.equal(brand.player.hp, 160 - 39);
});
