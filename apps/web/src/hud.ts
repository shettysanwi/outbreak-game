
import { PLAYER_COLORS } from '@tag-game/shared';
import type { Snapshot } from '@tag-game/shared';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);

  if (!found) {
    throw new Error(`Missing element #${id}`);
  }

  return found as T;
}

function formatSeconds(ms: number): string {
  const totalSeconds = Math.max(
    0,
    Math.ceil(ms / 1000),
  );

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(
    seconds,
  ).padStart(2, '0')}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    return `&#${char.charCodeAt(0)};`;
  });
}

export class Hud {
  private readonly hud =
    element<HTMLDivElement>('hud');

  private readonly timer =
    element<HTMLDivElement>('timer');

  private readonly scoreboard =
    element<HTMLDivElement>('scoreboard');

  private readonly roomCodeButton =
    element<HTMLButtonElement>('room-code');

  private readonly banner =
    element<HTMLDivElement>('banner');

  private readonly spectatorNote =
    element<HTMLDivElement>('spectator');

  private readonly staminaWrap =
    element<HTMLDivElement>('stamina-wrap');

  private readonly staminaBar =
    element<HTMLDivElement>('stamina-bar');

  private readonly podium =
    element<HTMLDivElement>('podium');

  private readonly podiumList =
    element<HTMLOListElement>('podium-list');

  private readonly podiumNote =
    element<HTMLParagraphElement>('podium-note');

  private readonly controlsHint =
    element<HTMLDivElement>('controls-hint');

  private previousPhase:
    Snapshot['phase'] | null = null;

  private goShownAt = 0;

  constructor(
    private readonly selfId: string,
    roomCode: string,
  ) {
    this.roomCodeButton.textContent = roomCode;

    this.roomCodeButton.addEventListener(
      'click',
      () => {
        const url =
          `${location.origin}` +
          `${location.pathname}` +
          `#${roomCode}`;

        void navigator.clipboard
          .writeText(url)
          .then(() => {
            this.roomCodeButton.textContent =
              'copied!';

            setTimeout(() => {
              this.roomCodeButton.textContent =
                roomCode;
            }, 1200);
          })
          .catch(() => {
            /*
             * Clipboard access can fail on some
             * browsers or insecure contexts.
             * The game should continue normally.
             */
          });
      },
    );

    this.hud.classList.remove('hidden');
  }

  update(
    snapshot: Snapshot,
    predictedStamina: number | null,
    now: number,
  ): void {
    /*
     * Detect phase changes.
     */
    if (
      snapshot.phase !==
      this.previousPhase
    ) {
      if (snapshot.phase === 'playing') {
        this.goShownAt = now;
      }

      this.previousPhase =
        snapshot.phase;
    }

    this.updateTimer(snapshot);

    this.updateBanner(
      snapshot,
      now,
    );

    this.updateScoreboard(snapshot);

    this.updateStamina(
      snapshot,
      predictedStamina,
    );

    this.updatePodium(snapshot);

    const self =
      snapshot.players.find(
        (player) =>
          player.id === this.selfId,
      );

    this.spectatorNote.classList.toggle(
      'hidden',
      !self?.spectator,
    );

    /*
     * Hide the controls hint after a short
     * period once the game has started.
     */
    if (
      snapshot.phase === 'playing' &&
      now - this.goShownAt > 15_000
    ) {
      this.controlsHint.classList.add(
        'hidden',
      );
    }
  }

  private updateTimer(
    snapshot: Snapshot,
  ): void {
    if (
      snapshot.phase === 'playing'
    ) {
      this.timer.textContent =
        formatSeconds(
          snapshot.phaseRemainingMs,
        );

      return;
    }

    if (
      snapshot.phase === 'countdown'
    ) {
      this.timer.textContent =
        formatSeconds(
          snapshot.phaseRemainingMs,
        );

      return;
    }

    if (
      snapshot.phase === 'podium'
    ) {
      this.timer.textContent =
        formatSeconds(
          snapshot.phaseRemainingMs,
        );

      return;
    }

    this.timer.textContent =
      '--:--';
  }

  private updateBanner(
    snapshot: Snapshot,
    now: number,
  ): void {
    if (
      snapshot.phase === 'waiting'
    ) {
      this.showBanner(
        '<div class="text-2xl font-bold text-slate-200">' +
          'Waiting for players...' +
          '</div>' +
          '<div class="mt-2 text-sm text-slate-400">' +
          'Share the room code with a friend.' +
          '</div>',
      );

      return;
    }

    if (
      snapshot.phase === 'countdown'
    ) {
      const second =
        Math.ceil(
          snapshot.phaseRemainingMs /
            1000,
        );

      this.showBanner(
        '<div class="countdown-pop ' +
          'text-7xl font-black text-sky-300">' +
          String(second) +
          '</div>' +
          '<div class="mt-2 text-sm ' +
          'tracking-widest text-slate-400 ' +
          'uppercase">' +
          'round starting' +
          '</div>',
      );

      return;
    }

    if (
      snapshot.phase === 'playing' &&
      now - this.goShownAt < 900
    ) {
      this.showBanner(
        '<div class="countdown-pop ' +
          'text-7xl font-black text-emerald-400">' +
          'GO!' +
          '</div>',
      );

      return;
    }

    if (
      snapshot.phase === 'podium'
    ) {
      return;
    }

    this.banner.classList.add(
      'hidden',
    );
  }

  private showBanner(
    html: string,
  ): void {
    this.banner.innerHTML = html;

    this.banner.classList.remove(
      'hidden',
    );
  }

  private updateScoreboard(
    snapshot: Snapshot,
  ): void {
    const players =
      snapshot.players;

    const survivors =
      players.filter(
        (player) =>
          player.role ===
          'survivor',
      ).length;

    const zombies =
      players.filter(
        (player) =>
          player.role ===
          'zombie',
      ).length;

    const self =
      players.find(
        (player) =>
          player.id === this.selfId,
      );

    /*
     * The existing HTML only has a generic
     * scoreboard container, so we generate
     * the information here instead of relying
     * on nonexistent #survivor-count etc.
     */
    let roleText =
      'Waiting';

    let vaccineText =
      '';

    if (self) {
      roleText =
        self.role === 'zombie'
          ? '🧟 Zombie'
          : '🧑 Survivor';

      if (
        self.role === 'survivor' &&
        self.hasVaccine
      ) {
        vaccineText =
          ' • 💉 Vaccine';
      }
    }

    this.scoreboard.innerHTML =
      '<div class="flex flex-wrap ' +
      'items-center gap-x-4 gap-y-1">' +
      `<span>🧑 Survivors: <strong>${String(
        survivors,
      )}</strong></span>` +
      `<span>🧟 Zombies: <strong>${String(
        zombies,
      )}</strong></span>` +
      `<span>Role: <strong>${roleText}</strong>${vaccineText}</span>` +
      '</div>';
  }

  private updateStamina(
    snapshot: Snapshot,
    predictedStamina: number | null,
  ): void {
    const self =
      snapshot.players.find(
        (player) =>
          player.id === this.selfId,
      );

    if (
      !self ||
      self.spectator ||
      snapshot.phase === 'waiting'
    ) {
      this.staminaWrap.classList.add(
        'hidden',
      );

      return;
    }

    this.staminaWrap.classList.remove(
      'hidden',
    );

    const stamina =
      predictedStamina ??
      self.stamina;

    this.staminaBar.style.width =
      `${String(
        Math.round(stamina),
      )}%`;

    this.staminaBar.classList.toggle(
      'bg-amber-400',
      stamina < 30,
    );

    this.staminaBar.classList.toggle(
      'bg-emerald-400',
      stamina >= 30,
    );
  }

  private updatePodium(
    snapshot: Snapshot,
  ): void {
    if (
      snapshot.phase !== 'podium'
    ) {
      this.podium.classList.add(
        'hidden',
      );

      this.podium.classList.remove(
        'flex',
      );

      return;
    }

    const medals = [
      'text-yellow-300',
      'text-slate-300',
      'text-amber-600',
    ];

    this.podiumList.innerHTML =
      snapshot.podium
        .map(
          (entry, index) => {
            const color =
              PLAYER_COLORS[
                entry.colorIndex %
                  PLAYER_COLORS.length
              ] ?? '#38bdf8';

            const rankClass =
              medals[index] ??
              'text-slate-500';

            return (
              '<li class="flex items-center ' +
              'gap-3 rounded-lg ' +
              'bg-slate-950/60 px-3 py-2">' +
              `<span class="w-6 text-right font-black ${rankClass}">` +
              `${String(index + 1)}` +
              '</span>' +
              `<span class="inline-block h-3 w-3 rounded-full" ` +
              `style="background:${color}"></span>` +
              `<span class="min-w-0 flex-1 truncate font-medium">` +
              `${escapeHtml(entry.nickname)}` +
              '</span>' +
              `<span class="font-mono text-sm text-slate-400">` +
              `${(entry.scoreMs / 1000).toFixed(1)}s survived` +
              '</span>' +
              '</li>'
            );
          },
        )
        .join('');

    this.podiumNote.textContent =
      `Next round in ${String(
        Math.ceil(
          snapshot.phaseRemainingMs /
            1000,
        ),
      )}s`;

    this.podium.classList.remove(
      'hidden',
    );

    this.podium.classList.add(
      'flex',
    );
  }
}

