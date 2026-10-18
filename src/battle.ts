import { moveAndSlide, type Box } from './collision.ts';
import { BATTLE_CONFIG as CFG, CHARACTER_STATS, ENEMY_STATS, SKILL_CONFIG as SKILL, SPAWN_ORDER,
  type CharacterId, type EnemyKind } from './battle-config.ts';
import { center, centerInView, contains, distanceSquared, edgeDistance, expand, overlaps, segmentHit, type Point } from './battle-geometry.ts';
import { Navigation } from './navigation.ts';
import { addExperience } from './experience.ts';
import { REWARD_STEP, emptyStacks, maxHpFor, rewardPool, rollChoices, skillStatsFor, statsFor,
  type PlayerStats, type RewardId, type SkillStats } from './rewards.ts';

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
  // 추적 마탄을 얻은 뒤 발사한 플레이어 투사체만 가까운 적을 향해 방향을 바꾼다.
  homing?: boolean;
}

// 휘두르기와 폭발의 범위를 잠시 보여주기 위한 기록. 판정에는 쓰지 않는다.
export interface AttackEffect {
  id: number;
  kind: 'swing' | 'explosion';
  x: number;
  y: number;
  radius: number;
  at: number;
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
  // 선택지가 열려 있는 동안 전투 전체가 일시정지된다.
  choices: RewardId[] = [];
  private pendingLevelUps = 0;
  // 경험치 배율로 생긴 1 미만의 경험치를 백분율 단위로 이월한다.
  private expCarry = 0;

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
        // 영혼 흡수 배율을 백분율 정수로 곱하고, 1 미만은 다음 획득으로 이월해 총량을 보존한다.
        const percentUnits = orb.value * this.skills.expPercent + this.expCarry;
        this.expCarry = percentUnits % 100;
        ({ level: this.level, experience: this.experience } = addExperience(this, Math.floor(percentUnits / 100)));
        this.pendingLevelUps += this.level - before;
      } else remaining.push(orb);
    }
    this.orbs = remaining;
  }

  // 오른 레벨 수만큼 선택창을 순서대로 열고, 매번 그 시점의 보상 상태로 새로 구성한다.
  private openNextChoices(): void {
    if (this.gameOver || this.choices.length || this.pendingLevelUps <= 0) return;
    this.choices = rollChoices(this.rewardStacks, this.stats.choiceCount, this.random, rewardPool(this.character));
  }

  choose(index: number): boolean {
    if (this.gameOver || !Number.isInteger(index) || index < 0 || index >= this.choices.length) return false;
    const id = this.choices[index];
    this.choices = [];
    this.pendingLevelUps--;
    this.applyReward(id);
    // 마력 폭주: 보상을 고른 시점부터 지속 시간을 다시 센다. 연속 레벨업에서도 누적하지 않는다.
    if (this.character === 'warlock') this.surgeUntil = this.time + SKILL.surge.durationMs;
    this.openNextChoices();
    return true;
  }

  applyReward(id: RewardId): void {
    this.rewardStacks[id]++;
    // 최대 체력이 늘어난 만큼 현재 체력도 늘린다. 최대 체력 강화와 죽음의 군주가 함께 쓴다.
    const maxHp = maxHpFor(this.rewardStacks, this.character);
    this.player.hp += maxHp - this.player.maxHp;
    this.player.maxHp = maxHp;
    if (id === 'heal') {
      this.player.hp = Math.min(this.player.maxHp,
        this.player.hp + Math.floor(this.player.maxHp * REWARD_STEP.healPercent / 100));
    }
    this.stats = statsFor(this.rewardStacks, this.character);
    this.skills = skillStatsFor(this.rewardStacks, this.character);
  }

  // 마력 폭주 중에는 공격력·이동속도가 늘고 공격 간격이 줄어든다. 나머지 능력치는 그대로다.
  currentStats(): PlayerStats {
    if (this.time >= this.surgeUntil) return this.stats;
    const scale = SKILL.surge.percent / 100;
    return { ...this.stats, damage: Math.round(this.stats.damage * (1 + scale)),
      speed: this.stats.speed * (1 + scale), attackMs: this.stats.attackMs * (1 - scale) };
  }

  private fire(owner: Actor, target: Actor, team: Projectile['team'], damage: number, color: number, offsetRad = 0): void {
    const config = team === 'ally' ? CFG.playerShot : CFG.enemyShot;
    const speed = team === 'ally' ? this.stats.shotSpeed : config.speed;
    const from = center(owner), to = center(target);
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const direction = rotate((to.x - from.x) / length, (to.y - from.y) / length, offsetRad);
    this.projectiles.push({ id: this.nextId++, team, x: from.x - config.size / 2, y: from.y - config.size / 2,
      width: config.size, height: config.size, vx: direction.x * speed, vy: direction.y * speed,
      damage, expiresAt: this.time + config.lifeMs, color, homing: team === 'ally' && this.skills.homing });
  }

  // 다중 시전: 대상 방향을 중심으로 10°씩 벌린 부채꼴로 발사하고, 전체 폭이 60°를 넘으면 그 안에서 고르게 나눈다.
  private fireVolley(target: Actor, damage: number): void {
    const count = this.skills.shots;
    const spread = count > 1 ? Math.min(SKILL.multiShot.spreadDeg, SKILL.multiShot.maxSpreadDeg / (count - 1)) : 0;
    for (let i = 0; i < count; i++) {
      this.fire(this.player, target, 'ally', damage, CFG.playerShot.color, (i - (count - 1) / 2) * spread * Math.PI / 180);
    }
  }

  // 플레이어 공격의 피해. 살아 있던 적이 이 피해로 죽을 때만 처치 수와 처치 회복을 한 번 적용한다.
  private strike(enemy: Enemy, damage: number): void {
    const wasAlive = enemy.hp > 0;
    this.dealDamage(enemy, damage);
    if (!wasAlive || enemy.hp > 0) return;
    this.kills++;
    if (!this.gameOver) this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.skills.killHeal);
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
    for (const enemy of targets) this.strike(enemy, damage);
    this.addEffect('swing', origin, radius);
    return true;
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
    const stepStart = this.time - dt;
    for (const shot of active) {
      if (this.gameOver) break;
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
        const time = segmentHit(start, end, expand(actor, shot.width / 2));
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
    this.time += dt;
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
    if (this.spawning && this.time >= this.nextSpawnAt) {
      const enemy = this.spawnEnemy(SPAWN_ORDER[this.spawnIndex % SPAWN_ORDER.length], view);
      if (enemy) this.spawnIndex++;
      this.nextSpawnAt = this.time + CFG.spawnMs;
    }
    this.updateEnemies(dt);
    if (this.gameOver) return;
    if (this.time - this.lastPlayerAttackAt >= power.attackMs) {
      if (CHARACTER_STATS[this.character].attack === 'swing') {
        if (this.swing(power.damage)) this.lastPlayerAttackAt = this.time;
      } else {
        const target = nearestTarget(this.player, this.enemies, view);
        if (target) {
          this.fireVolley(target, power.damage);
          this.lastPlayerAttackAt = this.time;
        }
      }
    }
    this.updateProjectiles(dt);
    // 같은 프레임에 플레이어가 사망하면 구슬 획득과 레벨업 선택이 일어나지 않는다.
    if (this.gameOver) return;
    this.updateOrbs(dt);
    this.openNextChoices();
  }
}
