import test from 'node:test';
import assert from 'node:assert/strict';
import { moveAndSlide } from '../src/collision.ts';

const bounds = { x: 50, y: 50, width: 2900, height: 2900 };
const body = (x, y) => ({ x, y, width: 40, height: 40 });
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

test('free movement preserves distance and stops when no movement is requested', () => {
  const start = body(1480, 1480);
  assert.equal(moveAndSlide(start, 250, 0, bounds, []).x, 1730);
  const diagonal = moveAndSlide(start, 250 / Math.sqrt(2), 250 / Math.sqrt(2), bounds, []);
  assert.ok(Math.abs(Math.hypot(diagonal.x - start.x, diagonal.y - start.y) - 250) < 1e-8);
  assert.deepEqual(moveAndSlide(start, 0, 0, bounds, []), start);
  assert.deepEqual(start, body(1480, 1480));
});

test('obstacles block movement from all four sides, including large steps', () => {
  const obstacle = { x: 500, y: 500, width: 80, height: 80 };
  assert.equal(moveAndSlide(body(200, 520), 1000, 0, bounds, [obstacle]).x, 460);
  assert.equal(moveAndSlide(body(800, 520), -1000, 0, bounds, [obstacle]).x, 580);
  assert.equal(moveAndSlide(body(520, 200), 0, 1000, bounds, [obstacle]).y, 460);
  assert.equal(moveAndSlide(body(520, 800), 0, -1000, bounds, [obstacle]).y, 580);
});

test('contact blocks one axis while allowing sliding, reversing and moving away', () => {
  const obstacle = { x: 500, y: 300, width: 80, height: 600 };
  const start = body(460, 400);
  const down = moveAndSlide(start, 100, 80, bounds, [obstacle]);
  assert.equal(down.x, 460);
  assert.ok(Math.abs(down.y - 480) < 1e-8);
  const up = moveAndSlide(down, 100, -80, bounds, [obstacle]);
  assert.ok(Math.abs(up.y - 400) < 1e-8);
  assert.ok(Math.abs(moveAndSlide(up, -100, 0, bounds, [obstacle]).x - 360) < 1e-8);
});

test('diagonal input cannot squeeze through a closed corner', () => {
  const obstacles = [
    { x: 500, y: 50, width: 100, height: 450 },
    { x: 50, y: 500, width: 450, height: 100 },
  ];
  const result = moveAndSlide(body(300, 300), 1000, 1000, bounds, obstacles);
  assert.equal(result.x, 460);
  assert.equal(result.y, 460);
  assert.ok(obstacles.every((obstacle) => !overlaps(result, obstacle)));
});

test('thin blockers and diagonal paths are not skipped during delayed frames', () => {
  const obstacle = { x: 700, y: 600, width: 2, height: 400 };
  const result = moveAndSlide(body(300, 300), 1600, 1500, bounds, [obstacle]);
  assert.ok(!overlaps(result, obstacle));
  // A long wall must stop the same diagonal even when the endpoint is past it.
  const wall = { ...obstacle, height: 2300 };
  const blocked = moveAndSlide(body(300, 300), 1600, 1500, bounds, [wall]);
  assert.equal(blocked.x, 660);
});

test('the player stays inside the 50px perimeter on every side and corner', () => {
  assert.equal(moveAndSlide(body(1480, 1480), -10000, 0, bounds, []).x, 50);
  assert.equal(moveAndSlide(body(1480, 1480), 10000, 0, bounds, []).x, 2910);
  assert.equal(moveAndSlide(body(1480, 1480), 0, -10000, bounds, []).y, 50);
  assert.equal(moveAndSlide(body(1480, 1480), 0, 10000, bounds, []).y, 2910);
  const corner = moveAndSlide(body(1480, 1480), -10000, -10000, bounds, []);
  assert.deepEqual(corner, body(50, 50));
});

test('the nearest obstacle wins regardless of array order', () => {
  const obstacles = [
    { x: 600, y: 100, width: 60, height: 200 },
    { x: 500, y: 100, width: 60, height: 200 },
  ];
  const start = body(200, 150);
  assert.equal(moveAndSlide(start, 1000, 0, bounds, obstacles).x, 460);
  assert.deepEqual(moveAndSlide(start, 1000, 0, bounds, obstacles),
    moveAndSlide(start, 1000, 0, bounds, [...obstacles].reverse()));
});
