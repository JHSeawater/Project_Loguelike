import warlock from '../sprite/profiles/warlock.json' with { type: 'json' };
import deathKnight from '../sprite/profiles/death_knight.json' with { type: 'json' };
import necromancer from '../sprite/profiles/necromancer.json' with { type: 'json' };
import zombie from '../sprite/profiles/zombie.json' with { type: 'json' };
import soldier from '../sprite/profiles/soldier.json' with { type: 'json' };
import knight from '../sprite/profiles/knight.json' with { type: 'json' };
import paladin from '../sprite/profiles/paladin.json' with { type: 'json' };
import archer from '../sprite/profiles/archer.json' with { type: 'json' };
import mage from '../sprite/profiles/mage.json' with { type: 'json' };
import zealot from '../sprite/profiles/zealot.json' with { type: 'json' };
import crossbowman from '../sprite/profiles/crossbowman.json' with { type: 'json' };
import priest from '../sprite/profiles/priest.json' with { type: 'json' };
import commander from '../sprite/profiles/commander.json' with { type: 'json' };
import allyMagicBolt from '../sprite/profiles/ally_magic_bolt.json' with { type: 'json' };
import warlockBolt from '../sprite/profiles/warlock_bolt.json' with { type: 'json' };
import mageOrb from '../sprite/profiles/mage_orb.json' with { type: 'json' };
import archerArrow from '../sprite/profiles/archer_arrow.json' with { type: 'json' };
import crossbowBolt from '../sprite/profiles/crossbow_bolt.json' with { type: 'json' };
import expOrb from '../sprite/profiles/exp_orb.json' with { type: 'json' };
import deathSlash from '../sprite/profiles/death_slash.json' with { type: 'json' };
import magicExplosion from '../sprite/profiles/magic_explosion.json' with { type: 'json' };
import corpseBlast from '../sprite/profiles/corpse_blast.json' with { type: 'json' };
import priestHeal from '../sprite/profiles/priest_heal.json' with { type: 'json' };
import bossBrandImpact from '../sprite/profiles/boss_brand_impact.json' with { type: 'json' };
import bossCrossImpact from '../sprite/profiles/boss_cross_impact.json' with { type: 'json' };
import bossAegis from '../sprite/profiles/boss_aegis.json' with { type: 'json' };
import raiseZombie from '../sprite/profiles/raise_zombie.json' with { type: 'json' };
import { effectLifetime, type AttackEffect, type PlayerCast, type Projectile } from './battle.ts';
import { BOSS_CONFIG, type CharacterId, type EnemyKind } from './battle-config.ts';

export const SPRITE_DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export type SpriteDirection = typeof SPRITE_DIRECTIONS[number];
export type SpriteAction = 'idle' | 'walk' | 'cast' | 'attack';
export interface SpriteProfile {
  id: string;
  folder: string;
  frame_size: number[];
  anchor: number[];
  magic: string;
  animations: { name: string; columns: number; fps: number }[];
}
export const ENEMY_ART: Record<EnemyKind, SpriteProfile> = { soldier, knight, paladin, archer, mage, zealot, crossbowman, priest, commander };
export const SPRITE_ART = { warlock, deathKnight, necromancer, zombie, ...ENEMY_ART } satisfies Record<string, SpriteProfile>;
export interface SpritePose { action: SpriteAction; direction: SpriteDirection; frame: number }

// 방향 행이 없는 가로 1행 시트(투사체·구슬). 기준점이 판정 중심에 오고, 색 변형은 `{id}_{suffix}` 텍스처다.
export interface StripProfile {
  id: string;
  folder: string;
  frames: number;
  fps: number;
  frame_size: number[];
  pivot: number[];
  // 가장 넓은 프레임의 그림 폭. 범위 효과는 이 폭이 실제 지름이 되도록 확대한다.
  target_width: number;
  palettes?: { suffix: string; color: string }[];
}
export const STRIP_ART = {
  allyMagicBolt, warlockBolt, mageOrb, archerArrow, crossbowBolt, expOrb,
  deathSlash, magicExplosion, corpseBlast, priestHeal, bossBrandImpact, bossCrossImpact, bossAegis, raiseZombie,
} satisfies Record<string, StripProfile>;
const EFFECT_ART: Record<AttackEffect['kind'], StripProfile> = {
  swing: deathSlash, explosion: magicExplosion, blast: corpseBlast, heal: priestHeal,
  brand: bossBrandImpact, cross: bossCrossImpact, raise: raiseZombie,
};
// 직업 전용 마탄이 있으면 그것을, 없으면 공용 마탄을 쓴다.
const CLASS_BOLTS: Partial<Record<CharacterId, StripProfile>> = { warlock: warlockBolt };
const ENEMY_SHOTS: Partial<Record<EnemyKind, StripProfile>> = { archer: archerArrow, mage: mageOrb, crossbowman: crossbowBolt };

export function allyBoltArt(character: CharacterId): StripProfile {
  return CLASS_BOLTS[character] ?? allyMagicBolt;
}

// 외형이 없는 적 투사체는 null이며 기존 도형으로 그린다.
export function shotArt(shot: Pick<Projectile, 'team' | 'source'>, character: CharacterId): StripProfile | null {
  if (shot.team === 'ally') return allyBoltArt(character);
  return (shot.source && ENEMY_SHOTS[shot.source]) ?? null;
}

// 구슬 색 구간: 2 미만 파랑, 2~3 초록, 4~9 금색, 10 이상 빨강. 합쳐져 값이 바뀌면 다음 표시부터 색이 바뀐다.
export function orbTexture(value: number): string {
  return `${expOrb.id}_${value >= 10 ? 'red' : value >= 4 ? 'gold' : value >= 2 ? 'green' : 'blue'}`;
}

export interface EffectDisplay {
  profile: StripProfile;
  frame: number;
  scaleX: number;
  scaleY: number;
  // 성광 십자는 같은 광선을 세로(0)와 가로(90°)로 두 번 그린다.
  rotations: number[];
}

// 단발 효과는 수명 전체에 프레임을 고르게 나눠 끝까지 재생한다. 범위 효과는 그림 폭이 판정 지름이 되게 확대하고,
// 성광 십자는 광선 폭을 판정 폭에, 길이를 양쪽 팔 전체 길이에 맞춘다. 좀비 부활은 원래 크기로 그린다.
export function effectDisplay(effect: Pick<AttackEffect, 'kind' | 'radius' | 'at'>, time: number): EffectDisplay {
  const profile = EFFECT_ART[effect.kind];
  const progress = Math.max(0, time - effect.at) / effectLifetime(effect.kind);
  const frame = Math.min(profile.frames - 1, Math.floor(progress * profile.frames));
  if (effect.kind === 'cross') {
    return { profile, frame, scaleX: BOSS_CONFIG.cross.width / profile.target_width,
      scaleY: BOSS_CONFIG.cross.length * 2 / profile.frame_size[1], rotations: [0, Math.PI / 2] };
  }
  const scale = effect.kind === 'raise' ? 1 : effect.radius * 2 / profile.target_width;
  return { profile, frame, scaleX: scale, scaleY: scale, rotations: [0] };
}

// 신성 방벽은 지속되는 동안 반복하며, 그림 폭이 보호 범위의 지름이 되게 확대한다.
export function aegisScale(): number {
  return BOSS_CONFIG.aegis.radius * 2 / bossAegis.target_width;
}

// 게임 시간으로 반복 재생한다. 일시정지 중에는 같은 프레임에 머문다.
export function stripFrame(profile: StripProfile, time: number, since = 0): number {
  return Math.floor(Math.max(0, time - since) * profile.fps / 1000) % profile.frames;
}

function directionFor(x: number, y: number, previous: SpriteDirection): SpriteDirection {
  if (x === 0 && y === 0) return previous;
  if (Math.abs(x) >= Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}

// 실제 변위와 전투 시간만 사용한다. 표시 동작은 공격 판정이나 이동을 지연하지 않는다.
export class SpriteAnimator {
  private profile: SpriteProfile;
  private defaultSheet: SpriteProfile['animations'][number];
  private actionSheet: SpriteProfile['animations'][number];
  private lastTime = -Infinity;
  private lastCastAt = -Infinity;
  private castDuration = 0;
  private castDirection: SpriteDirection = 'down';
  private direction: SpriteDirection = 'down';
  private action: SpriteAction = 'idle';
  private actionAt = 0;
  private pose: SpritePose = { action: 'idle', direction: 'down', frame: 0 };

  constructor(profile: SpriteProfile) {
    this.profile = profile;
    this.defaultSheet = profile.animations.find((sheet) => sheet.name === 'cast' || sheet.name === 'attack')!;
    this.actionSheet = this.defaultSheet;
  }

  sample(time: number, movement: { x: number; y: number }, cast: PlayerCast | null): SpritePose {
    if (time <= this.lastTime) return this.pose;
    if (!Number.isFinite(this.lastTime)) this.actionAt = time;
    this.lastTime = time;
    this.direction = directionFor(movement.x, movement.y, this.direction);
    const fresh = cast && cast.at > this.lastCastAt && cast.at <= time;
    // 공격과 시전을 모두 가진 보스는 기록에 적힌 동작을, 나머지는 자산의 행동 동작을 재생한다.
    if (fresh) this.actionSheet = this.profile.animations.find((item) => item.name === cast.sheet) ?? this.defaultSheet;
    const sheet = this.actionSheet;
    const release = Math.min(2, sheet.columns - 1), recovery = sheet.columns - release;
    if (fresh) {
      this.lastCastAt = cast.at;
      this.castDirection = directionFor(cast.direction.x, cast.direction.y, this.direction);
      this.direction = this.castDirection;
      this.castDuration = Math.max(1, Math.min(recovery * 1000 / sheet.fps, cast.attackMs));
    }
    const castAge = time - this.lastCastAt;
    if (castAge >= 0 && castAge < this.castDuration) {
      this.action = sheet.name as SpriteAction;
      // 실제 공격은 이미 발생했으므로 준비 프레임을 기다리지 않고 정점에서 재생한다.
      const column = release + Math.min(recovery - 1, Math.floor(castAge / this.castDuration * recovery));
      this.pose = { action: this.action, direction: this.castDirection,
        frame: SPRITE_DIRECTIONS.indexOf(this.castDirection) * sheet.columns + column };
      return this.pose;
    }
    const nextAction = movement.x !== 0 || movement.y !== 0 ? 'walk' : 'idle';
    if (this.action !== nextAction) { this.action = nextAction; this.actionAt = time; }
    const locomotion = this.profile.animations.find((item) => item.name === nextAction)!;
    const column = Math.floor((time - this.actionAt) * locomotion.fps / 1000) % locomotion.columns;
    this.pose = { action: nextAction, direction: this.direction,
      frame: SPRITE_DIRECTIONS.indexOf(this.direction) * locomotion.columns + column };
    return this.pose;
  }
}
