import Phaser from 'phaser';
import { decorateWorld } from './world-art';
import { createDungeon } from './dungeon';
import { getFootDepth } from './render-depth';
import { Battle, crossArms } from './battle';
import { BATTLE_CONFIG, BLESS_CONFIG, BOSS_CONFIG, CHARACTER_STATS, ENEMY_STATS, SKILL_CONFIG, type CharacterId } from './battle-config';
import { experienceToNextLevel } from './experience';
import { BLESS_IDS, REWARDS, REWARD_TIERS, type RewardDef, type RewardId, type RewardTier } from './rewards';
import { CharacterSelectScene, FONT, INPUT_DELAY_MS, TitleScene } from './menu-scenes';
import { ENEMY_ART, SPRITE_ART, STRIP_ART, aegisScale, allyBoltArt, effectDisplay, orbTexture, shotArt, stripFrame } from './sprite-animation';
import { loadSprite, createSpriteView, updateSpriteView, loadStrip, createStripView, type SpriteView } from './sprite-view';
import './style.css';

const CHOICE_CARD = { width: 220, height: 250, gap: 20, top: 230 };
// 카드 테두리: 레벨업 보상은 등급 색, 보스 보상은 구리색, 가호는 붉은색이다.
const TIER_COLORS: Record<RewardTier, number> = { common: 0x8a918c, uncommon: 0x5fbf6a, rare: 0x4f8fe0, epic: 0xa66be0 };
const cardStroke = (reward: RewardDef): number => reward.tier ? TIER_COLORS[reward.tier] : reward.blessing ? 0xd04848 : 0xe8743a;
// HUD의 누적 가호 표시에 쓰는 짧은 이름.
const BLESS_LABELS = { blessHp: '체력', blessSpeed: '이동속도', blessDamage: '공격력' } as const;
// 보스 체력 바는 HUD 패널 오른쪽 위에 둔다.
const BOSS_BAR = { x: 676, y: 44, width: 576, height: 10 };

class GameScene extends Phaser.Scene {
  private character: CharacterId = 'warlock';
  private player!: Phaser.GameObjects.Sprite;
  private playerView!: SpriteView;
  private lastPlayerPosition = { x: 0, y: 0 };
  private battle!: Battle;
  private enemyViews = new Map<number, SpriteView>();
  private zombieViews = new Map<number, SpriteView>();
  private shotViews = new Map<number, Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle>();
  private orbViews = new Map<number, Phaser.GameObjects.Sprite>();
  private effectViews = new Map<number, { ring?: Phaser.GameObjects.Arc; art: Phaser.GameObjects.Sprite[] }>();
  private hazardViews = new Map<number, Phaser.GameObjects.Graphics>();
  private aegisView?: Phaser.GameObjects.Arc;
  private aegisArt?: Phaser.GameObjects.Sprite;
  private status!: Phaser.GameObjects.Text;
  private healthFill!: Phaser.GameObjects.Rectangle;
  private expFill!: Phaser.GameObjects.Rectangle;
  private levelText!: Phaser.GameObjects.Text;
  private hudPanel!: Phaser.GameObjects.Rectangle;
  private blessText!: Phaser.GameObjects.Text;
  private barrierFill!: Phaser.GameObjects.Rectangle;
  private bossPanel!: Phaser.GameObjects.GameObject[];
  private bossName!: Phaser.GameObjects.Text;
  private bossFill!: Phaser.GameObjects.Rectangle;
  private bossNotice!: Phaser.GameObjects.Text;
  private shownGameOver = false;
  private gameOverAt = 0;
  private choiceViews: Phaser.GameObjects.GameObject[] = [];
  private shownChoices: readonly RewardId[] = [];
  private choiceOpenedAt = 0;
  private choiceKeys: Phaser.Input.Keyboard.Key[] = [];
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private readonly worldWidth = 3000;
  private readonly worldHeight = 3000;
  private readonly wallThickness = 50;

  constructor() {
    super('GameScene');
  }

  // 캐릭터 선택 화면에서 고른 직업을 받는다. 직접 시작하면 워록이다.
  init(data: { character?: CharacterId }): void {
    this.character = data.character ?? 'warlock';
  }

  preload(): void {
    loadSprite(this, SPRITE_ART[this.character]);
    if (this.character === 'necromancer') loadSprite(this, SPRITE_ART.zombie);
    for (const profile of Object.values(ENEMY_ART)) loadSprite(this, profile);
    const { allyMagicBolt, warlockBolt, ...shared } = STRIP_ART;
    for (const profile of [allyBoltArt(this.character), ...Object.values(shared)]) loadStrip(this, profile);
  }

  create(): void {
    // Phaser는 장면 객체를 다시 쓰므로, 이전 판의 표시 목록과 상태를 비우고 시작한다.
    this.enemyViews = new Map();
    this.zombieViews = new Map();
    this.shotViews = new Map();
    this.orbViews = new Map();
    this.effectViews = new Map();
    this.hazardViews = new Map();
    this.aegisView = undefined;
    this.aegisArt = undefined;
    this.shownGameOver = false;
    this.choiceViews = [];
    this.shownChoices = [];
    decorateWorld(this, this.worldWidth, this.worldHeight, this.wallThickness);
    this.battle = new Battle(createDungeon(this), { character: this.character });

    const body = this.battle.player;
    this.lastPlayerPosition = { x: body.x, y: body.y };
    this.playerView = createSpriteView(this, SPRITE_ART[this.character], 0, 0);
    this.player = this.playerView.body;
    this.positionPlayer();
    this.player.setDepth(getFootDepth(body));

    const camera = this.cameras.main;
    camera.setBounds(0, 0, this.worldWidth, this.worldHeight);
    camera.centerOn(body.x + body.width / 2, body.y + body.height / 2);
    // 표시 원점은 발이다. 카메라는 판정 몸체의 중심을 추적한다.
    camera.startFollow(this.player, true, 1, 1, 0, body.height / 2);

    // 가호를 고른 뒤에는 패널을 한 줄 늘려 누적 가호를 표시한다.
    this.hudPanel = this.add.rectangle(12, 12, 620, 112, 0x101612, 0.9).setOrigin(0).setScrollFactor(0).setDepth(20000);
    this.blessText = this.add.text(24, 120, '', { fontFamily: FONT, fontSize: '14px', color: '#e08080' })
      .setScrollFactor(0).setDepth(20001);
    this.status = this.add.text(24, 20, '', { fontFamily: 'Malgun Gothic, sans-serif', fontSize: '17px', color: '#eeeece' })
      .setScrollFactor(0).setDepth(20001);
    this.add.rectangle(24, 50, 180, 10, 0x383d32).setOrigin(0).setScrollFactor(0).setDepth(20001);
    this.healthFill = this.add.rectangle(24, 50, 180, 10, 0x66ddaa).setOrigin(0).setScrollFactor(0).setDepth(20002);
    this.add.rectangle(24, 65, 180, 6, 0x383d32).setOrigin(0).setScrollFactor(0).setDepth(20001);
    // 표시 크기는 원래 크기에 대한 배율로 바뀌므로, 바는 전체 너비로 만들고 비율만큼 줄인다. 너비 0으로 만들면 늘릴 수 없다.
    this.expFill = this.add.rectangle(24, 65, 180, 6, 0x6fb8ff).setOrigin(0).setScrollFactor(0).setDepth(20002);
    this.levelText = this.add.text(216, 52, '', { fontFamily: 'Malgun Gothic, sans-serif', fontSize: '14px', color: '#9fd0ff' })
      .setScrollFactor(0).setDepth(20001);
    // 성스러운 방벽의 배리어는 체력 바 바로 위의 하늘색 바로 표시한다. 얻기 전에는 숨긴다.
    this.barrierFill = this.add.rectangle(24, 45, 180, 3, 0x9fe6ff).setOrigin(0).setScrollFactor(0).setDepth(20002).setVisible(false);
    // 보스 이름과 체력 바. 보스가 살아 있는 동안만 보인다.
    const bossBack = this.add.rectangle(660, 12, 608, 52, 0x101612, 0.9).setOrigin(0).setScrollFactor(0).setDepth(20000);
    this.bossName = this.add.text(BOSS_BAR.x, 18, '', { fontFamily: FONT, fontSize: '17px', color: '#f0d890' }).setScrollFactor(0).setDepth(20001);
    const bossTrack = this.add.rectangle(BOSS_BAR.x, BOSS_BAR.y, BOSS_BAR.width, BOSS_BAR.height, 0x383d32).setOrigin(0).setScrollFactor(0).setDepth(20001);
    this.bossFill = this.add.rectangle(BOSS_BAR.x, BOSS_BAR.y, BOSS_BAR.width, BOSS_BAR.height, 0xd85a4a).setOrigin(0).setScrollFactor(0).setDepth(20002);
    this.bossPanel = [bossBack, this.bossName, bossTrack, this.bossFill];
    for (const view of this.bossPanel) (view as Phaser.GameObjects.Rectangle).setVisible(false);
    this.bossNotice = this.add.text(640, 210, `${ENEMY_STATS[BOSS_CONFIG.kind].name} 출현`, {
      fontFamily: FONT, fontSize: '36px', color: '#f0d890', stroke: '#101612', strokeThickness: 6,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20003).setVisible(false);
    // 적 범례는 한 줄에 5종씩 두 줄로 표시한다.
    Object.values(ENEMY_STATS).forEach((stats, index) => {
      this.add.text(24 + index % 5 * 105, 80 + Math.floor(index / 5) * 20, `■ ${stats.name}`, {
        fontFamily: 'Malgun Gothic, sans-serif', fontSize: '14px', color: `#${stats.color.toString(16).padStart(6, '0')}`,
      }).setScrollFactor(0).setDepth(20001);
    });
    this.syncBattle();

    const keyboard = this.input.keyboard;
    if (keyboard) {
      this.cursors = keyboard.createCursorKeys();
      this.wasd = {
        up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
      const { ONE, TWO, THREE, FOUR, FIVE } = Phaser.Input.Keyboard.KeyCodes;
      this.choiceKeys = [ONE, TWO, THREE, FOUR, FIVE].map((code) => keyboard.addKey(code));
      keyboard.on('keydown', (event: KeyboardEvent) => {
        if (event.code === 'Enter' && !event.repeat) this.leaveGameOver();
      });
    }
    this.input.on('pointerdown', () => this.leaveGameOver());
  }

  // 게임 종료 화면에서 Enter나 클릭으로 캐릭터 선택 화면으로 돌아간다. 종료 직후의 입력은 무시한다.
  private leaveGameOver(): void {
    if (!this.shownGameOver || this.time.now - this.gameOverAt < INPUT_DELAY_MS) return;
    this.scene.start('CharacterSelectScene');
  }

  update(_time: number, delta: number): void {
    // 눌림은 매 프레임 소비해 대기 시간 중의 입력이 나중에 선택으로 처리되지 않게 한다.
    const pressed = this.choiceKeys.findIndex((key) => Phaser.Input.Keyboard.JustDown(key));
    if (pressed >= 0) this.pickChoice(pressed);
    const left = this.cursors?.left.isDown || this.wasd?.left.isDown;
    const right = this.cursors?.right.isDown || this.wasd?.right.isDown;
    const up = this.cursors?.up.isDown || this.wasd?.up.isDown;
    const down = this.cursors?.down.isDown || this.wasd?.down.isDown;
    this.battle.update(delta, { x: Number(Boolean(right)) - Number(Boolean(left)), y: Number(Boolean(down)) - Number(Boolean(up)) }, (body) => {
      this.positionPlayer();
      const camera = this.cameras.main;
      // 이동 후의 실제 카메라 위치로 화면 내 조준과 화면 밖 생성을 판정한다.
      camera.centerOn(body.x + body.width / 2, body.y + body.height / 2);
      return { x: camera.scrollX, y: camera.scrollY, width: camera.width, height: camera.height };
    });
    this.syncBattle();
  }

  private positionPlayer(): void {
    const body = this.battle.player;
    const x = body.x + body.width / 2;
    const y = body.y + body.height;
    this.player.setPosition(x, y);
    this.playerView.magic?.setPosition(x, y);
  }

  private syncBattle(): void {
    const battle = this.battle;
    this.positionPlayer();
    const pose = this.playerView.animator.sample(battle.time, {
      x: battle.player.x - this.lastPlayerPosition.x, y: battle.player.y - this.lastPlayerPosition.y,
    }, battle.playerAction);
    this.lastPlayerPosition = { x: battle.player.x, y: battle.player.y };
    const hurtAge = battle.time - battle.player.lastHitAt;
    const alpha = hurtAge < BATTLE_CONFIG.player.hurtMs && !battle.gameOver && Math.floor(hurtAge / 120) % 2 === 0 ? 0.35 : 1;
    updateSpriteView(this.playerView, SPRITE_ART[this.character], pose,
      this.player.x, this.player.y, getFootDepth(battle.player), alpha);
    const liveEnemies = new Set<number>();
    for (const enemy of battle.enemies) {
      liveEnemies.add(enemy.id);
      // 각 적은 독립된 재생 상태를 갖고, 맞은 직후 0.1초 동안 흰색으로 점멸한다.
      const art = ENEMY_ART[enemy.kind];
      let view = this.enemyViews.get(enemy.id);
      if (!view) {
        view = createSpriteView(this, art, enemy.x, enemy.y);
        this.enemyViews.set(enemy.id, view);
      }
      const enemyPose = view.animator.sample(battle.time, { x: enemy.x - view.x, y: enemy.y - view.y }, enemy.action ?? null);
      updateSpriteView(view, art, enemyPose, enemy.x + enemy.width / 2, enemy.y + enemy.height, getFootDepth(enemy), 1);
      if (battle.time - enemy.lastHitAt < 100) view.body.setTintFill(0xffffff);
      else view.body.clearTint();
      view.x = enemy.x; view.y = enemy.y;
    }
    for (const [id, view] of this.enemyViews) {
      if (!liveEnemies.has(id)) { view.body.destroy(); view.magic?.destroy(); this.enemyViews.delete(id); }
    }
    // 각 좀비는 독립된 재생 상태를 갖고, 죽은 개체의 표시를 함께 정리한다.
    const liveZombies = new Set<number>();
    for (const zombie of battle.zombies) {
      if (zombie.hp <= 0) continue;
      liveZombies.add(zombie.id);
      let view = this.zombieViews.get(zombie.id);
      if (!view) {
        view = createSpriteView(this, SPRITE_ART.zombie, zombie.x, zombie.y);
        this.zombieViews.set(zombie.id, view);
      }
      const age = battle.time - zombie.lastHitAt;
      const zombiePose = view.animator.sample(battle.time, { x: zombie.x - view.x, y: zombie.y - view.y }, zombie.action ?? null);
      updateSpriteView(view, SPRITE_ART.zombie, zombiePose,
        zombie.x + zombie.width / 2, zombie.y + zombie.height, getFootDepth(zombie),
        age < BATTLE_CONFIG.player.hurtMs && Math.floor(age / 120) % 2 === 0 ? 0.35 : 1);
      view.x = zombie.x; view.y = zombie.y;
    }
    for (const [id, view] of this.zombieViews) {
      if (!liveZombies.has(id)) { view.body.destroy(); view.magic?.destroy(); this.zombieViews.delete(id); }
    }
    // 보스 범위 공격의 경고는 판정 범위 그대로 그리고, 피해 시점이 다가올수록 진하게 한다. 몸체 위, 투사체 아래에 그린다.
    const liveHazards = new Set<number>();
    for (const hazard of battle.hazards) {
      liveHazards.add(hazard.id);
      let view = this.hazardViews.get(hazard.id);
      if (!view) {
        view = this.add.graphics().setDepth(9000);
        this.hazardViews.set(hazard.id, view);
      }
      const progress = Math.min(1, (battle.time - hazard.castAt) / (hazard.hitAt - hazard.castAt));
      view.clear().fillStyle(0xe04848, 0.12 + 0.3 * progress).lineStyle(2, 0xe04848, 0.85);
      if (hazard.kind === 'brand') {
        view.fillCircle(hazard.x, hazard.y, BOSS_CONFIG.brand.radius).strokeCircle(hazard.x, hazard.y, BOSS_CONFIG.brand.radius);
      } else {
        for (const arm of crossArms(hazard)) view.fillRect(arm.x, arm.y, arm.width, arm.height).strokeRect(arm.x, arm.y, arm.width, arm.height);
      }
    }
    for (const [id, view] of this.hazardViews) {
      if (!liveHazards.has(id)) { view.destroy(); this.hazardViews.delete(id); }
    }
    // 신성 방벽이 유지되는 동안 보호 범위(보스 중심 반경)를 금색 원으로 표시하고, 같은 크기의 룬 고리를 반복 재생한다.
    const boss = battle.boss;
    if (boss && boss.hp > 0 && battle.time < battle.bossGuardUntil) {
      this.aegisView ??= this.add.circle(0, 0, BOSS_CONFIG.aegis.radius, BOSS_CONFIG.strokeColor, 0.1)
        .setStrokeStyle(3, BOSS_CONFIG.strokeColor).setDepth(9001);
      this.aegisArt ??= createStripView(this, STRIP_ART.bossAegis).setScale(aegisScale()).setDepth(9002);
      const x = boss.x + boss.width / 2, y = boss.y + boss.height / 2;
      this.aegisView.setPosition(x, y).setVisible(true);
      this.aegisArt.setPosition(x, y).setFrame(stripFrame(STRIP_ART.bossAegis, battle.time)).setVisible(true);
    } else {
      this.aegisView?.setVisible(false);
      this.aegisArt?.setVisible(false);
    }
    const liveShots = new Set<number>();
    for (const shot of battle.projectiles) {
      liveShots.add(shot.id);
      // 그림은 판정 중심에 기준점을 두고 진행 방향으로 회전한다. 길이로 판정을 바꾸지 않는다.
      const art = shotArt(shot, this.character);
      let view = this.shotViews.get(shot.id);
      if (!view) {
        view = (art ? createStripView(this, art) : this.add.rectangle(0, 0, shot.width, shot.height, shot.color)).setDepth(10000);
        this.shotViews.set(shot.id, view);
      }
      view.setPosition(shot.x + shot.width / 2, shot.y + shot.height / 2);
      if (art && view instanceof Phaser.GameObjects.Sprite) {
        view.setRotation(Math.atan2(shot.vy, shot.vx)).setFrame(stripFrame(art, battle.time, shot.firedAt));
      }
    }
    for (const [id, view] of this.shotViews) {
      if (!liveShots.has(id)) { view.destroy(); this.shotViews.delete(id); }
    }
    const liveOrbs = new Set<number>();
    for (const orb of battle.orbs) {
      liveOrbs.add(orb.id);
      let view = this.orbViews.get(orb.id);
      if (!view) {
        view = createStripView(this, STRIP_ART.expOrb, orbTexture(orb.value));
        this.orbViews.set(orb.id, view);
      }
      // 상한 초과로 값이 합쳐질 수 있으므로 색은 매 프레임 현재 값으로 정한다. 구슬은 회전하지 않는다.
      view.setTexture(orbTexture(orb.value), stripFrame(STRIP_ART.expOrb, battle.time));
      view.setPosition(orb.x + orb.width / 2, orb.y + orb.height / 2).setDepth(getFootDepth(orb));
    }
    for (const [id, view] of this.orbViews) {
      if (!liveOrbs.has(id)) { view.destroy(); this.orbViews.delete(id); }
    }
    // 휘두르기·폭발·회복 범위는 판정에 쓴 반경 그대로 원을 잠시 보여주고 흐리게 사라지게 한다. 그 위에 효과 그림을
    // 수명 동안 한 번 재생한다. 보스 타격과 좀비 부활은 경고 도형·소환물이 따로 있으므로 그림만 그린다.
    const liveEffects = new Set<number>();
    for (const effect of battle.effects) {
      liveEffects.add(effect.id);
      const display = effectDisplay(effect, battle.time);
      let view = this.effectViews.get(effect.id);
      if (!view) {
        const color = effect.kind === 'swing' ? 0xc9b8ff : effect.kind === 'heal' ? 0xe58fb8 : effect.kind === 'blast' ? 0x8fd16a : 0xffa64d;
        const ring = ['swing', 'explosion', 'heal', 'blast'].includes(effect.kind)
          ? this.add.circle(effect.x, effect.y, effect.radius, color, 0.18).setStrokeStyle(2, color).setDepth(10001) : undefined;
        const art = display.rotations.map((rotation) => createStripView(this, display.profile)
          .setPosition(effect.x, effect.y).setScale(display.scaleX, display.scaleY).setRotation(rotation).setDepth(10002));
        view = { ring, art };
        this.effectViews.set(effect.id, view);
      }
      view.ring?.setAlpha(Math.max(0, 1 - (battle.time - effect.at) / SKILL_CONFIG.effectMs));
      for (const sprite of view.art) sprite.setFrame(display.frame);
    }
    for (const [id, view] of this.effectViews) {
      if (!liveEffects.has(id)) { view.ring?.destroy(); for (const sprite of view.art) sprite.destroy(); this.effectViews.delete(id); }
    }
    this.status.setText(`체력 ${battle.player.hp}/${battle.player.maxHp}    생존 ${(battle.time / 1000).toFixed(1)}초    적 ${battle.enemies.length}    처치 ${battle.kills}`);
    this.healthFill.setDisplaySize(180 * battle.player.hp / battle.player.maxHp, 10);
    const need = experienceToNextLevel(battle.level);
    this.expFill.setDisplaySize(180 * battle.experience / need, 6);
    const surgeLeft = battle.surgeUntil - battle.time;
    this.levelText.setText(`Lv ${battle.level}   ${battle.experience}/${need}`
      + (surgeLeft > 0 ? `    마력 폭주 ${(surgeLeft / 1000).toFixed(1)}초` : '')
      + (battle.character === 'necromancer' ? `    좀비 ${battle.zombies.length}/${battle.skills.zombieMax}` : ''));
    const blessings = BLESS_IDS.filter((id) => battle.rewardStacks[id] > 0)
      .map((id) => `${BLESS_LABELS[id]} +${battle.blessPercent(id) - 100}%`);
    this.blessText.setText(blessings.length ? `가호: 적 ${blessings.join(' · ')}` : '');
    this.hudPanel.setSize(620, blessings.length ? 132 : 112);
    const barrierMax = battle.barrierMax;
    this.barrierFill.setVisible(barrierMax > 0);
    if (barrierMax > 0) this.barrierFill.setDisplaySize(180 * battle.barrier / barrierMax, 3);
    // 보스 체력 바와 등장 알림(게임 시간 2초).
    const bossAlive = Boolean(boss && boss.hp > 0);
    for (const view of this.bossPanel) (view as Phaser.GameObjects.Rectangle).setVisible(bossAlive);
    if (boss && bossAlive) {
      this.bossName.setText(`${ENEMY_STATS[boss.kind].name}   ${boss.hp}/${boss.maxHp}`);
      this.bossFill.setDisplaySize(BOSS_BAR.width * boss.hp / boss.maxHp, BOSS_BAR.height);
    }
    this.bossNotice.setVisible(!battle.gameOver && battle.time - battle.bossAppearedAt < 2000);
    // 선택할 때마다 새 선택지 배열이 만들어지므로 연속 레벨업에서도 창을 다시 구성한다.
    if (battle.choices !== this.shownChoices) this.showChoices(battle.choices);
    if (battle.gameOver && !this.shownGameOver) {
      this.shownGameOver = true;
      this.gameOverAt = this.time.now;
      this.add.rectangle(640, 360, 1280, 720, 0x060a08, 0.78).setScrollFactor(0).setDepth(30000);
      this.add.text(640, 360, `게임 종료\n\n${CHARACTER_STATS[battle.character].name} · 생존 ${(battle.time / 1000).toFixed(1)}초 · 처치 ${battle.kills} · Lv ${battle.level}\n\nEnter 또는 클릭: 캐릭터 선택으로`, {
        fontFamily: FONT, fontSize: '30px', color: '#e5e3c8', align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(30001);
    }
  }

  private pickChoice(index: number): void {
    if (!this.battle.choices.length || this.time.now - this.choiceOpenedAt < INPUT_DELAY_MS) return;
    if (this.battle.choose(index)) this.syncBattle();
  }

  private showChoices(choices: readonly RewardId[]): void {
    for (const view of this.choiceViews) view.destroy();
    this.choiceViews = [];
    this.shownChoices = choices;
    if (!choices.length) return;
    this.choiceOpenedAt = this.time.now;
    const fixed = <T extends Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text>(view: T, depth: number): T => {
      view.setScrollFactor(0).setDepth(depth);
      this.choiceViews.push(view);
      return view;
    };
    // HUD 위, 게임 종료 화면 아래에 그린다. 연속 레벨업은 앞선 레벨부터 순서대로 표시한다.
    const rewardLevel = this.battle.level - this.battle.pendingChoices + 1;
    // 가호 선택창은 몇 번째 가호인지로 그 가호가 나온 게임 시간을 보여 준다.
    const blessMinutes = (BLESS_IDS.reduce((sum, id) => sum + this.battle.rewardStacks[id], 0) + 1) * BLESS_CONFIG.everyMs / 60_000;
    const title = this.battle.choiceSource === 'boss' ? `${ENEMY_STATS[BOSS_CONFIG.kind].name} 처치 · 보상을 선택하세요`
      : this.battle.choiceSource === 'blessing' ? `${blessMinutes}:00 · 가호를 선택하세요`
      : `레벨 ${rewardLevel} 달성 · 보상을 선택하세요`;
    fixed(this.add.rectangle(640, 360, 1280, 720, 0x060a08, 0.72), 25000);
    fixed(this.add.text(640, 175, title, {
      fontFamily: FONT, fontSize: '28px', color: '#e5e3c8',
    }).setOrigin(0.5), 25001);
    const total = choices.length * CHOICE_CARD.width + (choices.length - 1) * CHOICE_CARD.gap;
    choices.forEach((id, index) => {
      // '직업 특수 특기'는 선택창을 열 때 정한, 실제로 얻게 될 특수 특기를 보여 준다.
      const special = id === 'bossSkill' && this.battle.bossSpecial ? REWARDS[this.battle.bossSpecial] : null;
      const reward = special ? { ...REWARDS[id], effect: `${special.name} 획득\n${special.effect}` } : REWARDS[id];
      const x = 640 - total / 2 + index * (CHOICE_CARD.width + CHOICE_CARD.gap) + CHOICE_CARD.width / 2;
      const y = CHOICE_CARD.top + CHOICE_CARD.height / 2;
      const stroke = cardStroke(reward);
      const card = fixed(this.add.rectangle(x, y, CHOICE_CARD.width, CHOICE_CARD.height, 0x1c2420)
        .setStrokeStyle(2, stroke), 25001);
      card.setInteractive({ useHandCursor: true })
        .on('pointerover', () => card.setStrokeStyle(3, 0x9fd0ff))
        .on('pointerout', () => card.setStrokeStyle(2, stroke))
        .on('pointerdown', () => this.pickChoice(index));
      const stacks = this.battle.rewardStacks[id];
      const stackText = reward.special ? '특수 특기 · 1회 획득'
        : Number.isFinite(reward.maxStacks) ? `중첩 ${stacks}/${reward.maxStacks}`
        : reward.character ? `직업 특기 · 중첩 ${stacks}` : id === 'heal' ? '중첩 제한 없음' : `중첩 ${stacks} · 제한 없음`;
      // 레벨업 보상은 등급 이름을 앞에 붙인다. 보스 보상과 가호는 등급 없이 표시한다.
      const footer = reward.tier ? `${REWARD_TIERS[reward.tier].name} · ${stackText}`
        : reward.blessing ? `가호 · 중첩 ${stacks}` : '보스 보상';
      const lines: [number, string, string, string][] = [
        [-95, `[${index + 1}]`, '18px', '#9fd0ff'],
        [-50, reward.name, '21px', '#eeeece'],
        [10, reward.effect, '16px', '#c8d2c0'],
        [90, footer, '15px', '#8f9c8a'],
      ];
      for (const [offset, text, fontSize, color] of lines) {
        fixed(this.add.text(x, y + offset, text, {
          fontFamily: FONT, fontSize, color, align: 'center', wordWrap: { width: CHOICE_CARD.width - 24, useAdvancedWrap: true },
        }).setOrigin(0.5), 25002);
      }
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#151923',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // 타이틀 → 캐릭터 선택 → 게임 순서로 진행한다. 첫 번째 장면이 처음 열린다.
  scene: [TitleScene, CharacterSelectScene, GameScene],
});
