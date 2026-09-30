import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BASE_SPEED,
  COUNTDOWN_MS,
  OBSTACLES,
  PLAYER_COLORS,
  PLAYER_RADIUS,
  PODIUM_MS,
  ROUND_MS,
  SPAWN_POINTS,
  SPRINT_MULTIPLIER,
  STAMINA_DRAIN_PER_S,
  STAMINA_MAX,
  STAMINA_REGEN_PER_S,
  STAMINA_SPRINT_MIN,
  TAG_COOLDOWN_MS,
} from './constants';

import type {
  MovableBody,
  PlayerInput,
  PodiumEntry,
  Rect,
  RoomState,
  SimEvent,
  SimOptions,
  SimPlayer,
  Vec2,
} from './types';

const INITIAL_INFECTION_MS = 60_000;

export function defaultSimOptions(): SimOptions {
  return {
    countdownMs: COUNTDOWN_MS,
    roundMs: ROUND_MS,
    podiumMs: PODIUM_MS,
    tagCooldownMs: TAG_COOLDOWN_MS,
    spawnPoints: SPAWN_POINTS,
    obstacles: OBSTACLES,
    rng: Math.random,
  };
}

export function createRoomState(): RoomState {
  return {
    phase: 'waiting',
    phaseRemainingMs: 0,
    players: {},
    itId: null,
    immunityRemainingMs: 0,
    roundNumber: 0,
    podium: [],
    nextJoinOrder: 0,
  };
}

export function idleInput(): PlayerInput {
  return {
    seq: 0,
    moveX: 0,
    moveY: 0,
    sprint: false,
  };
}

export function activePlayers(state: RoomState): SimPlayer[] {
  return Object.values(state.players).filter(
    (player) => !player.spectator,
  );
}

export function addPlayer(
  state: RoomState,
  id: string,
  nickname: string,
  options: SimOptions,
): SimPlayer {
  const joinOrder = state.nextJoinOrder++;

  const spawn =
    options.spawnPoints[joinOrder % options.spawnPoints.length] ?? {
      x: 100,
      y: 100,
    };

  const player: SimPlayer = {
    id,
    nickname,
    colorIndex: joinOrder % PLAYER_COLORS.length,
    x: spawn.x,
    y: spawn.y,
    stamina: STAMINA_MAX,
    sprinting: false,

    /*
     * New players can join only while the room
     * is in the waiting phase.
     *
     * Once the game has started, server.ts
     * rejects additional joins.
     */
    spectator:
      state.phase === 'playing' ||
      state.phase === 'podium',

    role: 'survivor',
    hasVaccine: false,
    scoreMs: 0,
    input: idleInput(),
    lastSeq: 0,
    joinOrder,
  };

  state.players[id] = player;

  return player;
}

export function removePlayer(
  state: RoomState,
  id: string,
): void {
  const player = state.players[id];

  if (!player) return;

  delete state.players[id];

  if (state.itId === id) {
    const remaining = activePlayers(state);

    let nearest: SimPlayer | null = null;
    let nearestD2 = Infinity;

    for (const candidate of remaining) {
      const dx = candidate.x - player.x;
      const dy = candidate.y - player.y;
      const d2 = dx * dx + dy * dy;

      if (d2 < nearestD2) {
        nearestD2 = d2;
        nearest = candidate;
      }
    }

    state.itId = nearest ? nearest.id : null;
  }
}

export function clampMagnitude(
  x: number,
  y: number,
): Vec2 {
  const magnitude = Math.hypot(x, y);

  if (magnitude <= 1) {
    return { x, y };
  }

  return {
    x: x / magnitude,
    y: y / magnitude,
  };
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveCircleRect(
  x: number,
  y: number,
  radius: number,
  rect: Rect,
): Vec2 | null {
  const closestX = clamp(
    x,
    rect.x,
    rect.x + rect.w,
  );

  const closestY = clamp(
    y,
    rect.y,
    rect.y + rect.h,
  );

  const dx = x - closestX;
  const dy = y - closestY;

  const d2 = dx * dx + dy * dy;

  if (d2 >= radius * radius) {
    return null;
  }

  if (d2 > 0) {
    const distance = Math.sqrt(d2);

    const push =
      (radius - distance) / distance;

    return {
      x: x + dx * push,
      y: y + dy * push,
    };
  }

  const left = x - rect.x;
  const right = rect.x + rect.w - x;
  const top = y - rect.y;
  const bottom = rect.y + rect.h - y;

  const least = Math.min(
    left,
    right,
    top,
    bottom,
  );

  if (least === left) {
    return {
      x: rect.x - radius,
      y,
    };
  }

  if (least === right) {
    return {
      x: rect.x + rect.w + radius,
      y,
    };
  }

  if (least === top) {
    return {
      x,
      y: rect.y - radius,
    };
  }

  return {
    x,
    y: rect.y + rect.h + radius,
  };
}

export function stepBody(
  body: MovableBody,
  dtMs: number,
  obstacles: readonly Rect[],
): void {
  const dt = dtMs / 1000;

  const move = clampMagnitude(
    body.input.moveX,
    body.input.moveY,
  );

  const moving =
    move.x !== 0 || move.y !== 0;

  if (body.input.sprint && moving) {
    body.sprinting = body.sprinting
      ? body.stamina > 0
      : body.stamina >= STAMINA_SPRINT_MIN;
  } else {
    body.sprinting = false;
  }

  if (body.sprinting) {
    body.stamina = Math.max(
      0,
      body.stamina -
        STAMINA_DRAIN_PER_S * dt,
    );
  } else {
    body.stamina = Math.min(
      STAMINA_MAX,
      body.stamina +
        STAMINA_REGEN_PER_S * dt,
    );
  }

  const speed =
    BASE_SPEED *
    (body.sprinting
      ? SPRINT_MULTIPLIER
      : 1);

  body.x += move.x * speed * dt;
  body.y += move.y * speed * dt;

  body.x = clamp(
    body.x,
    PLAYER_RADIUS,
    ARENA_WIDTH - PLAYER_RADIUS,
  );

  body.y = clamp(
    body.y,
    PLAYER_RADIUS,
    ARENA_HEIGHT - PLAYER_RADIUS,
  );

  for (const rect of obstacles) {
    const resolved = resolveCircleRect(
      body.x,
      body.y,
      PLAYER_RADIUS,
      rect,
    );

    if (resolved) {
      body.x = resolved.x;
      body.y = resolved.y;
    }
  }
}

function computePodium(
  state: RoomState,
): PodiumEntry[] {
  return activePlayers(state)
    .slice()
    .sort(
      (a, b) =>
        b.scoreMs - a.scoreMs,
    )
    .map((player) => ({
      id: player.id,
      nickname: player.nickname,
      colorIndex: player.colorIndex,
      scoreMs: player.scoreMs,
    }));
}

/*
 * Starts the actual countdown.
 *
 * IMPORTANT:
 * This function is NOT called automatically
 * when the second player joins.
 *
 * The server's Room.startGame() controls when
 * this happens.
 */
function startCountdown(
  state: RoomState,
  options: SimOptions,
  events: SimEvent[],
): void {
  state.phase = 'countdown';
  state.phaseRemainingMs =
    options.countdownMs;

  state.roundNumber += 1;
  state.podium = [];

  const players = Object.values(
    state.players,
  ).sort(
    (a, b) =>
      a.joinOrder - b.joinOrder,
  );

  players.forEach(
    (player, index) => {
      player.spectator = false;

      const spawn =
        options.spawnPoints[
          index %
            options.spawnPoints.length
        ];

      if (spawn) {
        player.x = spawn.x;
        player.y = spawn.y;
      }

      player.stamina = STAMINA_MAX;
      player.sprinting = false;
      player.scoreMs = 0;

      player.role = 'survivor';
      player.hasVaccine = false;
    },
  );

  const chosen =
    players.length > 0
      ? players[
          Math.floor(
            options.rng() *
              players.length,
          )
        ]
      : undefined;

  state.itId = chosen
    ? chosen.id
    : null;

  if (chosen) {
    chosen.role = 'zombie';
  }

  state.immunityRemainingMs = 0;

  events.push({
    type: 'phase',
    phase: 'countdown',
  });
}

function backToWaiting(
  state: RoomState,
  events: SimEvent[],
): void {
  state.phase = 'waiting';
  state.phaseRemainingMs = 0;
  state.itId = null;
  state.immunityRemainingMs = 0;

  events.push({
    type: 'phase',
    phase: 'waiting',
  });
}

export function startGame(
  state: RoomState,
  options: SimOptions,
): SimEvent[] {
  if (state.phase !== 'waiting') {
    return [];
  }

  if (activePlayers(state).length < 2) {
    return [];
  }

  const events: SimEvent[] = [];

  startCountdown(
    state,
    options,
    events,
  );

  return events;
}

export function stepRoom(
  state: RoomState,
  dtMs: number,
  options: SimOptions,
): SimEvent[] {
  const events: SimEvent[] = [];

  const active =
    activePlayers(state);

  switch (state.phase) {
    /*
     * LOBBY
     *
     * IMPORTANT:
     * Do NOT start the game here.
     *
     * The host must explicitly press
     * START GAME.
     */
    case 'waiting': {
      /*
       * Players stay completely still in the
       * lobby. No countdown is started here.
       */
      break;
    }

    case 'countdown': {
      state.phaseRemainingMs -= dtMs;

      if (
        Object.keys(state.players)
          .length < 2
      ) {
        backToWaiting(
          state,
          events,
        );
        break;
      }

      if (
        state.phaseRemainingMs <= 0
      ) {
        state.phase = 'playing';

        state.phaseRemainingMs =
          options.roundMs;

        state.immunityRemainingMs =
          options.tagCooldownMs;

        events.push({
          type: 'phase',
          phase: 'playing',
        });
      }

      break;
    }

    case 'playing': {
      if (active.length < 2) {
        backToWaiting(
          state,
          events,
        );
        break;
      }

      for (const player of active) {
        stepBody(
          player,
          dtMs,
          options.obstacles,
        );
      }

      for (const player of active) {
        if (
          player.role ===
          'survivor'
        ) {
          player.scoreMs += dtMs;
        }
      }

      state.immunityRemainingMs =
        Math.max(
          0,
          state.immunityRemainingMs -
            dtMs,
        );

      const elapsedMs =
        options.roundMs -
        state.phaseRemainingMs;

      const infectionWindowActive =
        elapsedMs <
        INITIAL_INFECTION_MS;

      /*
       * VACCINE
       *
       * A survivor with a vaccine can touch
       * a zombie and turn that zombie back
       * into a survivor.
       */
      for (const survivor of active) {
        if (
          survivor.role !==
            'survivor' ||
          !survivor.hasVaccine
        ) {
          continue;
        }

        for (const zombie of active) {
          if (
            zombie.id ===
            survivor.id
          ) {
            continue;
          }

          if (
            zombie.role !==
            'zombie'
          ) {
            continue;
          }

          const dx =
            survivor.x -
            zombie.x;

          const dy =
            survivor.y -
            zombie.y;

          const reach =
            PLAYER_RADIUS * 2;

          if (
            dx * dx +
              dy * dy <=
            reach * reach
          ) {
            zombie.role =
              'survivor';

            survivor.hasVaccine =
              false;

            break;
          }
        }
      }

      /*
       * INFECTION
       *
       * Zombie infection is active only
       * during the first 60 seconds.
       */
      if (infectionWindowActive) {
        for (const zombie of active) {
          if (
            zombie.role !==
            'zombie'
          ) {
            continue;
          }

          for (const survivor of active) {
            if (
              survivor.id ===
              zombie.id
            ) {
              continue;
            }

            if (
              survivor.role !==
              'survivor'
            ) {
              continue;
            }

            if (
              survivor.hasVaccine
            ) {
              continue;
            }

            const dx =
              survivor.x -
              zombie.x;

            const dy =
              survivor.y -
              zombie.y;

            const reach =
              PLAYER_RADIUS * 2;

            const touching =
              dx * dx +
                dy * dy <=
              reach * reach;

            if (touching) {
              survivor.role =
                'zombie';

              break;
            }
          }
        }
      }

      /*
       * IMMEDIATE ZOMBIE WIN
       *
       * If every active player is infected,
       * end the round immediately.
       */
      const survivorsRemaining =
        active.some(
          (player) =>
            player.role ===
            'survivor',
        );

      if (!survivorsRemaining) {
        state.phase = 'podium';

        state.phaseRemainingMs =
          options.podiumMs;

        state.podium =
          computePodium(state);

        state.itId = null;

        events.push({
          type: 'gameOver',
          winner: 'zombies',
        });

        events.push({
          type: 'phase',
          phase: 'podium',
        });

        break;
      }

      /*
       * NORMAL 10-MINUTE END
       */
      state.phaseRemainingMs -=
        dtMs;

      if (
        state.phaseRemainingMs <= 0
      ) {
        state.phase = 'podium';

        state.phaseRemainingMs =
          options.podiumMs;

        state.podium =
          computePodium(state);

        state.itId = null;

        events.push({
          type: 'gameOver',
          winner: 'survivors',
        });

        events.push({
          type: 'phase',
          phase: 'podium',
        });
      }

      break;
    }

    case 'podium': {
      state.phaseRemainingMs -=
        dtMs;

      if (
        state.phaseRemainingMs <= 0
      ) {
        if (
          Object.keys(
            state.players,
          ).length >= 2
        ) {
          /*
           * After a completed round, a new
           * round may begin automatically.
           */
          startCountdown(
            state,
            options,
            events,
          );
        } else {
          backToWaiting(
            state,
            events,
          );
        }
      }

      break;
    }
  }

  return events;
}