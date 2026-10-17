import test from 'node:test';
import assert from 'node:assert/strict';
import { Navigation } from '../src/navigation.ts';

test('A* walks around a solid wall and every segment clears the full actor body', () => {
  const bounds = { x: 0, y: 0, width: 600, height: 600 };
  const wall = { x: 260, y: 160, width: 60, height: 280 };
  const navigation = new Navigation(bounds, [wall]);
  for (const size of [40, 120]) {
    const from = { x: 100, y: 300 }, to = { x: 500, y: 300 };
    assert.equal(navigation.canTravel(from, to, size), false);
    const path = navigation.findPath(from, to, size);
    assert.ok(path && path.length > 2);
    let previous = from;
    for (const point of path) {
      assert.ok(navigation.canTravel(previous, point, size));
      previous = point;
    }
    assert.deepEqual(path[path.length - 1], to);
  }
});

test('a body cannot cut diagonal corners or fit through a corridor narrower than itself', () => {
  const navigation = new Navigation({ x: 0, y: 0, width: 500, height: 500 }, [
    { x: 200, y: 0, width: 40, height: 200 },
    { x: 200, y: 270, width: 40, height: 230 },
  ]);
  assert.ok(navigation.findPath({ x: 100, y: 235 }, { x: 400, y: 235 }, 40));
  assert.equal(navigation.findPath({ x: 100, y: 235 }, { x: 400, y: 235 }, 120), null);
});

test('unreachable goals return null rather than crossing a world-spanning wall', () => {
  const navigation = new Navigation({ x: 0, y: 0, width: 600, height: 600 }, [
    { x: 260, y: 0, width: 60, height: 600 },
  ]);
  assert.equal(navigation.findPath({ x: 100, y: 300 }, { x: 500, y: 300 }, 40), null);
});

test('rectangular bodies use their own width and height when passing a narrow gap', () => {
  const navigation = new Navigation({ x: 0, y: 0, width: 500, height: 500 }, [
    { x: 200, y: 0, width: 40, height: 200 },
    { x: 200, y: 300, width: 40, height: 200 },
  ]);
  const from = { x: 90, y: 250 }, to = { x: 410, y: 250 };
  // 100px 높이의 틈은 높이 80인 가로형 몸체만 통과하고 높이 120인 세로형 몸체는 통과하지 못한다.
  const path = navigation.findPath(from, to, 120, 80);
  assert.ok(path);
  let previous = from;
  for (const point of path) {
    assert.ok(navigation.canTravel(previous, point, 120, 80));
    previous = point;
  }
  assert.equal(navigation.canTravel(from, to, 80, 120), false);
  assert.equal(navigation.findPath(from, to, 80, 120), null);
});
