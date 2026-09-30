import './style.css';

import { SnapshotBuffer } from '@tag-game/shared';

import { Hud } from './hud';
import { createInputController } from './input';
import { NetClient } from './net';
import { LocalPredictor } from './prediction';
import { Renderer } from './renderer';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);

  if (!found) {
    throw new Error(`Missing element #${id}`);
  }

  return found as T;
}

const menu = element<HTMLDivElement>('menu');
const menuError = element<HTMLParagraphElement>('menu-error');

const nicknameInput =
  element<HTMLInputElement>('nickname');

const codeInput =
  element<HTMLInputElement>('code');

const createButton =
  element<HTMLButtonElement>('btn-create');

const joinButton =
  element<HTMLButtonElement>('btn-join');

/*
 * Lobby elements
 */
const lobby = element<HTMLDivElement>('lobby');

const lobbyCode =
  element<HTMLDivElement>('lobby-code');

const lobbyTitle =
  element<HTMLHeadingElement>('lobby-title');

const lobbyStatus =
  element<HTMLDivElement>('lobby-status');

const lobbyPlayers =
  element<HTMLDivElement>('lobby-players');

const startGameButton =
  element<HTMLButtonElement>('btn-start-game');

const lobbyError =
  element<HTMLParagraphElement>('lobby-error');

const hashCode = location.hash
  .replace('#', '')
  .trim()
  .toUpperCase();

if (/^[A-Z0-9]{4}$/.test(hashCode)) {
  codeInput.value = hashCode;
}

nicknameInput.focus();

function showMenuError(message: string): void {
  menuError.textContent = message;
  menuError.classList.remove('hidden');
}

function showLobbyError(message: string): void {
  lobbyError.textContent = message;
  lobbyError.classList.remove('hidden');
}

function setBusy(busy: boolean): void {
  createButton.disabled = busy;
  joinButton.disabled = busy;
}

async function start(roomCode?: string): Promise<void> {
  const nickname = nicknameInput.value.trim();

  if (!nickname) {
    showMenuError('Pick a nickname first.');
    nicknameInput.focus();
    return;
  }

  setBusy(true);
  menuError.classList.add('hidden');

  const net = new NetClient();

  try {
    await net.connect();
  } catch (error) {
    showMenuError(
      error instanceof Error
        ? error.message
        : 'Could not connect.',
    );

    setBusy(false);
    return;
  }

  const result = await net.join(
    nickname,
    roomCode,
  );

  if (!result.ok) {
    showMenuError(result.error);
    setBusy(false);
    return;
  }

  location.hash = result.roomCode;

  menu.classList.add('hidden');

  lobbyCode.textContent = result.roomCode;

  lobby.classList.remove('hidden');
  lobby.classList.add('flex');

  runGame(
    net,
    result.selfId,
    result.roomCode,
  );
}

createButton.addEventListener('click', () => {
  void start();
});

joinButton.addEventListener('click', () => {
  const code = codeInput.value
    .trim()
    .toUpperCase();

  if (!/^[A-Z0-9]{4}$/.test(code)) {
    showMenuError(
      'Room codes are 4 letters/digits.',
    );

    codeInput.focus();

    return;
  }

  void start(code);
});

for (const input of [
  nicknameInput,
  codeInput,
]) {
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;

    const code = codeInput.value
      .trim()
      .toUpperCase();

    if (/^[A-Z0-9]{4}$/.test(code)) {
      void start(code);
    } else {
      void start();
    }
  });
}

function updateLobby(snapshot: {
  phase: string;
  hostId: string | null;
  players: Array<{
    id: string;
    nickname: string;
  }>;
}, selfId: string, roomCode: string): void {
  /*
   * Lobby is only visible before the game starts.
   */
  if (
    snapshot.phase === 'waiting'
  ) {
    lobby.classList.remove('hidden');
    lobby.classList.add('flex');

    lobbyCode.textContent = roomCode;

    const isHost =
      snapshot.hostId === selfId;

    lobbyTitle.textContent = isHost
      ? 'You are the host'
      : 'Waiting for host';

    lobbyStatus.textContent = isHost
      ? 'Players are ready. Start the game when everyone has joined.'
      : 'The host will start the game when everyone is ready.';

    /*
     * Player list
     */
    lobbyPlayers.innerHTML = '';

    for (const player of snapshot.players) {
      const row = document.createElement('div');

      row.className =
        'flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2';

      const name = document.createElement('span');

      name.className =
        'font-medium text-slate-200';

      name.textContent =
        player.nickname +
        (player.id === selfId
          ? ' (You)'
          : '');

      const role = document.createElement('span');

      role.className =
        'text-xs text-slate-500';

      if (player.id === snapshot.hostId) {
        role.textContent = 'HOST';
        role.className =
          'text-xs font-bold text-amber-300';
      } else {
        role.textContent = 'PLAYER';
      }

      row.appendChild(name);
      row.appendChild(role);

      lobbyPlayers.appendChild(row);
    }

    /*
     * Only the host gets the Start Game button.
     */
    if (isHost) {
      startGameButton.classList.remove('hidden');

      if (snapshot.players.length < 2) {
        startGameButton.disabled = true;
        startGameButton.textContent =
          'WAITING FOR PLAYER...';
      } else {
        startGameButton.disabled = false;
        startGameButton.textContent =
          'START GAME';
      }
    } else {
      startGameButton.classList.add('hidden');
    }

    return;
  }

  /*
   * Once countdown/game begins, hide lobby.
   */
  lobby.classList.add('hidden');
  lobby.classList.remove('flex');
}

function runGame(
  net: NetClient,
  selfId: string,
  roomCode: string,
): void {
  const canvas =
    element<HTMLCanvasElement>('game');

  const renderer = new Renderer(canvas);

  const hud =
    new Hud(selfId, roomCode);

  const buffer =
    new SnapshotBuffer();

  const predictor =
    new LocalPredictor(
      selfId,
      (input) => {
        net.sendInput(input);
      },
    );

  const input =
    createInputController({
      joyBase:
        element<HTMLDivElement>('joy-base'),

      joyThumb:
        element<HTMLDivElement>('joy-thumb'),

      sprintButton:
        element<HTMLButtonElement>(
          'btn-sprint',
        ),
    });

  let running = true;

  /*
   * HOST START BUTTON
   */
  startGameButton.addEventListener(
    'click',
    async () => {
      startGameButton.disabled = true;
      lobbyError.classList.add('hidden');

      const result =
        await net.startGame();

      if (!result.ok) {
        startGameButton.disabled = false;
        showLobbyError(result.error);
      }
    },
  );

  net.onSnapshot((snapshot) => {
    const now = performance.now();

    buffer.push(snapshot, now);

    predictor.onSnapshot(snapshot);

    hud.update(
      snapshot,
      predictor.state()?.stamina ?? null,
      now,
    );

    updateLobby(
      snapshot,
      selfId,
      roomCode,
    );
  });

  net.onTag((event) => {
    renderer.addFlash(
      event.x,
      event.y,
    );

    const involved =
      event.newItId === selfId ||
      event.oldItId === selfId;

    renderer.addShake(
      involved ? 14 : 7,
    );
  });

  net.onDisconnect(() => {
    running = false;

    lobby.classList.add('hidden');
    lobby.classList.remove('flex');

    menu.classList.remove('hidden');

    setBusy(false);

    showMenuError(
      'Connection lost — join again.',
    );
  });

  const frame = (now: number): void => {
    if (!running) return;

    predictor.frame(
      now,
      input.current(),
    );

    const predicted =
      predictor.state();

    renderer.draw(
      {
        snapshot: buffer.latest(),

        positions:
          buffer.sample(now),

        selfId,

        self: predicted
          ? {
              displayX:
                predicted.displayX,

              displayY:
                predicted.displayY,

              sprinting:
                predicted.sprinting,
            }
          : null,
      },
      now,
    );

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}