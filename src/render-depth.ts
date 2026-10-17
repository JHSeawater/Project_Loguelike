import type { Box } from './collision';

// 화면 좌표가 아닌 월드 발밑 좌표로 정렬한다. 플레이어·적·장애물이 공통으로 사용한다.
export function getFootDepth(body: Pick<Box, 'y' | 'height'>): number {
  return body.y + body.height;
}
