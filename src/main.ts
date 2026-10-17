import Phaser from 'phaser';
import { decorateWorld } from './world-art';
import { createDungeon } from './dungeon';
import { moveAndSlide, type Box } from './collision';
import { getFootDepth } from './render-depth';
import './style.css';

class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private readonly moveDirection = new Phaser.Math.Vector2();
  private readonly moveSpeed = 250; // 게임 좌표 기준 픽셀/초
  private readonly worldWidth = 3000;
  private readonly worldHeight = 3000;
  private readonly wallThickness = 50;
  private obstacles: readonly Box[] = [];

  constructor() {
    super('GameScene');
  }

  create(): void {
    decorateWorld(this, this.worldWidth, this.worldHeight, this.wallThickness);
    this.obstacles = createDungeon(this);

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
    if (!this.cursors || !this.wasd) return;

    const left = this.cursors.left.isDown || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up = this.cursors.up.isDown || this.wasd.up.isDown;
    const down = this.cursors.down.isDown || this.wasd.down.isDown;

    // 방향만 정규화해 대각선에서도 같은 속도를 유지한다.
    this.moveDirection.set(Number(right) - Number(left), Number(down) - Number(up)).normalize();
    const distance = this.moveSpeed * (delta / 1000);
    const halfWidth = this.player.displayWidth / 2;
    const halfHeight = this.player.displayHeight / 2;

    const moved = moveAndSlide(
      { x: this.player.x - halfWidth, y: this.player.y - halfHeight,
        width: this.player.displayWidth, height: this.player.displayHeight },
      this.moveDirection.x * distance,
      this.moveDirection.y * distance,
      { x: this.wallThickness, y: this.wallThickness,
        width: this.worldWidth - this.wallThickness * 2,
        height: this.worldHeight - this.wallThickness * 2 },
      this.obstacles,
    );
    this.player.setPosition(moved.x + halfWidth, moved.y + halfHeight);
    this.player.setDepth(getFootDepth(moved));
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
