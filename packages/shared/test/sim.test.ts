import { describe, expect, it } from 'vitest';
import {
  ARENA_WIDTH,
  BASE_SPEED,
  PLAYER_RADIUS,
  SPRINT_MULTIPLIER,
  STAMINA_MAX,
  STAMINA_SPRINT_MIN,
  TICK_MS,
  addPlayer,
  clampMagnitude,
  createRoomState,
  defaultSimOptions,
  idleInput,
  removePlayer,
  resolveCircleRect,
  stepBody,
  stepRoom,
} from '../src/index';
import type { MovableBody, RoomState, SimEvent, SimOptions } from '../src/index';

function testOptions(overrides: Partial<SimOptions> = {}): SimOptions {
  const roundMs = overrides.roundMs ?? 10_000;
  return {
    ...defaultSimOptions(),
    countdownMs: 100,
    roundMs,
    gameDurationMs: overrides.gameDurationMs ?? roundMs,
    podiumMs: 100,
    gameoverMs: 100,
    tagCooldownMs: 500,
    rng: () => 0, // deterministic: first player (by join order) becomes "it"
    ...overrides,
  };
}

function makeBody(overrides: Partial<MovableBody> = {}): MovableBody {
  return {
    x: 800,
    y: 450,
    stamina: STAMINA_MAX,
    sprinting: false,
    input: idleInput(),
    ...overrides,
  };
}

function run(state: RoomState, ms: number, options: SimOptions): SimEvent[] {
  const events: SimEvent[] = [];
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    events.push(...stepRoom(state, TICK_MS, options));
  }
  return events;
}

/** Step until the predicate holds (checked after every tick) or maxMs elapses. */
function runUntil(
  state: RoomState,
  options: SimOptions,
  predicate: () => boolean,
  maxMs = 30_000,
): SimEvent[] {
  const events: SimEvent[] = [];
  for (let elapsed = 0; elapsed < maxMs; elapsed += TICK_MS) {
    events.push(...stepRoom(state, TICK_MS, options));
    if (predicate()) return events;
  }
  throw new Error('runUntil: predicate never became true');
}

describe('clampMagnitude', () => {
  it('leaves unit and sub-unit vectors untouched', () => {
    expect(clampMagnitude(0.5, 0)).toEqual({ x: 0.5, y: 0 });
    expect(clampMagnitude(0, -1)).toEqual({ x: 0, y: -1 });
  });

  it('normalizes oversized vectors so diagonals are not faster', () => {
    const clamped = clampMagnitude(1, 1);
    expect(Math.hypot(clamped.x, clamped.y)).toBeCloseTo(1, 10);
  });
});

describe('stepBody movement', () => {
  it('moves at BASE_SPEED without sprint', () => {
    const body = makeBody({ input: { seq: 1, moveX: 1, moveY: 0, sprint: false } });
    const startX = body.x;
    for (let i = 0; i < 60; i++) stepBody(body, TICK_MS, []);
    expect(body.x - startX).toBeCloseTo(BASE_SPEED, 5);
  });

  it('moves at sprint speed while stamina lasts', () => {
    const body = makeBody({ input: { seq: 1, moveX: 1, moveY: 0, sprint: true } });
    const startX = body.x;
    for (let i = 0; i < 60; i++) stepBody(body, TICK_MS, []);
    expect(body.x - startX).toBeCloseTo(BASE_SPEED * SPRINT_MULTIPLIER, 5);
    expect(body.stamina).toBeLessThan(STAMINA_MAX);
  });

  it('clamps the body inside the arena', () => {
    const body = makeBody({
      x: ARENA_WIDTH - PLAYER_RADIUS - 1,
      input: { seq: 1, moveX: 1, moveY: 0, sprint: true },
    });
    for (let i = 0; i < 300; i++) stepBody(body, TICK_MS, []);
    expect(body.x).toBe(ARENA_WIDTH - PLAYER_RADIUS);
  });

  it('never exceeds sprint speed even for degenerate inputs', () => {
    const body = makeBody({ input: { seq: 1, moveX: 1, moveY: 1, sprint: true } });
    const start = { x: body.x, y: body.y };
    for (let i = 0; i < 60; i++) stepBody(body, TICK_MS, []);
    const travelled = Math.hypot(body.x - start.x, body.y - start.y);
    expect(travelled).toBeLessThanOrEqual(BASE_SPEED * SPRINT_MULTIPLIER + 1e-6);
  });
});

describe('stamina', () => {
  it('drains while sprinting and regenerates when walking', () => {
    const body = makeBody({ input: { seq: 1, moveX: 1, moveY: 0, sprint: true } });
    for (let i = 0; i < 120; i++) stepBody(body, TICK_MS, []);
    const drained = body.stamina;
    expect(drained).toBeLessThan(STAMINA_MAX);

    body.input = { seq: 2, moveX: 1, moveY: 0, sprint: false };
    for (let i = 0; i < 120; i++) stepBody(body, TICK_MS, []);
    expect(body.stamina).toBeGreaterThan(drained);
  });

  it('cannot start sprinting below the minimum threshold', () => {
    const body = makeBody({
      stamina: STAMINA_SPRINT_MIN - 1,
      input: { seq: 1, moveX: 1, moveY: 0, sprint: true },
    });
    stepBody(body, TICK_MS, []);
    expect(body.sprinting).toBe(false);
  });

  it('keeps sprinting below the threshold until stamina hits zero (hysteresis)', () => {
    const body = makeBody({
      stamina: STAMINA_SPRINT_MIN + 1,
      input: { seq: 1, moveX: 1, moveY: 0, sprint: true },
    });
    stepBody(body, TICK_MS, []);
    expect(body.sprinting).toBe(true);
    body.stamina = STAMINA_SPRINT_MIN - 5;
    stepBody(body, TICK_MS, []);
    expect(body.sprinting).toBe(true);
    body.stamina = 0;
    stepBody(body, TICK_MS, []);
    expect(body.sprinting).toBe(false);
  });
});

describe('resolveCircleRect', () => {
  const rect = { x: 100, y: 100, w: 200, h: 100 };

  it('returns null when there is no overlap', () => {
    expect(resolveCircleRect(50, 50, 10, rect)).toBeNull();
  });

  it('pushes a circle out of a rect edge', () => {
    const resolved = resolveCircleRect(95, 150, 10, rect);
    expect(resolved).not.toBeNull();
    expect(resolved!.x).toBeCloseTo(90, 5);
    expect(resolved!.y).toBe(150);
  });

  it('pushes a fully-contained circle out through the nearest face', () => {
    const resolved = resolveCircleRect(110, 150, 10, rect);
    expect(resolved).toEqual({ x: 90, y: 150 });
  });

  it('blocks walking through an obstacle', () => {
    const body = makeBody({ x: 60, y: 150, input: { seq: 1, moveX: 1, moveY: 0, sprint: false } });
    for (let i = 0; i < 600; i++) stepBody(body, TICK_MS, [rect]);
    expect(body.x).toBeLessThanOrEqual(rect.x - PLAYER_RADIUS + 1e-6);
  });
});

describe('room phases and tag rules', () => {
  it('starts a countdown once two players are present, then plays', () => {
    const options = testOptions();
    const state = createRoomState();
    addPlayer(state, 'a', 'Ada', options);
    expect(stepRoom(state, TICK_MS, options)).toEqual([]);
    expect(state.phase).toBe('waiting');

    addPlayer(state, 'b', 'Bob', options);
    const events = run(state, 200, options);
    expect(events.some((e) => e.type === 'phase' && e.phase === 'countdown')).toBe(true);
    expect(events.some((e) => e.type === 'phase' && e.phase === 'playing')).toBe(true);
    expect(state.phase).toBe('playing');
    expect(state.players['a']!.role).toBe('zombie'); // rng() => 0 picks the first joiner as Patient Zero
    expect(state.players['b']!.role).toBe('survivor');
    expect(state.survivorCount).toBe(1);
    expect(state.zombieCount).toBe(1);
    expect(state.immunityRemainingMs).toBeGreaterThan(0);
  });

  it('infects survivor on contact without vaccine, converting role to zombie', () => {
    const options = testOptions();
    const state = createRoomState();
    addPlayer(state, 'a', 'Ada', options);
    addPlayer(state, 'b', 'Bob', options);
    run(state, 200, options); // through countdown into playing
    run(state, options.tagCooldownMs, options); // burn initial immunity

    const zombie = state.players['a']!;
    const survivor = state.players['b']!;
    expect(zombie.role).toBe('zombie');
    expect(survivor.role).toBe('survivor');
    expect(survivor.vaccines).toBe(0);

    zombie.x = 500;
    zombie.y = 450;
    survivor.x = 500 + PLAYER_RADIUS * 2 - 1;
    survivor.y = 450;

    const events = stepRoom(state, TICK_MS, options);
    const infection = events.find((e) => e.type === 'infection');
    expect(infection).toBeDefined();
    expect(infection).toMatchObject({
      zombieId: 'a',
      victimId: 'b',
      vaccineBlocked: false,
    });
    expect(survivor.role).toBe('zombie');
    expect(state.zombieCount).toBe(2);
    expect(state.survivorCount).toBe(0);
    // Immediate Zombies Win when survivors reach 0
    expect(state.phase).toBe('gameover');
    expect(state.winner).toBe('zombies');
  });

  it('consumes a vaccine on contact, granting immunity and preventing infection', () => {
    const options = testOptions();
    const state = createRoomState();
    addPlayer(state, 'a', 'Ada', options);
    addPlayer(state, 'b', 'Bob', options);
    run(state, 200, options);
    run(state, options.tagCooldownMs, options);

    const zombie = state.players['a']!;
    const survivor = state.players['b']!;
    survivor.vaccines = 1;

    zombie.x = 500;
    zombie.y = 450;
    survivor.x = 500 + PLAYER_RADIUS;
    survivor.y = 450;

    const events = stepRoom(state, TICK_MS, options);
    const infection = events.find((e) => e.type === 'infection');
    expect(infection).toBeDefined();
    expect(infection).toMatchObject({
      zombieId: 'a',
      victimId: 'b',
      vaccineBlocked: true,
    });
    expect(survivor.vaccines).toBe(0);
    expect(survivor.role).toBe('survivor');
    expect(survivor.immunityRemainingMs).toBe(3000);
    expect(state.survivorCount).toBe(1);

    // Overlapping during immunity blocks infection
    const nextEvents = run(state, 500, options);
    expect(nextEvents.filter((e) => e.type === 'infection')).toHaveLength(0);
    expect(survivor.role).toBe('survivor');
  });

  it('scores time NOT being it, and only during play', () => {
    const options = testOptions();
    const state = createRoomState();
    addPlayer(state, 'a', 'Ada', options);
    addPlayer(state, 'b', 'Bob', options);
    run(state, 200, options);

    const playedMs = 1000;
    run(state, playedMs, options);
    expect(state.players['a']!.scoreMs).toBe(0); // "it" scores nothing
    expect(state.players['b']!.scoreMs).toBeGreaterThan(playedMs * 0.9);
  });

  it('ends the round with a gameover phase and winner', () => {
    const options = testOptions({ roundMs: 500 });
    const state = createRoomState();
    addPlayer(state, 'a', 'Ada', options);
    addPlayer(state, 'b', 'Bob', options);
    run(state, 200, options);
    // Park survivor away so survivor is not infected
    state.players['b']!.x = 1500;
    state.players['b']!.y = 800;
    const events = runUntil(state, options, () => state.phase === 'gameover');
    expect(events.some((e) => e.type === 'phase' && e.phase === 'gameover')).toBe(true);
    expect(state.winner).toBe('survivors');
    expect(state.podium[0]!.id).toBe('b');
    expect(state.podium[1]!.id).toBe('a');
  });

  it('promotes mid-round joiners from spectator at the next countdown', () => {
    const options = testOptions({ roundMs: 500 });
    const state = createRoomState();
    addPlayer(state, 'a', 'Ada', options);
    addPlayer(state, 'b', 'Bob', options);
    run(state, 200, options);
    expect(state.phase).toBe('playing');

    const late = addPlayer(state, 'c', 'Cy', options);
    expect(late.spectator).toBe(true);
    expect(state.players['c']!.scoreMs).toBe(0);

    runUntil(state, options, () => state.phase === 'countdown'); // round -> gameover -> countdown
    expect(state.players['c']!.spectator).toBe(false);
  });

  it('returns to waiting when a player leaves mid-round', () => {
    const options = testOptions();
    const state = createRoomState();
    addPlayer(state, 'a', 'Ada', options);
    addPlayer(state, 'b', 'Bob', options);
    run(state, 200, options);
    expect(state.phase).toBe('playing');

    removePlayer(state, 'b');
    const events = stepRoom(state, TICK_MS, options);
    expect(events.some((e) => e.type === 'phase' && e.phase === 'waiting')).toBe(true);
    expect(state.itId).toBeNull();
  });

  it('hands "it" to the nearest player when the chaser disconnects', () => {
    const options = testOptions();
    const state = createRoomState();
    addPlayer(state, 'a', 'Ada', options);
    addPlayer(state, 'b', 'Bob', options);
    addPlayer(state, 'c', 'Cy', options);
    run(state, 200, options);
    expect(state.itId).toBe('a');

    const chaser = state.players['a']!;
    state.players['b']!.x = chaser.x + 50;
    state.players['b']!.y = chaser.y;
    state.players['c']!.x = chaser.x + 500;
    state.players['c']!.y = chaser.y;

    removePlayer(state, 'a');
    expect(state.itId).toBe('b');
  });
});
