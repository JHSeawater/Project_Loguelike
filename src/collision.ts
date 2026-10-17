export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 물리 엔진 없이 사각형을 축별로 이동시킨다. 막힌 축만 멈추므로 벽을 따라 이동할 수 있다.
export function moveAndSlide(
  body: Box,
  dx: number,
  dy: number,
  bounds: Box,
  obstacles: readonly Box[],
): Box {
  let { x, y } = body;
  const { width, height } = body;
  // 대각선 경로도 짧게 나누어 모서리나 얇은 장애물을 건너뛰지 않는다.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 8));
  const stepX = dx / steps;
  const stepY = dy / steps;

  for (let step = 0; step < steps; step++) {
    let nextX = Math.max(bounds.x, Math.min(x + stepX, bounds.x + bounds.width - width));
    for (const obstacle of obstacles) {
      if (y >= obstacle.y + obstacle.height || y + height <= obstacle.y) continue;
      if (stepX > 0 && x + width <= obstacle.x && nextX + width > obstacle.x) {
        nextX = Math.min(nextX, obstacle.x - width);
      } else if (stepX < 0 && x >= obstacle.x + obstacle.width && nextX < obstacle.x + obstacle.width) {
        nextX = Math.max(nextX, obstacle.x + obstacle.width);
      }
    }
    x = nextX;

    let nextY = Math.max(bounds.y, Math.min(y + stepY, bounds.y + bounds.height - height));
    for (const obstacle of obstacles) {
      if (x >= obstacle.x + obstacle.width || x + width <= obstacle.x) continue;
      if (stepY > 0 && y + height <= obstacle.y && nextY + height > obstacle.y) {
        nextY = Math.min(nextY, obstacle.y - height);
      } else if (stepY < 0 && y >= obstacle.y + obstacle.height && nextY < obstacle.y + obstacle.height) {
        nextY = Math.max(nextY, obstacle.y + obstacle.height);
      }
    }
    y = nextY;
  }

  return { x, y, width, height };
}
