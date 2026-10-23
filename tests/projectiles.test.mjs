import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle, createEnemy } from '../src/battle.ts';
import { center } from '../src/battle-geometry.ts';

// 움직이는 대상과 투사체의 판정. 플레이어(40×40, 시작 1480,1480, 초당 250px)를 방향키 입력으로 움직이고,
// 10×10 적 투사체를 직접 놓는다. 기대 결과는 두 몸체가 실제로 겹치는 시간 구간을 계산해 정했다.
const FRAMES = [5, 1000 / 60, 20, 50];
const view = () => ({ x: 860, y: 1140, width: 1280, height: 720 });
const enemyShot = (cx, cy, vx, vy) => ({ id: 900, team: 'enemy', x: cx - 5, y: cy - 5, width: 10, height: 10,
  vx, vy, damage: 10, color: 0xffffff, expiresAt: 5000 });
const run = (battle, ms, frame, input) => {
  for (let elapsed = 0; elapsed < ms - 1e-9;) {
    const dt = Math.min(frame, ms - elapsed);
    battle.update(dt, input, view);
    elapsed += dt;
  }
};
// 투사체 하나를 놓고 ms 동안 진행한 뒤 플레이어 체력과 투사체가 남았는지 돌려준다.
const fire = (shot, input, ms, frame, setup = () => {}) => {
  const battle = new Battle([], { spawning: false });
  setup(battle);
  battle.projectiles.push(shot);
  run(battle, ms, frame, input);
  return { battle, hp: battle.player.hp, alive: battle.projectiles.some((s) => s.id === 900) };
};

test('a fast shot hits a body that crosses its path mid-frame and has left the path by the end of the frame', () => {
  // 플레이어는 아래로 움직이고 투사체(y 1473~1483)는 초당 2000px로 오른쪽으로 지나간다.
  // y는 플레이어 위쪽이 1483에 닿기 전(12ms 전)까지, x는 투사체 오른쪽이 1480을 넘은 뒤(5ms 후)부터 겹친다.
  for (const frame of FRAMES) {
    const result = fire(enemyShot(1465, 1478, 2000, 0), { x: 0, y: 1 }, 50, frame);
    assert.equal(result.hp, 90, `${frame}ms`);
    assert.equal(result.alive, false, `${frame}ms`);
  }
});

test('a shot does not hit a body whose path it never actually shares', () => {
  for (const frame of FRAMES) {
    // 수직: 투사체(y 1525~1535)는 15ms에 플레이어 x 범위를 벗어나고, 플레이어 아래쪽은 20ms에야 1525에 닿는다.
    const crossing = fire(enemyShot(1495, 1530, 2000, 0), { x: 0, y: 1 }, 50, frame);
    assert.equal(crossing.hp, 100, `perpendicular ${frame}ms`);
    assert.equal(crossing.alive, true, `perpendicular ${frame}ms`);
    // 대각선(축마다 초당 176.8px): 왼쪽으로 가는 투사체(y 1523~1533)는 13.8ms에 플레이어 왼쪽을 벗어나고,
    // 플레이어 아래쪽은 17.0ms에야 1523에 닿는다.
    const diagonal = fire(enemyShot(1505, 1528, -2000, 0), { x: 1, y: 1 }, 50, frame);
    assert.equal(diagonal.hp, 100, `diagonal miss ${frame}ms`);
    assert.equal(diagonal.alive, true, `diagonal miss ${frame}ms`);
    // 같은 줄에서 25px 오른쪽에서 출발하면 17.0~25.3ms 사이에 겹친다.
    const late = fire(enemyShot(1530, 1528, -2000, 0), { x: 1, y: 1 }, 50, frame);
    assert.equal(late.hp, 90, `diagonal hit ${frame}ms`);
  }
});

test('shots moving with or against a body hit exactly when the gap between them closes', () => {
  for (const frame of FRAMES) {
    // 같은 방향: 초당 280px 투사체가 초당 250px로 달아나는 플레이어를 2px 뒤에서 쫓아 66.7ms에 닿는다.
    assert.equal(fire(enemyShot(1473, 1500, 280, 0), { x: 1, y: 0 }, 60, frame).hp, 100, `chasing 60ms ${frame}ms`);
    assert.equal(fire(enemyShot(1473, 1500, 280, 0), { x: 1, y: 0 }, 80, frame).hp, 90, `chasing 80ms ${frame}ms`);
    // 반대 방향: 서로 초당 530px로 가까워진다. 간격 20px은 37.7ms, 30px은 56.6ms에 닿는다.
    assert.equal(fire(enemyShot(1455, 1500, 280, 0), { x: -1, y: 0 }, 50, frame).hp, 90, `gap 20 ${frame}ms`);
    assert.equal(fire(enemyShot(1445, 1500, 280, 0), { x: -1, y: 0 }, 50, frame).hp, 100, `gap 30 50ms ${frame}ms`);
    assert.equal(fire(enemyShot(1445, 1500, 280, 0), { x: -1, y: 0 }, 60, frame).hp, 90, `gap 30 60ms ${frame}ms`);
  }
});

test('a non-piercing shot stops at the first body it actually meets, even when that body moves away', () => {
  // 첫 테스트의 투사체 경로 뒤(x 1540~1564)에 움직이지 않는 소환물을 둔다. 투사체는 35ms에야 소환물에 닿으므로,
  // 5~12ms에 지나가는 플레이어를 먼저 맞히고 소멸해야 한다.
  for (const frame of FRAMES) {
    let summon;
    const result = fire(enemyShot(1465, 1478, 2000, 0), { x: 0, y: 1 }, 50, frame, (battle) => {
      summon = { id: 1000, x: 1540, y: 1466, width: 24, height: 24, hp: 100, maxHp: 100, attackable: true, lastHitAt: -Infinity };
      battle.allies.push(summon);
    });
    run(result.battle, 200, frame, { x: 0, y: 0 });
    assert.equal(result.battle.player.hp, 90, `${frame}ms`);
    assert.equal(summon.hp, 100, `${frame}ms`);
    assert.equal(result.alive, false, `${frame}ms`);
  }
});

test('shots pass obstacles, but a body blocked by an obstacle is judged where it actually is', () => {
  // 플레이어 오른쪽에 붙은 벽(x 1520~1540)으로 오른쪽 입력이 막힌다. 아래로 가는 투사체는 벽을 통과한다.
  const wall = [{ x: 1520, y: 1400, width: 20, height: 200 }];
  const blocked = (cx) => {
    const battle = new Battle(wall, { spawning: false });
    battle.projectiles.push(enemyShot(cx, 1440, 0, 2000));
    return battle;
  };
  for (const frame of FRAMES) {
    // 투사체(x 1523~1533)는 플레이어가 움직였다면 지났을 자리를 지나지만, 막힌 플레이어(x ~1520)와는 겹치지 않는다.
    const beside = blocked(1528);
    run(beside, 50, frame, { x: 1, y: 0 });
    assert.equal(beside.player.x, 1480, `${frame}ms`);
    assert.equal(beside.player.hp, 100, `${frame}ms`);
    assert.ok(beside.projectiles.some((shot) => shot.id === 900), `${frame}ms`);
    // 투사체(x 1517~1527)는 벽 안을 지나면서 플레이어 오른쪽 3px과 겹친다.
    const grazing = blocked(1522);
    run(grazing, 50, frame, { x: 1, y: 0 });
    assert.equal(grazing.player.hp, 90, `${frame}ms`);
  }
});

test('an auto-fired shot starts at the muzzle and moves at its speed for exactly its age', () => {
  // 적이 움직이지 않도록 플레이어를 공격 불가로 둔다. 플레이어 자동 공격은 그대로 동작한다.
  for (const frame of [20, 50]) {
    const battle = new Battle([], { spawning: false });
    battle.player.attackable = false;
    battle.enemies.push(createEnemy(100, 'paladin', 1950, 1480));
    run(battle, frame, frame, { x: 0, y: 0 });
    const shot = battle.projectiles.find((s) => s.team === 'ally');
    const firedAt = battle.time;
    assert.deepEqual(center(shot), center(battle.player), `${frame}ms`);
    run(battle, 100, frame, { x: 0, y: 0 });
    const moved = Math.hypot(center(shot).x - center(battle.player).x, center(shot).y - center(battle.player).y);
    // 이동량은 700 × 경과 시간의 부동소수점 합이므로 1e-9px 안에서 비교한다.
    assert.ok(Math.abs(moved - 700 * (battle.time - firedAt) / 1000) < 1e-9, `${frame}ms: ${moved}`);
  }
});
