import type Phaser from 'phaser';
import type { Box } from './collision';
import { installTexture, PixelSurface } from './world-art';
import { dungeonObstacles, getObstacleVisual, type ObstacleKind } from './dungeon-layout';
import { getFootDepth } from './render-depth';

function addWear(surface: PixelSurface): void {
  // 발치에 이끼와 작은 잔디를 더해 기존 바닥과 자연스럽게 연결한다.
  for (const [x, y] of [[9, 42], [12, 43], [35, 43], [38, 41], [28, 44]]) {
    surface.rect(x, y, 2, 1, 0x454c32);
    surface.line(x, y, x - 1, y - 2, 0x343c2a);
  }
}

export function createObstacleArt(): Record<ObstacleKind, PixelSurface> {
  const grave = new PixelSurface(48, 48);
  grave.rect(9, 39, 31, 6, 0x141b17, 150);
  grave.polygon([[11, 40], [12, 11], [17, 11], [17, 7], [21, 4], [28, 4], [33, 8], [35, 14], [35, 37], [37, 40]], 0x1c2522);
  grave.polygon([[13, 37], [14, 12], [19, 12], [19, 8], [22, 6], [27, 6], [31, 9], [33, 14], [33, 38]], 0x74796b);
  grave.polygon([[16, 36], [17, 14], [21, 12], [22, 9], [26, 9], [30, 13], [30, 36]], 0x515d53);
  grave.rect(11, 37, 26, 4, 0x404b42);
  grave.rect(12, 37, 24, 1, 0x858675);
  grave.rect(13, 41, 22, 1, 0x242d27);
  grave.rect(23, 15, 2, 11, 0x303d37);
  grave.rect(20, 18, 8, 2, 0x303d37);
  grave.rect(20, 29, 8, 1, 0x92917a);
  grave.rect(21, 32, 5, 1, 0x353f37);
  grave.line(28, 8, 25, 12, 0x28362f);
  grave.line(25, 12, 28, 16, 0x28362f);
  grave.line(28, 16, 27, 22, 0x28362f);
  grave.rect(15, 33, 3, 3, 0x475237);

  const broken = new PixelSurface(48, 48);
  broken.rect(5, 39, 37, 6, 0x141b17, 150);
  broken.polygon([[8, 38], [10, 21], [16, 23], [19, 18], [22, 23], [25, 19], [29, 24], [29, 38]], 0x26312b);
  broken.polygon([[10, 36], [12, 24], [16, 26], [19, 21], [22, 26], [25, 23], [27, 27], [27, 36]], 0x737969);
  broken.rect(13, 29, 12, 7, 0x4a584d);
  broken.rect(17, 28, 2, 7, 0x2a3b31);
  broken.rect(14, 30, 8, 1, 0x2a3b31);
  broken.polygon([[29, 36], [33, 29], [38, 31], [39, 37], [35, 40]], 0x7c806e);
  broken.polygon([[29, 36], [35, 35], [38, 37], [35, 40]], 0x465548);
  broken.rect(7, 38, 32, 4, 0x424d3f);
  broken.rect(8, 38, 29, 1, 0x858774);
  broken.line(24, 26, 22, 34, 0x27372d);
  broken.rect(11, 36, 5, 2, 0x4b5637);

  const rock = new PixelSurface(48, 48);
  rock.rect(6, 35, 37, 8, 0x141b17, 140);
  rock.polygon([[5, 32], [9, 22], [17, 16], [29, 14], [39, 20], [43, 33], [37, 39], [16, 40]], 0x26342e);
  rock.polygon([[7, 30], [11, 23], [18, 18], [28, 16], [37, 21], [40, 29], [32, 33], [17, 33]], 0x777e6d);
  rock.polygon([[7, 31], [17, 33], [23, 26], [28, 18], [29, 29], [38, 35], [35, 38], [16, 38]], 0x515f52);
  rock.polygon([[29, 29], [40, 29], [41, 33], [38, 35]], 0x3b4b40);
  rock.line(17, 20, 21, 24, 0x9a9c82);
  rock.line(21, 24, 17, 32, 0x35483b);
  rock.line(30, 22, 33, 27, 0x445647);
  rock.rect(12, 34, 5, 2, 0x4b593a);

  const stump = new PixelSurface(48, 48);
  stump.rect(7, 38, 35, 7, 0x131a16, 150);
  stump.polygon([[7, 41], [13, 32], [15, 20], [13, 10], [20, 14], [25, 8], [28, 15], [34, 11], [32, 30], [40, 41], [33, 43], [24, 39], [14, 43]], 0x24271f);
  stump.polygon([[10, 40], [16, 31], [17, 20], [16, 15], [22, 17], [26, 13], [28, 19], [31, 16], [29, 31], [36, 40], [29, 37], [23, 35], [16, 40]], 0x63523b);
  stump.polygon([[17, 19], [20, 21], [26, 21], [30, 18], [26, 15], [23, 17], [19, 16]], 0x918064);
  stump.line(20, 18, 25, 18, 0x3b3828);
  stump.line(25, 18, 27, 17, 0x3b3828);
  stump.line(18, 23, 17, 35, 0x887052);
  stump.line(23, 24, 22, 33, 0x36382a);
  stump.line(27, 23, 26, 32, 0x3a3829);
  stump.line(28, 33, 33, 39, 0x826b4c);
  stump.line(15, 35, 12, 39, 0x8a7351);
  stump.rect(16, 35, 4, 3, 0x445039);

  const log = new PixelSurface(48, 48);
  log.rect(3, 34, 42, 9, 0x131a16, 150);
  log.polygon([[2, 33], [7, 25], [18, 25], [22, 20], [24, 25], [40, 24], [45, 30], [43, 37], [36, 40], [10, 39]], 0x24291f);
  log.polygon([[5, 32], [9, 27], [36, 26], [39, 34], [34, 37], [10, 37]], 0x61523a);
  log.line(9, 28, 33, 28, 0x897255);
  log.line(8, 32, 34, 31, 0x33392b);
  log.line(12, 35, 32, 34, 0x897255);
  log.polygon([[36, 27], [40, 26], [43, 30], [41, 35], [37, 36], [35, 32]], 0x9a8967);
  log.polygon([[37, 29], [40, 28], [41, 31], [39, 34], [37, 33]], 0x4c4b32);
  log.rect(38, 30, 2, 2, 0x867552);
  log.line(19, 27, 22, 22, 0x87704b, 2);
  log.line(15, 35, 11, 39, 0x3b3e2a, 2);
  log.rect(26, 34, 6, 3, 0x4b5838);

  const cross = new PixelSurface(48, 48);
  cross.rect(9, 39, 31, 6, 0x141b17, 150);
  // 금이 가고 모서리가 닳은 석재 십자가와 낮은 받침대.
  cross.polygon([[21, 4], [27, 4], [28, 14], [35, 14], [37, 16], [36, 21],
    [28, 21], [28, 37], [20, 37], [20, 21], [12, 21], [11, 16], [13, 14], [21, 14]], 0x25312b);
  cross.polygon([[22, 6], [25, 6], [26, 16], [34, 16], [35, 17], [34, 19],
    [26, 19], [26, 36], [22, 36], [22, 19], [14, 19], [13, 17], [15, 16], [22, 16]], 0x747b6c);
  cross.rect(24, 7, 2, 28, 0x535f53);
  cross.rect(15, 18, 19, 1, 0x535f53);
  cross.line(22, 7, 22, 16, 0x929582);
  cross.rect(14, 16, 7, 1, 0x929582);
  cross.line(25, 10, 23, 14, 0x303e34);
  cross.line(23, 14, 25, 18, 0x303e34);
  cross.line(25, 25, 23, 28, 0x303e34);
  cross.rect(13, 36, 22, 3, 0x69715f);
  cross.rect(11, 39, 26, 3, 0x414e40);
  cross.rect(12, 39, 24, 1, 0x858975);
  cross.rect(15, 40, 4, 2, 0x4a5838);

  const deadTree = new PixelSurface(48, 48);
  deadTree.rect(7, 39, 35, 6, 0x131a16, 150);
  deadTree.polygon([[7, 42], [16, 35], [19, 26], [19, 20], [23, 20], [26, 27],
    [28, 35], [40, 42], [31, 43], [24, 39], [16, 43]], 0x25291f);
  deadTree.polygon([[11, 40], [19, 34], [21, 24], [23, 26], [25, 35], [35, 41],
    [28, 39], [23, 36], [18, 40]], 0x66553d);
  // 굽은 줄기와 잎 없는 갈라진 가지.
  const limbs: readonly (readonly [number, number, number, number, number])[] = [
    [21, 30, 18, 21, 4], [18, 21, 14, 17, 3], [14, 17, 14, 12, 2],
    [14, 12, 10, 8, 1], [15, 18, 9, 19, 2], [9, 19, 7, 15, 1],
    [21, 26, 25, 20, 4], [25, 20, 25, 13, 3], [25, 13, 22, 10, 2],
    [22, 10, 23, 7, 1], [25, 16, 29, 11, 2], [29, 11, 33, 11, 1],
    [33, 11, 35, 7, 1], [25, 24, 32, 22, 3], [32, 22, 35, 16, 2],
    [35, 16, 39, 14, 1], [32, 22, 38, 25, 2], [38, 25, 40, 22, 1],
  ];
  for (const [x, y, endX, endY, thickness] of limbs) {
    deadTree.line(x, y, endX, endY, 0x282b21, thickness + 1);
  }
  for (const [x, y, endX, endY, thickness] of limbs) {
    deadTree.line(x, y, endX, endY, thickness > 2 ? 0x6d5940 : 0x857052,
      Math.max(1, thickness - 1));
  }
  deadTree.line(20, 29, 18, 37, 0x978060);
  deadTree.line(24, 30, 25, 36, 0x3b3a2b);
  deadTree.line(27, 36, 33, 40, 0x8a7353);
  deadTree.rect(15, 39, 4, 2, 0x465438);

  const art = { grave, 'broken-grave': broken, rock, stump, log,
    'cross-grave': cross, 'dead-tree': deadTree };
  for (const surface of Object.values(art)) addWear(surface);
  // 너비 12.5%, 높이 25% 확대. 정수 픽셀 복사로 도트 가장자리를 유지한다.
  const tallerTree = new PixelSurface(54, 60);
  for (let y = 0; y < tallerTree.height; y++) {
    for (let x = 0; x < tallerTree.width; x++) {
      const sourceX = Math.floor(x * deadTree.width / tallerTree.width);
      const sourceY = Math.floor(y * deadTree.height / tallerTree.height);
      const offset = (sourceY * deadTree.width + sourceX) * 4;
      tallerTree.pixels.set(deadTree.pixels.subarray(offset, offset + 4), (y * tallerTree.width + x) * 4);
    }
  }
  art['dead-tree'] = tallerTree;
  return art;
}

export function createDungeon(scene: Phaser.Scene): readonly Box[] {
  for (const [kind, surface] of Object.entries(createObstacleArt())) {
    installTexture(scene, `obstacle-${kind}`, surface);
  }
  for (const obstacle of dungeonObstacles) {
    const visual = getObstacleVisual(obstacle);
    scene.add.image(visual.x, visual.y, `obstacle-${obstacle.kind}`)
      .setOrigin(0).setScale(2).setFlipX(visual.flipX).setDepth(getFootDepth(obstacle));
  }
  return dungeonObstacles;
}
