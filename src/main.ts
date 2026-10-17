import Phaser from 'phaser';
import { decorateWorld } from './world-art';
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

  constructor() {
    super('GameScene');
  }

  create(): void {
    decorateWorld(this, this.worldWidth, this.worldHeight, this.wallThickness);

    this.player = this.add.rectangle(
      this.worldWidth / 2,
      this.worldHeight / 2,
      40,
      40,
      0x66ddaa,
    );

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

    // 울타리 50픽셀과 플레이어 반지름을 모두 제외한다. 큰 delta에도 벽을 넘지 않는다.
    this.player.x = Phaser.Math.Clamp(
      this.player.x + this.moveDirection.x * distance,
      this.wallThickness + halfWidth,
      this.worldWidth - this.wallThickness - halfWidth,
    );
    this.player.y = Phaser.Math.Clamp(
      this.player.y + this.moveDirection.y * distance,
      this.wallThickness + halfHeight,
      this.worldHeight - this.wallThickness - halfHeight,
    );
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
