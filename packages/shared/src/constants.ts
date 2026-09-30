import type { Rect, Vec2 } from './types';

/** Arena size in world units. */
export const ARENA_WIDTH = 1600;
export const ARENA_HEIGHT = 900;

export const PLAYER_RADIUS = 18;

/** Base movement speed in world units per second. */
export const BASE_SPEED = 230;
export const SPRINT_MULTIPLIER = 1.6;

export const STAMINA_MAX = 100;
export const STAMINA_DRAIN_PER_S = 35;
export const STAMINA_REGEN_PER_S = 22;
/** Minimum stamina required to start sprinting (hysteresis so sprint does not flicker at 0). */
export const STAMINA_SPRINT_MIN = 10;

/** After a tag / immunity trigger, immunity duration. */
export const TAG_COOLDOWN_MS = 3000;
/** Grace period immunity after a vaccine is consumed to prevent immediate re-infection. */
export const VACCINE_IMMUNITY_MS = 3000;

/** Authoritative simulation rate. */
export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;
/** Snapshot broadcast rate. */
export const SNAPSHOT_RATE = 20;
export const SNAPSHOT_EVERY = TICK_RATE / SNAPSHOT_RATE;

/** How far in the past remote players are rendered (interpolation buffer). */
export const INTERP_DELAY_MS = 100;

export const COUNTDOWN_MS = 3000;
/** Total match duration: 10 minutes (600,000 ms). */
export const GAME_DURATION_MS = 10 * 60 * 1000;
export const ROUND_MS = GAME_DURATION_MS;

/** Interval between private decision offers: 2 minutes (120,000 ms). */
export const DECISION_INTERVAL_MS = 2 * 60 * 1000;
/** Time limit for the chosen player to make a private decision (15 seconds). */
export const DECISION_TIMEOUT_MS = 15_000;

/** Duration of the game-over screen before returning to lobby (12 seconds). */
export const GAMEOVER_MS = 12_000;
export const PODIUM_MS = GAMEOVER_MS;

export const MAX_PLAYERS_PER_ROOM = 8;
export const MAX_NICKNAME_LENGTH = 16;
export const ROOM_CODE_LENGTH = 4;

/** Server keeps at most this many unprocessed inputs per player (one is consumed per tick). */
export const INPUT_QUEUE_MAX = 8;

/** Distinct player colors on a dark arena for Survivors. */
export const PLAYER_COLORS = [
  '#38bdf8',
  '#4ade80',
  '#facc15',
  '#c084fc',
  '#fb923c',
  '#f472b6',
  '#2dd4bf',
  '#a3e635',
] as const;

/** Zombie visual theme colors. */
export const ZOMBIE_COLOR = '#22c55e';
export const ZOMBIE_GLOW = 'rgba(34, 197, 94, 0.9)';

/** Survivor shield visual theme colors. */
export const SURVIVOR_SHIELD_COLOR = '#38bdf8';
export const SURVIVOR_SHIELD_GLOW = 'rgba(56, 189, 248, 0.85)';

export const OBSTACLES: readonly Rect[] = [
  { x: 380, y: 200, w: 120, h: 260 },
  { x: 1100, y: 440, w: 120, h: 260 },
  { x: 700, y: 90, w: 200, h: 90 },
  { x: 700, y: 720, w: 200, h: 90 },
];

export const SPAWN_POINTS: readonly Vec2[] = [
  { x: 200, y: 200 },
  { x: 1400, y: 700 },
  { x: 1400, y: 200 },
  { x: 200, y: 700 },
  { x: 800, y: 450 },
  { x: 200, y: 450 },
  { x: 1400, y: 450 },
  { x: 620, y: 620 },
];
