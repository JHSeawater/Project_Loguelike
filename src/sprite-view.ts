import type Phaser from 'phaser';
import { SpriteAnimator, type SpriteProfile, type SpritePose, type StripProfile } from './sprite-animation';

export interface SpriteView {
  body: Phaser.GameObjects.Sprite;
  magic?: Phaser.GameObjects.Sprite;
  animator: SpriteAnimator;
  x: number;
  y: number;
}

export function loadSprite(scene: Phaser.Scene, profile: SpriteProfile, idleOnly = false): void {
  for (const action of profile.animations) {
    if (idleOnly && action.name !== 'idle') continue;
    for (const suffix of profile.magic === 'none' ? [''] : ['', '_magic']) {
      const key = `${profile.id}_${action.name}${suffix}`;
      if (!scene.textures.exists(key)) scene.load.spritesheet(key, `/assets/sprites/${profile.folder}/${key}.png`, {
        frameWidth: profile.frame_size[0], frameHeight: profile.frame_size[1],
      });
    }
  }
}

export function createSpriteView(scene: Phaser.Scene, profile: SpriteProfile, x: number, y: number): SpriteView {
  const make = (suffix: string) => scene.add.sprite(x, y, `${profile.id}_idle${suffix}`, 0)
    .setOrigin(profile.anchor[0] / profile.frame_size[0], profile.anchor[1] / profile.frame_size[1]);
  return { body: make(''), magic: profile.magic === 'none' ? undefined : make('_magic'),
    animator: new SpriteAnimator(profile), x, y };
}

export function updateSpriteView(view: SpriteView, profile: SpriteProfile, pose: SpritePose,
  x: number, y: number, depth: number, alpha: number): void {
  view.body.setTexture(`${profile.id}_${pose.action}`, pose.frame).setPosition(x, y).setDepth(depth).setAlpha(alpha);
  view.magic?.setTexture(`${profile.id}_${pose.action}_magic`, pose.frame)
    .setPosition(x, y).setDepth(depth + 0.01).setAlpha(alpha);
}

export function loadStrip(scene: Phaser.Scene, profile: StripProfile): void {
  const keys = profile.palettes ? profile.palettes.map((palette) => `${profile.id}_${palette.suffix}`) : [profile.id];
  for (const key of keys) {
    if (!scene.textures.exists(key)) scene.load.spritesheet(key, `/assets/sprites/${profile.folder}/${key}.png`, {
      frameWidth: profile.frame_size[0], frameHeight: profile.frame_size[1],
    });
  }
}

// 기준점(발광탄의 핵, 화살의 회전축, 구슬의 중심)을 판정 몸체의 중심에 맞춘다.
export function createStripView(scene: Phaser.Scene, profile: StripProfile, key = profile.id): Phaser.GameObjects.Sprite {
  return scene.add.sprite(0, 0, key, 0).setOrigin(profile.pivot[0] / profile.frame_size[0], profile.pivot[1] / profile.frame_size[1]);
}
