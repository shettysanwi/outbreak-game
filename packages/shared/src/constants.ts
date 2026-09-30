import type { Rect, Vec2 } from './types';

export const ARENA_WIDTH = 1200;
export const ARENA_HEIGHT = 700;

export const PLAYER_RADIUS = 18;

export const BASE_SPEED = 180;
export const SPRINT_MULTIPLIER = 1.6;

export const STAMINA_MAX = 100;
export const STAMINA_DRAIN_PER_S = 35;
export const STAMINA_REGEN_PER_S = 20;
export const STAMINA_SPRINT_MIN = 10;

export const COUNTDOWN_MS = 5000;

/*
 * Zombie Survival:
 * 10 minute round
 */
export const ROUND_MS = 10 * 60 * 1000;

export const PODIUM_MS = 8000;

export const TAG_COOLDOWN_MS = 1000;

/*
 * Original project/server constants
 */
export const TICK_MS = 50;

export const SNAPSHOT_EVERY = 2;

export const INPUT_QUEUE_MAX = 120;

export const MAX_PLAYERS_PER_ROOM = 16;

export const ROOM_CODE_LENGTH = 4;

export const MAX_NICKNAME_LENGTH = 16;

export const INTERP_DELAY_MS = 100;

export const PLAYER_COLORS = [
  '#4ade80',
  '#60a5fa',
  '#f472b6',
  '#facc15',
  '#a78bfa',
  '#fb923c',
  '#2dd4bf',
  '#f87171',
];

export const SPAWN_POINTS: readonly Vec2[] = [
  { x: 120, y: 120 },
  { x: 1080, y: 120 },
  { x: 120, y: 580 },
  { x: 1080, y: 580 },
  { x: 600, y: 120 },
  { x: 600, y: 580 },
  { x: 300, y: 350 },
  { x: 900, y: 350 },
];

export const OBSTACLES: readonly Rect[] = [
  {
    x: 250,
    y: 150,
    w: 180,
    h: 40,
  },
  {
    x: 770,
    y: 150,
    w: 180,
    h: 40,
  },
  {
    x: 250,
    y: 510,
    w: 180,
    h: 40,
  },
  {
    x: 770,
    y: 510,
    w: 180,
    h: 40,
  },
  {
    x: 540,
    y: 280,
    w: 120,
    h: 140,
  },
];