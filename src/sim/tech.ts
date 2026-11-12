/**
 * Ages and technology.
 *
 * A match passes through four ages. A player leaves one for the next by
 * choosing between two reforms at the town centre, each a real change in how
 * medieval societies raised food, money or soldiers. Whichever is chosen
 * takes the player into the next age and leaves its mark for the rest of the
 * match; the other is closed for good.
 *
 * Ordinary technologies are researched at the building they belong to: better
 * ploughs at the mill, better steel at the blacksmith. Research sits in the
 * building's queue like a unit in training, is paid for when queued and
 * refunded if cancelled.
 *
 * What research changes is each player's own copy of the unit and building
 * figures (World.types). It is rebuilt from the starting figures and the list
 * of what the player has researched, in a fixed order, so it comes out the
 * same on every machine and need not be saved.
 */

import { Age, AGE_NAMES, ENTITY_TYPES, Kind, RESOURCE_COUNT, Tag, TRAIN_QUEUE_LENGTH, type EntityType } from './entityTypes';
import { fromRatio, idiv, ONE } from './fixed';
import { Terrain } from './map';
import { perSecondToPerTick } from './units';
import { entityIndex, type EntityId, type World } from './world';

type Cost = readonly [number, number, number, number];

/** A figure of a unit or building that research can change. */
type Stat = 'hp' | 'damage' | 'meleeArmor' | 'rangedArmor' | 'range' | 'sight' | 'speed' | 'carries' | 'seconds' | 'charge';

/** Which units and buildings an effect falls on: those named, and those carrying any of the tags. */
interface Who {
  readonly kinds?: readonly number[];
  readonly tags?: number;
}

export type Effect =
  /** Adds to a figure, or raises it by a percentage of what it started as. */
  | { readonly change: Stat; readonly of: Who; readonly add?: number; readonly percent?: number }
  /** Adds to the bonus damage against targets carrying a tag. */
  | { readonly bonus: number; readonly of: Who; readonly against: number }
  /** Changes what a unit costs, by a percentage of each resource. */
  | { readonly cost: number; readonly of: Who }
  /** Speeds up gathering from these terrains, in percent. */
  | { readonly gather: readonly number[]; readonly percent: number }
  /** What a unit is called from now on. */
  | { readonly rename: number; readonly to: string };

export interface Tech {
  readonly name: string;
  /** What it was and what it does, for the player. */
  readonly about: string;
  readonly cost: Cost;
  readonly seconds: number;
  /** The building it is researched at. */
  readonly at: number;
  /** The age the player must have reached. For a reform, the age it is chosen in. */
  readonly age: number;
  /** Technologies that must be researched first. */
  readonly requires: readonly number[];
  /** A reform takes the player into the next age and shuts out the other reform offered with it. */
  readonly reform: boolean;
  /** Reforms: how many different kinds of these buildings the player must have standing. */
  readonly needs: number;
  readonly among: readonly number[];
  readonly effects: readonly Effect[];
}

const SOLDIERS: Who = { tags: Tag.Infantry | Tag.Cavalry };
const BLADES: Who = { kinds: [Kind.Spearman, Kind.Horseman, Kind.ManAtArms, Kind.Knight] };
const BOWS: Who = { kinds: [Kind.Archer, Kind.Crossbowman, Kind.TownCentre, Kind.Watchtower] };
const HIGH_MEDIEVAL_WORKS = [Kind.Mill, Kind.LumberCamp, Kind.MiningCamp, Kind.Barracks];
const LATE_MEDIEVAL_WORKS = [Kind.ArcheryRange, Kind.Stable, Kind.Blacksmith];

function tech(
  name: string,
  at: number,
  age: number,
  cost: Cost,
  seconds: number,
  about: string,
  effects: readonly Effect[],
  requires: readonly number[] = [],
): Tech {
  return { name, about, cost, seconds, at, age, requires, reform: false, needs: 0, among: [], effects };
}

function reform(
  name: string,
  age: number,
  cost: Cost,
  seconds: number,
  among: readonly number[],
  about: string,
  effects: readonly Effect[],
): Tech {
  return { name, about, cost, seconds, at: Kind.TownCentre, age, requires: [], reform: true, needs: 2, among, effects };
}

export const TechId = {
  OpenFields: 0,
  KnightService: 1,
  TownCharters: 2,
  PaidRetinues: 3,
  StandingCompanies: 4,
  Gunfounding: 5,
  Wheelbarrow: 6,
  HeavyPlough: 7,
  HorseCollar: 8,
  FellingAxes: 9,
  Sawmills: 10,
  FireSetting: 11,
  DrainageAdits: 12,
  SteeledEdges: 13,
  BlastFurnace: 14,
  MailHauberks: 15,
  CoatOfPlates: 16,
  BodkinPoints: 17,
  Longbows: 18,
  LongSpears: 19,
  Pikes: 20,
  CouchedLance: 21,
  ArrowLoops: 22,
} as const;

//                                              food wood stone gold  seconds
export const TECHS: readonly Tech[] = [
  // ---- Reforms: two offered in each age, one to be chosen ----------------------
  reform(
    'Open fields',
    Age.EarlyMedieval,
    [400, 0, 0, 150],
    60,
    HIGH_MEDIEVAL_WORKS,
    'The village ploughs its strips in common under the manor, and more land comes under the plough. Farms yield a fifth faster.',
    [{ gather: [Terrain.Field], percent: 20 }],
  ),
  reform(
    'Knight service',
    Age.EarlyMedieval,
    [400, 0, 0, 150],
    60,
    HIGH_MEDIEVAL_WORKS,
    'Land is held in return for armed service, so there are always men owed to the lord. Soldiers train a fifth faster.',
    [{ change: 'seconds', of: SOLDIERS, percent: -20 }],
  ),
  reform(
    'Town charters',
    Age.HighMedieval,
    [800, 0, 0, 400],
    80,
    LATE_MEDIEVAL_WORKS,
    'Chartered boroughs with their own markets and guilds draw in trade and craftsmen. Gold and stone are worked a quarter faster.',
    [{ gather: [Terrain.Gold, Terrain.Stone], percent: 25 }],
  ),
  reform(
    'Paid retinues',
    Age.HighMedieval,
    [800, 0, 0, 400],
    80,
    LATE_MEDIEVAL_WORKS,
    'Captains contract to bring companies for wages instead of feudal duty: fewer, better soldiers. Soldiers have a tenth more hit points.',
    [{ change: 'hp', of: SOLDIERS, percent: 10 }],
  ),
  reform(
    'Standing companies',
    Age.LateMedieval,
    [1200, 0, 0, 800],
    100,
    LATE_MEDIEVAL_WORKS,
    'Permanent companies kept in peace and war, as France raised in 1445. Soldiers cost 15 per cent less.',
    [{ cost: -15, of: SOLDIERS }],
  ),
  reform(
    'Gunfounding',
    Age.LateMedieval,
    [1200, 0, 0, 800],
    100,
    LATE_MEDIEVAL_WORKS,
    'Cast bronze barrels and corned powder make guns that can be trusted. Handgunners hit a fifth harder and shoot a tile further.',
    [
      { change: 'damage', of: { tags: Tag.Gunpowder }, percent: 20 },
      { change: 'range', of: { tags: Tag.Gunpowder }, add: ONE },
    ],
  ),

  // ---- The town centre ---------------------------------------------------------
  tech(
    'Wheelbarrow',
    Kind.TownCentre,
    Age.HighMedieval,
    [150, 100, 0, 0],
    40,
    'One wheel and two handles, in use on English building sites by the 1200s. Villagers carry 5 more and walk a tenth faster.',
    [
      { change: 'carries', of: { kinds: [Kind.Villager] }, add: 5 },
      { change: 'speed', of: { kinds: [Kind.Villager] }, percent: 10 },
    ],
  ),

  // ---- The mill ----------------------------------------------------------------
  tech(
    'Heavy plough',
    Kind.Mill,
    Age.EarlyMedieval,
    [0, 125, 0, 0],
    30,
    'A wheeled plough with a mouldboard turns the heavy northern soils the scratch plough could not. Farms yield 15 per cent faster.',
    [{ gather: [Terrain.Field], percent: 15 }],
  ),
  tech(
    'Horse collar',
    Kind.Mill,
    Age.HighMedieval,
    [0, 200, 0, 50],
    40,
    'A padded collar lets a horse pull with its shoulders, not its windpipe, and a horse ploughs faster than an ox. Farms yield 15 per cent faster.',
    [{ gather: [Terrain.Field], percent: 15 }],
    [TechId.HeavyPlough],
  ),

  // ---- The lumber camp ---------------------------------------------------------
  tech(
    'Felling axes',
    Kind.LumberCamp,
    Age.EarlyMedieval,
    [100, 50, 0, 0],
    30,
    'Long-hafted axes with a narrow steeled bit, made for felling and nothing else. Wood is cut 15 per cent faster.',
    [{ gather: [Terrain.Forest], percent: 15 }],
  ),
  tech(
    'Sawmills',
    Kind.LumberCamp,
    Age.LateMedieval,
    [150, 100, 0, 100],
    45,
    'A water wheel drives the saw, as Villard de Honnecourt drew about 1250. Wood is cut 20 per cent faster.',
    [{ gather: [Terrain.Forest], percent: 20 }],
    [TechId.FellingAxes],
  ),

  // ---- The mining camp ---------------------------------------------------------
  tech(
    'Fire-setting',
    Kind.MiningCamp,
    Age.EarlyMedieval,
    [100, 75, 0, 0],
    30,
    'A fire built against the rock face and quenched cracks stone that picks cannot. Stone and gold are worked 15 per cent faster.',
    [{ gather: [Terrain.Stone, Terrain.Gold], percent: 15 }],
  ),
  tech(
    'Drainage adits',
    Kind.MiningCamp,
    Age.LateMedieval,
    [200, 150, 0, 0],
    45,
    'Tunnels driven in from the hillside drain the workings, so the miners can follow the vein down. Stone and gold are worked 20 per cent faster.',
    [{ gather: [Terrain.Stone, Terrain.Gold], percent: 20 }],
    [TechId.FireSetting],
  ),

  // ---- The blacksmith ----------------------------------------------------------
  tech(
    'Steeled edges',
    Kind.Blacksmith,
    Age.HighMedieval,
    [150, 0, 0, 75],
    40,
    'A strip of hard steel welded to an iron blade takes and keeps an edge. Spears, swords and lances do 1 more damage.',
    [{ change: 'damage', of: BLADES, add: 1 }],
  ),
  tech(
    'Blast furnace',
    Kind.Blacksmith,
    Age.LateMedieval,
    [250, 0, 0, 150],
    55,
    'Water-blown furnaces smelt iron by the ton instead of the bloom. Spears, swords and lances do 2 more damage.',
    [{ change: 'damage', of: BLADES, add: 2 }],
    [TechId.SteeledEdges],
  ),
  tech(
    'Mail hauberks',
    Kind.Blacksmith,
    Age.HighMedieval,
    [150, 0, 0, 75],
    40,
    'Knee-length coats of riveted rings for those who fight hand to hand. Soldiers take 1 less from blades.',
    [{ change: 'meleeArmor', of: SOLDIERS, add: 1 }],
  ),
  tech(
    'Coat of plates',
    Kind.Blacksmith,
    Age.LateMedieval,
    [250, 0, 0, 150],
    55,
    'Iron plates riveted inside a cloth coat, worn over mail from about 1250. Soldiers take 1 less from blades and from arrows.',
    [
      { change: 'meleeArmor', of: SOLDIERS, add: 1 },
      { change: 'rangedArmor', of: SOLDIERS, add: 1 },
    ],
    [TechId.MailHauberks],
  ),
  tech(
    'Bodkin points',
    Kind.Blacksmith,
    Age.HighMedieval,
    [100, 100, 0, 50],
    40,
    'Narrow four-sided arrowheads that punch through mail where a broadhead would turn. Arrows and bolts do 1 more damage, from towers too.',
    [{ change: 'damage', of: BOWS, add: 1 }],
  ),

  // ---- The archery range -------------------------------------------------------
  tech(
    'Longbows',
    Kind.ArcheryRange,
    Age.LateMedieval,
    [150, 200, 0, 100],
    50,
    'Yew staves as tall as the archer, drawn to the ear by men trained from boyhood. Archers become longbowmen: a tile more range and 1 more damage.',
    [
      { change: 'range', of: { kinds: [Kind.Archer] }, add: ONE },
      { change: 'damage', of: { kinds: [Kind.Archer] }, add: 1 },
      { rename: Kind.Archer, to: 'longbowman' },
    ],
  ),

  // ---- The barracks ------------------------------------------------------------
  tech(
    'Long spears',
    Kind.Barracks,
    Age.HighMedieval,
    [150, 100, 0, 0],
    40,
    'Spears of twelve feet and more, and the drill to hold a line with them. Spearmen have 15 more hit points and do 4 more to cavalry.',
    [
      { change: 'hp', of: { kinds: [Kind.Spearman] }, add: 15 },
      { bonus: 4, of: { kinds: [Kind.Spearman] }, against: Tag.Cavalry },
    ],
  ),
  tech(
    'Pikes',
    Kind.Barracks,
    Age.LateMedieval,
    [250, 150, 0, 100],
    55,
    'Eighteen-foot pikes in deep blocks, as the Swiss and Scots carried against knights. Spearmen become pikemen: 15 more hit points, 6 more to cavalry and a longer reach.',
    [
      { change: 'hp', of: { kinds: [Kind.Spearman] }, add: 15 },
      { bonus: 6, of: { kinds: [Kind.Spearman] }, against: Tag.Cavalry },
      { change: 'range', of: { kinds: [Kind.Spearman] }, add: fromRatio(1, 4) },
      { rename: Kind.Spearman, to: 'pikeman' },
    ],
    [TechId.LongSpears],
  ),

  // ---- The stable --------------------------------------------------------------
  tech(
    'Couched lance',
    Kind.Stable,
    Age.HighMedieval,
    [150, 0, 0, 100],
    45,
    'The lance tucked under the arm, so that horse and rider strike as one. Horsemen and knights do 6 more on a charge.',
    [{ change: 'charge', of: { tags: Tag.Cavalry }, add: 6 }],
  ),

  // ---- The watchtower ----------------------------------------------------------
  tech(
    'Arrow loops',
    Kind.Watchtower,
    Age.HighMedieval,
    [100, 0, 100, 0],
    40,
    'Narrow slits splayed on the inside give an archer cover and a wide field. Towers and town centres shoot a tile further and see two tiles further.',
    [
      { change: 'range', of: { kinds: [Kind.Watchtower, Kind.TownCentre] }, add: ONE },
      { change: 'sight', of: { kinds: [Kind.Watchtower, Kind.TownCentre] }, add: 2 },
    ],
  ),
];

/** Research in a building's queue is stored as this plus the technology's number; units are stored as their kind plus 1. */
export const QUEUED_TECH = 128;

// ---- What a player's research has made of their units ------------------------

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function falls(who: Who, kind: number, type: EntityType): boolean {
  return (who.kinds?.includes(kind) ?? false) || (who.tags !== undefined && (type.tags & who.tags) !== 0);
}

/**
 * Works out a player's units and buildings afresh from the starting figures
 * and everything the player has researched, and their gathering speeds with
 * them. Additions are applied first, then percentages of the starting figure,
 * so the order things were researched in makes no difference.
 */
export function rebuildTypes(world: World, player: number): void {
  const types: Mutable<EntityType>[] = ENTITY_TYPES.map((base) => ({
    ...base,
    cost: [...base.cost] as [number, number, number, number],
    bonuses: base.bonuses.map(([tags, extra]) => [tags, extra] as const),
  }));
  const percents: Partial<Record<Stat, number>>[] = ENTITY_TYPES.map(() => ({}));
  const costPercent = new Array<number>(ENTITY_TYPES.length).fill(0);
  const gather = world.gatherBonus.subarray(player * TERRAINS, (player + 1) * TERRAINS);
  gather.fill(0);

  for (let id = 0; id < TECHS.length; id++) {
    if (world.researched[player * TECHS.length + id] === 0) continue;
    for (const effect of TECHS[id]!.effects) {
      if ('gather' in effect) {
        for (const terrain of effect.gather) gather[terrain] = gather[terrain]! + effect.percent;
        continue;
      }
      if ('rename' in effect) {
        types[effect.rename]!.name = effect.to;
        continue;
      }
      for (let kind = 0; kind < types.length; kind++) {
        const type = types[kind]!;
        if (!falls(effect.of, kind, ENTITY_TYPES[kind]!)) continue;
        if ('change' in effect) {
          type[effect.change] += effect.add ?? 0;
          percents[kind]![effect.change] = (percents[kind]![effect.change] ?? 0) + (effect.percent ?? 0);
        } else if ('bonus' in effect) {
          const at = type.bonuses.findIndex(([tags]) => tags === effect.against);
          const bonuses = [...type.bonuses];
          if (at === -1) bonuses.push([effect.against, effect.bonus]);
          else bonuses[at] = [effect.against, bonuses[at]![1] + effect.bonus];
          type.bonuses = bonuses;
        } else {
          costPercent[kind] = costPercent[kind]! + effect.cost;
        }
      }
    }
  }
  for (let kind = 0; kind < types.length; kind++) {
    const type = types[kind]!;
    const base = ENTITY_TYPES[kind]!;
    for (const stat of Object.keys(percents[kind]!) as Stat[]) {
      type[stat] += idiv(base[stat] * percents[kind]![stat]!, 100);
    }
    if (costPercent[kind] !== 0) {
      type.cost = base.cost.map((amount) => amount + idiv(amount * costPercent[kind]!, 100)) as [number, number, number, number];
    }
    if (type.seconds < 1) type.seconds = 1;
  }
  world.types[player] = types;
}

/** How many terrains gathering speeds are kept for. */
export const TERRAINS = 9;

/**
 * Makes a finished piece of research take effect: the player's figures are
 * worked out again, and everything they already have in the field is brought
 * up to them. A unit keeps the wounds it had: only the extra hit points are
 * added.
 */
function takeEffect(world: World, player: number, id: number): void {
  const before = world.types[player]!;
  world.researched[player * TECHS.length + id] = 1;
  if (TECHS[id]!.reform) world.age[player] = TECHS[id]!.age + 1;
  rebuildTypes(world, player);
  const after = world.types[player]!;
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0 || world.owner[slot] !== player) continue;
    const kind = world.entityType[slot]!;
    const gained = after[kind]!.hp - before[kind]!.hp;
    if (gained > 0 && (world.mobile[slot] === 1 || world.built[slot] === 1)) world.hp[slot] = world.hp[slot]! + gained;
    if (world.hp[slot]! > after[kind]!.hp) world.hp[slot] = after[kind]!.hp;
    if (world.mobile[slot] === 1) world.speed[slot] = perSecondToPerTick(after[kind]!.speed, world.config.tickRate);
  }
}

// ---- Researching -------------------------------------------------------------

/** Whether a technology is waiting or under way in any of a player's buildings. */
export function isQueued(world: World, player: number, id: number): boolean {
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0 || world.mobile[slot] === 1 || world.owner[slot] !== player) continue;
    for (let k = 0; k < world.trainLength[slot]!; k++) {
      if (world.trainQueue[slot * QUEUE + k] === QUEUED_TECH + id) return true;
    }
  }
  return false;
}

const QUEUE = TRAIN_QUEUE_LENGTH;

/** How many different kinds among a list of buildings a player has standing and finished. */
function kindsStanding(world: World, player: number, among: readonly number[]): number {
  const seen = new Set<number>();
  for (let slot = 0; slot < world.highWater; slot++) {
    if (world.alive[slot] === 0 || world.mobile[slot] === 1 || world.owner[slot] !== player || world.built[slot] === 0) continue;
    if (among.includes(world.entityType[slot]!)) seen.add(world.entityType[slot]!);
  }
  return seen.size;
}

/**
 * Why a player cannot research something just now, in words for the player,
 * or null if they can (leaving aside whether they can pay for it).
 */
export function whyNot(world: World, player: number, id: number): string | null {
  const tech = TECHS[id];
  if (tech === undefined) return 'no such technology';
  if (world.researched[player * TECHS.length + id] === 1) return 'already researched';
  if (isQueued(world, player, id)) return 'already under way';
  const age = world.age[player]!;
  if (tech.reform) {
    if (age > tech.age) return 'that age is past';
    if (age < tech.age) return 'not yet';
    // Only one reform at a time: choosing one is choosing against the other.
    for (let other = 0; other < TECHS.length; other++) {
      if (other !== id && TECHS[other]!.reform && isQueued(world, player, other)) return 'another reform is under way';
    }
    if (kindsStanding(world, player, tech.among) < tech.needs) {
      const names = tech.among.map((kind) => ENTITY_TYPES[kind]!.name);
      return `needs ${tech.needs} of: ${names.join(', ')}`;
    }
    return null;
  }
  if (age < tech.age) return `needs the ${AGE_NAMES[tech.age]} age`;
  for (const first of tech.requires) {
    if (world.researched[player * TECHS.length + first] === 0) return `needs ${TECHS[first]!.name}`;
  }
  return null;
}

/** Adds a technology to a building's queue and takes its cost. Returns false if it cannot be done. */
export function queueResearch(world: World, player: number, building: EntityId, id: number): boolean {
  if (!Number.isInteger(id) || id < 0 || id >= TECHS.length || !world.isAlive(building)) return false;
  const slot = entityIndex(building);
  const tech = TECHS[id]!;
  if (world.mobile[slot] === 1 || world.owner[slot] !== player || world.built[slot] === 0) return false;
  if (world.entityType[slot] !== tech.at || whyNot(world, player, id) !== null) return false;
  const waiting = world.trainLength[slot]!;
  if (waiting >= QUEUE || !world.canAfford(player, tech.cost)) return false;
  world.pay(player, tech.cost);
  world.trainQueue[slot * QUEUE + waiting] = QUEUED_TECH + id;
  world.trainLength[slot] = waiting + 1;
  return true;
}

/** Ticks a technology takes to research. */
export function researchTicks(id: number, tickRate: number): number {
  return Math.max(1, TECHS[id]!.seconds * tickRate);
}

/** Called by production when a building has finished researching the technology at the head of its queue. */
export function finishResearch(world: World, building: number, id: number): void {
  takeEffect(world, world.owner[building]!, id);
}

/** What something in a building's queue costs, whether a unit or a technology, for refunds. */
export function queuedCost(world: World, player: number, queued: number): readonly number[] {
  if (queued >= QUEUED_TECH) return TECHS[queued - QUEUED_TECH]?.cost ?? NOTHING;
  return world.types[player]![queued - 1]?.cost ?? NOTHING;
}

const NOTHING: readonly number[] = new Array<number>(RESOURCE_COUNT).fill(0);
