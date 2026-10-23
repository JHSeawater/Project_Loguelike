import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle, createEnemy } from '../src/battle.ts';
import { BOSS_CONFIG, SKILL_CONFIG as SKILL } from '../src/battle-config.ts';
import { center } from '../src/battle-geometry.ts';
import { REWARDS, REWARD_IDS, emptyStacks, rewardPool, skillStatsFor, statsFor } from '../src/rewards.ts';

// 플레이어(1480,1480, 40×40, 중심 1500,1500) 주변을 비추는 고정 카메라.
const view = () => ({ x: 860, y: 1140, width: 1280, height: 720 });
const run = (battle, ms, input = { x: 0, y: 0 }) => {
  for (let t = 0; t < ms; t += 20) battle.update(20, input, view);
};
// 좀비화 판정에 쓰는 난수를 직접 정한다. 플레이어의 자동 공격은 멈춰 적이 의도치 않게 죽지 않게 한다.
const necro = (obstacles = []) => {
  const state = { roll: 0 };
  const battle = new Battle(obstacles, { character: 'necromancer', spawning: false, random: () => state.roll });
  battle['lastPlayerAttackAt'] = Infinity;
  return { battle, state };
};
const tough = (id, kind, x, y, hp = 100000) => {
  const enemy = createEnemy(id, kind, x, y);
  enemy.hp = enemy.maxHp = hp;
  return enemy;
};
// 중심이 (x, y)인 병사를 처치한다. 새로 일어난 좀비를 돌려주고, 일어나지 않았으면 undefined다.
let nextId = 1000;
const raiseAt = (battle, x, y, kind = 'soldier') => {
  const enemy = createEnemy(nextId++, kind, x - 20, y - 20);
  const before = battle.zombies.length;
  battle.enemies.push(enemy);
  battle.dealDamage(enemy, 100000);
  return battle.zombies.length > before ? battle.zombies.at(-1) : undefined;
};

test('the necromancer starts from its own stats, shoots like the warlock and draws from its own skill pool', () => {
  const { battle } = necro();
  assert.deepEqual([battle.player.hp, battle.player.maxHp], [80, 80]);
  assert.deepEqual(statsFor(emptyStacks(), 'necromancer'),
    { damage: 12, attackMs: 600, speed: 210, shotSpeed: 700, pickupRadius: 100, choiceCount: 3 });
  assert.deepEqual(rewardPool('necromancer'), [...REWARD_IDS, 'plague', 'corpseBoost', 'legion', 'contagion', 'corpseBlast']);
  assert.equal(skillStatsFor(emptyStacks(), 'necromancer').raisePercent, 30);
  // 다른 직업은 적이 죽어도 좀비가 생기지 않는다.
  assert.equal(skillStatsFor(emptyStacks(), 'warlock').raisePercent, 0);
  assert.deepEqual([REWARDS.plague.maxStacks, REWARDS.corpseBoost.maxStacks, REWARDS.legion.maxStacks], [8, Infinity, Infinity]);
  // 투사체 자동 공격: 화면 안의 적에게 공격력 12의 투사체를 쏜다.
  const shooter = new Battle([], { character: 'necromancer', spawning: false });
  shooter.enemies.push(tough(1, 'paladin', 1700, 1440));
  run(shooter, 20);
  assert.equal(shooter.projectiles.find((shot) => shot.team === 'ally').damage, 12);
});

test('a dying non-boss enemy rises as a 30×30 zombie at its center with the raise chance, up to 8 at once', () => {
  const { battle, state } = necro();
  // 확률 30%: 난수 0.299(29.9)는 부활, 0.3(30)은 부활하지 않는다.
  state.roll = 0.3;
  assert.equal(raiseAt(battle, 1900, 1500), undefined);
  state.roll = 0.299;
  const zombie = raiseAt(battle, 1900, 1600);
  assert.deepEqual(center(zombie), { x: 1900, y: 1600 });
  assert.deepEqual([zombie.width, zombie.height, zombie.hp, zombie.maxHp], [30, 30, 60, 60]);
  assert.ok(battle.allies.includes(zombie));
  // 보스는 좀비가 되지 않는다.
  state.roll = 0;
  const boss = createEnemy(nextId++, BOSS_CONFIG.kind, 2200, 2200);
  battle.enemies.push(boss);
  battle.dealDamage(boss, 100000);
  assert.equal(battle.zombies.length, 1);
  // 동시에 최대 8마리다. 이미 1마리가 있으므로 9번 더 부활시켜도 8마리에서 멈춘다.
  for (let i = 0; i < 9; i++) raiseAt(battle, 600 + i * 60, 600);
  assert.deepEqual([battle.zombies.length, SKILL.raise.max, battle.skills.zombieMax], [8, 8, 8]);
  // 좀비 몸체가 장애물에 걸리는 자리에서는 일어나지 않는다(광신도 25×30보다 좀비가 크다).
  const walled = necro([{ x: 2026, y: 1990, width: 10, height: 60 }]).battle;
  const zealot = createEnemy(1, 'zealot', 2000, 2000);
  walled.enemies.push(zealot);
  walled.dealDamage(zealot, 1000);
  assert.equal(walled.zombies.length, 0);
});

test('zombies hit an enemy they touch every 1s, and their kills count with orbs', () => {
  const { battle, state } = necro();
  const zombie = raiseAt(battle, 1800, 1500);
  zombie.hp = zombie.maxHp = 100000;
  state.roll = 0.99;
  // 좀비(1785~1815) 오른쪽 0.5px 옆의 성기사. 성기사는 좀비를 노리지만 이미 닿아 있어 움직이지 않는다.
  const target = tough(1, 'paladin', 1815.5, 1460);
  battle.enemies.push(target);
  run(battle, 20);
  assert.equal(100000 - target.hp, 5);
  run(battle, 980);
  assert.equal(100000 - target.hp, 5);
  run(battle, 20);
  assert.equal(100000 - target.hp, 10);
  // 체력 5인 적을 쓰러뜨리면 처치 수와 경험치 구슬이 생긴다.
  const weak = necro();
  const killer = raiseAt(weak.battle, 1800, 1500);
  killer.hp = killer.maxHp = 100000;
  weak.state.roll = 0.99;
  const prey = tough(2, 'soldier', 1815.5, 1480, 5);
  weak.battle.enemies.push(prey);
  // 좀비를 일으킨 병사의 구슬 2개가 이미 있다.
  const orbsBefore = weak.battle.orbs.length;
  run(weak.battle, 20);
  assert.equal(prey.hp, 0);
  assert.equal(weak.battle.kills, 1);
  assert.equal(weak.battle.orbs.length - orbsBefore, 2);
});

test('zombies chase the nearest enemy within 300px, otherwise return near the player, and the player walks through them', () => {
  // 감지 범위: 좀비 중심 반경 300px 원에 몸체가 닿은 적만 쫓는다.
  assert.equal(SKILL.zombie.senseRadius, 300);
  const { battle } = necro();
  const zombie = raiseAt(battle, 1500, 1800);
  zombie.hp = zombie.maxHp = 100000;
  // 감지 범위 밖의 적은 무시하고 플레이어 중심 150px 안으로 돌아온다(시작 거리 300px).
  // 성기사는 좀비보다 먼저 초당 75px로 다가오므로 302.5px에서 시작해 좀비가 판단할 때 301px이다.
  const ignored = tough(1, 'paladin', 1802.5, 1760);
  battle.enemies.push(ignored);
  run(battle, 20);
  assert.equal(zombie.targetId, null);
  battle.enemies = [];
  run(battle, 3000);
  const distance = () => Math.hypot(center(zombie).x - 1500, center(zombie).y - 1500);
  assert.ok(distance() <= SKILL.zombie.followRadius + 1e-9, String(distance()));
  // 범위 안에서 가장 가까운 적 쪽으로 간다: 왼쪽 180px의 적보다 오른쪽 150px의 적이 가깝다.
  const near = tough(2, 'paladin', center(zombie).x + 150, center(zombie).y - 40);
  const far = tough(3, 'paladin', center(zombie).x - 240, center(zombie).y - 40);
  battle.enemies.push(near, far);
  const before = zombie.x;
  run(battle, 200);
  assert.equal(zombie.targetId, near.id);
  assert.ok(zombie.x > before);
  // 쫓던 적이 범위를 벗어나면 바로 놓는다.
  near.x += 1000; far.x -= 1000;
  run(battle, 20);
  assert.equal(zombie.targetId, null);
  // 이동속도 초당 80px: 같은 줄 오른쪽 범위 안(몸체까지 190px)의 적을 향해 1초에 80px 간다. 둘이 다가와도 아직 닿지 않는다.
  const pace = necro();
  const walker = raiseAt(pace.battle, 1900, 1500);
  walker.hp = walker.maxHp = 100000;
  pace.battle.enemies.push(tough(4, 'paladin', 2090, 1460));
  const startX = walker.x;
  run(pace.battle, 1000);
  assert.ok(Math.abs(walker.x - startX - SKILL.zombie.speed) < 1e-6 && SKILL.zombie.speed === 80, String(walker.x - startX));
  // 플레이어는 좀비를 지나간다.
  const solo = necro();
  const blocker = raiseAt(solo.battle, 1560, 1500);
  blocker.hp = blocker.maxHp = 100000;
  run(solo.battle, 500, { x: 1, y: 0 });
  assert.ok(Math.abs(solo.battle.player.x - (1480 + 105)) < 1e-6);
});

test('enemies target a closer zombie, zombies have a 0.3s hurt cooldown, and dead zombies are removed', () => {
  const { battle } = necro();
  const zombie = raiseAt(battle, 2000, 1500);
  const soldier = tough(1, 'soldier', 2100, 1480);
  battle.enemies.push(soldier);
  run(battle, 20);
  assert.equal(soldier.targetId, zombie.id);
  // 피격 간격: 맞은 뒤 0.3초 동안은 피해가 없다.
  const hits = necro();
  const victim = raiseAt(hits.battle, 2000, 2000);
  assert.ok(hits.battle.dealDamage(victim, 10));
  assert.equal(hits.battle.dealDamage(victim, 10), false);
  run(hits.battle, 280);
  assert.equal(hits.battle.dealDamage(victim, 10), false);
  run(hits.battle, 20);
  assert.ok(hits.battle.dealDamage(victim, 10));
  assert.ok(hits.battle.zombies.includes(victim));
  run(hits.battle, 300);
  hits.battle.dealDamage(victim, 1000);
  assert.equal(victim.hp, 0);
  run(hits.battle, 20);
  assert.ok(!hits.battle.zombies.includes(victim) && !hits.battle.allies.includes(victim));
  // 플레이어가 죽으면 좀비도 모두 죽는다.
  const doomed = necro();
  const left = raiseAt(doomed.battle, 2000, 2000);
  doomed.battle.dealDamage(doomed.battle.player, 1000);
  assert.ok(doomed.battle.gameOver);
  assert.equal(left.hp, 0);
});

test('legion raises the zombie cap by 1 per stack without a limit, and a full army can grow right after picking it', () => {
  // 8마리로 가득 찬 상태에서는 더 일어나지 않는다.
  const { battle } = necro();
  for (let i = 0; i < 8; i++) raiseAt(battle, 600 + i * 60, 600);
  assert.equal(raiseAt(battle, 600, 700), undefined);
  // 망자의 군세 1회: 최대 9마리가 되어 바로 한 마리 더 일어나고, 그 뒤에는 다시 멈춘다.
  battle.applyReward('legion');
  assert.equal(battle.skills.zombieMax, 9);
  assert.ok(raiseAt(battle, 660, 700));
  assert.equal(raiseAt(battle, 720, 700), undefined);
  assert.equal(battle.zombies.length, 9);
  // 중첩 제한이 없다: 20회면 8 + 20 = 28마리다. 다른 직업은 최대 수가 0이다.
  const stacks = emptyStacks();
  stacks.legion = 20;
  assert.equal(skillStatsFor(stacks, 'necromancer').zombieMax, 28);
  assert.equal(skillStatsFor(stacks, 'warlock').zombieMax, 0);
  assert.ok(rewardPool('necromancer').includes('legion') && !rewardPool('warlock').includes('legion'));
});

test('plague raises the chance up to 70%, corpse boost strengthens zombies, contagion adds 20%p to zombie kills', () => {
  // 역병 확산 3회: 30 + 15 = 45%.
  const plague = necro();
  for (let i = 0; i < 3; i++) plague.battle.applyReward('plague');
  assert.equal(plague.battle.skills.raisePercent, 45);
  plague.state.roll = 0.45;
  assert.equal(raiseAt(plague.battle, 1900, 1500), undefined);
  plague.state.roll = 0.449;
  assert.ok(raiseAt(plague.battle, 1900, 1600));
  const capped = emptyStacks();
  capped.plague = 8;
  assert.equal(skillStatsFor(capped, 'necromancer').raisePercent, 70);
  // 시체 강화 2회: 새 좀비 체력 60 × 140% = 84, 공격력 5 × 140% = 7.
  const boost = necro();
  boost.battle.applyReward('corpseBoost');
  boost.battle.applyReward('corpseBoost');
  const strong = raiseAt(boost.battle, 1800, 1500);
  assert.deepEqual([strong.hp, strong.maxHp], [84, 84]);
  strong.hp = strong.maxHp = 100000;
  boost.state.roll = 0.99;
  const target = tough(1, 'paladin', 1815.5, 1460);
  boost.battle.enemies.push(target);
  run(boost.battle, 20);
  assert.equal(100000 - target.hp, 7);
  // 전염: 좀비가 처치한 적은 50%, 플레이어가 처치한 적은 그대로 30%. 난수 0.49로 비교한다.
  const spread = necro();
  spread.battle.applyReward('contagion');
  const biter = raiseAt(spread.battle, 1800, 1500);
  biter.hp = biter.maxHp = 100000;
  spread.state.roll = 0.49;
  assert.equal(raiseAt(spread.battle, 2400, 2400), undefined);
  const prey = tough(2, 'soldier', 1815.5, 1480, 5);
  spread.battle.enemies.push(prey);
  run(spread.battle, 20);
  assert.equal(prey.hp, 0);
  assert.equal(spread.battle.zombies.length, 2);
});

test('corpse blast hits enemies touching an 80px circle with 200% of the player damage when a zombie dies', () => {
  const { battle, state } = necro();
  battle.applyReward('corpseBlast');
  // 좀비(중심 2000,2000)가 일어날 때는 폭발하지 않는다.
  const inside = tough(1, 'soldier', 2080, 1980);
  const outside = tough(2, 'soldier', 1960, 2080.5);
  const zombie = raiseAt(battle, 2000, 2000);
  battle.enemies.push(inside, outside);
  assert.deepEqual([100000 - inside.hp, 100000 - outside.hp, battle.effects.length], [0, 0, 0]);
  // 좀비가 죽으면 그 중심에서 폭발한다. 오른쪽 병사의 왼쪽 면까지 정확히 80px이면 맞고, 80.5px이면 맞지 않는다. 12 × 200% = 24.
  state.roll = 0.99;
  battle.dealDamage(zombie, 1000);
  assert.deepEqual([100000 - inside.hp, 100000 - outside.hp], [24, 0]);
  assert.equal(battle.effects.at(-1).kind, 'blast');
  assert.deepEqual([battle.effects.at(-1).x, battle.effects.at(-1).y], [2000, 2000]);
  // 폭발로 죽은 적도 처치 수와 구슬이 한 번씩 생기고 좀비화를 판정한다(난수 0이면 부활).
  const chain = necro();
  chain.battle.applyReward('corpseBlast');
  const victim = raiseAt(chain.battle, 2000, 2000);
  const weak = tough(3, 'soldier', 2030, 1980, 24);
  chain.battle.enemies.push(weak);
  const orbsBefore = chain.battle.orbs.length;
  chain.battle.dealDamage(victim, 1000);
  assert.equal(weak.hp, 0);
  assert.equal(chain.battle.kills, 1);
  assert.equal(chain.battle.orbs.length - orbsBefore, 2);
  assert.ok(chain.battle.zombies.some((other) => other !== victim && other.hp > 0));
  // 시체 폭발이 없으면 좀비가 죽어도 피해가 없고, 플레이어가 죽어 함께 사라지는 좀비는 폭발하지 않는다.
  const plain = necro();
  const quiet = raiseAt(plain.battle, 2000, 2000);
  const near = tough(5, 'soldier', 2030, 1980);
  plain.battle.enemies.push(near);
  plain.battle.dealDamage(quiet, 1000);
  assert.equal(near.hp, 100000);
  const doomed = necro();
  doomed.battle.applyReward('corpseBlast');
  raiseAt(doomed.battle, 2000, 2000);
  const bystander = tough(6, 'soldier', 2030, 1980);
  doomed.battle.enemies.push(bystander);
  doomed.battle.dealDamage(doomed.battle.player, 1000);
  assert.equal(bystander.hp, 100000);
});
