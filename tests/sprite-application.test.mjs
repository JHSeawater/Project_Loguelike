import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SpriteAnimator, SPRITE_ART, SPRITE_DIRECTIONS, STRIP_ART, aegisScale, allyBoltArt, effectDisplay, orbTexture, shotArt, stripFrame } from '../src/sprite-animation.ts';
import { Battle, createEnemy } from '../src/battle.ts';
import { rgbaPng } from './helpers/sprite-png.mjs';

const still = { x: 0, y: 0 };
const view = () => ({ x: 860, y: 1140, width: 1280, height: 720 });

for (const [id, profile] of Object.entries(SPRITE_ART)) {
  test(`${id}: four directions, real movement, action aim, pause and independent instances`, () => {
    const action = profile.animations[2], walk = profile.animations[1].columns, act = action.columns;
    for (const [row, movement] of [[0,{x:0,y:1}],[1,{x:-1,y:0}],[2,{x:1,y:0}],[3,{x:0,y:-1}]]) {
      const animator = new SpriteAnimator(profile);
      assert.deepEqual(animator.sample(0, movement, null), { action:'walk', direction:SPRITE_DIRECTIONS[row], frame:row*walk });
      assert.equal(animator.sample(100, still, null).action, 'idle');
      const event = { at:120, direction:movement, attackMs:50 };
      const pose = animator.sample(120, {x:-movement.x,y:-movement.y}, event);
      assert.deepEqual(pose, { action:action.name, direction:SPRITE_DIRECTIONS[row], frame:row*act+2 });
      assert.deepEqual(animator.sample(120, still, null), pose, 'pause freezes action and direction');
      assert.equal(animator.sample(169, still, event).frame, row*act+act-1);
      assert.equal(animator.sample(170, still, event).action, 'idle');
      assert.deepEqual(new SpriteAnimator(profile).sample(0,still,null), {action:'idle',direction:'down',frame:0});
      assert.equal(new SpriteAnimator(profile).sample(12345,still,null).frame,0,'new summons start from the first idle frame');
    }
  });

  test(`${id}: every published frame and source agrees with its profile and manifest`, () => {
    const base = new URL(`../public/assets/sprites/${profile.folder}/`, import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL(`${profile.id}.json`,base),'utf8'));
    const [w,h] = profile.frame_size;
    let total = 0;
    for (const [index, sheet] of manifest.sheets.entries()) {
      const config = profile.animations[index];
      assert.equal(sheet.animation, config.name);
      assert.equal(sheet.frames_per_direction, config.columns);
      assert.equal(sheet.fps, config.fps);
      assert.deepEqual(sheet.anchor_px, profile.anchor);
      assert.deepEqual(sheet.directions, SPRITE_DIRECTIONS);
      assert.deepEqual(sheet.body_rect_px, [profile.anchor[0]-profile.body_size[0]/2,profile.anchor[1]-profile.body_size[1],...profile.body_size]);
      const source = new URL(`../${sheet.source}`, import.meta.url);
      assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'),sheet.source_sha256);
      const body = rgbaPng(new URL(sheet.body,base));
      assert.deepEqual([body.width,body.height],[config.columns*w,4*h]);
      assert.equal(sheet.magic === null, profile.magic === 'none');
      if (sheet.magic) {
        const fx = rgbaPng(new URL(sheet.magic,base));
        assert.deepEqual([fx.width,fx.height],[body.width,body.height]);
        if (config.effect_required) assert.ok(fx.pixels.some((v,i)=>i%4===3&&v>0),'required effect layer has visible pixels');
      }
      for (const name of [sheet.body,sheet.magic].filter(Boolean)) {
        assert.equal(createHash('sha256').update(readFileSync(new URL(name,base))).digest('hex'),manifest.outputs[name]);
      }
      for (let r=0;r<4;r++) {
        assert.equal(new Set(sheet.extraction.filter(f=>f.DirectionRow===r).map(f=>f.Scale)).size,1);
        const sourceRow = profile.source_rows.indexOf(SPRITE_DIRECTIONS[r]);
        const sourceY = sheet.extraction[r*config.columns].SourceRect[1];
        const orderedY = [...new Set(sheet.extraction.map(f=>f.SourceRect[1]))].sort((a,b)=>a-b);
        assert.equal(sourceY,orderedY[sourceRow], 'profile direction mapping is respected');
        for (let c=0;c<config.columns;c++) {
          let bottom=-1,count=0;
          for (let y=0;y<h;y++) for(let x=0;x<w;x++) {
            const p=((r*h+y)*body.width+c*w+x)*4, alpha=body.pixels[p+3];
            assert.ok(alpha===0||alpha===255);
            if (!alpha) assert.equal(body.pixels.readUInt32BE(p),0);
            else {
              assert.ok(x>=2&&x<w-2&&y>=2&&y<profile.anchor[1], `${sheet.body} ${r}/${c}: safety border`);
              bottom=Math.max(bottom,y);count++;
            }
          }
          assert.equal(bottom,profile.anchor[1]-1);
          assert.ok(count>=100,'readable silhouette'); total++;
        }
      }
    }
    assert.equal(total,profile.animations.reduce((sum,sheet)=>sum+sheet.columns*4,0));
  });
}

test('death knight publishes only real swings, preserving damage, cooldown and shot-only records', () => {
  const b = new Battle([], {character:'deathKnight',spawning:false});
  b.player.attackable=false;
  b.update(20,still,view);
  assert.equal(b.playerAction,null);
  const enemy=createEnemy(100,'paladin',1530,1480);enemy.hp=enemy.maxHp=1000;
  b.enemies.push(enemy); b.update(20,still,view);
  assert.equal(enemy.hp,984);
  // 성기사는 60×80, 데스 나이트 기본 공격은 16 피해 / 800ms다.
  assert.deepEqual(b.playerAction,{at:40,direction:{x:60,y:20},attackMs:800});
  assert.equal(b.playerCast,null);
  const action=b.playerAction;
  b.update(200,still,view); assert.equal(b.playerAction,action);assert.equal(enemy.hp,984);
  b.choices=['damage'];b.update(200,still,view);assert.equal(b.playerAction,action);assert.equal(b.time,240);
  const blocked=new Battle([{x:1521,y:1470,width:8,height:80}],{character:'deathKnight',spawning:false});
  blocked.enemies.push(createEnemy(1,'soldier',1535,1480));blocked.update(20,still,view);
  assert.equal(blocked.playerAction,null,'no animation through an obstacle');
});

test('zombies publish individual real attacks and retain their own cooldown during a pause', () => {
  const b=new Battle([],{character:'necromancer',spawning:false,random:()=>0});
  b.player.attackable=false;b.lastPlayerAttackAt=Infinity;
  for(const [id,x] of [[100,1800],[101,2200]]) {
    const dead=createEnemy(id,'soldier',x,1500);b.enemies.push(dead);b.dealDamage(dead,1000);
  }
  const [a,z]=b.zombies;
  const target=createEnemy(102,'paladin',a.x+30,a.y);target.hp=target.maxHp=1000;
  b.enemies.push(target);b.update(20,still,view);
  assert.equal(target.hp,995);assert.equal(a.action.at,20);assert.equal(a.action.attackMs,1000);
  assert.ok(a.action.direction.x>0);assert.equal(z.action,undefined);
  const event=a.action;
  b.update(200,still,view);assert.equal(a.action,event);assert.equal(target.hp,995);
  b.choices=['damage'];b.update(200,still,view);assert.equal(a.action,event);assert.equal(b.time,220);
  b.choices=[];
  for(let i=0;i<40;i++) b.update(20,still,view);
  assert.equal(a.action.at,1020);assert.equal(target.hp,990);
});

test('enemies publish only real melee and ranged attacks, preserving damage, cooldown and pauses', () => {
  const b=new Battle([],{spawning:false});
  b.player.hp=b.player.maxHp=100000;
  // 플레이어(1480~1520) 오른쪽에 붙은 병사와 사거리 안·밖의 궁사. 병사는 10 피해 / 800ms, 궁사는 5000ms 간격이다.
  const soldier=createEnemy(100,'soldier',1520.5,1480), archer=createEnemy(101,'archer',1690,1480), far=createEnemy(102,'archer',2100,1480);
  for(const enemy of [soldier,archer,far]) enemy.hp=enemy.maxHp=100000;
  b.enemies.push(soldier,archer,far);b.update(20,still,view);
  assert.deepEqual(soldier.action,{at:20,direction:{x:-40.5,y:0},attackMs:800});
  assert.equal(b.player.hp,100000-10);
  assert.equal(archer.action.at,20);assert.equal(archer.action.attackMs,5000);assert.ok(archer.action.direction.x<0);
  assert.equal(b.projectiles.filter(shot=>shot.team==='enemy').length,1);
  assert.equal(far.action,undefined,'no record without a real shot');
  const melee=soldier.action, shot=archer.action;
  b.update(200,still,view);assert.equal(soldier.action,melee);assert.equal(archer.action,shot);
  b.choices=['damage'];b.update(1000,still,view);
  assert.equal(soldier.action,melee);assert.equal(b.time,220);
  b.choices=[];
  for(let i=0;i<40;i++) b.update(20,still,view);
  assert.equal(soldier.action.at,820);assert.equal(archer.action,shot);
});

test('the boss records skill casts with the cast sheet, and its animator switches between attack and cast', () => {
  const b=new Battle([],{character:'deathKnight',spawning:false});
  b.player.hp=b.player.maxHp=100000;
  // 데스 나이트의 베기 반경 밖에 보스를 두고 첫 행동을 바로 쓰게 한다.
  const boss=createEnemy(500,'commander',1900,1455);b.enemies.push(boss);b.boss=boss;
  b['bossActionIndex']=0;b['nextBossActionAt']=0;
  b.update(20,still,view);
  assert.equal(b.hazards.length,1,'the real brand cast happened');
  assert.equal(boss.action.at,20);assert.equal(boss.action.sheet,'cast');assert.ok(boss.action.direction.x<0);
  const cast=boss.action;
  b.update(200,still,view);assert.equal(boss.action,cast,'no record between skills');
  const animator=new SpriteAnimator(SPRITE_ART.commander);
  assert.equal(animator.sample(0,still,{at:0,direction:{x:1,y:0},attackMs:1500}).action,'attack','melee records keep the attack sheet');
  const skill={at:1000,direction:{x:0,y:-1},attackMs:4000,sheet:'cast'};
  assert.deepEqual(animator.sample(1000,still,skill),{action:'cast',direction:'up',frame:3*6+2});
  // 시전 표시는 정점부터 남은 4프레임(12fps, 약 333ms)만 재생하고, 행동 간격 4초 전체를 기다리지 않는다.
  assert.equal(animator.sample(1333,still,skill).frame,3*6+5);
  assert.deepEqual(animator.sample(1334,still,skill),{action:'idle',direction:'up',frame:3*4});
  assert.equal(animator.sample(2000,still,{at:2000,direction:{x:1,y:0},attackMs:1500}).action,'attack');
});

test('priests record a cast only for heals that restore health, keeping their facing', () => {
  const b=new Battle([],{character:'deathKnight',spawning:false});
  b.player.hp=b.player.maxHp=100000;
  // 둘 다 사거리 안에서 멈추는 위치다. 사제는 3초마다 반경 160px 안의 다른 적을 10 회복한다.
  const priest=createEnemy(100,'priest',1700,1460), archer=createEnemy(101,'archer',1690,1530);
  b.enemies.push(priest,archer);
  b.update(20,still,view);
  assert.equal(priest.action,undefined,'nobody was wounded');
  assert.ok(!b.effects.some(effect=>effect.kind==='heal'));
  archer.hp-=12;
  for(let i=0;i<150;i++) b.update(20,still,view);
  assert.equal(archer.hp,archer.maxHp-2);
  assert.equal(priest.action.at,3020);
  assert.deepEqual(priest.action.direction,{x:0,y:0});
  assert.equal(priest.action.attackMs,3000);
});

for (const [id, profile] of Object.entries(STRIP_ART)) {
  test(`${id}: published strip frames agree with the profile, keep the pivot visible and clear transparent color`, () => {
    const base = new URL(`../public/assets/sprites/${profile.folder}/`, import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL(`${profile.id}.json`, base), 'utf8'));
    const [sheet] = manifest.sheets;
    const names = profile.palettes ? profile.palettes.map((palette) => `${profile.id}_${palette.suffix}.png`) : [`${profile.id}.png`];
    assert.deepEqual(Object.keys(manifest.outputs), names);
    assert.equal(createHash('sha256').update(readFileSync(new URL(`../${sheet.source}`, import.meta.url))).digest('hex'), sheet.source_sha256);
    assert.equal(new Set(sheet.extraction.map((frame) => frame.Scale)).size, 1, 'one scale for every frame');
    const [w, h] = profile.frame_size, [px, py] = profile.pivot;
    for (const name of names) {
      assert.equal(createHash('sha256').update(readFileSync(new URL(name, base))).digest('hex'), manifest.outputs[name]);
      const image = rgbaPng(new URL(name, base));
      assert.deepEqual([image.width, image.height], [w * profile.frames, h]);
      for (let f = 0; f < profile.frames; f++) {
        let count = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const at = (y * image.width + f * w + x) * 4, alpha = image.pixels[at + 3];
          if (!alpha) assert.equal(image.pixels.readUInt32BE(at), 0, `${name} ${f}: transparent pixels carry no color`);
          else count++;
          if (profile.alpha === 'binary') assert.ok(alpha === 0 || alpha === 255, `${name} ${f}: binary alpha`);
        }
        assert.ok(count >= 8, `${name} ${f}: visible frame`);
        // 투사체·구슬은 회전·배치 기준점이 그림 위에 있어야 판정 중심과 그림이 어긋나지 않는다.
        // 범위 효과는 유닛이 보이도록 중앙을 비워 두므로 이 검사를 하지 않는다.
        if (profile.folder !== 'effects') assert.ok(image.pixels[(py * image.width + f * w + px) * 4 + 3] > 0, `${name} ${f}: pivot pixel is drawn`);
      }
    }
  });
}

test('class bolts prefer their own art and fall back to the shared bolt; enemy shots follow the shooter', () => {
  assert.equal(allyBoltArt('warlock').id, 'warlock_bolt');
  // 네크로맨서 전용 원본이 아직 없으므로 공용 마탄을 쓴다. 데스 나이트는 투사체를 쏘지 않는다.
  assert.equal(allyBoltArt('necromancer').id, 'ally_magic_bolt');
  assert.equal(shotArt({ team: 'ally' }, 'warlock').id, 'warlock_bolt');
  assert.equal(shotArt({ team: 'ally' }, 'necromancer').id, 'ally_magic_bolt');
  assert.deepEqual(['archer', 'mage', 'crossbowman'].map((source) => shotArt({ team: 'enemy', source }, 'warlock').id),
    ['archer_arrow', 'mage_orb', 'crossbow_bolt']);
  assert.equal(shotArt({ team: 'enemy' }, 'warlock'), null, 'unknown enemy shots keep the plain shape');
  assert.equal(shotArt({ team: 'enemy', source: 'soldier' }, 'warlock'), null);
});

test('experience orb color tiers switch exactly at 2, 4 and 10', () => {
  assert.deepEqual([0.5, 1.5, 2, 3.5, 4, 9.5, 10, 40].map(orbTexture),
    ['exp_orb_blue', 'exp_orb_blue', 'exp_orb_green', 'exp_orb_green', 'exp_orb_gold', 'exp_orb_gold', 'exp_orb_red', 'exp_orb_red']);
});

test('strip frames follow game time from the shot, loop, and hold still while time is paused', () => {
  const bolt = STRIP_ART.warlockBolt, arrow = STRIP_ART.archerArrow;
  // 12fps: 한 프레임은 약 83.3ms다.
  assert.deepEqual([1000, 1083, 1084, 1250, 1333, 1334].map((time) => stripFrame(bolt, time, 1000)), [0, 0, 1, 3, 3, 0]);
  assert.equal(stripFrame(bolt, 1250, 1000), stripFrame(bolt, 1250, 1000), 'the same game time gives the same frame');
  assert.equal(stripFrame(bolt, 900, 1000), 0, 'a shot is never drawn before its first frame');
  assert.equal(stripFrame(arrow, 5000, 0), 0, 'single-frame arrows stay on frame 0');
  assert.equal(stripFrame(STRIP_ART.expOrb, 375), 3, 'orbs loop at 8fps on the global game time');
});

test('enemy shots record their shooter for display while player shots do not', () => {
  const b = new Battle([], { spawning: false });
  b.player.hp = b.player.maxHp = 100000;
  const archer = createEnemy(101, 'archer', 1690, 1480);
  archer.hp = archer.maxHp = 100000;
  b.enemies.push(archer); b.update(20, still, view);
  const shots = b.projectiles;
  assert.deepEqual(shots.filter((shot) => shot.team === 'enemy').map((shot) => shot.source), ['archer']);
  assert.ok(shots.some((shot) => shot.team === 'ally'), 'the warlock fired too');
  assert.ok(shots.filter((shot) => shot.team === 'ally').every((shot) => !('source' in shot)));
});

test('one-shot effects play every frame across their lifetime and scale to the judged size', () => {
  const frames = (kind, ages) => ages.map((age) => effectDisplay({ kind, radius: 100, at: 1000 }, 1000 + age).frame);
  // 범위 효과 150ms: 4장은 장당 37.5ms, 6장은 장당 25ms. 보스 타격·부활 300ms 6장은 장당 50ms.
  assert.deepEqual(frames('swing', [0, 37, 38, 112, 113, 149]), [0, 0, 1, 2, 3, 3]);
  assert.deepEqual(frames('heal', [0, 24, 25, 125, 149]), [0, 0, 1, 5, 5]);
  assert.deepEqual(frames('brand', [0, 49, 50, 250, 299]), [0, 0, 1, 5, 5]);
  assert.equal(effectDisplay({ kind: 'swing', radius: 100, at: 1000 }, 900).frame, 0, 'never before the first frame');
  // 그림 폭(target_width)이 판정 지름이 된다: 베기 반경 100 → 200px / 128px, 사제 회복 반경 160 → 320px / 192px.
  const swing = effectDisplay({ kind: 'swing', radius: 100, at: 0 }, 0), heal = effectDisplay({ kind: 'heal', radius: 160, at: 0 }, 0);
  assert.deepEqual([swing.scaleX, swing.scaleY, swing.rotations], [200 / 128, 200 / 128, [0]]);
  assert.equal(heal.scaleX, 320 / 192);
  assert.equal(effectDisplay({ kind: 'swing', radius: 160, at: 0 }, 0).scaleX, 320 / 128, 'a grown swing radius grows the art');
  // 성광 십자: 광선 폭 60px, 양쪽 팔 전체 1000px를 세로·가로로 한 번씩.
  const cross = effectDisplay({ kind: 'cross', radius: 500, at: 0 }, 0);
  assert.deepEqual([cross.scaleX, cross.scaleY * cross.profile.frame_size[1], cross.rotations], [60 / 60, 1000, [0, Math.PI / 2]]);
  assert.equal(effectDisplay({ kind: 'raise', radius: 0, at: 0 }, 0).scaleX, 1, 'raising keeps its drawn size');
  assert.equal(aegisScale() * STRIP_ART.bossAegis.target_width, 320, 'the aegis ring spans the 160px protection radius');
});

test('boss impacts leave a 300ms display record where the warning resolved, while range effects keep 150ms', () => {
  const b = new Battle([], { character: 'deathKnight', spawning: false });
  b.player.hp = b.player.maxHp = 100000;
  const boss = createEnemy(500, 'commander', 1900, 1455); b.enemies.push(boss); b.boss = boss;
  b['bossActionIndex'] = 0; b['nextBossActionAt'] = 0;
  b.update(20, still, view);
  const [hazard] = b.hazards;
  assert.equal(hazard.kind, 'brand');
  while (b.time < hazard.hitAt) b.update(20, still, view);
  assert.equal(b.hazards.length, 0);
  const impact = b.effects.find((effect) => effect.kind === 'brand');
  assert.deepEqual([impact.x, impact.y, impact.radius, impact.at], [hazard.x, hazard.y, 100, hazard.hitAt]);
  b.choices = ['damage']; b.update(1000, still, view); assert.ok(b.effects.includes(impact), 'a pause keeps the record');
  b.choices = [];
  while (b.time < hazard.hitAt + 280) b.update(20, still, view);
  assert.ok(b.effects.includes(impact), 'still shown before 300ms');
  while (b.time < hazard.hitAt + 300) b.update(20, still, view);
  assert.ok(!b.effects.includes(impact), 'gone at 300ms');
  // 데스 나이트의 베기 표시는 여전히 150ms다.
  const knight = new Battle([], { character: 'deathKnight', spawning: false });
  const target = createEnemy(100, 'paladin', 1530, 1480); target.hp = target.maxHp = 100000; knight.enemies.push(target);
  knight.update(20, still, view);
  const swing = knight.effects.find((effect) => effect.kind === 'swing');
  while (knight.time < swing.at + 140) knight.update(20, still, view);
  assert.ok(knight.effects.includes(swing));
  knight.update(20, still, view);
  assert.ok(!knight.effects.includes(swing));
});
