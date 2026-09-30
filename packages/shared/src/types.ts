export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Phase =
  | 'waiting'
  | 'countdown'
  | 'playing'
  | 'podium';

export interface PlayerInput {
  seq: number;
  moveX: number;
  moveY: number;
  sprint: boolean;
}

export interface MovableBody {
  x: number;
  y: number;
  stamina: number;
  sprinting: boolean;
  input: PlayerInput;
}

export interface SimPlayer extends MovableBody {
  id: string;
  nickname: string;
  colorIndex: number;
  spectator: boolean;
  role: 'zombie' | 'survivor';
  hasVaccine: boolean;
  scoreMs: number;
  lastSeq: number;
  joinOrder: number;
}

export interface PodiumEntry {
  id: string;
  nickname: string;
  colorIndex: number;
  scoreMs: number;
}

export interface RoomState {
  phase: Phase;
  phaseRemainingMs: number;
  players: Record<string, SimPlayer>;
  itId: string | null;
  immunityRemainingMs: number;
  roundNumber: number;
  podium: PodiumEntry[];
  nextJoinOrder: number;
}

export type SimEvent =
  | { type: 'phase'; phase: Phase }
  | { type: 'tag'; oldItId: string; newItId: string; x: number; y: number }
  | { type: 'gameOver'; winner: 'zombies' | 'survivors' };

export interface SimOptions {
  countdownMs: number;
  roundMs: number;
  podiumMs: number;
  tagCooldownMs: number;
  spawnPoints: readonly Vec2[];
  obstacles: readonly Rect[];
  rng: () => number;
}

export interface PlayerSnapshot {
  id: string;
  nickname: string;
  colorIndex: number;
  x: number;
  y: number;
  stamina: number;
  sprinting: boolean;
  spectator: boolean;
  role: 'zombie' | 'survivor';
  hasVaccine: boolean;
  scoreMs: number;
}

export interface Snapshot {
  tick: number;
  phase: Phase;
  phaseRemainingMs: number;
  roundNumber: number;

  // Lobby information
  hostId: string | null;

  itId: string | null;
  immunityMs: number;
  players: PlayerSnapshot[];
  podium: PodiumEntry[];
  lastSeq: number;
}

export interface TagBroadcast {
  oldItId: string;
  newItId: string;
  x: number;
  y: number;
}

export type GameOverBroadcast = {
  winner: 'zombies' | 'survivors';
};

export type JoinResult =
  | { ok: true; roomCode: string; selfId: string }
  | { ok: false; error: string };

export type StartGameResult =
  | { ok: true }
  | { ok: false; error: string };

export interface ServerToClientEvents {
  snapshot: (snapshot: Snapshot) => void;
  tag: (event: TagBroadcast) => void;
  gameOver: (event: GameOverBroadcast) => void;
}

export interface ClientToServerEvents {
  join: (message: unknown, ack: (result: JoinResult) => void) => void;
  input: (message: unknown) => void;

  startGame: (
    message: unknown,
    ack: (result: StartGameResult) => void,
  ) => void;
}