import Phaser from 'phaser';
import { CHARACTER_STATS, SKILL_CONFIG, type CharacterId } from './battle-config';
import { REWARDS, SKILL_IDS } from './rewards';

export const GAME_TITLE = 'Grave of the Fallen';
export const FONT = 'Malgun Gothic, sans-serif';
// 화면이 열린 직후의 입력은 무시한다. 이전 화면에서 누르던 키나 연타가 다음 화면의 선택으로 이어지지 않게 한다.
export const INPUT_DELAY_MS = 300;

const PLAYABLE: readonly CharacterId[] = ['warlock', 'deathKnight'];
// 직업 설계의 보류 구상. 고를 수 없는 잠긴 카드로만 보여준다.
const PLANNED = ['네크로맨서', '드라큘라', '드루이드', '서큐버스'];

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

// 카드 문구는 직업·특기 데이터로 만든다. 화면에서 따로 수치를 정하지 않는다.
function describe(id: CharacterId): string[] {
  const stats = CHARACTER_STATS[id], surge = SKILL_CONFIG.surge;
  const attack = stats.attack === 'shot' ? '화면 안 가장 가까운 적에게 투사체 발사' : `주변 ${stats.swingRadius}px 안의 적 전부 베기`;
  const passive = id === 'warlock'
    ? `마력 폭주 — 보상 선택 후 ${surge.durationMs / 1000}초간 공격력·이동속도 +${surge.percent}%, 공격 간격 −${surge.percent}%`
    : `생명 착취 — 적 처치 시 체력 +${stats.killHeal}`;
  const skills = SKILL_IDS.filter((skill) => REWARDS[skill].character === id)
    .map((skill) => REWARDS[skill].special ? `${REWARDS[skill].name}(특수)` : REWARDS[skill].name);
  return [
    `체력 ${stats.hp} · 공격력 ${stats.damage}`,
    `공격 간격 ${stats.attackMs / 1000}초 · 이동속도 ${stats.speed}`,
    `공격: ${attack}`,
    `패시브: ${passive}`,
    `특기: ${skills.join(', ')}`,
  ];
}

// 반복 입력(키를 누르고 있을 때)과 화면이 열린 직후의 입력을 걸러낸다.
const accepts = (scene: Phaser.Scene, openedAt: number, event?: KeyboardEvent): boolean =>
  !event?.repeat && scene.time.now - openedAt >= INPUT_DELAY_MS;

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create(): void {
    const openedAt = this.time.now;
    this.add.text(640, 270, GAME_TITLE, { fontFamily: FONT, fontSize: '64px', color: '#e5e3c8' }).setOrigin(0.5);
    this.add.text(640, 410, 'Enter · Space · 클릭으로 시작', { fontFamily: FONT, fontSize: '22px', color: '#9fd0ff' }).setOrigin(0.5);
    this.add.text(640, 650, '이동 WASD·방향키    레벨업 보상 선택 숫자키·클릭',
      { fontFamily: FONT, fontSize: '16px', color: '#8f9c8a' }).setOrigin(0.5);
    const start = (): void => { this.scene.start('CharacterSelectScene'); };
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if ((event.code === 'Enter' || event.code === 'Space') && accepts(this, openedAt, event)) start();
    });
    this.input.on('pointerdown', () => { if (accepts(this, openedAt)) start(); });
  }
}

export class CharacterSelectScene extends Phaser.Scene {
  private selected = 0;
  private cards: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super('CharacterSelectScene');
  }

  create(): void {
    const openedAt = this.time.now;
    this.selected = 0;
    this.cards = [];
    this.add.text(640, 60, '캐릭터 선택', { fontFamily: FONT, fontSize: '32px', color: '#e5e3c8' }).setOrigin(0.5);
    const card = { width: 420, height: 340, gap: 40, top: 110 };
    PLAYABLE.forEach((id, index) => {
      const stats = CHARACTER_STATS[id];
      const x = 640 + (index - (PLAYABLE.length - 1) / 2) * (card.width + card.gap);
      const left = x - card.width / 2 + 24;
      const view = this.add.rectangle(x, card.top + card.height / 2, card.width, card.height, 0x1c2420)
        .setStrokeStyle(2, 0x5f7a70);
      view.setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.select(index))
        .on('pointerdown', () => { if (accepts(this, openedAt)) this.begin(index); });
      this.cards.push(view);
      this.add.text(left, card.top + 20, `[${index + 1}]`, { fontFamily: FONT, fontSize: '18px', color: '#9fd0ff' });
      this.add.rectangle(left + 20, card.top + 72, 40, 40, stats.color);
      this.add.text(left + 56, card.top + 58, stats.name, { fontFamily: FONT, fontSize: '26px', color: '#eeeece' });
      this.add.text(left, card.top + 112, describe(id).join('\n'), {
        fontFamily: FONT, fontSize: '16px', color: '#c8d2c0', lineSpacing: 8,
        wordWrap: { width: card.width - 48, useAdvancedWrap: true },
      });
    });
    const locked = { width: 230, height: 76, gap: 20, top: 480 };
    PLANNED.forEach((name, index) => {
      const x = 640 + (index - (PLANNED.length - 1) / 2) * (locked.width + locked.gap);
      this.add.rectangle(x, locked.top + locked.height / 2, locked.width, locked.height, 0x14181a).setStrokeStyle(1, 0x3a403c);
      this.add.text(x, locked.top + 26, name, { fontFamily: FONT, fontSize: '19px', color: '#6c7470' }).setOrigin(0.5);
      this.add.text(x, locked.top + 54, '준비 중', { fontFamily: FONT, fontSize: '14px', color: '#555c58' }).setOrigin(0.5);
    });
    this.add.text(640, 640, '← → 선택 · Enter 시작 · 숫자키로 바로 시작 · Esc 타이틀',
      { fontFamily: FONT, fontSize: '16px', color: '#8f9c8a' }).setOrigin(0.5);
    this.select(0);
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (!accepts(this, openedAt, event)) return;
      const number = PLAYABLE.findIndex((_, index) => event.code === `Digit${index + 1}` || event.code === `Numpad${index + 1}`);
      if (number >= 0) this.begin(number);
      else if (event.code === 'ArrowLeft' || event.code === 'KeyA') this.select((this.selected + PLAYABLE.length - 1) % PLAYABLE.length);
      else if (event.code === 'ArrowRight' || event.code === 'KeyD') this.select((this.selected + 1) % PLAYABLE.length);
      else if (event.code === 'Enter' || event.code === 'Space') this.begin(this.selected);
      else if (event.code === 'Escape') this.scene.start('TitleScene');
    });
  }

  private select(index: number): void {
    this.selected = index;
    this.cards.forEach((view, i) => {
      if (i === index) view.setStrokeStyle(3, CHARACTER_STATS[PLAYABLE[i]].color);
      else view.setStrokeStyle(2, 0x5f7a70);
    });
  }

  private begin(index: number): void {
    this.scene.start('GameScene', { character: PLAYABLE[index] });
  }
}
