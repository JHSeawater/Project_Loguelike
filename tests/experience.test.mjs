import test from 'node:test';
import assert from 'node:assert/strict';
import { addExperience, experienceToNextLevel } from '../src/experience.ts';

const cumulativeTo = (level) => {
  let total = 0;
  for (let n = 1; n < level; n++) total += experienceToNextLevel(n);
  return total;
};

test('level requirement grows continuously by 5, 10, 20, 40 per ten-level band', () => {
  const expected = { 1: 5, 2: 10, 9: 45, 10: 55, 11: 65, 19: 145, 20: 165, 29: 345, 30: 385, 31: 425, 39: 745, 40: 825 };
  for (const [level, need] of Object.entries(expected)) assert.equal(experienceToNextLevel(Number(level)), need, `level ${level}`);
  assert.equal(cumulativeTo(10), 225);
  assert.equal(cumulativeTo(20), 1225);
  assert.equal(cumulativeTo(30), 3775);
  assert.equal(cumulativeTo(40), 9425);
  assert.equal(cumulativeTo(50), 21275);
});

test('experience levels up exactly at the requirement and carries the remainder over', () => {
  assert.deepEqual(addExperience({ level: 1, experience: 0 }, 4), { level: 1, experience: 4 });
  assert.deepEqual(addExperience({ level: 1, experience: 4 }, 1), { level: 2, experience: 0 });
  assert.deepEqual(addExperience({ level: 1, experience: 4 }, 3), { level: 2, experience: 2 });
  assert.deepEqual(addExperience({ level: 9, experience: 44 }, 1), { level: 10, experience: 0 });
  assert.deepEqual(addExperience({ level: 10, experience: 54 }, 1), { level: 11, experience: 0 });
});

test('a large gain processes several level ups in order without losing experience', () => {
  assert.deepEqual(addExperience({ level: 1, experience: 0 }, 20), { level: 3, experience: 5 });
  assert.deepEqual(addExperience({ level: 1, experience: 0 }, 225), { level: 10, experience: 0 });
  assert.deepEqual(addExperience({ level: 1, experience: 0 }, 3775 + 384), { level: 30, experience: 384 });
  let progress = { level: 1, experience: 0 };
  for (let i = 0; i < 1225; i++) progress = addExperience(progress, 1);
  assert.deepEqual(progress, { level: 20, experience: 0 });
});
