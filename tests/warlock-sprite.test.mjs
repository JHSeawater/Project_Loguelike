import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { rgbaPng } from './helpers/sprite-png.mjs';
import { Battle, createEnemy } from '../src/battle.ts';
import { WARLOCK_ART, WarlockAnimator } from '../src/warlock-animation.ts';

const still = { x: 0, y: 0 };
const view = () => ({ x: 860, y: 1140, width: 1280, height: 720 });

test('idle and walking follow game time, actual displacement, and the four direction rows', () => {
  const animator = new WarlockAnimator();
  assert.deepEqual(animator.sample(0, still, null), { action: 'idle', direction: 'down', frame: 0 });
  assert.equal(animator.sample(167, still, null).frame, 1);
  assert.deepEqual(animator.sample(200, { x: 2, y: 0 }, null), { action: 'walk', direction: 'right', frame: 12 });
  assert.equal(animator.sample(500, { x: 2, y: 0 }, null).frame, 15);
  assert.deepEqual(animator.sample(600, still, null), { action: 'idle', direction: 'right', frame: 8 });
  assert.equal(animator.sample(800, still, null).frame, 9);
  for (const [row, direction, movement] of [
    [0, 'down', { x: 0, y: 1 }], [1, 'left', { x: -1, y: 0 }],
    [2, 'right', { x: 1, y: 0 }], [3, 'up', { x: 0, y: -1 }],
  ]) {
    assert.deepEqual(new WarlockAnimator().sample(0, movement, null), { action: 'walk', direction, frame: row * 6 });
  }
  // 입력 키를 계속 눌러도 실제 변위가 0인 충돌 상태는 대기 동작이다.
  assert.equal(new WarlockAnimator().sample(100, still, null).action, 'idle');
});

test('a cast starts at the release pose, keeps its aim while moving, and returns to locomotion', () => {
  const animator = new WarlockAnimator();
  const cast = { at: 300, direction: { x: 0, y: -10 }, attackMs: 500 };
  animator.sample(0, still, null);
  assert.deepEqual(animator.sample(300, { x: -1, y: 0 }, cast), { action: 'cast', direction: 'up', frame: 20 });
  assert.equal(animator.sample(400, { x: -1, y: 0 }, cast).frame, 21);
  assert.equal(animator.sample(550, { x: -1, y: 0 }, cast).frame, 23);
  assert.deepEqual(animator.sample(634, { x: -1, y: 0 }, cast), { action: 'walk', direction: 'left', frame: 6 });
  assert.equal(animator.sample(734, { x: -1, y: 0 }, cast).frame, 7);
});

test('unchanged game time freezes the whole pose, and repeated shot records do not restart a cast', () => {
  const animator = new WarlockAnimator();
  const cast = { at: 0, direction: { x: 1, y: 0 }, attackMs: 500 };
  animator.sample(0, still, cast);
  const frozen = animator.sample(100, still, cast);
  for (let i = 0; i < 20; i++) assert.deepEqual(animator.sample(100, { x: -1, y: 1 }, cast), frozen);
  assert.equal(animator.sample(250, still, cast).frame, 17);
  assert.deepEqual(animator.sample(334, still, cast), { action: 'idle', direction: 'right', frame: 8 });
  assert.deepEqual(new WarlockAnimator().sample(0, still, null), { action: 'idle', direction: 'down', frame: 0 });
});

test('rapid attacks cap the visual duration and a newer volley restarts only once', () => {
  const animator = new WarlockAnimator();
  const first = { at: 0, direction: { x: 1, y: 0 }, attackMs: 50 };
  assert.equal(animator.sample(0, still, first).frame, 14);
  assert.equal(animator.sample(49, still, first).frame, 17);
  assert.equal(animator.sample(50, still, first).action, 'idle');
  const second = { at: 51, direction: { x: -1, y: 0 }, attackMs: 50 };
  assert.equal(animator.sample(51, still, second).frame, 8);
  assert.equal(animator.sample(76, still, second).frame, 10);
});

test('actual volleys publish aim and effective attack speed without changing shot timing or movement', () => {
  const battle = new Battle([], { spawning: false });
  battle.player.attackable = false;
  battle.applyReward('multiShot');
  battle.surgeUntil = 1000;
  const enemy = createEnemy(100, 'paladin', 1700, 1480);
  battle.enemies.push(enemy);
  const startX = battle.player.x;
  battle.update(20, { x: 1, y: 0 }, view);
  assert.equal(battle.projectiles.length, 2);
  assert.equal(battle.playerCast.at, 20);
  assert.equal(battle.playerCast.attackMs, 400);
  assert.deepEqual(battle.playerCast.direction, {
    x: enemy.x + enemy.width / 2 - (battle.player.x + battle.player.width / 2),
    y: enemy.y + enemy.height / 2 - (battle.player.y + battle.player.height / 2),
  });
  assert.ok(Math.abs(battle.player.x - startX - 230 * 1.2 * 0.02) < 1e-9, 'floating-point position tolerance 1e-9 px');
  const cast = battle.playerCast;
  battle.update(250, still, view);
  assert.equal(battle.playerCast, cast);
  battle.update(150, still, view);
  assert.equal(battle.playerCast.at, 420);
  battle.choices = ['damage'];
  const paused = battle.playerCast;
  battle.update(250, { x: 1, y: 0 }, view);
  assert.equal(battle.time, 420);
  assert.equal(battle.playerCast, paused);
});

test('cast display survives projectile impact; no target and melee attacks produce no shot event', () => {
  const battle = new Battle([], { spawning: false });
  battle.player.attackable = false;
  battle.enemies.push(createEnemy(100, 'soldier', 1530, 1480));
  battle.update(250, still, view);
  assert.equal(battle.projectiles.length, 0);
  assert.equal(battle.enemies[0].hp, 15);
  assert.equal(battle.playerCast.at, 50);
  const absent = new Battle([], { spawning: false });
  absent.update(250, still, view);
  assert.equal(absent.playerCast, null);
  const knight = new Battle([], { spawning: false, character: 'deathKnight' });
  knight.enemies.push(createEnemy(100, 'soldier', 1530, 1480));
  knight.update(20, still, view);
  assert.equal(knight.playerCast, null);
  assert.ok(knight.effects.some(effect => effect.kind === 'swing'));
});

// 최종 PNG의 픽셀을 직접 검사한다. 외부 이미지 라이브러리나 테스트 전용 파일 변환을 요구하지 않는다.
test('processed PNGs have exact cells, binary bodies, separate magic, fixed feet, and intact sources', () => {
  const directory = new URL('../public/assets/sprites/characters/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('warlock.json', directory), 'utf8').replace(/^\uFEFF/, ''));
  let frameCount = 0;
  for (const sheet of manifest.sheets) {
    const source = readFileSync(new URL(`../${sheet.source}`, import.meta.url));
    assert.equal(createHash('sha256').update(source).digest('hex'), sheet.source_sha256);
    assert.deepEqual(sheet.directions, ['down', 'left', 'right', 'up']);
    assert.deepEqual(sheet.anchor_px, [WARLOCK_ART.footX, WARLOCK_ART.footY]);
    const body = rgbaPng(new URL(sheet.body, directory)), magic = rgbaPng(new URL(sheet.magic, directory));
    const columns = WARLOCK_ART.sheets[sheet.animation].columns;
    assert.deepEqual([body.width, body.height], [columns * 64, 256]);
    assert.deepEqual([magic.width, magic.height], [body.width, body.height]);
    let magicCount = 0;
    for (let i = 0; i < body.pixels.length; i += 4) {
      const alpha = body.pixels[i + 3];
      assert.ok(alpha === 0 || alpha === 255, 'body alpha is binary');
      if (alpha === 0) assert.equal(body.pixels.readUInt32BE(i), 0, 'transparent RGB cleaned');
      if (magic.pixels[i + 3] > 0) magicCount++;
    }
    assert.ok(magicCount > 20, 'separate hand magic is present');
    for (let row = 0; row < 4; row++) {
      const scales = sheet.extraction.filter(frame => frame.DirectionRow === row).map(frame => frame.Scale);
      assert.equal(new Set(scales).size, 1, 'fixed scale within a direction prevents size pumping');
      for (let col = 0; col < columns; col++) {
        let bottom = -1, count = 0;
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
          const alpha = body.pixels[((row * 64 + y) * body.width + col * 64 + x) * 4 + 3];
          if (alpha > 0) {
            assert.ok(x >= 2 && x < 62 && y >= 2 && y < 60, `${sheet.body}: unclipped body`);
            bottom = Math.max(bottom, y); count++;
          }
        }
        assert.equal(bottom, 59, 'last opaque foot row leaves exactly 4px below');
        assert.ok(count > 400, 'a readable body silhouette is present');
        frameCount++;
      }
    }
    // 원본 2행이 오른쪽, 3행이 왼쪽인 자료를 게임의 left/right 순서로 재배열했다.
    assert.ok(sheet.extraction[columns].SourceRect[1] > sheet.extraction[columns * 2].SourceRect[1]);
  }
  assert.equal(frameCount, 64);
});
