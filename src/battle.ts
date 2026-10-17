import { moveAndSlide, type Box } from './collision.ts';
import { BATTLE_CONFIG as CFG, ENEMY_STATS, SPAWN_ORDER, type EnemyKind } from './battle-config.ts';
import { center, centerInView, contains, distanceSquared, edgeDistance, expand, overlaps, segmentHit, type Point } from './battle-geometry.ts';
import { Navigation } from './navigation.ts';
import { addExperience } from './experience.ts';
import { REWARD_STEP, emptyStacks, rollChoices, statsFor, type RewardId } from './rewards.ts';

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
}

export interface Projectile extends Box {
  id: number;
  team: 'ally' | 'enemy';
  vx: number;
  vy: number;
  damage: number;
  expiresAt: number;
  color: number;
}

export interface ExpOrb extends Box {
  id: number;
  value: number;
  pulled: boolean;
}

export function createEnemy(id: number, kind: EnemyKind, x: number, y: number, now = 0): Enemy {
  const stats = ENEMY_STATS[kind];
  return { id, kind, x, y, width: stats.width, height: stats.height, hp: stats.hp, maxHp: stats.hp,
    attackable: true, lastHitAt: -Infinity, targetId: null, nextThinkAt: now,
    nextPathAt: now, nextAttackAt: now, path: [], pathIndex: 0, stuckMs: 0 };
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

export class Battle {
  readonly player: Actor = { id: 0, x: 1480, y: 1480, width: 40, height: 40,
    hp: CFG.player.hp, maxHp: CFG.player.hp, attackable: true, lastHitAt: -Infinity };
  // 소환물 시스템은 아직 만들지 않는다. 추후 살아 있는 소환물을 같은 후보 목록에 연결한다.
  readonly allies: Actor[] = [this.player];
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  // 생성 순서대로 유지해 상한 초과 시 가장 오래된 구슬을 찾는다.
  orbs: ExpOrb[] = [];
  time = 0;
  kills = 0;
  level = 1;
  experience = 0;
  gameOver = false;
  // 보상은 이번 게임에서만 유지된다. 능력치는 중첩 수로 다시 계산한다.
  readonly rewardStacks = emptyStacks();
  stats = statsFor(this.rewardStacks);
  // 선택지가 열려 있는 동안 전투 전체가 일시정지된다.
  choices: RewardId[] = [];
  private pendingLevelUps = 0;

  // 아직 보상을 고르지 않은 레벨업 수. 현재 열린 선택창을 포함한다.
  get pendingChoices(): number {
    return this.pendingLevelUps;
  }
  private readonly obstacles: readonly Box[];
  private readonly navigation: Navigation;
  private readonly random: () => number;
  private readonly spawning: boolean;
  private nextId = 1;
  private nextSpawnAt = 0;
  private spawnIndex = 0;
  private lastPlayerAttackAt = -Infinity;
  private pathBudget = 0;

  constructor(obstacles: readonly Box[], options: { spawning?: boolean; random?: () => number } = {}) {
    this.obstacles = obstacles;
    this.navigation = new Navigation(CFG.world, obstacles);
    this.random = options.random ?? Math.random;
    this.spawning = options.spawning ?? true;
  }

  spawnEnemy(kind: EnemyKind, view: Box): Enemy | null {
    if (this.enemies.length >= CFG.maxEnemies || this.gameOver) return null;
    const { width, height } = ENEMY_STATS[kind];
    const area = expand(view, 550);
    const left = Math.max(CFG.world.x, area.x);
    const top = Math.max(CFG.world.y, area.y);
    const right = Math.min(CFG.world.x + CFG.world.width, area.x + area.width) - width;
    const bottom = Math.min(CFG.world.y + CFG.world.height, area.y + area.height) - height;
    if (right < left || bottom < top) return null;
    for (let attempt = 0; attempt < 120; attempt++) {
      const body = { x: left + this.random() * (right - left), y: top + this.random() * (bottom - top), width, height };
      if (!contains(CFG.world, body) || overlaps(body, expand(view, CFG.spawnMargin))) continue;
      if (this.obstacles.some((obstacle) => overlaps(body, obstacle))) continue;
      if ([...this.allies, ...this.enemies].some((actor) => actor.hp > 0 && overlaps(body, actor))) continue;
      const enemy = createEnemy(this.nextId++, kind, body.x, body.y, this.time);
      enemy.nextThinkAt += enemy.id % 5 * 50;
      this.enemies.push(enemy);
      return enemy;
    }
    return null;
  }

  dealDamage(target: Actor, damage: number): boolean {
    if (this.gameOver || target.hp <= 0 || !target.attackable) return false;
    if (target === this.player && this.time - target.lastHitAt < CFG.player.hurtMs) return false;
    target.hp = Math.max(0, target.hp - damage);
    target.lastHitAt = this.time;
    // 살아 있던 적이 이 피해로 죽을 때만 구슬을 만들므로 처치 주체와 관계없이 한 번만 생긴다.
    if (target.hp === 0 && this.enemies.includes(target as Enemy)) this.dropOrb(target as Enemy);
    if (target === this.player && target.hp === 0) {
      this.gameOver = true;
      for (const ally of this.allies) ally.hp = 0;
      this.projectiles = [];
    }
    return true;
  }

  private dropOrb(enemy: Enemy): void {
    const value = ENEMY_STATS[enemy.kind].exp;
    if (this.orbs.length >= CFG.expOrb.max) {
      this.orbs[0].value += value;
      return;
    }
    const { x, y } = center(enemy), size = CFG.expOrb.size;
    this.orbs.push({ id: this.nextId++, x: x - size / 2, y: y - size / 2, width: size, height: size, value, pulled: false });
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
        ({ level: this.level, experience: this.experience } = addExperience(this, orb.value));
        this.pendingLevelUps += this.level - before;
      } else remaining.push(orb);
    }
    this.orbs = remaining;
  }

  // 오른 레벨 수만큼 선택창을 순서대로 열고, 매번 그 시점의 보상 상태로 새로 구성한다.
  private openNextChoices(): void {
    if (this.gameOver || this.choices.length || this.pendingLevelUps <= 0) return;
    this.choices = rollChoices(this.rewardStacks, this.stats.choiceCount, this.random);
  }

  choose(index: number): boolean {
    if (this.gameOver || !Number.isInteger(index) || index < 0 || index >= this.choices.length) return false;
    const id = this.choices[index];
    this.choices = [];
    this.pendingLevelUps--;
    this.applyReward(id);
    this.openNextChoices();
    return true;
  }

  applyReward(id: RewardId): void {
    this.rewardStacks[id]++;
    if (id === 'maxHp') {
      this.player.maxHp += REWARD_STEP.maxHp;
      this.player.hp += REWARD_STEP.maxHp;
    } else if (id === 'heal') {
      this.player.hp = Math.min(this.player.maxHp,
        this.player.hp + Math.floor(this.player.maxHp * REWARD_STEP.healPercent / 100));
    }
    this.stats = statsFor(this.rewardStacks);
  }

  private fire(owner: Actor, target: Actor, team: Projectile['team'], damage: number, color: number): void {
    const config = team === 'ally' ? CFG.playerShot : CFG.enemyShot;
    const speed = team === 'ally' ? this.stats.shotSpeed : config.speed;
    const from = center(owner), to = center(target);
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    this.projectiles.push({ id: this.nextId++, team, x: from.x - config.size / 2, y: from.y - config.size / 2,
      width: config.size, height: config.size, vx: (to.x - from.x) / length * speed,
      vy: (to.y - from.y) / length * speed, damage, expiresAt: this.time + config.lifeMs, color });
  }

  private moveEnemy(enemy: Enemy, target: Actor, dt: number): void {
    const stats = ENEMY_STATS[enemy.kind];
    if (stats.ranged && distanceSquared(enemy, target) <= stats.range ** 2) return;
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
    const distance = Math.min(length, stats.speed * dt / 1000);
    const blockers = [...this.obstacles,
      ...this.allies.filter((actor) => actor.hp > 0),
      ...this.enemies.filter((other) => other !== enemy && other.hp > 0)];
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

  private updateEnemies(dt: number): void {
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
      if (!target) continue;
      this.moveEnemy(enemy, target, dt);
      const stats = ENEMY_STATS[enemy.kind];
      if (stats.ranged) {
        if (distanceSquared(enemy, target) <= stats.range ** 2 && this.time >= enemy.nextAttackAt) {
          this.fire(enemy, target, 'enemy', stats.damage, stats.color);
          enemy.nextAttackAt = this.time + stats.attackMs;
        }
      } else if (edgeDistance(enemy, target) <= 0.75
        && !this.obstacles.some((obstacle) => segmentHit(center(enemy), center(target), obstacle) !== null)) {
        this.dealDamage(target, stats.damage);
      }
    }
  }

  private updateProjectiles(dt: number): void {
    const active = this.projectiles;
    this.projectiles = [];
    for (const shot of active) {
      if (this.gameOver) break;
      if (this.time >= shot.expiresAt) continue;
      const start = center(shot);
      const end = { x: start.x + shot.vx * dt / 1000, y: start.y + shot.vy * dt / 1000 };
      const candidates = shot.team === 'ally' ? this.enemies : this.allies;
      let hit: Actor | null = null, first = Infinity;
      for (const actor of candidates) {
        if (actor.hp <= 0 || !actor.attackable) continue;
        const time = segmentHit(start, end, expand(actor, shot.width / 2));
        if (time !== null && time < first) { hit = actor; first = time; }
      }
      if (hit) {
        const wasAlive = hit.hp > 0;
        this.dealDamage(hit, shot.damage);
        if (shot.team === 'ally' && wasAlive && hit.hp === 0) this.kills++;
        continue;
      }
      shot.x = end.x - shot.width / 2; shot.y = end.y - shot.height / 2;
      if (this.time < shot.expiresAt && overlaps(shot, { x: 0, y: 0, width: 3000, height: 3000 })) this.projectiles.push(shot);
    }
    this.enemies = this.enemies.filter((enemy) => enemy.hp > 0);
  }

  update(delta: number, input: Point, viewForPlayer: (player: Actor) => Box): void {
    // 보상 선택 중에는 게임 시간을 진행하지 않으므로 모든 이동과 타이머가 멈춘다.
    if (this.gameOver || this.choices.length) return;
    // 비활성 탭 복귀 시 이동·공격·스폰이 한 프레임에 몰리지 않게 한다.
    const dt = Math.max(0, Math.min(delta, 50));
    this.time += dt;
    const length = Math.hypot(input.x, input.y);
    if (length) {
      const distance = this.stats.speed * dt / 1000;
      const moved = moveAndSlide(this.player, input.x / length * distance, input.y / length * distance,
        CFG.world, [...this.obstacles, ...this.enemies.filter((enemy) => enemy.hp > 0),
          ...this.allies.filter((ally) => ally !== this.player && ally.hp > 0)]);
      this.player.x = moved.x; this.player.y = moved.y;
    }
    const view = viewForPlayer(this.player);
    if (this.spawning && this.time >= this.nextSpawnAt) {
      const enemy = this.spawnEnemy(SPAWN_ORDER[this.spawnIndex % SPAWN_ORDER.length], view);
      if (enemy) this.spawnIndex++;
      this.nextSpawnAt = this.time + CFG.spawnMs;
    }
    this.updateEnemies(dt);
    if (this.gameOver) return;
    if (this.time - this.lastPlayerAttackAt >= this.stats.attackMs) {
      const target = nearestTarget(this.player, this.enemies, view);
      if (target) {
        this.fire(this.player, target, 'ally', this.stats.damage, CFG.playerShot.color);
        this.lastPlayerAttackAt = this.time;
      }
    }
    this.updateProjectiles(dt);
    // 같은 프레임에 플레이어가 사망하면 구슬 획득과 레벨업 선택이 일어나지 않는다.
    if (this.gameOver) return;
    this.updateOrbs(dt);
    this.openNextChoices();
  }
}
