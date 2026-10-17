import Phaser from 'phaser';
import { decorateWorld } from './world-art';
import { createDungeon } from './dungeon';
import { getFootDepth } from './render-depth';
import { Battle } from './battle';
import { BATTLE_CONFIG, ENEMY_STATS } from './battle-config';
import { experienceToNextLevel } from './experience';
import { REWARDS, type RewardId } from './rewards';
import './style.css';

const FONT = 'Malgun Gothic, sans-serif';
const CHOICE_CARD = { width: 220, height: 250, gap: 20, top: 230 };
// 선택창이 열린 직후 이동·연속 입력이 의도치 않은 선택으로 이어지지 않게 한다.
const CHOICE_INPUT_DELAY_MS = 300;

class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private battle!: Battle;
  private enemyViews = new Map<number, Phaser.GameObjects.Rectangle>();
  private shotViews = new Map<number, Phaser.GameObjects.Rectangle>();
  private orbViews = new Map<number, Phaser.GameObjects.Rectangle>();
  private status!: Phaser.GameObjects.Text;
  private healthFill!: Phaser.GameObjects.Rectangle;
  private expFill!: Phaser.GameObjects.Rectangle;
  private levelText!: Phaser.GameObjects.Text;
  private shownGameOver = false;
  private choiceViews: Phaser.GameObjects.GameObject[] = [];
  private shownChoices: readonly RewardId[] = [];
  private choiceOpenedAt = 0;
  private choiceKeys: Phaser.Input.Keyboard.Key[] = [];
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private readonly worldWidth = 3000;
  private readonly worldHeight = 3000;
  private readonly wallThickness = 50;

  constructor() {
    super('GameScene');
  }

  create(): void {
    decorateWorld(this, this.worldWidth, this.worldHeight, this.wallThickness);
    this.battle = new Battle(createDungeon(this));

    this.player = this.add.rectangle(
      this.worldWidth / 2,
      this.worldHeight / 2,
      40,
      40,
      0x66ddaa,
    );
    this.player.setDepth(getFootDepth({ y: this.player.y - 20, height: 40 }));

    const camera = this.cameras.main;
    camera.setBounds(0, 0, this.worldWidth, this.worldHeight);
    camera.centerOn(this.player.x, this.player.y);
    camera.startFollow(this.player, true, 1, 1);

    this.add.rectangle(12, 12, 620, 97, 0x101612, 0.9).setOrigin(0).setScrollFactor(0).setDepth(20000);
    this.status = this.add.text(24, 20, '', { fontFamily: 'Malgun Gothic, sans-serif', fontSize: '17px', color: '#eeeece' })
      .setScrollFactor(0).setDepth(20001);
    this.add.rectangle(24, 50, 180, 10, 0x383d32).setOrigin(0).setScrollFactor(0).setDepth(20001);
    this.healthFill = this.add.rectangle(24, 50, 180, 10, 0x66ddaa).setOrigin(0).setScrollFactor(0).setDepth(20002);
    this.add.rectangle(24, 65, 180, 6, 0x383d32).setOrigin(0).setScrollFactor(0).setDepth(20001);
    this.expFill = this.add.rectangle(24, 65, 0, 6, 0x6fb8ff).setOrigin(0).setScrollFactor(0).setDepth(20002);
    this.levelText = this.add.text(216, 52, '', { fontFamily: 'Malgun Gothic, sans-serif', fontSize: '14px', color: '#9fd0ff' })
      .setScrollFactor(0).setDepth(20001);
    Object.values(ENEMY_STATS).forEach((stats, index) => {
      this.add.text(24 + index * 105, 82, `■ ${stats.name}`, {
        fontFamily: 'Malgun Gothic, sans-serif', fontSize: '14px', color: `#${stats.color.toString(16).padStart(6, '0')}`,
      }).setScrollFactor(0).setDepth(20001);
    });
    this.syncBattle();

    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.cursors = keyboard.createCursorKeys();
      this.wasd = {
        up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
      const { ONE, TWO, THREE, FOUR, FIVE } = Phaser.Input.Keyboard.KeyCodes;
      this.choiceKeys = [ONE, TWO, THREE, FOUR, FIVE].map((code) => keyboard.addKey(code));
    }
  }

  update(_time: number, delta: number): void {
    // 눌림은 매 프레임 소비해 대기 시간 중의 입력이 나중에 선택으로 처리되지 않게 한다.
    const pressed = this.choiceKeys.findIndex((key) => Phaser.Input.Keyboard.JustDown(key));
    if (pressed >= 0) this.pickChoice(pressed);
    const left = this.cursors?.left.isDown || this.wasd?.left.isDown;
    const right = this.cursors?.right.isDown || this.wasd?.right.isDown;
    const up = this.cursors?.up.isDown || this.wasd?.up.isDown;
    const down = this.cursors?.down.isDown || this.wasd?.down.isDown;
    this.battle.update(delta, { x: Number(Boolean(right)) - Number(Boolean(left)), y: Number(Boolean(down)) - Number(Boolean(up)) }, (body) => {
      this.player.setPosition(body.x + body.width / 2, body.y + body.height / 2);
      const camera = this.cameras.main;
      // 이동 후의 실제 카메라 위치로 화면 내 조준과 화면 밖 생성을 판정한다.
      camera.centerOn(this.player.x, this.player.y);
      return { x: camera.scrollX, y: camera.scrollY, width: camera.width, height: camera.height };
    });
    this.syncBattle();
  }

  private syncBattle(): void {
    const battle = this.battle;
    this.player.setDepth(getFootDepth(battle.player));
    const hurtAge = battle.time - battle.player.lastHitAt;
    this.player.setAlpha(hurtAge < 3000 && !battle.gameOver && Math.floor(hurtAge / 120) % 2 === 0 ? 0.35 : 1);
    const liveEnemies = new Set<number>();
    for (const enemy of battle.enemies) {
      liveEnemies.add(enemy.id);
      let view = this.enemyViews.get(enemy.id);
      if (!view) {
        view = this.add.rectangle(0, 0, enemy.width, enemy.height, ENEMY_STATS[enemy.kind].color).setStrokeStyle(2, 0x222823);
        this.enemyViews.set(enemy.id, view);
      }
      view.setPosition(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2).setDepth(getFootDepth(enemy));
      view.setFillStyle(battle.time - enemy.lastHitAt < 100 ? 0xffffff : ENEMY_STATS[enemy.kind].color);
    }
    for (const [id, view] of this.enemyViews) {
      if (!liveEnemies.has(id)) { view.destroy(); this.enemyViews.delete(id); }
    }
    const liveShots = new Set<number>();
    for (const shot of battle.projectiles) {
      liveShots.add(shot.id);
      let view = this.shotViews.get(shot.id);
      if (!view) {
        view = this.add.rectangle(0, 0, shot.width, shot.height, shot.color).setDepth(10000);
        this.shotViews.set(shot.id, view);
      }
      view.setPosition(shot.x + shot.width / 2, shot.y + shot.height / 2);
    }
    for (const [id, view] of this.shotViews) {
      if (!liveShots.has(id)) { view.destroy(); this.shotViews.delete(id); }
    }
    const liveOrbs = new Set<number>();
    for (const orb of battle.orbs) {
      liveOrbs.add(orb.id);
      let view = this.orbViews.get(orb.id);
      if (!view) {
        // 12×12 영역 안의 마름모: 한 변 12/√2의 사각형을 45도 회전한다.
        const side = BATTLE_CONFIG.expOrb.size / Math.SQRT2;
        view = this.add.rectangle(0, 0, side, side, 0).setAngle(45).setStrokeStyle(1, 0x1a1f2a);
        this.orbViews.set(orb.id, view);
      }
      // 상한 초과로 값이 합쳐질 수 있으므로 색은 매 프레임 현재 값으로 정한다.
      view.setFillStyle(orb.value >= 10 ? 0xff7a6b : orb.value >= 4 ? 0xffd65a : orb.value >= 2 ? 0x7ee08c : 0x6fb8ff);
      view.setPosition(orb.x + orb.width / 2, orb.y + orb.height / 2).setDepth(getFootDepth(orb));
    }
    for (const [id, view] of this.orbViews) {
      if (!liveOrbs.has(id)) { view.destroy(); this.orbViews.delete(id); }
    }
    this.status.setText(`체력 ${battle.player.hp}/${battle.player.maxHp}    생존 ${(battle.time / 1000).toFixed(1)}초    적 ${battle.enemies.length}    처치 ${battle.kills}`);
    this.healthFill.setDisplaySize(180 * battle.player.hp / battle.player.maxHp, 10);
    const need = experienceToNextLevel(battle.level);
    this.expFill.setDisplaySize(180 * battle.experience / need, 6);
    this.levelText.setText(`Lv ${battle.level}   ${battle.experience}/${need}`);
    // 선택할 때마다 새 선택지 배열이 만들어지므로 연속 레벨업에서도 창을 다시 구성한다.
    if (battle.choices !== this.shownChoices) this.showChoices(battle.choices);
    if (battle.gameOver && !this.shownGameOver) {
      this.shownGameOver = true;
      this.add.rectangle(640, 360, 1280, 720, 0x060a08, 0.78).setScrollFactor(0).setDepth(30000);
      this.add.text(640, 360, `게임 종료\n\n생존 ${(battle.time / 1000).toFixed(1)}초 · 처치 ${battle.kills} · Lv ${battle.level}\n\n새로고침하여 다시 시작`, {
        fontFamily: 'Malgun Gothic, sans-serif', fontSize: '30px', color: '#e5e3c8', align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(30001);
    }
  }

  private pickChoice(index: number): void {
    if (!this.battle.choices.length || this.time.now - this.choiceOpenedAt < CHOICE_INPUT_DELAY_MS) return;
    if (this.battle.choose(index)) this.syncBattle();
  }

  private showChoices(choices: readonly RewardId[]): void {
    for (const view of this.choiceViews) view.destroy();
    this.choiceViews = [];
    this.shownChoices = choices;
    if (!choices.length) return;
    this.choiceOpenedAt = this.time.now;
    const fixed = <T extends Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text>(view: T, depth: number): T => {
      view.setScrollFactor(0).setDepth(depth);
      this.choiceViews.push(view);
      return view;
    };
    // HUD 위, 게임 종료 화면 아래에 그린다. 연속 레벨업은 앞선 레벨부터 순서대로 표시한다.
    const rewardLevel = this.battle.level - this.battle.pendingChoices + 1;
    fixed(this.add.rectangle(640, 360, 1280, 720, 0x060a08, 0.72), 25000);
    fixed(this.add.text(640, 175, `레벨 ${rewardLevel} 달성 · 보상을 선택하세요`, {
      fontFamily: FONT, fontSize: '28px', color: '#e5e3c8',
    }).setOrigin(0.5), 25001);
    const total = choices.length * CHOICE_CARD.width + (choices.length - 1) * CHOICE_CARD.gap;
    choices.forEach((id, index) => {
      const reward = REWARDS[id];
      const x = 640 - total / 2 + index * (CHOICE_CARD.width + CHOICE_CARD.gap) + CHOICE_CARD.width / 2;
      const y = CHOICE_CARD.top + CHOICE_CARD.height / 2;
      const card = fixed(this.add.rectangle(x, y, CHOICE_CARD.width, CHOICE_CARD.height, 0x1c2420)
        .setStrokeStyle(2, 0x5f7a70), 25001);
      card.setInteractive({ useHandCursor: true })
        .on('pointerover', () => card.setStrokeStyle(3, 0x9fd0ff))
        .on('pointerout', () => card.setStrokeStyle(2, 0x5f7a70))
        .on('pointerdown', () => this.pickChoice(index));
      const stacks = this.battle.rewardStacks[id];
      const stackText = Number.isFinite(reward.maxStacks) ? `중첩 ${stacks}/${reward.maxStacks}` : '중첩 제한 없음';
      const lines: [number, string, string, string][] = [
        [-95, `[${index + 1}]`, '18px', '#9fd0ff'],
        [-50, reward.name, '21px', '#eeeece'],
        [10, reward.effect, '16px', '#c8d2c0'],
        [90, stackText, '15px', '#8f9c8a'],
      ];
      for (const [offset, text, fontSize, color] of lines) {
        fixed(this.add.text(x, y + offset, text, { fontFamily: FONT, fontSize, color, align: 'center' }).setOrigin(0.5), 25002);
      }
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#151923',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: GameScene,
});
