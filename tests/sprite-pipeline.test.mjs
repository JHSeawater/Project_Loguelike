import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { rgbaPng } from './helpers/sprite-png.mjs';

function crc32(bytes) {
  let crc=0xffffffff;
  for(const b of bytes) { crc^=b; for(let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  return (crc^0xffffffff)>>>0;
}
function chunk(type, bytes) {
  const out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);out.write(type,4);bytes.copy(out,8);
  out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out;
}
// Small deterministic source fixture: four direction rows with distinct, detached opaque bodies.
function sourcePng(columns) {
  const w=columns*32,h=128,raw=Buffer.alloc((w*4+1)*h),header=Buffer.alloc(13);
  header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;
  for(let r=0;r<4;r++) for(let c=0;c<columns;c++) for(let y=8;y<24;y++) for(let x=8;x<24;x++) {
    const at=(r*32+y)*(w*4+1)+1+(c*32+x)*4;
    raw[at]=80+r*20;raw[at+1]=60+c*10;raw[at+2]=50;raw[at+3]=255;
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

test('batch pipeline caches, repairs corrupt outputs and preserves published files on failed inputs', {skip:process.platform!=='win32'}, () => {
  const root=mkdtempSync(path.join(tmpdir(),'roguelike-sprite-test-'));
  const script=fileURLToPath(new URL('../scripts/process-sprites.ps1',import.meta.url));
  const profile={id:'fixture',folder:'characters',frame_size:[24,24],anchor:[12,20],body_size:[10,10],target_height:16,
    source_rows:['down','right','left','up'],magic:'none',core_alpha:240,body_alpha:128,min_component_area:10,keep_parts:false,part_area:1,
    animations:[{name:'idle',source:'sprite/idle.png',columns:4,fps:6},{name:'walk',source:'sprite/walk.png',columns:6,fps:10},{name:'attack',source:'sprite/attack.png',columns:6,fps:12}]};
  const profilePath=path.join(root,'sprite/profiles/fixture.json');
  const output=path.join(root,'public/assets/sprites/characters');
  const run=(...args)=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-ProjectRoot',root,...args],{encoding:'utf8',windowsHide:true,timeout:30000});
  const report=()=>JSON.parse(readFileSync(path.join(root,'sprite/reports/processing-report.json'),'utf8'));
  const saveProfile=()=>writeFileSync(profilePath,JSON.stringify(profile));
  try {
    mkdirSync(path.dirname(profilePath),{recursive:true});saveProfile();
    const originals=new Map();
    for(const a of profile.animations) { const png=sourcePng(a.columns);originals.set(a.source,png);writeFileSync(path.join(root,a.source),png); }
    let result=run();assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(report()[0].status,'processed');
    const names=['fixture_idle.png','fixture_walk.png','fixture_attack.png','fixture.json'];
    const good=new Map(names.map(n=>[n,readFileSync(path.join(output,n))]));
    const mtimes=names.map(n=>statSync(path.join(output,n)).mtimeMs);
    result=run();assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(report()[0].status,'cached');
    assert.deepEqual(names.map(n=>statSync(path.join(output,n)).mtimeMs),mtimes,'cache leaves bytes and mtimes untouched');
    result=run('-Force');assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(report()[0].status,'processed');
    for(const n of names) assert.deepEqual(readFileSync(path.join(output,n)),good.get(n),'forced processing is deterministic');
    writeFileSync(path.join(output,names[0]),'broken');result=run();
    assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(report()[0].status,'processed');
    assert.deepEqual(readFileSync(path.join(output,names[0])),good.get(names[0]));
    writeFileSync(path.join(root,'sprite/attack.png'),'invalid PNG');result=run();
    assert.equal(result.status,1);assert.equal(report()[0].status,'failed');assert.match(report()[0].error,/attack/);
    for(const n of names) assert.deepEqual(readFileSync(path.join(output,n)),good.get(n),'failure keeps previous published asset');
    assert.ok(readdirSync(output).every(n=>!n.startsWith('.staging-')),'failed staging is cleaned');
    writeFileSync(path.join(root,'sprite/attack.png'),originals.get('sprite/attack.png'));
    profile.animations[0].source='sprite/missing.png';saveProfile();result=run();
    assert.equal(result.status,1);assert.equal(report()[0].status,'missing');
    profile.animations[0].source='../outside.png';saveProfile();result=run();
    assert.equal(result.status,1);assert.equal(report()[0].status,'failed');assert.match(report()[0].error,/escapes root/);
    for(const [name,bytes] of originals) assert.deepEqual(readFileSync(path.join(root,name)),bytes,'source images remain untouched');
    for(const n of names) assert.deepEqual(readFileSync(path.join(output,n)),good.get(n));
  } finally {
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('roguelike-sprite-test-'));
    rmSync(root,{recursive:true,force:true});
  }
});

// Each 32×32 cell holds an L-shaped body and a separate 3×3 speck inside the body's bounding box, above-left of it.
function speckPng(columns) {
  const w=columns*32,h=128,raw=Buffer.alloc((w*4+1)*h),header=Buffer.alloc(13);
  header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;
  const paint=(r,c,x0,y0,x1,y1)=>{ for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) {
    const at=(r*32+y)*(w*4+1)+1+(c*32+x)*4; raw[at]=90;raw[at+1]=70+c*10;raw[at+2]=60;raw[at+3]=255; } };
  for(let r=0;r<4;r++) for(let c=0;c<columns;c++) { paint(r,c,16,4,23,27);paint(r,c,6,20,23,27);paint(r,c,6,4,8,6); }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}

test('largest-shape extraction starts inside that shape, and a profile may carry both attack and cast', {skip:process.platform!=='win32'}, () => {
  const root=mkdtempSync(path.join(tmpdir(),'roguelike-sprite-test-'));
  const script=fileURLToPath(new URL('../scripts/process-sprites.ps1',import.meta.url));
  const animations=[['idle',4],['walk',6],['attack',6],['cast',6]].map(([name,columns])=>({name,source:`sprite/${name}.png`,columns,fps:8}));
  const profile={id:'boss',folder:'enemies',frame_size:[24,24],anchor:[12,20],body_size:[10,10],target_height:16,
    source_rows:['down','left','right','up'],magic:'none',core_alpha:240,body_alpha:128,min_component_area:10,keep_parts:false,part_area:1,animations};
  try {
    mkdirSync(path.join(root,'sprite/profiles'),{recursive:true});
    writeFileSync(path.join(root,'sprite/profiles/boss.json'),JSON.stringify(profile));
    for(const a of animations) writeFileSync(path.join(root,a.source),speckPng(a.columns));
    const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-ProjectRoot',root],{encoding:'utf8',windowsHide:true,timeout:30000});
    const report=JSON.parse(readFileSync(path.join(root,'sprite/reports/processing-report.json'),'utf8'));
    assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(report[0].status,'processed',report[0].error);
    const output=path.join(root,'public/assets/sprites/enemies');
    const manifest=JSON.parse(readFileSync(path.join(output,'boss.json'),'utf8'));
    assert.deepEqual(manifest.sheets.map(s=>s.animation),['idle','walk','attack','cast']);
    assert.deepEqual(Object.keys(manifest.outputs).sort(),['boss_attack.png','boss_cast.png','boss_idle.png','boss_walk.png']);
    // A body grown from the speck would have about 4 opaque pixels; the L body keeps over 100 per frame after scaling.
    const body=rgbaPng(path.join(output,'boss_cast.png'));
    for(let r=0;r<4;r++) for(let c=0;c<6;c++) {
      let count=0;
      for(let y=0;y<24;y++) for(let x=0;x<24;x++) if(body.pixels[((r*24+y)*body.width+c*24+x)*4+3]) count++;
      assert.ok(count>=100,`frame ${r}/${c} has ${count} body pixels`);
    }
  } finally {
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('roguelike-sprite-test-'));
    rmSync(root,{recursive:true,force:true});
  }
});

// Native 6×4 frames (left half dark blue, right half light blue, frame k has a hole at (k+1,1)), drawn 10× larger with gaps.
const nativeStrip = (frames) => Array.from({ length: frames }, (_, k) => (x, y) =>
  x === k + 1 && y === 1 ? null : x < 3 ? [48, 96, 192] : [128, 176, 255]);
function upscaledPng(frames) {
  const scale = 10, w = 20 + frames * 100, h = 100, raw = Buffer.alloc((w * 4 + 1) * h), header = Buffer.alloc(13);
  header.writeUInt32BE(w); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 6;
  nativeStrip(frames).forEach((color, k) => {
    for (let y = 0; y < 4 * scale; y++) for (let x = 0; x < 6 * scale; x++) {
      const rgb = color(Math.floor(x / scale), Math.floor(y / scale)); if (!rgb) continue;
      const at = (30 + y) * (w * 4 + 1) + 1 + (20 + k * 100 + x) * 4;
      raw[at] = rgb[0]; raw[at + 1] = rgb[1]; raw[at + 2] = rgb[2]; raw[at + 3] = 255;
    }
  });
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('one-row strips shrink upscaled pixel art back to its pixels, keep single-frame outputs and make palette variants', {skip:process.platform!=='win32'}, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'roguelike-sprite-test-'));
  const script = fileURLToPath(new URL('../scripts/process-sprites.ps1', import.meta.url));
  const strip = (id, frames, extra = {}) => ({ id, layout: 'strip', folder: 'projectiles', source: `sprite/${id}.png`, frames, fps: 8,
    frame_size: [8, 6], pivot: [4, 3], target_width: 6, align: 'center', alpha: 'binary', ...extra });
  const profiles = [strip('orb', 3, { palettes: [{ suffix: 'blue', color: '#3060c0' }, { suffix: 'red', color: '#c03030' }] }), strip('dart', 1)];
  try {
    mkdirSync(path.join(root, 'sprite/profiles'), { recursive: true });
    for (const p of profiles) {
      writeFileSync(path.join(root, `sprite/profiles/${p.id}.json`), JSON.stringify(p));
      writeFileSync(path.join(root, p.source), upscaledPng(p.frames));
    }
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProjectRoot', root], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    const report = JSON.parse(readFileSync(path.join(root, 'sprite/reports/processing-report.json'), 'utf8'));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(report.map((r) => [r.asset, r.status, r.error]), [['dart', 'processed', undefined], ['orb', 'processed', undefined]]);
    const output = path.join(root, 'public/assets/sprites/projectiles');
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(output, 'dart.json'), 'utf8')).outputs), ['dart.png']);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(output, 'orb.json'), 'utf8')).outputs), ['orb_blue.png', 'orb_red.png']);
    // The 6×4 picture is centered on the (4,3) pivot of each 8×6 cell, so native pixel (x,y) lands at (x+1,y+1).
    const blue = rgbaPng(path.join(output, 'orb_blue.png')), red = rgbaPng(path.join(output, 'orb_red.png'));
    nativeStrip(3).forEach((color, k) => {
      for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) {
        const inside = x >= 1 && x <= 6 && y >= 1 && y <= 4, rgb = inside ? color(x - 1, y - 1) : null;
        const at = (y * blue.width + k * 8 + x) * 4;
        assert.deepEqual([...blue.pixels.subarray(at, at + 4)], rgb ? [...rgb, 255] : [0, 0, 0, 0], `frame ${k} pixel ${x},${y}`);
        // The red variant keeps shape and alpha and turns the dark blue base into the requested red.
        assert.equal(red.pixels[at + 3], blue.pixels[at + 3]);
        if (rgb && x <= 3) assert.deepEqual([...red.pixels.subarray(at, at + 3)], [192, 48, 48]);
      }
    });
  } finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith('roguelike-sprite-test-'));
    rmSync(root, { recursive: true, force: true });
  }
});

// Two 33×20 blocks (red, then blue). With a bridge, a faint 2px band (alpha 40) joins them so no column is empty.
function blocksPng(bridge) {
  const w = 120, h = 40, raw = Buffer.alloc((w * 4 + 1) * h), header = Buffer.alloc(13);
  header.writeUInt32BE(w); header.writeUInt32BE(h, 4); header[8] = 8; header[9] = 6;
  const paint = (x0, x1, y0, y1, rgba) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) rgba.forEach((v, k) => { raw[y * (w * 4 + 1) + 1 + x * 4 + k] = v; }); };
  paint(10, 42, 10, 29, [200, 40, 40, 255]); paint(70, 102, 10, 29, [40, 40, 200, 255]);
  if (bridge) paint(43, 69, 19, 20, [128, 128, 128, 40]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('effect strips split touching frames at the faintest column, stand on the cell bottom and leave no holes at mild reductions', {skip:process.platform!=='win32'}, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'roguelike-sprite-test-'));
  const script = fileURLToPath(new URL('../scripts/process-sprites.ps1', import.meta.url));
  const strip = (id, extra) => ({ id, layout: 'strip', folder: 'effects', source: `sprite/${id}.png`, frames: 2, fps: 12,
    frame_size: [48, 24], pivot: [24, 12], target_width: 20, align: 'center', alpha: 'soft', ...extra });
  const profiles = [[strip('joined', { split: 'valley', align: 'bottom', target_width: 34 }), true], [strip('mild', {}), false]];
  try {
    mkdirSync(path.join(root, 'sprite/profiles'), { recursive: true });
    for (const [p, bridge] of profiles) {
      writeFileSync(path.join(root, `sprite/profiles/${p.id}.json`), JSON.stringify(p));
      writeFileSync(path.join(root, p.source), blocksPng(bridge));
    }
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProjectRoot', root], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    const report = JSON.parse(readFileSync(path.join(root, 'sprite/reports/processing-report.json'), 'utf8'));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(report.map((r) => [r.asset, r.status, r.error]), [['joined', 'processed', undefined], ['mild', 'processed', undefined]]);
    const output = path.join(root, 'public/assets/sprites/effects');
    const opaque = (image, f) => {
      const cells = [];
      for (let y = 0; y < 24; y++) for (let x = 0; x < 48; x++) {
        const at = (y * image.width + f * 48 + x) * 4;
        if (image.pixels[at + 3] === 255) cells.push([x, y, image.pixels[at], image.pixels[at + 2]]);
      }
      return cells;
    };
    const joined = rgbaPng(path.join(output, 'joined.png'));
    for (const [f, red] of [[0, true], [1, false]]) {
      const cells = opaque(joined, f);
      assert.ok(cells.length > 0 && cells.every(([, , r, b]) => red ? r > b : b > r), `frame ${f} holds only its own block`);
      assert.equal(Math.max(...cells.map(([, y]) => y)), 23, `frame ${f} stands on the cell bottom`);
    }
    // 33px blocks shrunk to 20px (1.65:1): every pixel of the reduced block is drawn, with no transparent seams.
    const mild = rgbaPng(path.join(output, 'mild.png'));
    for (const f of [0, 1]) {
      const cells = opaque(mild, f), xs = cells.map(([x]) => x), ys = cells.map(([, y]) => y);
      const width = Math.max(...xs) - Math.min(...xs) + 1, height = Math.max(...ys) - Math.min(...ys) + 1;
      assert.equal(width, 20);
      assert.equal(cells.length, width * height, `frame ${f} is a solid ${width}x${height} block`);
    }
  } finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith('roguelike-sprite-test-'));
    rmSync(root, { recursive: true, force: true });
  }
});
