import { moveAndSlide, type Box } from './collision.ts';
import { BATTLE_CONFIG as CFG, BLESS_CONFIG as BLESS, BOSS_CONFIG as BOSS, CHARACTER_STATS, ENEMY_STATS, SKILL_CONFIG as SKILL, SPAWN_PATTERNS,
  SPAWN_STAGES, SPAWN_WEIGHTS, type CharacterId, type EnemyKind, type SpawnStage } from './battle-config.ts';
import { center, centerInView, contains, distanceSquared, edgeDistance, expand, overlaps, segmentHit, type Point } from './battle-geometry.ts';
import { Navigation } from './navigation.ts';
import { addExperience } from './experience.ts';
import { BLESS_IDS, BOSS_REWARD, REWARD_STEP, bossRewardPool, emptyStacks, maxHpFor, missingSpecialSkills, rewardPool, rollChoices,
  skillStatsFor, statsFor, type BlessId, type PlayerStats, type RewardId, type SkillId, type SkillStats } from './rewards.ts';

export interface Actor extends Box {
  id: number;
  hp: number;
  maxHp: number;
  attackable: boolean;
  lastHitAt: number;
}

export interface Enemy extends Actor {
  kind: EnemyKind;
  targetId: number | null;
  nextThinkAt: number;
  nextPathAt: number;
  nextAttackAt: number;
  path: Point[];
  pathIndex: number;
  stuckMs: number;
  // 원거리 적·사제가 사거리 안에서 멈춰 있는지. 멈춘 동안은 다른 적의 이동을 막지 않는다.
  holding: boolean;
}

export interface Projectile extends Box {
  id: number;
  team: 'ally' | 'enemy';
  vx: number;
  vy: number;
  damage: number;
  expiresAt: number;
  color: number;
  // 추적 마탄을 얻은 뒤 발사한 플레이어 투사체만 가까운 적을 향해 방향을 바꾼다.
  homing?: boolean;
  // 발사된 게임 시간. 단계 끝에 발사되므로 다음 단계부터 움직인다.
  firedAt?: number;
}

// 휘두르기·폭발·사제 회복의 범위를 잠시 보여주기 위한 기록. 판정에는 쓰지 않는다.
export interface AttackEffect {
  id: number;
  kind: 'swing' | 'explosion' | 'heal';
  x: number;
  y: number;
  radius: number;
  at: number;
}

// 보스 범위 공격의 경고. (x, y)는 낙인 원과 십자의 중심이며, hitAt에 범위에 닿은 아군에게 한 번 피해를 준다.
export interface Hazard {
  id: number;
  kind: 'brand' | 'cross';
  x: number;
  y: number;
  castAt: number;
  hitAt: number;
}

// 성광 십자의 가로·세로 팔. 판정과 표시가 같은 사각형을 쓴다.
export function crossArms(hazard: Point): [Box, Box] {
  const { width, length } = BOSS.cross;
  return [{ x: hazard.x - length, y: hazard.y - width / 2, width: length * 2, height: width },
    { x: hazard.x - width / 2, y: hazard.y - length, width, height: length * 2 }];
}

// 범위에 몸체가 닿았는지 판정한다. 경계에 정확히 닿는 경우도 포함한다.
export function hazardTouches(hazard: Hazard, body: Box): boolean {
  if (hazard.kind === 'brand') return circleTouches(hazard, BOSS.brand.radius, body);
  return crossArms(hazard).some((arm) => body.x <= arm.x + arm.width && body.x + body.width >= arm.x
    && body.y <= arm.y + arm.height && body.y + body.height >= arm.y);
}

export interface ExpOrb extends Box {
  id: number;
  value: number;
  pulled: boolean;
}

// hpPercent: 생성 시점의 체력 배율(백분율). 정수로 계산한 뒤 반올림한다.
export function createEnemy(id: number, kind: EnemyKind, x: number, y: number, now = 0, hpPercent = 100): Enemy {
  const stats = ENEMY_STATS[kind];
  const hp = Math.round(stats.hp * hpPercent / 100);
  return { id, kind, x, y, width: stats.width, height: stats.height, hp, maxHp: hp,
    attackable: true, lastHitAt: -Infinity, targetId: null, nextThinkAt: now,
    nextPathAt: now, nextAttackAt: now, path: [], pathIndex: 0, stuckMs: 0, holding: false };
}

// 게임 시간에 해당하는 생성 단계. 경계 시점부터 다음 단계를 쓴다.
export function stageAt(time: number): SpawnStage {
  let current = SPAWN_STAGES[0];
  for (const stage of SPAWN_STAGES) if (time >= stage.at) current = stage;
  return current;
}

// 그 시점까지 등장한 종류 중 가중치로 고른다. 광신도는 가중치가 없어 일반 생성에 나오지 않는다.
export function pickSpawnKind(time: number, random: () => number): EnemyKind {
  const kinds = SPAWN_STAGES.filter((stage) => time >= stage.at).flatMap((stage) => stage.adds)
    .filter((kind) => SPAWN_WEIGHTS[kind]);
  const weights = kinds.map((kind) => SPAWN_WEIGHTS[kind] ?? 0);
  let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
  let index = 0;
  while (index < kinds.length - 1 && roll >= weights[index]) roll -= weights[index++];
  return kinds[index];
}

// 10:00에는 100%, 이후 1분마다 기본 체력의 10%씩 더한 백분율.
export function hpPercentAt(time: number): number {
  const growth = SPAWN_PATTERNS.hpGrowth;
  return time < growth.from ? 100 : 100 + growth.percent * Math.floor((time - growth.from) / growth.everyMs);
}

export function nearestTarget<T extends Actor>(source: Box, targets: readonly T[], view?: Box, preferredId?: number | null): T | null {
  let best: T | null = null, distance = Infinity;
  for (const candidate of targets) {
    if (candidate.hp <= 0 || !candidate.attackable || (view && !centerInView(candidate, view))) continue;
    const d = distanceSquared(source, candidate);
    if (d < distance || (d === distance && (candidate.id === preferredId
      || (best?.id !== preferredId && candidate.id < (best?.id ?? Infinity))))) {
      best = candidate; distance = d;
    }
  }
  return best;
}

// 원과 사각형 몸체가 겹치는지 판정한다. 경계에 정확히 닿는 경우도 포함한다.
export function circleTouches(point: Point, radius: number, body: Box): boolean {
  const dx = Math.max(body.x - point.x, 0, point.x - body.x - body.width);
  const dy = Math.max(body.y - point.y, 0, point.y - body.y - body.height);
  return dx * dx + dy * dy <= radius * radius;
}

const rotate = (x: number, y: number, radians: number): Point => ({
  x: x * Math.cos(radians) - y * Math.sin(radians), y: x * Math.sin(radians) + y * Math.cos(radians),
});

export class Battle {
  readonly character: CharacterId;
  readonly player: Actor;
  // 소환물 시스템은 아직 만들지 않는다. 추후 살아 있는 소환물을 같은 후보 목록에 연결한다.
  readonly allies: Actor[];
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  effects: AttackEffect[] = [];
  // 생성 순서대로 유지해 상한 초과 시 가장 오래된 구슬을 찾는다.
  orbs: ExpOrb[] = [];
  time = 0;
  kills = 0;
  level = 1;
  experience = 0;
  gameOver = false;
  // 보상은 이번 게임에서만 유지된다. 능력치는 중첩 수로 다시 계산한다.
  readonly rewardStacks = emptyStacks();
  stats: PlayerStats;
  skills: SkillStats;
  // 워록의 마력 폭주가 끝나는 게임 시간. 보상을 고를 때마다 이 시점부터 다시 계산한다.
  surgeUntil = -Infinity;
  // 선택지가 열려 있는 동안 전투 전체가 일시정지된다. 보스 보상 → 가호 → 레벨업 선택창 순서로 연다.
  choices: RewardId[] = [];
  choiceSource: 'level' | 'boss' | 'blessing' = 'level';
  // 보스 보상 '직업 특수 특기'로 얻을 특수 특기. 보스 보상 선택창을 열 때 아직 없는 것 중에서 무작위로 정한다.
  bossSpecial: SkillId | null = null;
  // 피의 광란: 처치한 뒤 다음 1회 휘두르기의 공격력이 커진다. 여러 번 처치해도 한 번만 쌓인다.
  frenzyCharged = false;
  // 보스 보상 '성스러운 방벽'의 남은 배리어. 체력보다 먼저 피해를 막는다.
  barrier = 0;
  // 등장한 보스와 등장한 게임 시간. 처치된 뒤에도 남겨 두어 표시에서 처치 여부를 알 수 있다.
  boss: Enemy | null = null;
  bossAppearedAt = -Infinity;
  // 보스 범위 공격의 경고 목록과 신성 방벽이 끝나는 게임 시간.
  hazards: Hazard[] = [];
  bossGuardUntil = -Infinity;
  private pendingLevelUps = 0;
  private pendingBossRewards = 0;
  private pendingBlessings = 0;
  private nextBlessAt: number = BLESS.everyMs;
  // 경험치 배율로 생긴 1 미만의 경험치를 백분율 단위로 이월한다.
  private expCarry = 0;

  // 아직 보상을 고르지 않은 레벨업 수. 현재 열린 선택창을 포함한다.
  get pendingChoices(): number {
    return this.pendingLevelUps;
  }

  // 가호로 더해진 적 능력치 배율(백분율). 기본값 기준으로 가호마다 더한다.
  blessPercent(id: BlessId): number {
    return 100 + this.rewardStacks[id] * BLESS.percent;
  }

  // 가호 '정화'을 적용한 적의 피해. 정수로 반올림한다.
  private enemyDamage(base: number): number {
    return Math.round(base * this.blessPercent('blessDamage') / 100);
  }

  // 배리어의 최대치. '성스러운 방벽'을 얻은 뒤 현재 최대 체력의 일정 비율이다.
  get barrierMax(): number {
    return this.rewardStacks.barrier ? Math.round(this.player.maxHp * BOSS_REWARD.barrierPercent / 100) : 0;
  }
  private readonly obstacles: readonly Box[];
  private readonly navigation: Navigation;
  private readonly random: () => number;
  private readonly spawning: boolean;
  private nextId = 1;
  private nextSpawnAt = 0;
  private nextGroupAt: number = SPAWN_PATTERNS.zealotGroup.from;
  private nextRingAt: number = SPAWN_PATTERNS.ring.from;
  // 보스가 등장하면 Infinity가 되어 다시 등장하지 않는다.
  private nextBossAt: number = BOSS.at;
  private nextBossActionAt = Infinity;
  private bossActionIndex = 0;
  // 성광 십자를 경고하는 동안 보스는 멈춘다.
  private bossCastUntil = -Infinity;
  private lastPlayerAttackAt = -Infinity;
  private pathBudget = 0;
  // 현재 단계가 시작된 게임 시간. 주기 동작이 이번 단계 안에서 준비됐는지 판단한다.
  private stepStart = 0;
  // 단계 시작 시점의 몸체 위치. 투사체는 몸체가 이 위치에서 지금 위치까지 움직인 것으로 보고 판정한다.
  private readonly origins = new Map<Actor, Point>();
  // 적이 움직일 때 다른 적의 막는 범위를 담는 상자. 이동마다 다시 채워 쓴다.
  private readonly enemyBlockers: Box[] = [];

  constructor(obstacles: readonly Box[],
    options: { spawning?: boolean; random?: () => number; character?: CharacterId } = {}) {
    this.character = options.character ?? 'warlock';
    const hp = CHARACTER_STATS[this.character].hp;
    this.player = { id: 0, x: 1480, y: 1480, width: CFG.player.size, height: CFG.player.size,
      hp, maxHp: hp, attackable: true, lastHitAt: -Infinity };
    this.allies = [this.player];
    this.stats = statsFor(this.rewardStacks, this.character);
    this.skills = skillStatsFor(this.rewardStacks, this.character);
    this.obstacles = obstacles;
    this.navigation = new Navigation(CFG.world, obstacles);
    this.random = options.random ?? Math.random;
    this.spawning = options.spawning ?? true;
  }

  // 최대 적 수에 세는 적. 보스는 포함하지 않는다.
  private regularCount(): number {
    let count = 0;
    for (const enemy of this.enemies) if (enemy.kind !== BOSS.kind) count++;
    return count;
  }

  // near가 있으면 그 지점 주변(무리 생성), 없으면 화면 주변 550px 범위에서 무작위로 자리를 찾는다.
  // 보스는 최대 적 수와 관계없이 생성하고, onScreen이면 화면 밖 규칙 없이 near 주변에 둔다(보스의 소환).
  spawnEnemy(kind: EnemyKind, view: Box, near?: Point, onScreen = false): Enemy | null {
    if (this.gameOver || (kind !== BOSS.kind && this.regularCount() >= stageAt(this.time).max)) return null;
    const { width, height } = ENEMY_STATS[kind];
    const spread = onScreen ? BOSS.rally.spread : SPAWN_PATTERNS.zealotGroup.spread;
    const area = near ? { x: near.x - spread, y: near.y - spread, width: spread * 2, height: spread * 2 } : expand(view, 550);
    const left = Math.max(CFG.world.x, area.x);
    const top = Math.max(CFG.world.y, area.y);
    const right = Math.min(CFG.world.x + CFG.world.width, area.x + area.width) - width;
    const bottom = Math.min(CFG.world.y + CFG.world.height, area.y + area.height) - height;
    if (right < left || bottom < top) return null;
    for (let attempt = 0; attempt < 120; attempt++) {
      const body = { x: left + this.random() * (right - left), y: top + this.random() * (bottom - top), width, height };
      if (this.canSpawnAt(body, view, onScreen)) return this.addEnemy(kind, body);
    }
    return null;
  }

  // 화면 밖·월드 안·장애물 밖이며 살아 있는 몸체와 겹치지 않는 자리인지 확인한다. onScreen이면 화면 밖 조건을 뺀다.
  private canSpawnAt(body: Box, view: Box, onScreen = false): boolean {
    return contains(CFG.world, body) && (onScreen || !overlaps(body, expand(view, CFG.spawnMargin)))
      && !this.obstacles.some((obstacle) => overlaps(body, obstacle))
      && ![...this.allies, ...this.enemies].some((actor) => actor.hp > 0 && overlaps(body, actor));
  }

  // 시간에 따른 체력 증가와 가호 '신앙심'을 더한 체력으로 만든다. 이미 있는 적의 체력은 바꾸지 않는다.
  private addEnemy(kind: EnemyKind, body: Box): Enemy {
    const hpPercent = hpPercentAt(this.time) + this.blessPercent('blessHp') - 100;
    const enemy = createEnemy(this.nextId++, kind, body.x, body.y, this.time, hpPercent);
    enemy.nextThinkAt += enemy.id % 5 * 50;
    this.enemies.push(enemy);
    return enemy;
  }

  // 포위 웨이브: 화면 중심에서 같은 각도 간격으로 뻗은 방향마다, 화면 밖 여유 거리 바로 바깥에 놓는다.
  // 장애물이나 월드 경계에 막히면 같은 방향으로 20px씩 최대 10번 더 밀어 보고, 자리가 없으면 그 방향은 건너뛴다.
  private spawnRing(view: Box): void {
    const { kind, count } = SPAWN_PATTERNS.ring;
    const { width, height } = ENEMY_STATS[kind];
    const origin = center(view);
    const halfX = view.width / 2 + CFG.spawnMargin + width / 2 + 1;
    const halfY = view.height / 2 + CFG.spawnMargin + height / 2 + 1;
    for (let i = 0; i < count; i++) {
      if (this.regularCount() >= stageAt(this.time).max) return;
      const angle = i / count * Math.PI * 2;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const reach = Math.min(Math.abs(dx) > 1e-9 ? halfX / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? halfY / Math.abs(dy) : Infinity);
      for (let push = 0; push <= 10; push++) {
        const distance = reach + push * 20;
        const body = { x: origin.x + dx * distance - width / 2, y: origin.y + dy * distance - height / 2, width, height };
        if (this.canSpawnAt(body, view)) { this.addEnemy(kind, body); break; }
      }
    }
  }

  // 시간 단계별 일반 생성과 광신도 무리·포위 웨이브, 보스 등장을 처리한다.
  private spawnWaves(view: Box): void {
    // 보스는 자리가 없으면 다음 단계에 다시 시도한다.
    if (this.time >= this.nextBossAt) {
      const boss = this.spawnEnemy(BOSS.kind, view);
      if (boss) {
        this.boss = boss;
        this.bossAppearedAt = this.time;
        this.nextBossAt = Infinity;
        this.nextBossActionAt = this.time + BOSS.firstActionMs;
      }
    }
    const stage = stageAt(this.time);
    if (this.time >= this.nextSpawnAt) {
      for (let i = 0; i < stage.count; i++) this.spawnEnemy(pickSpawnKind(this.time, this.random), view);
      this.nextSpawnAt = this.intervalFrom(this.nextSpawnAt) + stage.everyMs;
    }
    const group = SPAWN_PATTERNS.zealotGroup;
    if (this.time >= this.nextGroupAt) {
      this.nextGroupAt += group.everyMs;
      const leader = this.spawnEnemy('zealot', view);
      for (let i = 1; leader && i < group.count; i++) this.spawnEnemy('zealot', view, center(leader));
    }
    if (this.time >= this.nextRingAt) {
      const due = this.nextRingAt;
      this.nextRingAt += SPAWN_PATTERNS.ring.everyMs;
      // 보스가 등장하는 회차의 포위 웨이브는 건너뛴다.
      if (due !== BOSS.at) this.spawnRing(view);
    }
  }

  // 보스 행동: 정해진 간격마다 순서대로 범위 공격 경고, 소집, 방벽을 쓴다.
  private bossAct(boss: Enemy, target: Actor, view: Box): void {
    if (this.time < this.nextBossActionAt) return;
    this.nextBossActionAt = this.intervalFrom(this.nextBossActionAt) + BOSS.everyMs;
    const action = BOSS.cycle[this.bossActionIndex++ % BOSS.cycle.length];
    if (action === 'brand') this.addHazard('brand', center(target), BOSS.brand.warnMs);
    else if (action === 'cross') {
      this.addHazard('cross', center(boss), BOSS.cross.warnMs);
      this.bossCastUntil = this.time + BOSS.cross.warnMs;
    } else if (action === 'rally') {
      for (let i = 0; i < BOSS.rally.count; i++) this.spawnEnemy(BOSS.rally.kind, view, center(boss), true);
    } else this.bossGuardUntil = this.time + BOSS.aegis.durationMs;
  }

  private addHazard(kind: Hazard['kind'], point: Point, warnMs: number): void {
    this.hazards.push({ id: this.nextId++, kind, x: point.x, y: point.y, castAt: this.time, hitAt: this.time + warnMs });
  }

  // 경고 시간이 끝난 범위 공격은 그 순간 범위에 닿은 아군에게 한 번 피해를 주고 사라진다. 장애물은 막지 않는다.
  private resolveHazards(): void {
    if (!this.hazards.length) return;
    this.hazards = this.hazards.filter((hazard) => {
      if (this.time < hazard.hitAt) return true;
      const damage = this.enemyDamage(hazard.kind === 'brand' ? BOSS.brand.damage : BOSS.cross.damage);
      for (const ally of this.allies) if (ally.hp > 0 && hazardTouches(hazard, ally)) this.dealDamage(ally, damage);
      return false;
    });
  }

  // 주기 동작의 다음 간격을 셀 기준 시각. 이번 단계 안에서 준비됐으면 준비된 시각부터 세어, 프레임 간격이
  // 주기로 나누어떨어지지 않아도 늦어진 만큼이 쌓이지 않게 한다. 이전 단계부터 대상이 없거나 사거리 밖이라
  // 기다리고 있었으면 지금부터 센다.
  private intervalFrom(readyAt: number): number {
    return readyAt > this.stepStart ? readyAt : this.time;
  }

  // 신성 방벽이 유지되는 동안 보스와, 보스 중심 반경 안에 몸체가 닿은 적은 피해가 줄어든다.
  private guarded(target: Actor): boolean {
    const boss = this.boss;
    if (!boss || boss.hp <= 0 || this.time >= this.bossGuardUntil || target === this.player) return false;
    return target === boss || (this.enemies.includes(target as Enemy) && circleTouches(center(boss), BOSS.aegis.radius, target));
  }

  dealDamage(target: Actor, damage: number): boolean {
    if (this.gameOver || target.hp <= 0 || !target.attackable) return false;
    if (target === this.player && this.time - target.lastHitAt < CFG.player.hurtMs) return false;
    if (this.guarded(target)) damage = Math.round(damage * (100 - BOSS.aegis.reducePercent) / 100);
    // 배리어가 체력보다 먼저 피해를 막는다. 다 막아도 피격으로 보아 피격 간격이 시작된다.
    if (target === this.player && this.barrier > 0) {
      const absorbed = Math.min(this.barrier, damage);
      this.barrier -= absorbed;
      damage -= absorbed;
    }
    target.hp = Math.max(0, target.hp - damage);
    target.lastHitAt = this.time;
    // 살아 있던 적이 이 피해로 죽을 때만 구슬을 만들므로 처치 주체와 관계없이 한 번만 생긴다.
    if (target.hp === 0 && this.enemies.includes(target as Enemy)) this.dropOrb(target as Enemy);
    // 보스가 죽으면 아직 끝나지 않은 범위 공격은 사라지고, 보스 보상 선택이 생긴다.
    if (target.hp === 0 && target === this.boss) {
      this.hazards = [];
      this.pendingBossRewards++;
    }
    if (target === this.player && target.hp === 0) {
      this.gameOver = true;
      for (const ally of this.allies) ally.hp = 0;
      this.projectiles = [];
    }
    return true;
  }

  // 적의 경험치만큼 같은 값의 구슬을 몸체 안에 격자로 고르게 놓는다. 몸체는 장애물과 겹치지 않으므로 구슬도 이동 가능 공간에 생긴다.
  private dropOrb(enemy: Enemy): void {
    const { size, value } = CFG.expOrb;
    const count = Math.round(ENEMY_STATS[enemy.kind].exp / value);
    const cols = Math.ceil(Math.sqrt(count * enemy.width / enemy.height)), rows = Math.ceil(count / cols);
    for (let i = 0; i < count; i++) {
      // 상한을 넘으면 새 구슬 대신 가장 오래된 구슬에 값을 더해 총량을 보존한다.
      if (this.orbs.length >= CFG.expOrb.max) {
        this.orbs[0].value += value;
        continue;
      }
      const cx = enemy.x + (i % cols + 0.5) * enemy.width / cols;
      const cy = enemy.y + (Math.floor(i / cols) + 0.5) * enemy.height / rows;
      // 구슬이 몸체 밖으로 나가지 않도록 중심을 안쪽으로 제한한다.
      const x = Math.max(enemy.x, Math.min(cx - size / 2, enemy.x + enemy.width - size));
      const y = Math.max(enemy.y, Math.min(cy - size / 2, enemy.y + enemy.height - size));
      this.orbs.push({ id: this.nextId++, x, y, width: size, height: size, value, pulled: false });
    }
  }

  private updateOrbs(dt: number): void {
    const target = center(this.player);
    const remaining: ExpOrb[] = [];
    for (const orb of this.orbs) {
      const from = center(orb);
      const distance = Math.hypot(target.x - from.x, target.y - from.y);
      // 반경 경계를 포함한다. 한 번 끌려온 구슬은 플레이어가 멀어져도 계속 따라간다.
      if (distance <= this.stats.pickupRadius) orb.pulled = true;
      if (orb.pulled && distance > 0) {
        // 플레이어 중심을 넘어가지 않도록 이동량을 남은 거리로 제한한다.
        const move = Math.min(distance, CFG.expOrb.pullSpeed * dt / 1000);
        orb.x += (target.x - from.x) / distance * move;
        orb.y += (target.y - from.y) / distance * move;
      }
      if (overlaps(orb, this.player)) {
        const before = this.level;
        // 영혼 흡수 배율을 백분율 정수로 곱하고, 1 미만은 다음 획득으로 이월해 총량을 보존한다.
        const percentUnits = orb.value * this.skills.expPercent + this.expCarry;
        this.expCarry = percentUnits % 100;
        ({ level: this.level, experience: this.experience } = addExperience(this, Math.floor(percentUnits / 100)));
        this.pendingLevelUps += this.level - before;
      } else remaining.push(orb);
    }
    this.orbs = remaining;
  }

  // 보스 보상 선택창, 가호 선택창을 먼저 열고, 이어서 오른 레벨 수만큼 선택창을 순서대로 연다. 매번 그 시점의 보상 상태로 새로 구성한다.
  private openNextChoices(): void {
    if (this.gameOver || this.choices.length) return;
    if (this.pendingBossRewards > 0) {
      this.choiceSource = 'boss';
      this.choices = rollChoices(this.rewardStacks, BOSS_REWARD.choices, this.random, bossRewardPool(this.rewardStacks, this.character));
      const missing = missingSpecialSkills(this.rewardStacks, this.character);
      this.bossSpecial = this.choices.includes('bossSkill') ? missing[Math.min(missing.length - 1, Math.floor(this.random() * missing.length))] : null;
    } else if (this.pendingBlessings > 0) {
      this.choiceSource = 'blessing';
      this.choices = [...BLESS_IDS];
    } else if (this.pendingLevelUps > 0) {
      this.choiceSource = 'level';
      this.choices = rollChoices(this.rewardStacks, this.stats.choiceCount, this.random, rewardPool(this.character));
    }
  }

  choose(index: number): boolean {
    if (this.gameOver || !Number.isInteger(index) || index < 0 || index >= this.choices.length) return false;
    const id = this.choices[index];
    this.choices = [];
    const levelUp = this.choiceSource === 'level';
    if (levelUp) this.pendingLevelUps--;
    else if (this.choiceSource === 'boss') this.pendingBossRewards--;
    else this.pendingBlessings--;
    this.applyReward(id);
    // 마력 폭주: 레벨업 보상을 고른 시점부터 지속 시간을 다시 센다. 연속 레벨업에서도 누적하지 않는다.
    // 보상을 적용한 뒤에 정하므로 마력 조정을 고른 순간의 폭주부터 늘어난 지속 시간을 쓴다.
    if (levelUp && this.character === 'warlock') this.surgeUntil = this.time + this.skills.surgeMs;
    this.openNextChoices();
    return true;
  }

  applyReward(id: RewardId): void {
    this.rewardStacks[id]++;
    // '직업 특수 특기'는 선택창에서 정한 특수 특기를 얻는 것과 같다. 정하지 않았으면 아직 없는 첫 특수 특기를 얻는다.
    if (id === 'bossSkill') {
      const special = this.bossSpecial ?? missingSpecialSkills(this.rewardStacks, this.character)[0];
      if (special) this.rewardStacks[special]++;
      this.bossSpecial = null;
    }
    // 최대 체력이 늘어난 만큼 현재 체력도 늘린다. 최대 체력 강화와 죽음의 군주가 함께 쓴다.
    const maxHp = maxHpFor(this.rewardStacks, this.character);
    this.player.hp += maxHp - this.player.maxHp;
    this.player.maxHp = maxHp;
    if (id === 'heal') {
      this.player.hp = Math.min(this.player.maxHp,
        this.player.hp + Math.floor(this.player.maxHp * REWARD_STEP.healPercent / 100));
    }
    // 완전 회복은 늘어난 최대 체력까지 회복하고, 성스러운 방벽은 배리어를 가득 채운 상태로 얻는다.
    if (id === 'restore') this.player.hp = this.player.maxHp;
    if (id === 'barrier') this.barrier = this.barrierMax;
    this.stats = statsFor(this.rewardStacks, this.character);
    this.skills = skillStatsFor(this.rewardStacks, this.character);
  }

  // 마력 폭주 중에는 공격력·이동속도가 늘고 공격 간격이 줄어든다. 나머지 능력치는 그대로다.
  currentStats(): PlayerStats {
    if (this.time >= this.surgeUntil) return this.stats;
    const scale = this.skills.surgePercent / 100;
    return { ...this.stats, damage: Math.round(this.stats.damage * (1 + scale)),
      speed: this.stats.speed * (1 + scale), attackMs: this.stats.attackMs * (1 - scale) };
  }

  private fire(owner: Actor, target: Actor, team: Projectile['team'], damage: number, color: number, speed: number, offsetRad = 0): void {
    const config = team === 'ally' ? CFG.playerShot : CFG.enemyShot;
    const from = center(owner), to = center(target);
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const direction = rotate((to.x - from.x) / length, (to.y - from.y) / length, offsetRad);
    this.projectiles.push({ id: this.nextId++, team, x: from.x - config.size / 2, y: from.y - config.size / 2,
      width: config.size, height: config.size, vx: direction.x * speed, vy: direction.y * speed,
      damage, expiresAt: this.time + config.lifeMs, color, homing: team === 'ally' && this.skills.homing, firedAt: this.time });
  }

  // 다중 시전: 대상 방향을 중심으로 10°씩 벌린 부채꼴로 발사하고, 전체 폭이 60°를 넘으면 그 안에서 고르게 나눈다.
  private fireVolley(target: Actor, damage: number): void {
    const count = this.skills.shots;
    const spread = count > 1 ? Math.min(SKILL.multiShot.spreadDeg, SKILL.multiShot.maxSpreadDeg / (count - 1)) : 0;
    for (let i = 0; i < count; i++) {
      this.fire(this.player, target, 'ally', damage, CFG.playerShot.color, this.stats.shotSpeed, (i - (count - 1) / 2) * spread * Math.PI / 180);
    }
  }

  // 플레이어 공격의 피해. 살아 있던 적이 이 피해로 죽을 때만 처치 수와 처치 회복을 한 번 적용한다.
  private strike(enemy: Enemy, damage: number): void {
    const wasAlive = enemy.hp > 0;
    this.dealDamage(enemy, damage);
    if (!wasAlive || enemy.hp > 0) return;
    this.kills++;
    if (!this.gameOver) this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.skills.killHeal);
    if (this.skills.frenzy) this.frenzyCharged = true;
  }

  // 사제 회복: 자신을 제외하고 몸체가 반경 원에 닿은(경계 포함) 살아 있는 적을 최대 체력까지 회복한다. 장애물은 막지 않는다.
  private healAround(priest: Enemy, radius: number, amount: number): void {
    const origin = center(priest);
    let healed = false;
    for (const other of this.enemies) {
      if (other === priest || other.hp <= 0 || other.hp >= other.maxHp || !circleTouches(origin, radius, other)) continue;
      other.hp = Math.min(other.maxHp, other.hp + amount);
      healed = true;
    }
    if (healed) this.addEffect('heal', origin, radius);
  }

  private addEffect(kind: AttackEffect['kind'], point: Point, radius: number): void {
    this.effects.push({ id: this.nextId++, kind, x: point.x, y: point.y, radius, at: this.time });
  }

  // 죽음의 칼날: 반경 안에 몸체가 닿은 적 전부를 한 번씩 벤다. 장애물 너머의 적은 맞히지 않는다.
  private swing(damage: number): boolean {
    const origin = center(this.player), radius = this.skills.swingRadius;
    const targets = this.enemies.filter((enemy) => enemy.hp > 0 && enemy.attackable && circleTouches(origin, radius, enemy)
      && !this.obstacles.some((obstacle) => segmentHit(origin, center(enemy), obstacle) !== null));
    if (!targets.length) return false;
    // 피의 광란으로 쌓인 강화는 이번 휘두르기 전체에 쓰고 사라진다. 이번 휘두르기로 처치하면 다음 휘두르기에 다시 쌓인다.
    const power = this.frenzyCharged ? damage * SKILL.bloodFrenzy.damageMultiplier : damage;
    this.frenzyCharged = false;
    for (const enemy of targets) this.strike(enemy, power);
    this.addEffect('swing', origin, radius);
    return true;
  }

  private moveEnemy(enemy: Enemy, target: Actor, dt: number): void {
    const stats = ENEMY_STATS[enemy.kind];
    enemy.holding = stats.ranged && distanceSquared(enemy, target) <= stats.range ** 2;
    if (enemy.holding) return;
    if (!stats.ranged && edgeDistance(enemy, target) <= 0.75) return;
    const from = center(enemy), destination = center(target);
    let waypoint: Point | undefined;
    if (this.navigation.canTravel(from, destination, enemy.width, enemy.height)) {
      waypoint = destination;
      enemy.path = []; enemy.pathIndex = 0;
    } else {
      if (this.time >= enemy.nextPathAt && this.pathBudget > 0) {
        this.pathBudget--;
        enemy.path = this.navigation.findPath(from, destination, enemy.width, enemy.height) ?? [];
        enemy.pathIndex = 0;
        enemy.nextPathAt = this.time + CFG.pathMs + enemy.id % 4 * 50;
      }
      while (enemy.pathIndex < enemy.path.length
        && Math.hypot(from.x - enemy.path[enemy.pathIndex].x, from.y - enemy.path[enemy.pathIndex].y) < 4) enemy.pathIndex++;
      waypoint = enemy.path[enemy.pathIndex];
    }
    if (!waypoint) return; // 도달 불가능하면 대기하고 다음 주기에 재탐색한다.
    const dx = waypoint.x - from.x, dy = waypoint.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) return;
    // 가호 '인도'은 이미 있는 적에게도 바로 적용된다.
    const distance = Math.min(length, stats.speed * this.blessPercent('blessSpeed') / 100 * dt / 1000);
    // 적끼리는 서로 몸체 위쪽 통과 영역을 뺀 아래쪽끼리만 막는다. 다른 적의 막는 범위를 그 적의 통과 영역만큼
    // 위에서, 이 적의 통과 영역만큼 아래에서 줄이면 두 아래쪽 몸체가 겹칠 때만 부딪힌다.
    // 사거리 안에서 멈춘 원거리 적·사제는 근접 적을 막지 않아, 그 뒤의 근접 적이 줄을 지나 다가갈 수 있다.
    // 원거리 적·사제끼리는 멈춰 있어도 막아, 같은 자리에 겹쳐 서지 않고 옆으로 비켜 선다.
    // 매 이동마다 상자를 새로 만들지 않도록 재사용한다.
    const lift = enemy.height * CFG.enemyPassTop;
    let count = 0;
    for (const other of this.enemies) {
      if (other === enemy || other.hp <= 0 || (other.holding && !stats.ranged)) continue;
      const inset = other.height * CFG.enemyPassTop;
      const box = this.enemyBlockers[count++] ??= { x: 0, y: 0, width: 0, height: 0 };
      box.x = other.x; box.y = other.y + inset; box.width = other.width; box.height = other.height - inset - lift;
    }
    const blockers = [...this.obstacles, ...this.allies.filter((actor) => actor.hp > 0), ...this.enemyBlockers.slice(0, count)];
    let moved = moveAndSlide(enemy, dx / length * distance, dy / length * distance, CFG.world, blockers);
    const progress = Math.hypot(moved.x - enemy.x, moved.y - enemy.y);
    if (progress < distance * 0.25) {
      // 적 무리의 몸체에 막히면 좌우로 작은 우회를 시도한다. 순간이동이나 겹침은 허용하지 않는다.
      let bestProgress = progress;
      const preferredSide = enemy.id % 2 ? 1 : -1;
      for (const side of [preferredSide, -preferredSide]) {
        const candidate = moveAndSlide(enemy, -dy / length * distance * side, dx / length * distance * side, CFG.world, blockers);
        const amount = Math.hypot(candidate.x - enemy.x, candidate.y - enemy.y);
        if (amount > bestProgress + 0.001) { moved = candidate; bestProgress = amount; }
      }
      enemy.stuckMs += dt;
      if (enemy.stuckMs > 600) { enemy.nextPathAt = 0; enemy.stuckMs = 0; }
    } else enemy.stuckMs = 0;
    enemy.x = moved.x; enemy.y = moved.y;
  }

  private updateEnemies(dt: number, view: Box): void {
    this.pathBudget = CFG.pathBudget;
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 || this.gameOver) continue;
      let target = this.allies.find((actor) => actor.id === enemy.targetId && actor.hp > 0 && actor.attackable);
      if (!target || this.time >= enemy.nextThinkAt) {
        const selected = nearestTarget(enemy, this.allies, undefined, enemy.targetId);
        if (selected?.id !== enemy.targetId) { enemy.nextPathAt = 0; enemy.path = []; }
        target = selected ?? undefined;
        enemy.targetId = target?.id ?? null;
        enemy.nextThinkAt = this.time + CFG.targetMs;
      }
      if (!target) { enemy.holding = false; continue; }
      if (enemy === this.boss) this.bossAct(enemy, target, view);
      if (enemy !== this.boss || this.time >= this.bossCastUntil) this.moveEnemy(enemy, target, dt);
      const stats = ENEMY_STATS[enemy.kind];
      if (stats.heal) {
        if (this.time >= enemy.nextAttackAt) {
          this.healAround(enemy, stats.heal.radius, stats.heal.amount);
          enemy.nextAttackAt = this.intervalFrom(enemy.nextAttackAt) + stats.attackMs;
        }
      } else if (stats.ranged) {
        if (distanceSquared(enemy, target) <= stats.range ** 2 && this.time >= enemy.nextAttackAt) {
          this.fire(enemy, target, 'enemy', this.enemyDamage(stats.damage), stats.color, stats.shotSpeed ?? CFG.enemyShot.speed);
          enemy.nextAttackAt = this.intervalFrom(enemy.nextAttackAt) + stats.attackMs;
        }
      } else if (edgeDistance(enemy, target) <= 0.75
        && !this.obstacles.some((obstacle) => segmentHit(center(enemy), center(target), obstacle) !== null)) {
        this.dealDamage(target, this.enemyDamage(stats.damage));
      }
    }
  }

  private updateProjectiles(dt: number): void {
    const active = this.projectiles;
    this.projectiles = [];
    const stepStart = this.stepStart;
    for (const shot of active) {
      if (this.gameOver) break;
      // 이번 단계 끝에 발사된 투사체는 다음 단계부터 움직이므로, 이동 거리가 속도 × 발사 후 경과 시간과 같다.
      if (shot.firedAt === this.time) { this.projectiles.push(shot); continue; }
      // 단계 안에서도 남은 수명만큼만 이동·판정한다. 만료 시점에 정확히 닿으면 이미 소멸한 것으로 본다.
      const life = Math.min(dt, shot.expiresAt - stepStart);
      if (life <= 0) continue;
      const start = center(shot);
      if (shot.homing) this.steer(shot, start, life);
      const end = { x: start.x + shot.vx * life / 1000, y: start.y + shot.vy * life / 1000 };
      const candidates = shot.team === 'ally' ? this.enemies : this.allies;
      let hit: Actor | null = null, first = Infinity;
      for (const actor of candidates) {
        if (actor.hp <= 0 || !actor.attackable) continue;
        // 몸체도 이번 단계 동안 시작 위치에서 지금 위치까지 일정하게 움직였다고 보고, 시작 위치의 몸체에 대한
        // 투사체의 상대 경로로 판정한다. 단계 중간에만 겹쳐도 맞히고, 끝 위치에만 겹치는 경우는 맞히지 않는다.
        const origin = this.origins.get(actor) ?? actor;
        const share = life / dt;
        const relative = { x: end.x - (actor.x - origin.x) * share, y: end.y - (actor.y - origin.y) * share };
        const body = { x: origin.x, y: origin.y, width: actor.width, height: actor.height };
        const time = segmentHit(start, relative, expand(body, shot.width / 2));
        if (time !== null && time < first && stepStart + time * life < shot.expiresAt) { hit = actor; first = time; }
      }
      if (hit && shot.team === 'ally') {
        this.strike(hit as Enemy, shot.damage);
        if (this.skills.explosionRadius > 0) {
          this.explode({ x: start.x + (end.x - start.x) * first, y: start.y + (end.y - start.y) * first }, hit, shot.damage);
        }
        continue;
      }
      if (hit) {
        this.dealDamage(hit, shot.damage);
        continue;
      }
      shot.x = end.x - shot.width / 2; shot.y = end.y - shot.height / 2;
      if (this.time < shot.expiresAt && overlaps(shot, { x: 0, y: 0, width: 3000, height: 3000 })) this.projectiles.push(shot);
    }
    this.enemies = this.enemies.filter((enemy) => enemy.hp > 0);
  }

  // 추적 마탄: 투사체에서 가장 가까운 적 쪽으로 이번 단계의 최대 회전량까지만 방향을 바꾼다. 속력은 유지한다.
  private steer(shot: Projectile, from: Point, life: number): void {
    let target: Point | null = null, best = Infinity;
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 || !enemy.attackable) continue;
      const point = center(enemy), d = (point.x - from.x) ** 2 + (point.y - from.y) ** 2;
      if (d < best) { best = d; target = point; }
    }
    if (!target) return;
    const heading = Math.atan2(shot.vy, shot.vx);
    const wanted = Math.atan2(target.y - from.y, target.x - from.x);
    const gap = Math.atan2(Math.sin(wanted - heading), Math.cos(wanted - heading));
    const limit = SKILL.homing.turnDegPerSec * Math.PI / 180 * life / 1000;
    const turned = rotate(shot.vx, shot.vy, Math.max(-limit, Math.min(limit, gap)));
    shot.vx = turned.x; shot.vy = turned.y;
  }

  // 마력 폭발: 적중 지점의 원에 몸체가 닿은 다른 적에게 공격력 일부의 피해를 준다. 장애물은 막지 않는다.
  private explode(point: Point, primary: Actor, damage: number): void {
    const radius = this.skills.explosionRadius;
    const splash = Math.round(damage * SKILL.explosion.damagePercent / 100);
    for (const enemy of this.enemies) {
      if (enemy !== primary && enemy.hp > 0 && enemy.attackable && circleTouches(point, radius, enemy)) this.strike(enemy, splash);
    }
    this.addEffect('explosion', point, radius);
  }

  update(delta: number, input: Point, viewForPlayer: (player: Actor) => Box): void {
    // 낮은 FPS에서도 경과 시간을 버리지 않도록 50ms 이하 단계로 나눠 모두 진행한다.
    // 긴 정지 뒤의 프레임은 상한까지만 반영해 이동·공격·스폰이 한꺼번에 몰리지 않게 한다.
    let remaining = Math.max(0, Math.min(delta, CFG.maxFrameMs));
    // 보상 선택이 열리거나 게임이 끝나면 남은 시간을 진행하지 않으므로 모든 이동과 타이머가 멈춘다.
    while (remaining > 0 && !this.gameOver && !this.choices.length) {
      const dt = Math.min(remaining, CFG.stepMs);
      remaining -= dt;
      this.step(dt, input, viewForPlayer);
    }
  }

  private step(dt: number, input: Point, viewForPlayer: (player: Actor) => Box): void {
    // 단계 시작 시점의 능력치를 쓴다. 마력 폭주는 끝나는 시점에 시작하는 단계부터 풀린다.
    const power = this.currentStats();
    this.stepStart = this.time;
    this.time += dt;
    this.origins.clear();
    for (const actor of this.allies) this.origins.set(actor, { x: actor.x, y: actor.y });
    for (const enemy of this.enemies) this.origins.set(enemy, { x: enemy.x, y: enemy.y });
    // 배리어는 마지막 피격 뒤 일정 시간 동안 피해를 받지 않으면 다시 가득 찬다.
    if (this.barrier < this.barrierMax && this.time - this.player.lastHitAt >= BOSS_REWARD.barrierRegenMs) this.barrier = this.barrierMax;
    this.effects = this.effects.filter((effect) => this.time - effect.at < SKILL.effectMs);
    const length = Math.hypot(input.x, input.y);
    if (length) {
      const distance = power.speed * dt / 1000;
      const moved = moveAndSlide(this.player, input.x / length * distance, input.y / length * distance,
        CFG.world, [...this.obstacles, ...this.enemies.filter((enemy) => enemy.hp > 0),
          ...this.allies.filter((ally) => ally !== this.player && ally.hp > 0)]);
      this.player.x = moved.x; this.player.y = moved.y;
    }
    const view = viewForPlayer(this.player);
    if (this.spawning) this.spawnWaves(view);
    this.updateEnemies(dt, view);
    this.resolveHazards();
    if (this.gameOver) return;
    const attackReadyAt = this.lastPlayerAttackAt + power.attackMs;
    if (this.time >= attackReadyAt) {
      if (CHARACTER_STATS[this.character].attack === 'swing') {
        if (this.swing(power.damage)) this.lastPlayerAttackAt = this.intervalFrom(attackReadyAt);
      } else {
        const target = nearestTarget(this.player, this.enemies, view);
        if (target) {
          this.fireVolley(target, power.damage);
          this.lastPlayerAttackAt = this.intervalFrom(attackReadyAt);
        }
      }
    }
    this.updateProjectiles(dt);
    // 같은 프레임에 플레이어가 사망하면 구슬 획득과 레벨업 선택이 일어나지 않는다.
    if (this.gameOver) return;
    this.updateOrbs(dt);
    // 가호는 게임 시간 2분마다 하나씩 고른다. 선택 중에는 게임 시간이 멈추므로 밀리지 않는다.
    if (this.time >= this.nextBlessAt) {
      this.pendingBlessings++;
      this.nextBlessAt += BLESS.everyMs;
    }
    this.openNextChoices();
  }
}
