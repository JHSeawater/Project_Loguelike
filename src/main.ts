import Phaser from 'phaser';
import { decorateWorld } from './world-art';
import { createDungeon } from './dungeon';
import { getFootDepth } from './render-depth';
import { Battle, crossArms } from './battle';
import { BATTLE_CONFIG, BOSS_CONFIG, CHARACTER_STATS, ENEMY_STATS, SKILL_CONFIG, type CharacterId } from './battle-config';
import { experienceToNextLevel } from './experience';
import { REWARDS, type RewardDef, type RewardId } from './rewards';
import { CharacterSelectScene, FONT, INPUT_DELAY_MS, TitleScene } from './menu-scenes';
import './style.css';

const CHOICE_CARD = { width: 220, height: 250, gap: 20, top: 230 };
// 카드 테두리: 공통 보상, 직업 무한 특기, 특수 특기를 구분한다.
const cardStroke = (reward: RewardDef): number => reward.special ? 0xe0b84a : reward.character ? 0x9b7ad8 : 0x5f7a70;

class GameScene extends Phaser.Scene {
  private character: CharacterId = 'warlock';
  private player!: Phaser.GameObjects.Rectangle;
  private battle!: Battle;
  private enemyViews = new Map<number, Phaser.GameObjects.Rectangle>();
  private shotViews = new Map<number, Phaser.GameObjects.Rectangle>();
  private orbViews = new Map<number, Phaser.GameObjects.Rectangle>();
  private effectViews = new Map<number, Phaser.GameObjects.Arc>();
  private hazardViews = new Map<number, Phaser.GameObjects.Graphics>();
  private aegisView?: Phaser.GameObjects.Arc;
  private status!: Phaser.GameObjects.Text;
  private healthFill!: Phaser.GameObjects.Rectangle;
  private expFill!: Phaser.GameObjects.Rectangle;
  private levelText!: Phaser.GameObjects.Text;
  private shownGameOver = false;
  private gameOverAt = 0;
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

  // 캐릭터 선택 화면에서 고른 직업을 받는다. 직접 시작하면 워록이다.
  init(data: { character?: CharacterId }): void {
    this.character = data.character ?? 'warlock';
  }

  create(): void {
    // Phaser는 장면 객체를 다시 쓰므로, 이전 판의 표시 목록과 상태를 비우고 시작한다.
    this.enemyViews = new Map();
    this.shotViews = new Map();
    this.orbViews = new Map();
    this.effectViews = new Map();
    this.hazardViews = new Map();
    this.aegisView = undefined;
    this.shownGameOver = false;
    this.choiceViews = [];
    this.shownChoices = [];
    decorateWorld(this, this.worldWidth, this.worldHeight, this.wallThickness);
    this.battle = new Battle(createDungeon(this), { character: this.character });

    this.player = this.add.rectangle(
      this.worldWidth / 2,
      this.worldHeight / 2,
      40,
      40,
      CHARACTER_STATS[this.battle.character].color,
    );
    this.player.setDepth(getFootDepth({ y: this.player.y - 20, height: 40 }));

    const camera = this.cameras.main;
    camera.setBounds(0, 0, this.worldWidth, this.worldHeight);
    camera.centerOn(this.player.x, this.player.y);
    camera.startFollow(this.player, true, 1, 1);

    this.add.rectangle(12, 12, 620, 112, 0x101612, 0.9).setOrigin(0).setScrollFactor(0).setDepth(20000);
    this.status = this.add.text(24, 20, '', { fontFamily: 'Malgun Gothic, sans-serif', fontSize: '17px', color: '#eeeece' })
      .setScrollFactor(0).setDepth(20001);
    this.add.rectangle(24, 50, 180, 10, 0x383d32).setOrigin(0).setScrollFactor(0).setDepth(20001);
    this.healthFill = this.add.rectangle(24, 50, 180, 10, 0x66ddaa).setOrigin(0).setScrollFactor(0).setDepth(20002);
    this.add.rectangle(24, 65, 180, 6, 0x383d32).setOrigin(0).setScrollFactor(0).setDepth(20001);
    // 표시 크기는 원래 크기에 대한 배율로 바뀌므로, 바는 전체 너비로 만들고 비율만큼 줄인다. 너비 0으로 만들면 늘릴 수 없다.
    this.expFill = this.add.rectangle(24, 65, 180, 6, 0x6fb8ff).setOrigin(0).setScrollFactor(0).setDepth(20002);
    this.levelText = this.add.text(216, 52, '', { fontFamily: 'Malgun Gothic, sans-serif', fontSize: '14px', color: '#9fd0ff' })
      .setScrollFactor(0).setDepth(20001);
    // 적 범례는 한 줄에 5종씩 두 줄로 표시한다.
    Object.values(ENEMY_STATS).forEach((stats, index) => {
      this.add.text(24 + index % 5 * 105, 80 + Math.floor(index / 5) * 20, `■ ${stats.name}`, {
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
      keyboard.on('keydown', (event: KeyboardEvent) => {
        if (event.code === 'Enter' && !event.repeat) this.leaveGameOver();
      });
    }
    this.input.on('pointerdown', () => this.leaveGameOver());
  }

  // 게임 종료 화면에서 Enter나 클릭으로 캐릭터 선택 화면으로 돌아간다. 종료 직후의 입력은 무시한다.
  private leaveGameOver(): void {
    if (!this.shownGameOver || this.time.now - this.gameOverAt < INPUT_DELAY_MS) return;
    this.scene.start('CharacterSelectScene');
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
        // 보스는 금색 테두리로 다른 적과 구분한다.
        const boss = enemy.kind === BOSS_CONFIG.kind;
        view = this.add.rectangle(0, 0, enemy.width, enemy.height, ENEMY_STATS[enemy.kind].color)
          .setStrokeStyle(boss ? 3 : 2, boss ? BOSS_CONFIG.strokeColor : 0x222823);
        this.enemyViews.set(enemy.id, view);
      }
      view.setPosition(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2).setDepth(getFootDepth(enemy));
      view.setFillStyle(battle.time - enemy.lastHitAt < 100 ? 0xffffff : ENEMY_STATS[enemy.kind].color);
    }
    for (const [id, view] of this.enemyViews) {
      if (!liveEnemies.has(id)) { view.destroy(); this.enemyViews.delete(id); }
    }
    // 보스 범위 공격의 경고는 판정 범위 그대로 그리고, 피해 시점이 다가올수록 진하게 한다. 몸체 위, 투사체 아래에 그린다.
    const liveHazards = new Set<number>();
    for (const hazard of battle.hazards) {
      liveHazards.add(hazard.id);
      let view = this.hazardViews.get(hazard.id);
      if (!view) {
        view = this.add.graphics().setDepth(9000);
        this.hazardViews.set(hazard.id, view);
      }
      const progress = Math.min(1, (battle.time - hazard.castAt) / (hazard.hitAt - hazard.castAt));
      view.clear().fillStyle(0xe04848, 0.12 + 0.3 * progress).lineStyle(2, 0xe04848, 0.85);
      if (hazard.kind === 'brand') {
        view.fillCircle(hazard.x, hazard.y, BOSS_CONFIG.brand.radius).strokeCircle(hazard.x, hazard.y, BOSS_CONFIG.brand.radius);
      } else {
        for (const arm of crossArms(hazard)) view.fillRect(arm.x, arm.y, arm.width, arm.height).strokeRect(arm.x, arm.y, arm.width, arm.height);
      }
    }
    for (const [id, view] of this.hazardViews) {
      if (!liveHazards.has(id)) { view.destroy(); this.hazardViews.delete(id); }
    }
    // 신성 방벽이 유지되는 동안 보스 주위에 금색 원을 표시한다.
    const boss = battle.boss;
    if (boss && boss.hp > 0 && battle.time < battle.bossGuardUntil) {
      this.aegisView ??= this.add.circle(0, 0, 1, BOSS_CONFIG.strokeColor, 0.12).setStrokeStyle(3, BOSS_CONFIG.strokeColor).setDepth(9001);
      this.aegisView.setPosition(boss.x + boss.width / 2, boss.y + boss.height / 2)
        .setRadius(Math.hypot(boss.width, boss.height) / 2 + 8).setVisible(true);
    } else this.aegisView?.setVisible(false);
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
    // 휘두르기·폭발 범위를 판정에 쓴 반경 그대로 잠시 보여주고 흐리게 사라지게 한다.
    const liveEffects = new Set<number>();
    for (const effect of battle.effects) {
      liveEffects.add(effect.id);
      let view = this.effectViews.get(effect.id);
      if (!view) {
        const color = effect.kind === 'swing' ? 0xc9b8ff : effect.kind === 'heal' ? 0xe58fb8 : 0xffa64d;
        view = this.add.circle(effect.x, effect.y, effect.radius, color, 0.18).setStrokeStyle(2, color).setDepth(10001);
        this.effectViews.set(effect.id, view);
      }
      view.setAlpha(Math.max(0, 1 - (battle.time - effect.at) / SKILL_CONFIG.effectMs));
    }
    for (const [id, view] of this.effectViews) {
      if (!liveEffects.has(id)) { view.destroy(); this.effectViews.delete(id); }
    }
    this.status.setText(`체력 ${battle.player.hp}/${battle.player.maxHp}    생존 ${(battle.time / 1000).toFixed(1)}초    적 ${battle.enemies.length}    처치 ${battle.kills}`);
    this.healthFill.setDisplaySize(180 * battle.player.hp / battle.player.maxHp, 10);
    const need = experienceToNextLevel(battle.level);
    this.expFill.setDisplaySize(180 * battle.experience / need, 6);
    const surgeLeft = battle.surgeUntil - battle.time;
    this.levelText.setText(`Lv ${battle.level}   ${battle.experience}/${need}`
      + (surgeLeft > 0 ? `    마력 폭주 ${(surgeLeft / 1000).toFixed(1)}초` : ''));
    // 선택할 때마다 새 선택지 배열이 만들어지므로 연속 레벨업에서도 창을 다시 구성한다.
    if (battle.choices !== this.shownChoices) this.showChoices(battle.choices);
    if (battle.gameOver && !this.shownGameOver) {
      this.shownGameOver = true;
      this.gameOverAt = this.time.now;
      this.add.rectangle(640, 360, 1280, 720, 0x060a08, 0.78).setScrollFactor(0).setDepth(30000);
      this.add.text(640, 360, `게임 종료\n\n${CHARACTER_STATS[battle.character].name} · 생존 ${(battle.time / 1000).toFixed(1)}초 · 처치 ${battle.kills} · Lv ${battle.level}\n\nEnter 또는 클릭: 캐릭터 선택으로`, {
        fontFamily: FONT, fontSize: '30px', color: '#e5e3c8', align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(30001);
    }
  }

  private pickChoice(index: number): void {
    if (!this.battle.choices.length || this.time.now - this.choiceOpenedAt < INPUT_DELAY_MS) return;
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
      const stroke = cardStroke(reward);
      const card = fixed(this.add.rectangle(x, y, CHOICE_CARD.width, CHOICE_CARD.height, 0x1c2420)
        .setStrokeStyle(2, stroke), 25001);
      card.setInteractive({ useHandCursor: true })
        .on('pointerover', () => card.setStrokeStyle(3, 0x9fd0ff))
        .on('pointerout', () => card.setStrokeStyle(2, stroke))
        .on('pointerdown', () => this.pickChoice(index));
      const stacks = this.battle.rewardStacks[id];
      const stackText = reward.special ? '특수 특기 · 1회 획득'
        : Number.isFinite(reward.maxStacks) ? `중첩 ${stacks}/${reward.maxStacks}`
        : reward.character ? `직업 특기 · 중첩 ${stacks}` : '중첩 제한 없음';
      const lines: [number, string, string, string][] = [
        [-95, `[${index + 1}]`, '18px', '#9fd0ff'],
        [-50, reward.name, '21px', '#eeeece'],
        [10, reward.effect, '16px', '#c8d2c0'],
        [90, stackText, '15px', '#8f9c8a'],
      ];
      for (const [offset, text, fontSize, color] of lines) {
        fixed(this.add.text(x, y + offset, text, {
          fontFamily: FONT, fontSize, color, align: 'center', wordWrap: { width: CHOICE_CARD.width - 24, useAdvancedWrap: true },
        }).setOrigin(0.5), 25002);
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
  // 타이틀 → 캐릭터 선택 → 게임 순서로 진행한다. 첫 번째 장면이 처음 열린다.
  scene: [TitleScene, CharacterSelectScene, GameScene],
});
