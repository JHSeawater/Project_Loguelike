import type Phaser from 'phaser';

// 정수 좌표로만 그려 확대해도 선명한 도트를 유지한다.
export class PixelSurface {
  readonly pixels: Uint8ClampedArray;

  constructor(readonly width: number, readonly height: number) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  rect(x: number, y: number, width: number, height: number, color: number, alpha = 255): void {
    const right = Math.min(this.width, Math.floor(x + width));
    const bottom = Math.min(this.height, Math.floor(y + height));
    for (let py = Math.max(0, Math.floor(y)); py < bottom; py++) {
      for (let px = Math.max(0, Math.floor(x)); px < right; px++) {
        const offset = (py * this.width + px) * 4;
        this.pixels[offset] = (color >> 16) & 255;
        this.pixels[offset + 1] = (color >> 8) & 255;
        this.pixels[offset + 2] = color & 255;
        this.pixels[offset + 3] = alpha;
      }
    }
  }

  line(x: number, y: number, endX: number, endY: number, color: number, thickness = 1): void {
    x = Math.round(x);
    y = Math.round(y);
    endX = Math.round(endX);
    endY = Math.round(endY);
    const dx = Math.abs(endX - x);
    const dy = -Math.abs(endY - y);
    const stepX = x < endX ? 1 : -1;
    const stepY = y < endY ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      this.rect(x, y, thickness, thickness, color);
      if (x === endX && y === endY) break;
      const doubledError = error * 2;
      if (doubledError >= dy) { error += dy; x += stepX; }
      if (doubledError <= dx) { error += dx; y += stepY; }
    }
  }

  polygon(points: readonly (readonly [number, number])[], color: number): void {
    const top = Math.max(0, Math.min(...points.map((point) => point[1])));
    const bottom = Math.min(this.height - 1, Math.max(...points.map((point) => point[1])));
    for (let y = top; y <= bottom; y++) {
      const intersections: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          intersections.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const left = Math.ceil(intersections[i]);
        this.rect(left, y, Math.floor(intersections[i + 1]) - left + 1, 1, color);
      }
    }
  }
}

function seededRandom(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGround(width: number, height: number): PixelSurface {
  const surface = new PixelSurface(width, height);
  const random = seededRandom(731904);
  const cell = 36;
  const columns = Math.ceil(width / cell) + 1;
  const rows = Math.ceil(height / cell) + 1;
  const noise = Array.from({ length: columns * rows }, () => random());
  const earth = [0x24231f, 0x282620, 0x2c2923, 0x302b25, 0x292a22, 0x252820];

  // 부드럽게 이어지는 흙의 명암에 작은 입자를 섞어 타일 이음새를 없앤다.
  for (let y = 0; y < height; y += 2) {
    const row = Math.floor(y / cell);
    const fy = (y % cell) / cell;
    const sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < width; x += 2) {
      const column = Math.floor(x / cell);
      const fx = (x % cell) / cell;
      const sx = fx * fx * (3 - 2 * fx);
      const top = noise[row * columns + column] * (1 - sx)
        + noise[row * columns + column + 1] * sx;
      const bottom = noise[(row + 1) * columns + column] * (1 - sx)
        + noise[(row + 1) * columns + column + 1] * sx;
      const value = top * (1 - sy) + bottom * sy;
      const index = Math.min(earth.length - 1, Math.floor(value * earth.length));
      surface.rect(x, y, 2, 2, earth[index]);
      if (random() < 0.2) surface.rect(x, y, 1, 1, random() < 0.5 ? 0x343129 : 0x201f1b);
    }
  }

  // 마른 풀과 잿빛 이끼는 작은 군집으로 흩뿌린다. 모두 통과 가능한 장식이다.
  for (let patch = 0; patch < 2600; patch++) {
    const x = Math.floor(random() * width);
    const y = Math.floor(random() * height);
    const dry = random() < 0.32;
    for (let blade = 0; blade < 4 + random() * 6; blade++) {
      const bx = x + Math.floor(random() * 17) - 8;
      const by = y + Math.floor(random() * 9) - 4;
      const length = 2 + Math.floor(random() * 5);
      const lean = Math.floor(random() * 5) - 2;
      surface.line(bx, by, bx + lean, by - length, dry ? 0x494333 : 0x39402c);
      surface.rect(bx, by, 2, 1, 0x1d211a);
      if (blade % 3 === 0) surface.rect(bx + lean, by - length, 1, 1, dry ? 0x5b503b : 0x49503a);
    }
  }

  for (let speck = 0; speck < 6500; speck++) {
    const x = Math.floor(random() * width);
    const y = Math.floor(random() * height);
    surface.rect(x, y, random() < 0.8 ? 1 : 2, 1, random() < 0.5 ? 0x464137 : 0x191d19);
  }

  for (let branch = 0; branch < 230; branch++) {
    const x = Math.floor(random() * width);
    const y = Math.floor(random() * height);
    const angle = random() * Math.PI * 2;
    const length = 6 + random() * 14;
    const dx = Math.cos(angle) * length;
    const dy = Math.sin(angle) * length;
    surface.line(x + 1, y + 1, x + dx + 1, y + dy + 1, 0x191b18, 2);
    surface.line(x, y, x + dx, y + dy, 0x514537);
    surface.line(x, y, x + dx * 0.45, y + dy * 0.45, 0x62513d);
    surface.line(x + dx * 0.5, y + dy * 0.5, x + dx * 0.6 - dy * 0.35, y + dy * 0.6 + dx * 0.35, 0x514537);
    surface.line(x + dx * 0.75, y + dy * 0.75, x + dx * 0.8 + dy * 0.25, y + dy * 0.8 - dx * 0.25, 0x514537);
  }
  return surface;
}

export function createFence(): PixelSurface {
  const surface = new PixelSurface(100, 50);
  const iron = 0x151b1c;
  const edge = 0x56615b;
  const rust = 0x645440;
  surface.rect(0, 0, 100, 50, 0x101512, 120);
  surface.rect(0, 44, 100, 6, 0x171c1b);
  surface.rect(0, 44, 100, 1, 0x4a4c40);
  for (let x = 16; x < 100; x += 20) surface.rect(x, 46, 1, 4, 0x34382f);

  // 참고 이미지의 첨두 아치, 창살, 작은 십자 장식.
  const arch = [[12, 29], [17, 22], [24, 17], [35, 12], [46, 6], [54, 1], [62, 6], [73, 12], [84, 17], [92, 22], [99, 29]];
  for (let i = 1; i < arch.length; i++) {
    const [x, y] = arch[i - 1];
    const [nextX, nextY] = arch[i];
    surface.line(x, y, nextX, nextY, edge, 2);
    surface.line(x, y + 2, nextX, nextY + 2, iron, 2);
  }
  for (const x of [22, 38, 54, 70, 86]) {
    const top = 8 + Math.round(Math.abs(x - 54) * 0.42);
    surface.rect(x, top, 2, 36 - top + 8, iron);
    surface.line(x, top + 1, x, 42, edge);
    surface.line(x - 2, top + 2, x, top - 2, iron);
    surface.line(x, top - 2, x + 2, top + 2, edge);
    const ornamentY = 30;
    surface.line(x - 3, ornamentY, x + 3, ornamentY, edge);
    surface.line(x, ornamentY - 3, x, ornamentY + 3, edge);
    surface.rect(x - 1, ornamentY - 1, 3, 3, iron);
    surface.rect(x - 4, ornamentY - 2, 1, 2, rust);
    surface.rect(x + 4, ornamentY + 1, 1, 2, edge);
  }
  for (const y of [35, 41]) {
    surface.rect(10, y, 90, 3, iron);
    surface.rect(10, y, 90, 1, edge);
  }
  for (const centerX of [30, 78]) {
    // 네 잎 장식과 아래쪽 마름모 철물로 고딕 울타리의 밀도를 더한다.
    const flower = [[0, -4], [-2, -4], [-3, -2], [-3, -1], [-5, -1], [-5, 1], [-3, 1], [-3, 3], [0, 4], [3, 3], [3, 1], [5, 1], [5, -1], [3, -1], [3, -2], [2, -4], [0, -4]];
    for (let i = 1; i < flower.length; i++) {
      surface.line(centerX + flower[i - 1][0], 23 + flower[i - 1][1], centerX + flower[i][0], 23 + flower[i][1], edge);
    }
    surface.rect(centerX, 17, 1, 17, iron);
    surface.rect(centerX, 22, 1, 2, rust);
  }
  for (let x = 16; x < 98; x += 8) {
    surface.line(x, 38, x + 3, 35, edge);
    surface.line(x + 3, 35, x + 6, 38, iron);
    surface.line(x + 6, 38, x + 3, 41, edge);
    surface.line(x + 3, 41, x, 38, iron);
  }
  surface.rect(53, 0, 3, 44, iron);
  surface.rect(54, 1, 1, 43, rust);

  // 각 구간은 석재 기둥으로 연결되며 틈이 없는 충돌 영역을 사용한다.
  surface.rect(0, 11, 12, 33, 0x252c2b);
  surface.rect(2, 14, 2, 27, 0x596057);
  surface.rect(5, 15, 5, 25, 0x1a2221);
  surface.rect(10, 13, 2, 30, 0x111819);
  surface.rect(1, 8, 12, 4, 0x60675d);
  surface.rect(0, 12, 14, 2, 0x373f3a);
  surface.rect(3, 5, 8, 3, 0x29322f);
  surface.rect(2, 4, 10, 1, 0x707265);
  surface.rect(0, 42, 14, 3, 0x66695a);
  surface.rect(0, 45, 14, 5, 0x2c3531);
  surface.rect(2, 46, 10, 1, 0x4c5449);
  surface.rect(5, 25, 2, 2, 0x42473b);
  surface.rect(7, 34, 2, 3, 0x3d4436);
  return surface;
}

export function createCorner(): PixelSurface {
  const surface = new PixelSurface(50, 50);
  surface.rect(0, 0, 50, 50, 0x171d1b);
  surface.rect(3, 3, 44, 44, 0x4c554c);
  surface.rect(5, 5, 40, 40, 0x6a6e5e);
  surface.rect(7, 7, 36, 36, 0x303b36);
  surface.rect(11, 11, 28, 28, 0x202b28);
  surface.rect(14, 14, 22, 22, 0x4a554a);
  surface.rect(16, 16, 18, 18, 0x39443b);
  surface.rect(23, 18, 4, 14, 0x778071);
  surface.rect(18, 23, 14, 4, 0x778071);
  surface.rect(23, 23, 4, 4, 0x9b9a7b);
  return surface;
}

export function installTexture(scene: Phaser.Scene, key: string, surface: PixelSurface): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, surface.width, surface.height);
  if (!texture) throw new Error(`Unable to create texture: ${key}`);
  const context = texture.getContext();
  const image = context.createImageData(surface.width, surface.height);
  image.data.set(surface.pixels);
  context.putImageData(image, 0, 0);
  texture.refresh();
}

export function decorateWorld(scene: Phaser.Scene, width: number, height: number, wallThickness: number): void {
  installTexture(scene, 'dead-ground', createGround(width / 2, height / 2));
  installTexture(scene, 'gothic-fence', createFence());
  installTexture(scene, 'fence-corner', createCorner());
  scene.add.image(0, 0, 'dead-ground').setOrigin(0).setScale(2).setDepth(-2);

  const half = wallThickness / 2;
  const fence = (x: number, y: number, length: number, angle: number): void => {
    scene.add.tileSprite(x, y, length, wallThickness, 'gothic-fence')
      .setAngle(angle).setDepth(-1);
  };
  fence(width / 2, half, width - wallThickness * 2, 0);
  fence(width / 2, height - half, width - wallThickness * 2, 180);
  fence(half, height / 2, height - wallThickness * 2, -90);
  fence(width - half, height / 2, height - wallThickness * 2, 90);

  for (const x of [half, width - half]) {
    for (const y of [half, height - half]) {
      scene.add.image(x, y, 'fence-corner').setDepth(-1);
    }
  }
}
