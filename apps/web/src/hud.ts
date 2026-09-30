import { PLAYER_COLORS } from '@tag-game/shared';
import type { Snapshot } from '@tag-game/shared';
import type { NetClient } from './net';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

function formatSeconds(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0',
  )}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

export class Hud {
  private privateDecisionEventId: string | null = null;
  private privateDecisionExpiresAt = 0;

  private readonly hud = element<HTMLDivElement>('hud');
  private readonly timer = element<HTMLDivElement>('timer');
  private readonly scoreboard = element<HTMLDivElement>('scoreboard');

  private readonly survivorCount =
    element<HTMLSpanElement>('survivor-count');

  private readonly zombieCount =
    element<HTMLSpanElement>('zombie-count');

  private readonly roleDisplay =
    element<HTMLSpanElement>('role-display');

  private readonly vaccineCount =
    element<HTMLSpanElement>('vaccine-count');

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

  private previousPhase: Snapshot['phase'] | null = null;
  private goShownAt = 0;
  private lastCountdownSecond = -1;

  /*
   * Keyboard controls for the private decision.
   *
   * S = Survivor + Vaccine
   * Z = Zombie
   */
  private readonly handlePrivateDecisionKey = (
    event: KeyboardEvent,
  ): void => {
    /*
     * If there is no active private decision,
     * S and Z should do nothing.
     */
    if (!this.privateDecisionEventId) {
      return;
    }

    const target = event.target;

    /*
     * Do not interfere with typing into input fields.
     */
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === 's') {
      event.preventDefault();
      this.chooseRole('survivor');
      return;
    }

    if (key === 'z') {
      event.preventDefault();
      this.chooseRole('zombie');
    }
  };

  constructor(
    private readonly selfId: string,
    roomCode: string,
    private readonly net: NetClient,
  ) {
    this.roomCodeButton.textContent = roomCode;

    this.roomCodeButton.addEventListener('click', () => {
      const url = `${location.origin}${location.pathname}#${roomCode}`;

      void navigator.clipboard.writeText(url).then(() => {
        this.roomCodeButton.textContent = 'copied!';

        setTimeout(() => {
          this.roomCodeButton.textContent = roomCode;
        }, 1200);
      });
    });

    /*
     * Listen for S/Z keyboard choices.
     *
     * The handler itself checks whether a private decision
     * is currently active.
     */
    document.addEventListener(
      'keydown',
      this.handlePrivateDecisionKey,
    );

    this.hud.classList.remove('hidden');
  }

  update(
    snapshot: Snapshot,
    predictedStamina: number | null,
    now: number,
  ): void {
    if (snapshot.phase !== this.previousPhase) {
      if (snapshot.phase === 'playing') {
        this.goShownAt = now;
      }

      this.previousPhase = snapshot.phase;
    }

    this.updateTimer(snapshot);

    /*
     * Private decision has priority over the normal banner.
     * This prevents normal HUD updates from hiding it.
     */
    if (this.privateDecisionEventId) {
      if (now >= this.privateDecisionExpiresAt) {
        this.closePrivateDecision();
      } else {
        this.updatePrivateDecisionCountdown(now);
      }
    } else {
      this.updateBanner(snapshot, now);
    }

    this.updateScoreboard(snapshot);
    this.updateStamina(snapshot, predictedStamina);
    this.updatePodium(snapshot);

    const self = snapshot.players.find(
      (player) => player.id === this.selfId,
    );

    this.spectatorNote.classList.toggle(
      'hidden',
      !self?.spectator,
    );

    if (now > 15_000) {
      this.controlsHint.classList.add('hidden');
    }
  }

  private updateTimer(snapshot: Snapshot): void {
    this.timer.textContent =
      snapshot.phase === 'playing'
        ? formatSeconds(snapshot.phaseRemainingMs)
        : '--:--';
  }

  private updateBanner(
    snapshot: Snapshot,
    now: number,
  ): void {
    if (snapshot.phase === 'waiting') {
      this.showBanner(
        '<div class="text-2xl font-bold text-slate-200">Waiting for players…</div>' +
          '<div class="mt-2 text-sm text-slate-400">Share the room code (top right) with a friend.</div>',
      );

      return;
    }

    if (snapshot.phase === 'countdown') {
      const second = Math.ceil(
        snapshot.phaseRemainingMs / 1000,
      );

      if (second !== this.lastCountdownSecond) {
        this.lastCountdownSecond = second;
      }

      this.showBanner(
        `<div class="countdown-pop text-7xl font-black text-sky-300">${String(second)}</div>` +
          '<div class="mt-2 text-sm tracking-widest text-slate-400 uppercase">round starting</div>',
      );

      return;
    }

    if (
      snapshot.phase === 'playing' &&
      now - this.goShownAt < 900
    ) {
      this.showBanner(
        '<div class="countdown-pop text-7xl font-black text-emerald-400">GO!</div>',
      );

      return;
    }

    this.banner.classList.add('hidden');
  }

  private showBanner(html: string): void {
    this.banner.innerHTML = html;
    this.banner.classList.remove('hidden');
  }

  private updateScoreboard(snapshot: Snapshot): void {
    const self = snapshot.players.find(
      (player) => player.id === this.selfId,
    );

    this.survivorCount.textContent = String(
      snapshot.survivorCount,
    );

    this.zombieCount.textContent = String(
      snapshot.zombieCount,
    );

    if (!self) {
      this.roleDisplay.textContent = '—';
      this.vaccineCount.textContent = '0';
      return;
    }

    if (self.role === 'zombie') {
      this.roleDisplay.textContent = '🧟 Zombie';
      this.roleDisplay.className =
        'font-bold text-rose-300';
    } else {
      this.roleDisplay.textContent = '🧍 Survivor';
      this.roleDisplay.className =
        'font-bold text-emerald-300';
    }

    this.vaccineCount.textContent = String(
      self.vaccines ?? 0,
    );
  }

  private updateStamina(
    snapshot: Snapshot,
    predictedStamina: number | null,
  ): void {
    const self = snapshot.players.find(
      (player) => player.id === this.selfId,
    );

    if (!self || self.spectator) {
      this.staminaWrap.classList.add('hidden');
      return;
    }

    this.staminaWrap.classList.remove('hidden');

    const stamina =
      predictedStamina ?? self.stamina;

    this.staminaBar.style.width =
      `${String(Math.round(stamina))}%`;

    this.staminaBar.classList.toggle(
      'bg-amber-400',
      stamina < 30,
    );

    this.staminaBar.classList.toggle(
      'bg-emerald-400',
      stamina >= 30,
    );
  }

  private updatePodium(snapshot: Snapshot): void {
    if (snapshot.phase !== 'gameover') {
      this.podium.classList.add('hidden');
      this.podium.classList.remove('flex');
      return;
    }

    const medals = [
      'text-yellow-300',
      'text-slate-300',
      'text-amber-600',
    ];

    this.podiumList.innerHTML = snapshot.podium
      .map((entry, index) => {
        const color =
          PLAYER_COLORS[
            entry.colorIndex % PLAYER_COLORS.length
          ] ?? '#38bdf8';

        const rankClass =
          medals[index] ?? 'text-slate-500';

        return (
          '<li class="flex items-center gap-3 rounded-lg bg-slate-950/60 px-3 py-2">' +
          `<span class="w-6 text-right font-black ${rankClass}">${String(index + 1)}</span>` +
          `<span class="inline-block h-3 w-3 rounded-full" style="background:${color}"></span>` +
          `<span class="min-w-0 flex-1 truncate font-medium">${escapeHtml(entry.nickname)}</span>` +
          `<span class="font-mono text-sm text-slate-400">${(entry.scoreMs / 1000).toFixed(1)}s free</span>` +
          '</li>'
        );
      })
      .join('');

    this.podiumNote.textContent =
      `Next round in ${String(
        Math.ceil(snapshot.phaseRemainingMs / 1000),
      )}s`;

    this.podium.classList.remove('hidden');
    this.podium.classList.add('flex');
  }

  showPrivateDecision(
    eventId: string,
    timeLimitMs: number,
  ): void {
    /*
     * Ignore a duplicate decision offer if the same
     * decision is already being displayed.
     */
    if (
      this.privateDecisionEventId === eventId
    ) {
      return;
    }

    this.privateDecisionEventId = eventId;

    this.privateDecisionExpiresAt =
      performance.now() + timeLimitMs;

    /*
     * Create the private decision UI.
     */
    this.banner.innerHTML =
      '<div class="text-3xl font-black text-amber-300">🔐 Private Decision</div>' +
      '<div class="mt-2 text-base text-slate-200">' +
      'You have <span id="decision-seconds" class="font-bold text-white"></span> seconds to choose.' +
      '</div>' +
      '<div class="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">' +
      '<button id="choose-survivor" type="button" class="rounded-lg bg-emerald-600 px-5 py-3 font-semibold text-white transition hover:bg-emerald-500 cursor-pointer">' +
      '🧍 Survivor + 💉 Vaccine' +
      '</button>' +
      '<button id="choose-zombie" type="button" class="rounded-lg bg-rose-600 px-5 py-3 font-semibold text-white transition hover:bg-rose-500 cursor-pointer">' +
      '🧟 Zombie' +
      '</button>' +
      '</div>' +
      '<div class="mt-4 text-sm text-slate-400">' +
      'Press <span class="font-bold text-white">S</span> for Survivor or <span class="font-bold text-white">Z</span> for Zombie' +
      '</div>';

    this.banner.classList.remove('hidden');

    /*
     * Find the two buttons after creating them.
     */
    const survivorButton =
      document.getElementById(
        'choose-survivor',
      ) as HTMLButtonElement | null;

    const zombieButton =
      document.getElementById(
        'choose-zombie',
      ) as HTMLButtonElement | null;

    /*
     * Mouse / touch controls.
     */
    survivorButton?.addEventListener(
      'click',
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.chooseRole('survivor');
      },
    );

    zombieButton?.addEventListener(
      'click',
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        this.chooseRole('zombie');
      },
    );

    this.updatePrivateDecisionCountdown(
      performance.now(),
    );
  }

  private chooseRole(
    choice: 'survivor' | 'zombie',
  ): void {
    /*
     * Do nothing if the decision has already expired
     * or has already been answered.
     */
    if (!this.privateDecisionEventId) {
      return;
    }

    if (
      performance.now() >=
      this.privateDecisionExpiresAt
    ) {
      this.closePrivateDecision();
      return;
    }

    const eventId =
      this.privateDecisionEventId;

    /*
     * Send the choice to the server.
     */
    this.net.sendPrivateDecision(
      eventId,
      choice,
    );

    /*
     * Close the popup immediately after sending.
     */
    this.closePrivateDecision();
  }

  private updatePrivateDecisionCountdown(
    now: number,
  ): void {
    if (!this.privateDecisionEventId) {
      return;
    }

    const remainingMs =
      this.privateDecisionExpiresAt - now;

    const seconds = Math.max(
      0,
      Math.ceil(remainingMs / 1000),
    );

    const secondsElement =
      document.getElementById(
        'decision-seconds',
      );

    if (secondsElement) {
      secondsElement.textContent =
        String(seconds);
    }

    /*
     * If the countdown reaches zero,
     * close the decision.
     */
    if (remainingMs <= 0) {
      this.closePrivateDecision();
    }
  }

  private closePrivateDecision(): void {
    this.privateDecisionEventId = null;
    this.privateDecisionExpiresAt = 0;

    this.banner.classList.add('hidden');
  }
}