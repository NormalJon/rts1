/**
 * The skirmish AI: a computer opponent that plays the same game a person does.
 *
 * It is a player, not part of the simulation. A few times a second it looks
 * at the world and returns commands, which go through the session exactly as
 * a person's clicks do, so replays and multiplayer need know nothing about it.
 *
 * It plays fair. It gets no extra resources and it does not see through the
 * fog: of the enemy it knows only what its side can see now, plus the
 * buildings it remembers seeing. The one thing it is given is where towns can
 * start on the map, which any player who knows the map would know too.
 *
 * What it does, in the order it thinks about them:
 *
 *   the town   train villagers; build houses before running out of room;
 *              share the villagers between food and wood (and a little
 *              stone for towers); plant farms when the berries are spoken
 *              for; put a lumber camp by the trees when the walk gets long
 *   the forge  barracks, archery range, stable and blacksmith as the town
 *              grows; keep them training, leaning toward whatever beats the
 *              enemy's soldiers it has seen
 *   progress   mine gold; choose a reform and move up an age when the town
 *              can bear the cost; research what its buildings offer
 *   the army   send one scout to find the enemy; gather the rest in front of
 *              the town; come home to fight raiders; when the army is big
 *              enough, march on the nearest enemy building it knows of, and
 *              keep going from one to the next; fall back when the attack
 *              is broken, and come again with more
 *
 * Nothing here is random and nothing reads a clock, so the same match always
 * plays out the same way.
 */

import { canPlace } from '../sim/buildings';
import type { Command } from '../sim/commands';
import { ENTITY_TYPES, Kind, POPULATION_LIMIT, Resource, TRAIN_QUEUE_LENGTH } from '../sim/entityTypes';
import { TechId, TECHS, whyNot } from '../sim/tech';
import { Terrain } from '../sim/map';
import { countPopulation } from '../sim/production';
import { canSee, hasExplored, sees } from '../sim/vision';
import { Job, MoveState, OrderKind, type EntityId, type World } from '../sim/world';

/** Anything that plays a side by issuing commands: an AI, a script, a network peer. */
export interface Controller {
  /** Called once before every tick. Returns the commands this player gives now. */
  act(world: World): Command[];
}

export type Difficulty = 'easy' | 'standard' | 'hard';

interface Tuning {
  /** Seconds between one look at the world and the next. */
  readonly thinkSeconds: number;
  /** How many villagers it works up to. */
  readonly villagers: number;
  /** How many soldiers it keeps at most. */
  readonly army: number;
  /** How big the army must be for the first attack, and how much bigger for each one after. */
  readonly firstAttack: number;
  readonly attackGrowth: number;
  /** Seconds it leaves its opponent in peace at the start, however many soldiers it has. */
  readonly patience: number;
  /** Villagers it wants before each military building. */
  readonly barracksAt: number;
  readonly rangeAt: number;
  readonly stableAt: number;
  /** Whether it trains what beats the soldiers it has seen. */
  readonly counters: boolean;
  /** Watchtowers it builds at home, and second copies of its military buildings. */
  readonly towers: number;
  readonly doubles: boolean;
  /** The last age it climbs to, and the villagers it wants before leaving each age. */
  readonly lastAge: number;
  readonly ageAt: readonly number[];
  /** Villagers it keeps on gold once it has a use for it. */
  readonly goldMiners: number;
}

const TUNING: Record<Difficulty, Tuning> = {
  easy: {
    thinkSeconds: 2,
    villagers: 14,
    army: 12,
    firstAttack: 5,
    attackGrowth: 2,
    patience: 540,
    barracksAt: 12,
    rangeAt: 14,
    stableAt: 99,
    counters: false,
    towers: 0,
    doubles: false,
    lastAge: 1,
    ageAt: [14, 99, 99],
    goldMiners: 2,
  },
  standard: {
    thinkSeconds: 1,
    villagers: 24,
    army: 40,
    firstAttack: 8,
    attackGrowth: 4,
    patience: 300,
    barracksAt: 8,
    rangeAt: 12,
    stableAt: 15,
    counters: true,
    towers: 1,
    doubles: false,
    lastAge: 2,
    ageAt: [18, 24, 99],
    goldMiners: 3,
  },
  hard: {
    thinkSeconds: 0.5,
    villagers: 34,
    army: 70,
    firstAttack: 12,
    attackGrowth: 6,
    patience: 0,
    barracksAt: 7,
    rangeAt: 10,
    stableAt: 13,
    counters: true,
    towers: 2,
    doubles: true,
    lastAge: 3,
    ageAt: [16, 24, 32],
    goldMiners: 5,
  },
};

/** The soldiers it trains: how much of each it likes in an army with no enemy in mind, and what each is good against. */
const LIKES: Record<number, number> = {
  [Kind.Spearman]: 4,
  [Kind.Archer]: 4,
  [Kind.Horseman]: 2,
  [Kind.ManAtArms]: 4,
  [Kind.Knight]: 2,
  [Kind.Crossbowman]: 2,
  [Kind.Handgunner]: 3,
};
const BEATS: Record<number, readonly number[]> = {
  [Kind.Spearman]: [Kind.Horseman, Kind.Knight],
  [Kind.Archer]: [Kind.Spearman],
  [Kind.Horseman]: [Kind.Archer, Kind.Crossbowman, Kind.Handgunner],
  [Kind.ManAtArms]: [Kind.Spearman, Kind.Archer, Kind.Horseman],
  [Kind.Knight]: [Kind.Archer, Kind.Crossbowman, Kind.Handgunner, Kind.Horseman],
  [Kind.Crossbowman]: [Kind.ManAtArms],
  [Kind.Handgunner]: [Kind.ManAtArms, Kind.Archer],
};
/** The reform it chooses on leaving each age: more food first, then better soldiers, then guns. */
const REFORMS = [TechId.OpenFields, TechId.PaidRetinues, TechId.Gunfounding];
/** What it researches, most wanted first, as its buildings and its age allow. */
const RESEARCH_ORDER: readonly number[] = [
  TechId.FellingAxes,
  TechId.HeavyPlough,
  TechId.Wheelbarrow,
  TechId.FireSetting,
  TechId.HorseCollar,
  TechId.LongSpears,
  TechId.SteeledEdges,
  TechId.MailHauberks,
  TechId.BodkinPoints,
  TechId.CouchedLance,
  TechId.ArrowLoops,
  TechId.Sawmills,
  TechId.DrainageAdits,
  TechId.Pikes,
  TechId.Longbows,
  TechId.BlastFurnace,
  TechId.CoatOfPlates,
];
const MILITARY_BUILDINGS: readonly number[] = [Kind.Barracks, Kind.ArcheryRange, Kind.Stable, Kind.Watchtower, Kind.Blacksmith];

/** How far from home an enemy counts as a threat to the town, in tiles. */
const THREAT_RADIUS = 18;
/** How far it will send villagers for berries, trees and stone. */
const WORK_RADIUS = 22;
/** Woodcutters walking further than this to hand in want a lumber camp by the trees. */
const LONG_WALK = 5;
/** Farms it has before it wants a mill among them. */
const FARMS_BEFORE_MILL = 6;

type Mode = 'gather' | 'defend' | 'attack';

interface Point {
  x: number;
  y: number;
}

interface KnownBuilding extends Point {
  readonly id: EntityId;
  readonly kind: number;
}

const fixed = (tile: number): number => (tile << 16) + 0x8000;
const tileX = (world: World, slot: number): number => world.posX[slot]! >> 16;
const tileY = (world: World, slot: number): number => world.posY[slot]! >> 16;
const far = (ax: number, ay: number, bx: number, by: number): number => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

export class SkirmishAi implements Controller {
  readonly player: number;
  readonly difficulty: Difficulty;
  private readonly tuning: Tuning;

  // ---- What it remembers from one look to the next ---------------------------
  /** Where its town is: the town centre, or wherever it last stood. */
  private home: Point | null = null;
  /** Enemy buildings it has seen and not since seen gone. */
  private readonly known = new Map<EntityId, KnownBuilding>();
  /** How many of each kind of enemy soldier it has lately seen, fading with time. */
  private readonly enemyMix = new Map<number, number>();
  private mode: Mode = 'gather';
  private waveSize: number;
  private waveStart = 0;
  /** The soldiers who set out on the present attack. Those trained since wait at home to follow in a body. */
  private readonly wave = new Set<EntityId>();
  private target: Point | null = null;
  private scout: EntityId = -1;
  private scouted = false;
  private scoutSentAt = 0;
  /** Looks since anything threatened the town. */
  private quiet = 0;

  // ---- The world as of this look ----------------------------------------------
  private world!: World;
  private out: Command[] = [];
  private purse: number[] = [0, 0, 0, 0];
  private villagers: number[] = [];
  private soldiers: number[] = [];
  private idle: number[] = [];
  private done = new Map<number, number[]>();
  private sites: number[] = [];
  private gathering = [0, 0, 0, 0];
  private berryPickers = 0;
  private farmed = new Set<number>();
  private claimed = new Set<number>();
  private threats: number[] = [];
  /** What is being put by for a building or reform it wants and cannot yet pay for, by resource. */
  private saving = [0, 0, 0, 0];

  constructor(player: number, difficulty: Difficulty = 'standard') {
    this.player = player;
    this.difficulty = difficulty;
    this.tuning = TUNING[difficulty];
    this.waveSize = this.tuning.firstAttack;
  }

  /** What it is up to, for tests and for anyone watching it play. */
  status(): { mode: Mode; waveSize: number; target: Point | null; knownBuildings: number; scouting: boolean } {
    return {
      mode: this.mode,
      waveSize: this.waveSize,
      target: this.target,
      knownBuildings: this.known.size,
      scouting: this.scout !== -1,
    };
  }

  act(world: World): Command[] {
    const every = Math.max(1, Math.round(this.tuning.thinkSeconds * world.config.tickRate));
    // Players think on different ticks, so their orders do not all land at once.
    if (world.tick % every !== (this.player * 7) % every) return [];
    this.world = world;
    this.out = [];
    this.takeStock();
    if (this.villagers.length + this.soldiers.length + this.done.size + this.sites.length === 0) return [];
    this.lookForTheEnemy();
    this.runTheTown();
    this.runTheArmy();
    return this.out;
  }

  // ---- Looking ----------------------------------------------------------------

  /** Counts up what it has and what its villagers are doing. */
  private takeStock(): void {
    const { world, player } = this;
    this.villagers = [];
    this.soldiers = [];
    this.idle = [];
    this.done = new Map();
    this.sites = [];
    this.gathering = [0, 0, 0, 0];
    this.berryPickers = 0;
    this.farmed = new Set();
    this.claimed = new Set();
    this.purse = Array.from(world.stock.subarray(player * 4, player * 4 + 4));
    for (let slot = 0; slot < world.highWater; slot++) {
      if (world.alive[slot] === 0 || world.owner[slot] !== player) continue;
      const kind = world.entityType[slot]!;
      if (world.mobile[slot] === 0) {
        if (world.built[slot] === 0) this.sites.push(slot);
        else {
          const list = this.done.get(kind);
          if (list === undefined) this.done.set(kind, [slot]);
          else list.push(slot);
        }
        continue;
      }
      if (kind !== Kind.Villager) {
        this.soldiers.push(slot);
        continue;
      }
      this.villagers.push(slot);
      const job = world.job[slot]!;
      if (job === Job.ToResource || job === Job.Harvesting || job === Job.ToDropOff) {
        const terrain = world.jobTerrain[slot]!;
        const resource = terrain === Terrain.Forest ? Resource.Wood : terrain === Terrain.Stone ? Resource.Stone : terrain === Terrain.Gold ? Resource.Gold : Resource.Food;
        this.gathering[resource]!++;
        if (terrain === Terrain.Berries) this.berryPickers++;
        if (terrain === Terrain.Field && world.jobTile[slot]! >= 0) this.farmed.add(world.jobTile[slot]!);
      } else if (job === Job.None && world.moveState[slot] === MoveState.Idle && world.engaged[slot] === 0) {
        this.idle.push(slot);
      }
    }
    const hall = this.done.get(Kind.TownCentre)?.[0];
    if (hall !== undefined) this.home = { x: tileX(world, hall), y: tileY(world, hall) };
    else if (this.home === null) {
      const first = this.villagers[0] ?? this.soldiers[0] ?? this.sites[0] ?? [...this.done.values()][0]?.[0];
      if (first !== undefined) this.home = { x: tileX(world, first), y: tileY(world, first) };
    }
  }

  private count(kind: number): number {
    return this.done.get(kind)?.length ?? 0;
  }

  private siteCount(kind: number): number {
    let n = 0;
    for (const slot of this.sites) if (this.world.entityType[slot] === kind) n++;
    return n;
  }

  /** Notes the enemy in sight: buildings to remember, soldiers to counter, raiders to drive off. */
  private lookForTheEnemy(): void {
    const { world, player } = this;
    const home = this.home;
    this.threats = [];
    for (const [kind, seen] of this.enemyMix) this.enemyMix.set(kind, seen * 0.985);
    const inSight = new Map<number, number>();
    for (let slot = 0; slot < world.highWater; slot++) {
      if (world.alive[slot] === 0 || !world.hostile(player, world.owner[slot]!) || !canSee(world, player, slot)) continue;
      const x = tileX(world, slot);
      const y = tileY(world, slot);
      if (world.mobile[slot] === 0) {
        const id = world.idAt(slot);
        if (!this.known.has(id)) this.known.set(id, { id, kind: world.entityType[slot]!, x, y });
        continue;
      }
      const kind = world.entityType[slot]!;
      if (kind !== Kind.Villager) inSight.set(kind, (inSight.get(kind) ?? 0) + 1);
      if (home !== null && far(x, y, home.x, home.y) <= THREAT_RADIUS) this.threats.push(slot);
    }
    for (const [kind, n] of inSight) this.enemyMix.set(kind, Math.max(this.enemyMix.get(kind) ?? 0, n));
    // A remembered building is forgotten once its place is in view and it is not there.
    for (const building of this.known.values()) {
      if (!world.isAlive(building.id) && sees(world, player, building.y * world.map.width + building.x)) {
        this.known.delete(building.id);
      }
    }
  }

  // ---- Giving orders ----------------------------------------------------------

  private canAfford(cost: readonly number[]): boolean {
    return cost.every((amount, r) => this.purse[r]! >= amount);
  }

  private spend(cost: readonly number[]): void {
    cost.forEach((amount, r) => (this.purse[r] = this.purse[r]! - amount));
  }

  private ids(slots: readonly number[]): EntityId[] {
    return slots.map((slot) => this.world.idAt(slot));
  }

  /**
   * A free plot for a building: the nearest to a point, no closer than
   * `inner` tiles and no further than `outer`, with a tile's width clear of
   * other buildings all round so that nothing gets walled in. Of the plots at
   * the same distance it takes the one nearest `toward`, if given.
   */
  private findPlot(kind: number, near: Point, inner: number, outer: number, toward?: Point): Point | null {
    const { world, player } = this;
    const { map } = world;
    const reach = (ENTITY_TYPES[kind]!.footprint >> 1) + 1;
    const lanesClear = (tx: number, ty: number): boolean => {
      for (let y = ty - reach; y <= ty + reach; y++) {
        for (let x = tx - reach; x <= tx + reach; x++) {
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
          if (map.blocked[y * map.width + x] === 1) return false;
        }
      }
      return true;
    };
    for (let r = inner; r <= outer; r++) {
      let best: Point | null = null;
      let bestScore = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = near.x + dx;
          const ty = near.y + dy;
          if (!canPlace(world, kind, tx, ty, player) || !lanesClear(tx, ty)) continue;
          const score = toward === undefined ? 0 : far(tx, ty, toward.x, toward.y);
          if (best === null || score < bestScore) {
            best = { x: tx, y: ty };
            bestScore = score;
          }
        }
      }
      if (best !== null) return best;
    }
    return null;
  }

  /** The villager best spared for a building job near a point: an idle one, else one cutting wood. */
  private takeBuilder(near: Point): number {
    const { world } = this;
    let best = -1;
    let bestScore = 0;
    for (const slot of this.villagers) {
      if (this.claimed.has(slot)) continue;
      const job = world.job[slot]!;
      if (job === Job.ToSite || job === Job.Constructing) continue;
      const standing = this.idle.includes(slot);
      const felling = world.jobTerrain[slot] === Terrain.Forest && job !== Job.None;
      // Idle hands first, then woodcutters, then anyone; nearer is better within each.
      const score = (standing ? 0 : felling ? 1000 : 2000) + far(tileX(world, slot), tileY(world, slot), near.x, near.y);
      if (best === -1 || score < bestScore) {
        best = slot;
        bestScore = score;
      }
    }
    if (best !== -1) this.claimed.add(best);
    return best;
  }

  /** Founds a building and sets villagers to it. Returns whether it could. */
  private build(kind: number, near: Point, inner: number, outer: number, builders: number, toward?: Point): boolean {
    const type = this.world.types[this.player]![kind]!;
    if (this.world.age[this.player]! < type.age || !this.canAfford(type.cost)) return false;
    const plot = this.findPlot(kind, near, inner, outer, toward);
    if (plot === null) return false;
    const crew: number[] = [];
    for (let i = 0; i < builders; i++) {
      const builder = this.takeBuilder(plot);
      if (builder !== -1) crew.push(builder);
    }
    if (crew.length === 0) return false;
    this.spend(type.cost);
    this.out.push({ kind: 'build', units: this.ids(crew), buildingType: kind, tileX: plot.x, tileY: plot.y });
    return true;
  }

  /** The nearest tile of a resource to a point that the side has explored and a villager can stand beside. */
  private nearestResource(terrain: number, near: Point, radius: number): number {
    const { world, player } = this;
    const { map } = world;
    const region = this.home === null ? 0 : map.region[map.nearestPassable(this.home.x, this.home.y)] ?? 0;
    return map.nearestTile(
      near.x,
      near.y,
      radius,
      (tile) =>
        map.terrain[tile] === terrain &&
        map.amount[tile]! > 0 &&
        hasExplored(world, player, tile) &&
        map.canBeWorkedFrom(tile, region),
    );
  }

  // ---- The town ---------------------------------------------------------------

  private runTheTown(): void {
    const { world, player, tuning } = this;
    const home = this.home;
    if (home === null) return;
    const population = countPopulation(world);
    const used = population.used[player]!;
    const room = population.room[player]!;
    const workers = this.villagers.length;
    const enemy = this.enemyStart() ?? { x: world.map.width - 1 - home.x, y: world.map.height - 1 - home.y };

    // More villagers, one in the making at a time.
    const hall = this.done.get(Kind.TownCentre)?.[0];
    if (hall !== undefined && world.trainLength[hall] === 0 && workers < tuning.villagers && used < room) {
      this.train(hall, Kind.Villager);
    }

    // A house before the town is full.
    const forges = MILITARY_BUILDINGS.reduce((n, kind) => n + this.count(kind), 0);
    if (room - used <= 2 + forges && room < POPULATION_LIMIT && this.siteCount(Kind.House) === 0) {
      // Behind the town, away from the enemy.
      this.build(Kind.House, home, 5, 14, 1, { x: 2 * home.x - enemy.x, y: 2 * home.y - enemy.y });
    }

    // Military buildings, one at a time so the town is not starved to pay
    // for them. If the next one cannot be afforded yet, wood is put by for it
    // instead of all going on soldiers.
    this.saving = [0, 0, 0, 0];
    const age = world.age[player]!;
    const building = this.sites.some((slot) => MILITARY_BUILDINGS.includes(world.entityType[slot]!));
    if (!building) {
      const want = (kind: number): boolean => this.count(kind) === 0;
      let next = -1;
      let builders = 2;
      if (workers >= tuning.barracksAt && want(Kind.Barracks)) next = Kind.Barracks;
      else if (workers >= tuning.rangeAt && want(Kind.ArcheryRange)) next = Kind.ArcheryRange;
      else if (workers >= tuning.stableAt && want(Kind.Stable)) next = Kind.Stable;
      else if (age >= 1 && workers >= 18 && want(Kind.Blacksmith)) next = Kind.Blacksmith;
      else if (this.count(Kind.Watchtower) < tuning.towers && workers >= 14 && this.purse[Resource.Stone]! >= 50) {
        next = Kind.Watchtower;
        builders = 1;
      } else if (tuning.doubles && workers >= 26) {
        next = [Kind.Barracks, Kind.ArcheryRange, Kind.Stable].find((kind) => this.count(kind) === 1) ?? -1;
      }
      if (next !== -1) {
        const near = next === Kind.Watchtower ? 5 : 7;
        if (!this.build(next, home, near, near + 10, builders, enemy)) this.saving = [...world.types[player]![next]!.cost];
      }
    }
    this.advance(workers);

    // A site nobody is working on gets a builder.
    for (const site of this.sites) {
      const id = world.idAt(site);
      const crewed = this.villagers.some(
        (slot) => world.jobTarget[slot] === id && (world.job[slot] === Job.ToSite || world.job[slot] === Job.Constructing),
      );
      if (crewed) continue;
      const builder = this.takeBuilder({ x: tileX(world, site), y: tileY(world, site) });
      if (builder !== -1) this.out.push({ kind: 'construct', units: this.ids([builder]), target: id });
    }

    this.shareOutTheWork(home);
    this.trainSoldiers(used, room);

    // New soldiers gather in front of the town.
    const muster = this.musterPoint(home, enemy);
    const unset: EntityId[] = [];
    for (const kind of [Kind.Barracks, Kind.ArcheryRange, Kind.Stable]) {
      for (const slot of this.done.get(kind) ?? []) if (world.rallyX[slot]! < 0) unset.push(world.idAt(slot));
    }
    if (unset.length > 0) this.out.push({ kind: 'rally', buildings: unset, x: fixed(muster.x), y: fixed(muster.y) });
  }

  private train(building: number, kind: number): boolean {
    const { world } = this;
    const cost = world.types[this.player]![kind]!.cost;
    if (world.trainLength[building]! >= TRAIN_QUEUE_LENGTH || !this.canAfford(cost)) return false;
    this.spend(cost);
    this.out.push({ kind: 'train', building: world.idAt(building), unitType: kind });
    return true;
  }

  /**
   * Progress: a reform when the town is big enough to bear it, and whatever
   * research its buildings offer. A reform it cannot yet pay for is saved
   * toward, ahead of soldiers.
   */
  private advance(workers: number): void {
    const { world, player, tuning } = this;
    const age = world.age[player]!;
    const hall = this.done.get(Kind.TownCentre)?.[0];
    if (age < tuning.lastAge && hall !== undefined && workers >= tuning.ageAt[age]!) {
      const reform = REFORMS[age]!;
      const why = whyNot(world, player, reform);
      if (why === null) {
        const cost = TECHS[reform]!.cost;
        if (world.trainLength[hall]! < 2 && this.canAfford(cost)) {
          this.spend(cost);
          this.out.push({ kind: 'research', building: world.idAt(hall), tech: reform });
          return;
        }
        // Not enough yet. Put it by, on top of anything already being saved for.
        this.saving = this.saving.map((amount, r) => amount + cost[r]!);
      }
    }
    // Research, one thing each look, out of what is not being saved for something bigger.
    if (this.threats.length > 0) return;
    for (const id of RESEARCH_ORDER) {
      const tech = TECHS[id]!;
      const at = (this.done.get(tech.at) ?? []).find((slot) => world.trainLength[slot] === 0);
      if (at === undefined || !this.canAfford(tech.cost) || whyNot(world, player, id) !== null) continue;
      // What makes the villagers work faster pays for itself and is bought
      // whenever there is the money. The rest waits until nothing bigger is
      // being saved for.
      const pays = tech.effects.some((effect) => 'gather' in effect) || id === TechId.Wheelbarrow;
      if (!pays && tech.cost.some((amount, r) => amount > 0 && this.purse[r]! - amount < this.saving[r]!)) continue;
      // Either way, enough food is left that the town does not stop growing for it.
      if (this.purse[Resource.Food]! - tech.cost[Resource.Food] < 50) continue;
      this.spend(tech.cost);
      this.out.push({ kind: 'research', building: world.idAt(at), tech: id });
      return;
    }
  }

  /** Where the army gathers: a few tiles out from the town on the enemy's side. */
  private musterPoint(home: Point, enemy: Point): Point {
    const { map } = this.world;
    const dx = Math.sign(enemy.x - home.x);
    const dy = Math.sign(enemy.y - home.y);
    const x = Math.min(map.width - 2, Math.max(1, home.x + dx * 9));
    const y = Math.min(map.height - 2, Math.max(1, home.y + dy * 9));
    const region = map.region[map.nearestPassable(home.x, home.y)] ?? 0;
    const tile = map.nearestPassable(x, y, region, 12);
    return tile === -1 ? home : { x: tile % map.width, y: Math.floor(tile / map.width) };
  }

  /** Puts idle villagers to work and keeps the split between food, wood and stone about right. */
  private shareOutTheWork(home: Point): void {
    const { world, tuning } = this;
    const workers = this.villagers.length;
    if (workers === 0) return;

    // How many should be on each. Mostly food, which everything costs; more
    // wood when the stores are short of it, and two on stone if a tower is wanted.
    const food = this.purse[Resource.Food]!;
    const wood = this.purse[Resource.Wood]!;
    const stoneTile = this.count(Kind.Watchtower) < tuning.towers && workers >= 14 && this.purse[Resource.Stone]! < 50 ? this.nearestResource(Terrain.Stone, home, WORK_RADIUS) : -1;
    const onStone = stoneTile === -1 ? 0 : 2;
    // Gold pays for reforms, research and armour. It is mined from the time
    // the town is on its feet, and left alone once there is plenty in hand.
    const goldTile = workers >= 10 && this.purse[Resource.Gold]! < 500 + this.saving[Resource.Gold]! ? this.nearestResource(Terrain.Gold, home, WORK_RADIUS) : -1;
    const onGold = goldTile === -1 ? 0 : Math.min(tuning.goldMiners, Math.max(2, (workers - 8) >> 1));
    const hands = workers - onStone - onGold;
    const share = food > wood + 150 ? 0.4 : wood > food + 150 ? 0.7 : 0.55;
    const onFood = Math.min(hands, Math.ceil(hands * share));
    const wanted = [onFood, hands - onFood, onStone, onGold];
    this.wantMiningCamp(home, goldTile, onGold);

    const woodFrom = this.woodAnchor(home);
    const woodTile = this.nearestResource(Terrain.Forest, woodFrom, WORK_RADIUS);
    this.wantLumberCamp(home, woodTile);

    // Where food can come from: berry bushes with room, then farms without a farmer.
    const berryTile = this.nearestResource(Terrain.Berries, home, WORK_RADIUS);
    let berryRoom = berryTile === -1 ? 0 : Math.max(0, this.berryBushes(home) * 2 - this.berryPickers);
    const freeFarms: number[] = [];
    for (const farm of this.done.get(Kind.Farm) ?? []) {
      const middle = tileY(world, farm) * world.map.width + tileX(world, farm);
      if (!this.farmed.has(middle)) freeFarms.push(middle);
    }

    // A mill in among the farms once there are several, so the outer ones are not a long walk from the stores.
    const farms = this.count(Kind.Farm);
    const mills = this.count(Kind.Mill) + this.siteCount(Kind.Mill);
    if (farms >= FARMS_BEFORE_MILL * (mills + 1)) this.build(Kind.Mill, this.foodAnchor(home), 8, 16, 1);

    const giveWork = (slot: number, resource: number): boolean => {
      const unit = this.ids([slot]);
      if (resource === Resource.Wood) {
        if (woodTile === -1) return false;
        this.out.push({ kind: 'gather', units: unit, tile: woodTile });
        return true;
      }
      if (resource === Resource.Stone) {
        if (stoneTile === -1) return false;
        this.out.push({ kind: 'gather', units: unit, tile: stoneTile });
        return true;
      }
      if (resource === Resource.Gold) {
        if (goldTile === -1) return false;
        this.out.push({ kind: 'gather', units: unit, tile: goldTile });
        return true;
      }
      if (berryRoom > 0) {
        berryRoom--;
        this.out.push({ kind: 'gather', units: unit, tile: berryTile });
        return true;
      }
      const farm = freeFarms.pop();
      if (farm !== undefined) {
        this.out.push({ kind: 'gather', units: unit, tile: farm });
        return true;
      }
      // No farm free: plant one. Whoever plants it farms it.
      const cost = world.types[this.player]![Kind.Farm]!.cost;
      if (!this.canAfford(cost)) return false;
      const plot = this.findPlot(Kind.Farm, this.foodAnchor(home), 3, 14);
      if (plot === null) return false;
      this.spend(cost);
      this.out.push({ kind: 'build', units: unit, buildingType: Kind.Farm, tileX: plot.x, tileY: plot.y });
      return true;
    };

    // The berries will not last. Plant ahead: when what is left on the bushes
    // would feed the pickers for under two minutes, put one of them to
    // planting a farm each look that there is wood to spare for it.
    if (this.berryPickers > 0 && this.berryFood(home) < this.berryPickers * 90 && this.purse[Resource.Wood]! >= 125 + this.saving[Resource.Wood]!) {
      const picker = this.villagers.find(
        (slot) => !this.claimed.has(slot) && world.jobTerrain[slot] === Terrain.Berries && world.job[slot] === Job.Harvesting,
      );
      if (picker !== undefined) {
        const room = berryRoom;
        berryRoom = 0;
        if (giveWork(picker, Resource.Food)) this.claimed.add(picker);
        berryRoom = room;
      }
    }

    const have = [...this.gathering];
    const mostNeeded = (): number => {
      let best: number = Resource.Food;
      for (const resource of [Resource.Wood, Resource.Stone, Resource.Gold]) {
        if (wanted[resource]! - have[resource]! > wanted[best]! - have[best]!) best = resource;
      }
      return best;
    };
    for (const slot of this.idle) {
      if (this.claimed.has(slot)) continue;
      const first = mostNeeded();
      // If there is no way to do the job most needed, any honest work will do.
      const order = [first, Resource.Wood, Resource.Food].filter((resource, i, all) => all.indexOf(resource) === i);
      for (const resource of order) {
        if (!giveWork(slot, resource)) continue;
        have[resource]!++;
        this.claimed.add(slot);
        break;
      }
    }

    // One villager moves across each look if the split has drifted well off:
    // from whatever has most to spare to whatever is most short.
    let from = -1;
    for (const resource of [Resource.Food, Resource.Wood, Resource.Stone, Resource.Gold]) {
      const spare = have[resource]! - wanted[resource]!;
      const enough = wanted[resource] === 0 ? 1 : 2;
      if (spare >= enough && (from === -1 || spare > have[from]! - wanted[from]!)) from = resource;
    }
    const to = mostNeeded();
    if (from === -1 || from === to || wanted[to]! - have[to]! < 1) return;
    const mover = this.villagers.find((slot) => {
      const job = world.job[slot]!;
      if (this.claimed.has(slot) || (job !== Job.Harvesting && job !== Job.ToResource)) return false;
      const terrain = world.jobTerrain[slot]!;
      if (from === Resource.Wood) return terrain === Terrain.Forest;
      if (from === Resource.Stone) return terrain === Terrain.Stone;
      if (from === Resource.Gold) return terrain === Terrain.Gold;
      return terrain === Terrain.Berries || terrain === Terrain.Field;
    });
    if (mover === undefined) return;
    // If the work most needed cannot be had just now, wood always can.
    if (giveWork(mover, to) || (from !== Resource.Wood && giveWork(mover, Resource.Wood))) this.claimed.add(mover);
  }

  /** How much food is left on the berry bushes within reach of home. */
  private berryFood(home: Point): number {
    const { world, player } = this;
    const { map } = world;
    let food = 0;
    for (let y = Math.max(0, home.y - 14); y <= Math.min(map.height - 1, home.y + 14); y++) {
      for (let x = Math.max(0, home.x - 14); x <= Math.min(map.width - 1, home.x + 14); x++) {
        const tile = y * map.width + x;
        if (map.terrain[tile] === Terrain.Berries && hasExplored(world, player, tile)) food += map.amount[tile]!;
      }
    }
    return food;
  }

  /** How many berry bushes within reach of home still have fruit. */
  private berryBushes(home: Point): number {
    const { world, player } = this;
    const { map } = world;
    let n = 0;
    for (let y = Math.max(0, home.y - 14); y <= Math.min(map.height - 1, home.y + 14); y++) {
      for (let x = Math.max(0, home.x - 14); x <= Math.min(map.width - 1, home.x + 14); x++) {
        const tile = y * map.width + x;
        if (map.terrain[tile] === Terrain.Berries && map.amount[tile]! > 0 && hasExplored(world, player, tile)) n++;
      }
    }
    return n;
  }

  /** Where woodcutters hand in: the lumber camp built last, or the town centre. */
  private woodAnchor(home: Point): Point {
    const camps = this.done.get(Kind.LumberCamp);
    const camp = camps?.[camps.length - 1];
    return camp === undefined ? home : { x: tileX(this.world, camp), y: tileY(this.world, camp) };
  }

  /** Farms go round the newest mill once there are enough of them to need one, else round the town centre. */
  private foodAnchor(home: Point): Point {
    const mills = this.done.get(Kind.Mill);
    const mill = mills?.[mills.length - 1];
    return mill === undefined ? home : { x: tileX(this.world, mill), y: tileY(this.world, mill) };
  }

  /** Builds a lumber camp by the trees when the nearest drop-off is a long walk from them. */
  private wantLumberCamp(home: Point, woodTile: number): void {
    const { world } = this;
    if (woodTile === -1 || this.siteCount(Kind.LumberCamp) > 0 || this.gathering[Resource.Wood]! < 3) return;
    const trees = { x: woodTile % world.map.width, y: Math.floor(woodTile / world.map.width) };
    let nearest = far(trees.x, trees.y, home.x, home.y);
    for (const camp of this.done.get(Kind.LumberCamp) ?? []) {
      nearest = Math.min(nearest, far(trees.x, trees.y, tileX(world, camp), tileY(world, camp)));
    }
    if (nearest > LONG_WALK) this.build(Kind.LumberCamp, trees, 2, 6, 1, home);
  }

  /** Builds a mining camp by the gold when the miners have a long walk home with it. */
  private wantMiningCamp(home: Point, goldTile: number, miners: number): void {
    const { world } = this;
    if (goldTile === -1 || miners < 2 || this.siteCount(Kind.MiningCamp) > 0) return;
    const ore = { x: goldTile % world.map.width, y: Math.floor(goldTile / world.map.width) };
    let nearest = far(ore.x, ore.y, home.x, home.y);
    for (const camp of this.done.get(Kind.MiningCamp) ?? []) {
      nearest = Math.min(nearest, far(ore.x, ore.y, tileX(world, camp), tileY(world, camp)));
    }
    if (nearest > LONG_WALK) this.build(Kind.MiningCamp, ore, 2, 6, 1, home);
  }

  /** Keeps the military buildings training, leaning toward what the army is short of. */
  private trainSoldiers(used: number, room: number): void {
    const { world, tuning } = this;
    // The town comes first: while it is still growing, soldiers get only what is left over.
    const growing = this.villagers.length < tuning.villagers;
    const reserve = growing ? 50 : 0;
    const have = new Map<number, number>();
    let total = 0;
    for (const slot of this.soldiers) have.set(world.entityType[slot]!, (have.get(world.entityType[slot]!) ?? 0) + 1);
    const makers: number[] = [];
    for (const building of [Kind.Barracks, Kind.ArcheryRange, Kind.Stable]) {
      for (const slot of this.done.get(building) ?? []) {
        for (let k = 0; k < world.trainLength[slot]!; k++) {
          const queued = world.trainQueue[slot * TRAIN_QUEUE_LENGTH + k]! - 1;
          if (queued < ENTITY_TYPES.length) have.set(queued, (have.get(queued) ?? 0) + 1);
        }
        if (world.trainLength[slot] === 0) makers.push(slot);
      }
    }
    for (const n of have.values()) total += n;
    if (total >= tuning.army || used >= room) return;

    // What it would like the army to be made of: a balance, shifted toward
    // whatever beats the enemy soldiers it has seen.
    const types = world.types[this.player]!;
    const age = world.age[this.player]!;
    // Saving for a building or a reform must not leave the town naked: money
    // is held back from soldiers only once there is a garrison of six, and
    // never with raiders in the town.
    const saving = this.threats.length > 0 || total < Math.min(6, this.waveSize) ? [0, 0, 0, 0] : this.saving;
    const rich = this.purse[Resource.Gold]! > 250 + saving[Resource.Gold]!;
    const weight = (kind: number): number => {
      // With gold to spare, it goes on the soldiers gold buys.
      let w = (LIKES[kind] ?? 1) * (rich && types[kind]!.cost[Resource.Gold] > 0 ? 2 : 1);
      if (tuning.counters) for (const victim of BEATS[kind] ?? []) w += 1.5 * (this.enemyMix.get(victim) ?? 0);
      return w / ((have.get(kind) ?? 0) + 1);
    };
    for (const maker of makers) {
      if (total >= tuning.army) break;
      // Of what this building trains in this age and the purse will stretch to, the kind the army is shortest of.
      let best = -1;
      for (const kind of world.typeOf(maker).trains) {
        const cost = types[kind]!.cost;
        if (types[kind]!.age > age || !this.canAfford(cost)) continue;
        if (this.purse[Resource.Food]! - cost[Resource.Food] < reserve) continue;
        if (cost.some((amount, r) => amount > 0 && this.purse[r]! - amount < saving[r]!)) continue;
        if (best === -1 || weight(kind) > weight(best)) best = kind;
      }
      if (best !== -1 && this.train(maker, best)) {
        have.set(best, (have.get(best) ?? 0) + 1);
        total++;
      }
    }
  }

  // ---- The army ---------------------------------------------------------------

  /** The nearest place an enemy's town may have started: a guess at where to find them. */
  private enemyStart(): Point | null {
    const { world, player } = this;
    let best: Point | null = null;
    let bestDistance = 0;
    for (let other = 0; other < world.config.playerCount; other++) {
      const start = world.map.starts[other];
      if (start === undefined || !world.hostile(player, other)) continue;
      const at = { x: start.x >> 16, y: start.y >> 16 };
      const distance = this.home === null ? 0 : far(at.x, at.y, this.home.x, this.home.y);
      if (best === null || distance < bestDistance) {
        best = at;
        bestDistance = distance;
      }
    }
    return best;
  }

  private runTheArmy(): void {
    const { world } = this;
    const home = this.home;
    if (home === null) return;
    const enemy = this.enemyStart();

    // One soldier rides out early to find the enemy town.
    if (!world.isAlive(this.scout)) this.scout = -1;
    if (!this.scouted && this.scout === -1 && enemy !== null && this.soldiers.length > 0 && world.tick > 45 * world.config.tickRate) {
      const rider = this.soldiers.find((slot) => world.entityType[slot] === Kind.Horseman) ?? this.soldiers[0]!;
      this.scout = world.idAt(rider);
      this.scouted = true;
      this.scoutSentAt = world.tick;
      this.out.push({ kind: 'move', units: [this.scout], x: fixed(enemy.x), y: fixed(enemy.y) });
    }
    const army = this.soldiers.filter((slot) => world.idAt(slot) !== this.scout);
    // The scout rejoins the army once it has had its look.
    if (this.scout !== -1 && world.tick > this.scoutSentAt + 3 * world.config.tickRate) {
      const slot = this.scout & 0xfffff;
      if (world.moveState[slot] === MoveState.Idle && world.engaged[slot] === 0) this.scout = -1;
    }
    if (army.length === 0) {
      this.mode = 'gather';
      this.wave.clear();
      return;
    }
    const atEase = (slot: number): boolean => world.orderKind[slot] === OrderKind.None && world.engaged[slot] === 0;
    const muster = this.musterPoint(home, enemy ?? home);

    // Raiders at home come before anything else, unless the army is away and they are few.
    this.quiet = this.threats.length === 0 ? this.quiet + 1 : 0;
    if (this.threats.length > 0 && (this.mode !== 'attack' || this.threats.length >= 4)) {
      const raider = this.threats[0]!;
      const at = { x: tileX(world, raider), y: tileY(world, raider) };
      const called = army.filter((slot) => this.mode !== 'defend' || atEase(slot));
      this.mode = 'defend';
      this.wave.clear();
      if (called.length > 0) this.out.push({ kind: 'attackMove', units: this.ids(called), x: fixed(at.x), y: fixed(at.y) });
      return;
    }
    if (this.mode === 'defend' && this.quiet >= 3) this.mode = 'gather';

    // Whoever is not out on an attack waits at the mustering place.
    const marching = this.mode === 'attack' ? army.filter((slot) => this.wave.has(world.idAt(slot))) : [];
    const reserve = this.mode === 'attack' ? army.filter((slot) => !this.wave.has(world.idAt(slot))) : army;
    if (this.mode === 'gather' && army.length >= this.waveSize && world.tick >= this.tuning.patience * world.config.tickRate) {
      // Enough of them: everyone goes.
      this.mode = 'attack';
      this.waveStart = army.length;
      this.target = null;
      this.wave.clear();
      for (const slot of army) this.wave.add(world.idAt(slot));
      this.march(army);
      return;
    }
    const strays = reserve.filter((slot) => atEase(slot) && far(tileX(world, slot), tileY(world, slot), muster.x, muster.y) > 7);
    if (strays.length > 0) this.out.push({ kind: 'move', units: this.ids(strays), x: fixed(muster.x), y: fixed(muster.y) });
    if (this.mode !== 'attack') return;

    // An attack that has lost two in three is broken: home, and come again stronger.
    if (marching.length * 3 <= this.waveStart) {
      this.mode = 'gather';
      this.waveSize = Math.min(this.tuning.army, this.waveSize + this.tuning.attackGrowth);
      this.wave.clear();
      if (marching.length > 0) this.out.push({ kind: 'move', units: this.ids(marching), x: fixed(muster.x), y: fixed(muster.y) });
      return;
    }
    // Reinforcements go out together once there are enough of them to matter, not one at a time to be picked off.
    if (reserve.length >= Math.max(4, this.waveStart >> 1) && this.target !== null) {
      for (const slot of reserve) this.wave.add(world.idAt(slot));
      this.waveStart = Math.max(this.waveStart, marching.length + reserve.length);
      this.out.push({ kind: 'attackMove', units: this.ids(reserve), x: fixed(this.target.x), y: fixed(this.target.y) });
    }
    this.march(marching);
  }

  /** Runs an attack already under way: where to go next, and what to do on getting there. */
  private march(army: readonly number[]): void {
    const { world, player } = this;
    if (army.length === 0) return;
    const enemy = this.enemyStart();
    const atEase = (slot: number): boolean => world.orderKind[slot] === OrderKind.None && world.engaged[slot] === 0;
    // Where is the army now, roughly?
    let sumX = 0;
    let sumY = 0;
    for (const slot of army) {
      sumX += tileX(world, slot);
      sumY += tileY(world, slot);
    }
    const centre = { x: Math.round(sumX / army.length), y: Math.round(sumY / army.length) };

    // Pick somewhere to march on: the nearest enemy building it knows of; or
    // the enemy's start, if it has never been there; or the nearest ground it
    // has never seen, to hunt down whatever is left.
    const stale =
      this.target === null ||
      (sees(world, player, this.target.y * world.map.width + this.target.x) &&
        ![...this.known.values()].some((b) => b.x === this.target!.x && b.y === this.target!.y));
    if (stale) {
      let next: Point | null = null;
      let nearest = 0;
      for (const building of this.known.values()) {
        // Farms and houses can wait: what shoots, trains and governs comes first.
        const worth = building.kind === Kind.Farm ? 40 : building.kind === Kind.House ? 12 : 0;
        const distance = far(building.x, building.y, centre.x, centre.y) + worth;
        if (next === null || distance < nearest) {
          next = { x: building.x, y: building.y };
          nearest = distance;
        }
      }
      if (next === null && enemy !== null && !hasExplored(world, player, enemy.y * world.map.width + enemy.x)) next = enemy;
      if (next === null) {
        const tile = world.map.nearestTile(centre.x, centre.y, 48, (t) => !hasExplored(world, player, t));
        if (tile !== -1) next = { x: tile % world.map.width, y: Math.floor(tile / world.map.width) };
      }
      if (next === null) {
        // Nothing left to find. Stand down until something turns up.
        this.mode = 'gather';
        this.wave.clear();
        return;
      }
      const changed = this.target === null || next.x !== this.target.x || next.y !== this.target.y;
      this.target = next;
      if (changed) {
        this.out.push({ kind: 'attackMove', units: this.ids(army), x: fixed(next.x), y: fixed(next.y) });
        return;
      }
    }
    if (this.target === null) return;
    // At the enemy's walls with few of his soldiers about: left to
    // themselves the men would chase villagers all day, so those with blades
    // are told to pull the building down. The archers keep the defenders off.
    const mark = [...this.known.values()].find((b) => b.x === this.target!.x && b.y === this.target!.y);
    let defenders = 0;
    for (let slot = 0; slot < world.highWater; slot++) {
      if (world.alive[slot] === 0 || world.mobile[slot] === 0 || world.entityType[slot] === Kind.Villager) continue;
      if (!world.hostile(player, world.owner[slot]!) || !canSee(world, player, slot)) continue;
      if (far(tileX(world, slot), tileY(world, slot), centre.x, centre.y) <= 12) defenders++;
    }
    const inSight = mark !== undefined && world.isAlive(mark.id) && canSee(world, player, mark.id & 0xfffff);
    if (mark !== undefined && inSight && far(centre.x, centre.y, mark.x, mark.y) <= 12 && defenders * 3 < army.length) {
      const wreckers = army.filter(
        (slot) => !world.typeOf(slot).ranged && !(world.orderKind[slot] === OrderKind.AttackTarget && world.target[slot] === mark.id),
      );
      if (wreckers.length > 0) this.out.push({ kind: 'attack', units: this.ids(wreckers), target: mark.id });
    } else {
      // Defenders have turned up: anyone hacking at a wall turns to face them.
      const busy = army.filter((slot) => world.orderKind[slot] === OrderKind.AttackTarget && defenders * 3 >= army.length);
      if (busy.length > 0) this.out.push({ kind: 'attackMove', units: this.ids(busy), x: fixed(this.target.x), y: fixed(this.target.y) });
    }
    // Anyone who has stopped with the job unfinished is sent on again.
    const resting = army.filter(atEase);
    if (resting.length > 0) {
      this.out.push({ kind: 'attackMove', units: this.ids(resting), x: fixed(this.target.x), y: fixed(this.target.y) });
    }
  }
}
