import Phaser from 'phaser';
import { decorateWorld } from './world-art';
import { createDungeon } from './dungeon';
import { getFootDepth } from './render-depth';
import { Battle } from './battle';
import { ENEMY_STATS } from './battle-config';
import './style.css';

class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private battle!: Battle;
  private enemyViews = new Map<number, Phaser.GameObjects.Rectangle>();
  private shotViews = new Map<number, Phaser.GameObjects.Rectangle>();
  private status!: Phaser.GameObjects.Text;
  private healthFill!: Phaser.GameObjects.Rectangle;
  private shownGameOver = false;
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

    this.add.rectangle(12, 12, 620, 83, 0x101612, 0.9).setOrigin(0).setScrollFactor(0).setDepth(20000);
    this.status = this.add.text(24, 20, '', { fontFamily: 'Malgun Gothic, sans-serif', fontSize: '17px', color: '#eeeece' })
      .setScrollFactor(0).setDepth(20001);
    this.add.rectangle(24, 50, 180, 10, 0x383d32).setOrigin(0).setScrollFactor(0).setDepth(20001);
    this.healthFill = this.add.rectangle(24, 50, 180, 10, 0x66ddaa).setOrigin(0).setScrollFactor(0).setDepth(20002);
    Object.values(ENEMY_STATS).forEach((stats, index) => {
      this.add.text(24 + index * 105, 68, `■ ${stats.name}`, {
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
    }
  }

  update(_time: number, delta: number): void {
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
    this.status.setText(`체력 ${battle.player.hp}/100    생존 ${(battle.time / 1000).toFixed(1)}초    적 ${battle.enemies.length}    처치 ${battle.kills}`);
    this.healthFill.setDisplaySize(180 * battle.player.hp / 100, 10);
    if (battle.gameOver && !this.shownGameOver) {
      this.shownGameOver = true;
      this.add.rectangle(640, 360, 1280, 720, 0x060a08, 0.78).setScrollFactor(0).setDepth(30000);
      this.add.text(640, 360, `게임 종료\n\n생존 ${(battle.time / 1000).toFixed(1)}초 · 처치 ${battle.kills}\n\n새로고침하여 다시 시작`, {
        fontFamily: 'Malgun Gothic, sans-serif', fontSize: '30px', color: '#e5e3c8', align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(30001);
    }
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
