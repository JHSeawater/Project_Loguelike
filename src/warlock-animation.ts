import { SpriteAnimator, SPRITE_ART } from './sprite-animation.ts';

export const WARLOCK_DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export type WarlockDirection = typeof WARLOCK_DIRECTIONS[number];
export type WarlockAction = 'idle' | 'walk' | 'cast';

export const WARLOCK_ART = {
  frameSize: SPRITE_ART.warlock.frame_size[0],
  footX: SPRITE_ART.warlock.anchor[0],
  footY: SPRITE_ART.warlock.anchor[1],
  sheets: {
    idle: SPRITE_ART.warlock.animations.find((sheet) => sheet.name === 'idle')!,
    walk: SPRITE_ART.warlock.animations.find((sheet) => sheet.name === 'walk')!,
    cast: SPRITE_ART.warlock.animations.find((sheet) => sheet.name === 'cast')!,
  },
} as const;

export interface WarlockPose {
  action: WarlockAction;
  direction: WarlockDirection;
  frame: number;
}


// 기존 워록 호출부와 테스트의 호환 진입점. 재생 로직은 공통 가공 설정을 사용한다.
export class WarlockAnimator extends SpriteAnimator {
  constructor() { super(SPRITE_ART.warlock); }
}
