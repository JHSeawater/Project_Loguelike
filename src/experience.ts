export interface LevelProgress {
  level: number;
  experience: number;
}

// 레벨 n→n+1 필요량. 5에서 시작해 출발 레벨 10단위 구간마다 증가량이 5·10·20·40…으로 두 배가 된다.
export function experienceToNextLevel(level: number): number {
  let need = 5;
  for (let n = 2; n <= level; n++) need += 5 * 2 ** Math.floor(n / 10);
  return need;
}

// 초과분은 이월하고, 남은 경험치가 다음 필요량보다 작아질 때까지 연속으로 레벨을 올린다.
export function addExperience(progress: LevelProgress, amount: number): LevelProgress {
  let { level, experience } = progress;
  experience += amount;
  for (let need = experienceToNextLevel(level); experience >= need; need = experienceToNextLevel(level)) {
    experience -= need;
    level++;
  }
  return { level, experience };
}
