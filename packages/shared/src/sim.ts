import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BASE_SPEED,
  COUNTDOWN_MS,
  DECISION_INTERVAL_MS,
  DECISION_TIMEOUT_MS,
  GAMEOVER_MS,
  GAME_DURATION_MS,
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
  VACCINE_IMMUNITY_MS,
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

export function defaultSimOptions(): SimOptions {
  return {
    countdownMs: COUNTDOWN_MS,
    roundMs: ROUND_MS,
    gameDurationMs: GAME_DURATION_MS,
    decisionIntervalMs: DECISION_INTERVAL_MS,
    decisionTimeoutMs: DECISION_TIMEOUT_MS,
    vaccineImmunityMs: VACCINE_IMMUNITY_MS,
    podiumMs: PODIUM_MS,
    gameoverMs: GAMEOVER_MS,
    tagCooldownMs: TAG_COOLDOWN_MS,
    spawnPoints: SPAWN_POINTS,
    obstacles: OBSTACLES,
    rng: Math.random,
  };
}

export function updateRoleCounts(state: RoomState): void {
  let survivors = 0;
  let zombies = 0;

  for (const player of Object.values(state.players)) {
    if (player.spectator) continue;

    if (player.role === 'zombie') {
      zombies += 1;
    } else {
      survivors += 1;
    }
  }

  state.survivorCount = survivors;
  state.zombieCount = zombies;
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
    survivorCount: 0,
    zombieCount: 0,
    nextDecisionRemainingMs: DECISION_INTERVAL_MS,
    activeDecision: null,
    winner: null,
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

/**
 * Players who join during an active round spectate
 * until the next countdown.
 */
export function addPlayer(
  state: RoomState,
  id: string,
  nickname: string,
  options: SimOptions,
): SimPlayer {
  const joinOrder = state.nextJoinOrder++;

  const spawn =
    options.spawnPoints[
      joinOrder % options.spawnPoints.length
    ] ?? { x: 100, y: 100 };

  const player: SimPlayer = {
    id,
    nickname,
    colorIndex: joinOrder % PLAYER_COLORS.length,
    x: spawn.x,
    y: spawn.y,
    stamina: STAMINA_MAX,
    sprinting: false,
    spectator:
      state.phase === 'playing' ||
      state.phase === 'gameover',
    scoreMs: 0,
    input: idleInput(),
    lastSeq: 0,
    joinOrder,
    role: 'survivor',
    vaccines: 0,
    immunityRemainingMs: 0,
  };

  state.players[id] = player;

  updateRoleCounts(state);

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
    state.itId = remaining[0]?.id ?? null;
  }

  if (
    state.activeDecision &&
    state.activeDecision.targetPlayerId === id
  ) {
    state.activeDecision = null;
  }

  updateRoleCounts(state);

  /*
   * If the only Zombie leaves during a game,
   * select a new Zombie so the game can continue.
   */
  if (
    state.phase === 'playing' &&
    state.zombieCount === 0 &&
    state.survivorCount >= 1
  ) {
    const survivors = activePlayers(state).filter(
      (p) => p.role === 'survivor',
    );

    const chosen = survivors[0];

    if (chosen) {
      chosen.role = 'zombie';
      state.itId = chosen.id;
      updateRoleCounts(state);
    }
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

/**
 * Push a circle out of a rectangle.
 * Returns the corrected center, or null if there is no overlap.
 */
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

  // Center is inside the rectangle.
  // Exit through the face with the least penetration.

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

/**
 * Integrate one body for dtMs using its current input.
 */
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
    body.sprinting =
      body.sprinting
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
    const resolved =
      resolveCircleRect(
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

/**
 * Starts the countdown for a new game.
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
  state.winner = null;

  state.activeDecision = null;

  state.nextDecisionRemainingMs =
    options.decisionIntervalMs ??
    DECISION_INTERVAL_MS;

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
      player.vaccines = 0;
      player.immunityRemainingMs = 0;
    },
  );

  /*
   * Exactly one random player becomes
   * the initial Zombie.
   */
  const zombieIndex = Math.floor(
    options.rng() * players.length,
  );

  players.forEach(
    (player, index) => {
      player.role =
        index === zombieIndex
          ? 'zombie'
          : 'survivor';
    },
  );

  state.itId =
    players[zombieIndex]?.id ?? null;

  state.immunityRemainingMs = 0;

  updateRoleCounts(state);

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

  state.winner = null;

  state.activeDecision = null;

  state.nextDecisionRemainingMs = 0;

  updateRoleCounts(state);

  events.push({
    type: 'phase',
    phase: 'waiting',
  });
}

/**
 * Creates a private decision for one eligible Survivor.
 */
function createPrivateDecision(
  state: RoomState,
  options: SimOptions,
  events: SimEvent[],
): void {
  /*
   * Do not create another decision while one
   * is already active.
   */
  if (state.activeDecision) {
    return;
  }

  const eligiblePlayers =
    activePlayers(state).filter(
      (player) =>
        player.role === 'survivor',
    );

  if (eligiblePlayers.length === 0) {
    state.nextDecisionRemainingMs =
      options.decisionIntervalMs ??
      DECISION_INTERVAL_MS;

    return;
  }

  const target =
    eligiblePlayers[
      Math.floor(
        options.rng() *
          eligiblePlayers.length,
      )
    ];

  if (!target) {
    return;
  }

  const timeout =
    options.decisionTimeoutMs ??
    DECISION_TIMEOUT_MS;

  state.activeDecision = {
    eventId:
      `${state.roundNumber}-` +
      `${Date.now()}-` +
      `${target.id}`,

    targetPlayerId: target.id,

    expiresAtMs:
      Date.now() + timeout,
  };

  state.nextDecisionRemainingMs =
    options.decisionIntervalMs ??
    DECISION_INTERVAL_MS;

  events.push({
    type: 'decision_trigger',
  });
}

/**
 * Expires an unanswered private decision.
 */
function updatePrivateDecision(
  state: RoomState,
): void {
  if (!state.activeDecision) {
    return;
  }

  if (
    Date.now() >=
    state.activeDecision.expiresAtMs
  ) {
    state.activeDecision = null;
  }
}

/**
 * Advance the authoritative room simulation.
 *
 * Phases:
 * waiting -> countdown -> playing -> gameover
 */
export function stepRoom(
  state: RoomState,
  dtMs: number,
  options: SimOptions,
): SimEvent[] {
  const events: SimEvent[] = [];

  const active =
    activePlayers(state);

  switch (state.phase) {
    case 'waiting': {
      for (const player of active) {
        stepBody(
          player,
          dtMs,
          options.obstacles,
        );
      }

      if (active.length >= 2) {
        startCountdown(
          state,
          options,
          events,
        );
      }

      break;
    }

    case 'countdown': {
      /*
       * Players remain at their spawn positions
       * during the countdown.
       */
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
          options.gameDurationMs ??
          options.roundMs;

        state.nextDecisionRemainingMs =
          options.decisionIntervalMs ??
          DECISION_INTERVAL_MS;

        state.immunityRemainingMs =
          options.tagCooldownMs;

        state.activeDecision = null;

        updateRoleCounts(state);

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

      /*
       * Move all active players.
       */
      for (const player of active) {
        stepBody(
          player,
          dtMs,
          options.obstacles,
        );
      }

      /*
       * Update player timers and survivor score.
       */
      for (const player of active) {
        player.immunityRemainingMs =
          Math.max(
            0,
            player.immunityRemainingMs -
              dtMs,
          );

        if (
          player.role === 'survivor'
        ) {
          player.scoreMs += dtMs;
        }
      }

      /*
       * Backward-compatible global tag immunity.
       */
      state.immunityRemainingMs =
        Math.max(
          0,
          state.immunityRemainingMs -
            dtMs,
        );

      /*
       * Zombie-Survivor collision.
       */
      const zombies = active.filter(
        (player) =>
          player.role === 'zombie',
      );

      const reach =
        PLAYER_RADIUS * 2;

      const reachSq =
        reach * reach;

      /*
       * Prevent one Survivor from being
       * processed multiple times during the
       * same simulation tick.
       */
      const processedVictims =
        new Set<string>();

      for (const zombie of zombies) {
        for (const survivor of active) {
          if (
            survivor.role !==
            'survivor'
          ) {
            continue;
          }

          if (
            processedVictims.has(
              survivor.id,
            )
          ) {
            continue;
          }

          if (
            survivor.immunityRemainingMs >
            0
          ) {
            continue;
          }

          if (
            state.immunityRemainingMs >
            0
          ) {
            continue;
          }

          const dx =
            survivor.x - zombie.x;

          const dy =
            survivor.y - zombie.y;

          if (
            dx * dx +
              dy * dy <=
            reachSq
          ) {
            const contactX =
              (survivor.x +
                zombie.x) /
              2;

            const contactY =
              (survivor.y +
                zombie.y) /
              2;

            processedVictims.add(
              survivor.id,
            );

            /*
             * VACCINE PROTECTION
             */
            if (
              survivor.vaccines > 0
            ) {
              survivor.vaccines -= 1;

              survivor.immunityRemainingMs =
                options.vaccineImmunityMs ??
                VACCINE_IMMUNITY_MS;

              events.push({
                type: 'infection',
                zombieId: zombie.id,
                victimId:
                  survivor.id,
                x: contactX,
                y: contactY,
                vaccineBlocked: true,
              });
            }

            /*
             * NORMAL INFECTION
             */
            else {
              survivor.role =
                'zombie';

              state.itId =
                survivor.id;

              state.immunityRemainingMs =
                options.tagCooldownMs;

              events.push({
                type: 'infection',
                zombieId: zombie.id,
                victimId:
                  survivor.id,
                x: contactX,
                y: contactY,
                vaccineBlocked: false,
              });

              /*
               * Keep old tag event for
               * compatibility with the
               * existing client.
               */
              events.push({
                type: 'tag',
                oldItId:
                  zombie.id,
                newItId:
                  survivor.id,
                x: contactX,
                y: contactY,
              });
            }
          }
        }
      }

      updateRoleCounts(state);

      /*
       * PRIVATE DECISION TIMER
       *
       * Every 2 minutes, one eligible
       * Survivor gets a private decision.
       */
      updatePrivateDecision(state);

      if (!state.activeDecision) {
        state.nextDecisionRemainingMs -=
          dtMs;

        if (
          state.nextDecisionRemainingMs <=
          0
        ) {
          createPrivateDecision(
            state,
            options,
            events,
          );
        }
      }

      /*
       * Zombies win immediately when
       * there are no Survivors left.
       */
      if (
        state.survivorCount === 0
      ) {
        state.phase = 'gameover';

        state.phaseRemainingMs =
          options.gameoverMs ??
          options.podiumMs ??
          GAMEOVER_MS;

        state.winner = 'zombies';

        state.activeDecision = null;

        state.podium =
          computePodium(state);

        events.push({
          type: 'phase',
          phase: 'gameover',
        });

        break;
      }

      /*
       * Ten-minute timer.
       */
      state.phaseRemainingMs -=
        dtMs;

      if (
        state.phaseRemainingMs <=
        0
      ) {
        state.phase = 'gameover';

        state.phaseRemainingMs =
          options.gameoverMs ??
          options.podiumMs ??
          GAMEOVER_MS;

        state.winner =
          state.survivorCount > 0
            ? 'survivors'
            : 'zombies';

        state.activeDecision = null;

        state.podium =
          computePodium(state);

        events.push({
          type: 'phase',
          phase: 'gameover',
        });

        break;
      }

      break;
    }

    case 'gameover': {
      state.phaseRemainingMs -=
        dtMs;

      if (
        state.phaseRemainingMs <=
        0
      ) {
        if (
          Object.keys(
            state.players,
          ).length >= 2
        ) {
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