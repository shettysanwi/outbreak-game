
import type { Server, Socket } from 'socket.io';
import {
  INPUT_QUEUE_MAX,
  SNAPSHOT_EVERY,
  TICK_MS,
  addPlayer,
  createRoomState,
  defaultSimOptions,
  removePlayer,
  stepRoom,
  startGame as startSimGame,
} from '@tag-game/shared';

import type {
  ClientToServerEvents,
  InputMessage,
  PlayerSnapshot,
  ServerToClientEvents,
  SimOptions,
  Snapshot,
  StartGameResult,
} from '@tag-game/shared';

export type GameServer = Server<
  ClientToServerEvents,
  ServerToClientEvents
>;

export type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents
>;

/**
 * One room = one authoritative simulation.
 *
 * A fixed-timestep loop advances the world at 60 Hz regardless of interval
 * jitter (the pump accumulates real elapsed time and steps in exact TICK_MS
 * increments). Every 3rd tick (~20 Hz) a snapshot is broadcast; each player
 * additionally receives the sequence number of their last applied input so
 * the client can reconcile its prediction.
 */
export class Room {
  readonly state = createRoomState();

  private readonly options: SimOptions;
  private readonly sockets =
    new Map<string, GameSocket>();

  private readonly inputQueues =
    new Map<string, InputMessage[]>();

  private tickCount = 0;
  private accumulatorMs = 0;
  private lastPumpAt = 0;
  private interval: NodeJS.Timeout | null = null;

  private hostId: string | null = null;

  constructor(
    readonly code: string,
    overrides: Partial<SimOptions> = {},
  ) {
    this.options = {
      ...defaultSimOptions(),
      ...overrides,
    };
  }

  get playerCount(): number {
    return this.sockets.size;
  }

  get isEmpty(): boolean {
    return this.sockets.size === 0;
  }

  getHostId(): string | null {
    return this.hostId;
  }

  join(
    socket: GameSocket,
    nickname: string,
  ): void {
    this.sockets.set(socket.id, socket);
    this.inputQueues.set(socket.id, []);

    addPlayer(
      this.state,
      socket.id,
      nickname,
      this.options,
    );

    // First player becomes host.
    if (!this.hostId) {
      this.hostId = socket.id;
    }

    void socket.join(this.code);

    if (!this.interval) {
      this.start();
    }

    // Immediately send the updated lobby to all players.
    // This makes the new player visible without waiting
    // for the next simulation snapshot.
    this.broadcastSnapshot(); // ADDED
  }

  leave(socketId: string): void {
    this.sockets.delete(socketId);
    this.inputQueues.delete(socketId);

    removePlayer(
      this.state,
      socketId,
    );

    // If the host leaves, give host control
    // to the first remaining player.
    if (this.hostId === socketId) {
      const remainingPlayers =
        Object.values(this.state.players);

      this.hostId =
        remainingPlayers[0]?.id ?? null;
    }

    if (this.isEmpty) {
      this.hostId = null;
      this.stop();
    }
  }

  /**
   * Called by the server when a player presses
   * Start Game.
   */
  startGame(
    socketId: string,
  ): StartGameResult {
    if (this.hostId !== socketId) {
      return {
        ok: false,
        error:
          'Only the host can start the game.',
      };
    }

    if (this.state.phase !== 'waiting') {
      return {
        ok: false,
        error:
          'The game has already started.',
      };
    }

    if (this.playerCount < 2) {
      return {
        ok: false,
        error:
          'At least 2 players are required to start.',
      };
    }

    /*
     * Use the shared simulation startGame()
     * so that the real server initializes:
     *
     * - player roles
     * - initial zombie
     * - spawn positions
     * - vaccine state
     * - round number
     * - countdown timer
     */
    const events = startSimGame(
      this.state,
      this.options,
    );

    if (events.length === 0) {
      return {
        ok: false,
        error: 'Could not start the game.',
      };
    }

    this.broadcastSnapshot();

    return {
      ok: true,
    };
  }

  /** Queue a validated input; one is consumed per tick. */
  queueInput(
    socketId: string,
    input: InputMessage,
  ): void {
    const queue =
      this.inputQueues.get(socketId);

    if (!queue) return;

    if (queue.length >= INPUT_QUEUE_MAX) {
      queue.shift();
    }

    queue.push(input);
  }

  start(): void {
    this.lastPumpAt = Date.now();
    this.accumulatorMs = 0;

    // Pump twice per tick; the accumulator turns wall time
    // into exact fixed steps.
    this.interval = setInterval(
      this.pump,
      TICK_MS / 2,
    );
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private readonly pump = (): void => {
    const now = Date.now();

    let elapsed =
      now - this.lastPumpAt;

    this.lastPumpAt = now;

    // Cap catch-up work after event-loop stalls
    // instead of spiraling.
    if (elapsed > 250) {
      elapsed = 250;
    }

    this.accumulatorMs += elapsed;

    while (
      this.accumulatorMs >= TICK_MS
    ) {
      this.accumulatorMs -= TICK_MS;
      this.tick();
    }
  };

  private tick(): void {
    this.tickCount += 1;

    // Apply queued inputs.
    for (const [
      id,
      player,
    ] of Object.entries(this.state.players)) {
      const input =
        this.inputQueues
          .get(id)
          ?.shift();

      if (input) {
        player.input = input;
        player.lastSeq = input.seq;
      }

      // No fresh input:
      // the previous input keeps applying.
    }

    /*
     * While waiting, do not advance the simulation.
     *
     * The host must explicitly press Start Game.
     */
    if (
      this.state.phase !== 'waiting'
    ) {
      const events = stepRoom(
        this.state,
        TICK_MS,
        this.options,
      );

      // Handle simulation events.
      for (const event of events) {
        if (event.type === 'tag') {
          for (
            const socket of
            this.sockets.values()
          ) {
            socket.emit('tag', {
              oldItId:
                event.oldItId,

              newItId:
                event.newItId,

              x: event.x,

              y: event.y,
            });
          }
        }

        /*
         * When the last survivor becomes infected,
         * sim.ts creates:
         *
         * {
         *   type: 'gameOver',
         *   winner: 'zombies'
         * }
         *
         * Broadcast the result to every connected player.
         */
        if (
          event.type === 'gameOver'
        ) {
          for (
            const socket of
            this.sockets.values()
          ) {
            socket.emit(
              'gameOver',
              {
                winner:
                  event.winner,
              },
            );
          }
        }
      }
    }

    // Broadcast updated state.
    if (
      this.tickCount %
        SNAPSHOT_EVERY ===
      0
    ) {
      this.broadcastSnapshot();
    }
  }

  private broadcastSnapshot(): void {
    const players: PlayerSnapshot[] =
      Object.values(
        this.state.players,
      ).map((player) => ({
        id: player.id,
        nickname: player.nickname,
        colorIndex:
          player.colorIndex,

        x: player.x,
        y: player.y,

        stamina:
          player.stamina,

        sprinting:
          player.sprinting,

        spectator:
          player.spectator,

        // Zombie Survival state
        role:
          player.role,

        hasVaccine:
          player.hasVaccine,

        scoreMs:
          player.scoreMs,
      }));

    const base:
      Omit<Snapshot, 'lastSeq'> = {
      tick:
        this.tickCount,

      phase:
        this.state.phase,

      phaseRemainingMs:
        Math.max(
          0,
          Math.round(
            this.state
              .phaseRemainingMs,
          ),
        ),

      roundNumber:
        this.state.roundNumber,

      hostId:
        this.hostId,

      itId:
        this.state.itId,

      immunityMs:
        Math.max(
          0,
          Math.round(
            this.state
              .immunityRemainingMs,
          ),
        ),

      players,

      podium:
        this.state.podium,
    };

    for (
      const [
        id,
        socket,
      ] of this.sockets
    ) {
      socket.emit(
        'snapshot',
        {
          ...base,

          lastSeq:
            this.state.players[id]
              ?.lastSeq ?? 0,
        },
      );
    }
  }
}
