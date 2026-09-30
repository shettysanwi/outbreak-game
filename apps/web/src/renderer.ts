import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  OBSTACLES,
  PLAYER_COLORS,
  PLAYER_RADIUS,
} from '@tag-game/shared';
import type { Snapshot, Vec2 } from '@tag-game/shared';

export interface RenderView {
  snapshot: Snapshot | null;

  positions: Map<string, Vec2>;

  selfId: string;

  self: {
    displayX: number;
    displayY: number;
    sprinting: boolean;
  } | null;
}

interface Flash {
  x: number;
  y: number;
  at: number;
}

const FLASH_MS = 500;
const SHAKE_MS = 280;

const ZOMBIE_COLOR = '#fb365c';
const ZOMBIE_GLOW = 'rgba(251, 54, 92, 0.9)';

const SURVIVOR_COLOR = '#34d399';
const SURVIVOR_GLOW = 'rgba(52, 211, 153, 0.85)';

const VACCINE_COLOR = '#38bdf8';
const SELF_COLOR = '#f8fafc';

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;

  private cssWidth = 0;
  private cssHeight = 0;

  private flashes: Flash[] = [];

  private shakeStart = -Infinity;
  private shakeMagnitude = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Canvas 2D is not supported.');
    }

    this.ctx = ctx;

    this.resize();

    window.addEventListener('resize', () => {
      this.resize();
    });
  }

  addFlash(x: number, y: number): void {
    this.flashes.push({
      x,
      y,
      at: performance.now(),
    });
  }

  addShake(magnitude: number): void {
    this.shakeStart = performance.now();
    this.shakeMagnitude = magnitude;
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;

    this.cssWidth = window.innerWidth;
    this.cssHeight = window.innerHeight;

    this.canvas.width = Math.round(
      this.cssWidth * dpr,
    );

    this.canvas.height = Math.round(
      this.cssHeight * dpr,
    );
  }

  draw(view: RenderView, now: number): void {
    const { ctx } = this;

    const dpr = window.devicePixelRatio || 1;

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0,
    );

    /*
     * ==================================================
     * OUTSIDE WORLD
     * ==================================================
     */

    const backgroundGradient =
      ctx.createRadialGradient(
        this.cssWidth / 2,
        this.cssHeight / 2,
        50,
        this.cssWidth / 2,
        this.cssHeight / 2,
        Math.max(
          this.cssWidth,
          this.cssHeight,
        ),
      );

    backgroundGradient.addColorStop(
      0,
      '#10151c',
    );

    backgroundGradient.addColorStop(
      0.55,
      '#07090d',
    );

    backgroundGradient.addColorStop(
      1,
      '#020304',
    );

    ctx.fillStyle =
      backgroundGradient;

    ctx.fillRect(
      0,
      0,
      this.cssWidth,
      this.cssHeight,
    );

    /*
     * Very subtle red emergency glow.
     */
    const emergencyGlow =
      ctx.createRadialGradient(
        this.cssWidth * 0.5,
        0,
        20,
        this.cssWidth * 0.5,
        0,
        this.cssWidth * 0.8,
      );

    emergencyGlow.addColorStop(
      0,
      'rgba(127, 29, 29, 0.14)',
    );

    emergencyGlow.addColorStop(
      1,
      'rgba(127, 29, 29, 0)',
    );

    ctx.fillStyle =
      emergencyGlow;

    ctx.fillRect(
      0,
      0,
      this.cssWidth,
      this.cssHeight,
    );

    /*
     * ==================================================
     * ARENA SCALE
     * ==================================================
     */

    const padding = 20;

    const scale = Math.min(
      (this.cssWidth - padding * 2) /
        ARENA_WIDTH,
      (this.cssHeight - padding * 2) /
        ARENA_HEIGHT,
    );

    let offsetX =
      (this.cssWidth -
        ARENA_WIDTH * scale) /
      2;

    let offsetY =
      (this.cssHeight -
        ARENA_HEIGHT * scale) /
      2;

    /*
     * ==================================================
     * SCREEN SHAKE
     * ==================================================
     */

    const shakeAge =
      now - this.shakeStart;

    if (shakeAge < SHAKE_MS) {
      const falloff =
        this.shakeMagnitude *
        (1 - shakeAge / SHAKE_MS);

      offsetX +=
        (Math.random() * 2 - 1) *
        falloff;

      offsetY +=
        (Math.random() * 2 - 1) *
        falloff;
    }

    ctx.save();

    ctx.translate(
      offsetX,
      offsetY,
    );

    ctx.scale(
      scale,
      scale,
    );

    /*
     * ==================================================
     * ARENA
     * ==================================================
     */

    this.drawArena(
      ctx,
      now,
    );

    /*
     * ==================================================
     * PLAYERS
     * ==================================================
     */

    const snapshot =
      view.snapshot;

    if (snapshot) {
      for (const player of snapshot.players) {
        if (player.spectator) {
          continue;
        }

        const isSelf =
          player.id === view.selfId;

        let x = player.x;
        let y = player.y;

        let sprinting =
          player.sprinting;

        /*
         * Local player.
         */
        if (
          isSelf &&
          view.self
        ) {
          x =
            view.self.displayX;

          y =
            view.self.displayY;

          sprinting =
            view.self.sprinting;
        } else {
          /*
           * Remote player interpolation.
           */
          const interpolated =
            view.positions.get(
              player.id,
            );

          if (interpolated) {
            x = interpolated.x;
            y = interpolated.y;
          }
        }

        this.drawPlayer(
          ctx,
          {
            x,
            y,

            color:
              PLAYER_COLORS[
                player.colorIndex %
                  PLAYER_COLORS.length
              ] ?? '#38bdf8',

            nickname:
              player.nickname,

            role:
              player.role,

            vaccines:
              player.vaccines ?? 0,

            isSelf,

            sprinting,

            now,
          },
        );
      }
    }

    /*
     * ==================================================
     * INFECTION EFFECTS
     * ==================================================
     */

    this.drawFlashes(
      ctx,
      now,
    );

    ctx.restore();
  }

  /*
   * ==================================================
   * ARENA
   * ==================================================
   */

  private drawArena(
    ctx: CanvasRenderingContext2D,
    now: number,
  ): void {
    /*
     * --------------------------------------------------
     * OUTER SHADOW
     * --------------------------------------------------
     */

    ctx.save();

    ctx.shadowColor =
      'rgba(0, 0, 0, 0.9)';

    ctx.shadowBlur = 45;

    ctx.fillStyle =
      '#080b10';

    ctx.beginPath();

    ctx.roundRect(
      0,
      0,
      ARENA_WIDTH,
      ARENA_HEIGHT,
      24,
    );

    ctx.fill();

    ctx.restore();

    /*
     * --------------------------------------------------
     * DARK INFECTED FLOOR
     * --------------------------------------------------
     */

    const arenaGradient =
      ctx.createLinearGradient(
        0,
        0,
        ARENA_WIDTH,
        ARENA_HEIGHT,
      );

    arenaGradient.addColorStop(
      0,
      '#111820',
    );

    arenaGradient.addColorStop(
      0.45,
      '#0a1118',
    );

    arenaGradient.addColorStop(
      1,
      '#05090e',
    );

    ctx.fillStyle =
      arenaGradient;

    ctx.beginPath();

    ctx.roundRect(
      0,
      0,
      ARENA_WIDTH,
      ARENA_HEIGHT,
      24,
    );

    ctx.fill();

    /*
     * --------------------------------------------------
     * FLOOR GRID
     * --------------------------------------------------
     */

    ctx.save();

    ctx.lineWidth = 1;

    ctx.strokeStyle =
      'rgba(148, 163, 184, 0.055)';

    for (
      let x = 50;
      x < ARENA_WIDTH;
      x += 50
    ) {
      ctx.beginPath();

      ctx.moveTo(
        x,
        0,
      );

      ctx.lineTo(
        x,
        ARENA_HEIGHT,
      );

      ctx.stroke();
    }

    for (
      let y = 50;
      y < ARENA_HEIGHT;
      y += 50
    ) {
      ctx.beginPath();

      ctx.moveTo(
        0,
        y,
      );

      ctx.lineTo(
        ARENA_WIDTH,
        y,
      );

      ctx.stroke();
    }

    ctx.restore();

    /*
     * --------------------------------------------------
     * RED EMERGENCY LIGHT
     * --------------------------------------------------
     */

    const pulse =
      0.035 +
      Math.sin(now / 900) *
        0.012;

    const redLight =
      ctx.createRadialGradient(
        ARENA_WIDTH * 0.5,
        ARENA_HEIGHT * 0.05,
        30,
        ARENA_WIDTH * 0.5,
        ARENA_HEIGHT * 0.05,
        ARENA_WIDTH * 0.75,
      );

    redLight.addColorStop(
      0,
      `rgba(185, 28, 28, ${pulse})`,
    );

    redLight.addColorStop(
      1,
      'rgba(185, 28, 28, 0)',
    );

    ctx.fillStyle =
      redLight;

    ctx.beginPath();

    ctx.roundRect(
      0,
      0,
      ARENA_WIDTH,
      ARENA_HEIGHT,
      24,
    );

    ctx.fill();

    /*
     * --------------------------------------------------
     * DARK CORNERS
     * --------------------------------------------------
     */

    const cornerShadow =
      ctx.createRadialGradient(
        0,
        0,
        20,
        0,
        0,
        ARENA_WIDTH * 0.65,
      );

    cornerShadow.addColorStop(
      0,
      'rgba(0, 0, 0, 0.65)',
    );

    cornerShadow.addColorStop(
      1,
      'rgba(0, 0, 0, 0)',
    );

    ctx.fillStyle =
      cornerShadow;

    ctx.fillRect(
      0,
      0,
      ARENA_WIDTH,
      ARENA_HEIGHT,
    );

    /*
     * --------------------------------------------------
     * HAZARD MARKINGS
     * --------------------------------------------------
     */

    this.drawHazardStrip(
      ctx,
      35,
      35,
      150,
      18,
    );

    this.drawHazardStrip(
      ctx,
      ARENA_WIDTH - 185,
      ARENA_HEIGHT - 53,
      150,
      18,
    );

    /*
     * --------------------------------------------------
     * BLOOD / CONTAMINATION MARKS
     * --------------------------------------------------
     */

    this.drawContaminationMark(
      ctx,
      ARENA_WIDTH * 0.18,
      ARENA_HEIGHT * 0.23,
      1,
    );

    this.drawContaminationMark(
      ctx,
      ARENA_WIDTH * 0.76,
      ARENA_HEIGHT * 0.72,
      -1,
    );

    /*
     * --------------------------------------------------
     * ARENA BORDER
     * --------------------------------------------------
     */

    ctx.save();

    ctx.shadowColor =
      'rgba(127, 29, 29, 0.25)';

    ctx.shadowBlur = 18;

    ctx.strokeStyle =
      'rgba(127, 29, 29, 0.75)';

    ctx.lineWidth = 3;

    ctx.beginPath();

    ctx.roundRect(
      0,
      0,
      ARENA_WIDTH,
      ARENA_HEIGHT,
      24,
    );

    ctx.stroke();

    /*
     * Inner border.
     */

    ctx.shadowBlur = 0;

    ctx.strokeStyle =
      'rgba(148, 163, 184, 0.08)';

    ctx.lineWidth = 1;

    ctx.beginPath();

    ctx.roundRect(
      7,
      7,
      ARENA_WIDTH - 14,
      ARENA_HEIGHT - 14,
      19,
    );

    ctx.stroke();

    ctx.restore();

    /*
     * --------------------------------------------------
     * CORNER WARNING LIGHTS
     * --------------------------------------------------
     */

    this.drawWarningLight(
      ctx,
      22,
      22,
      now,
    );

    this.drawWarningLight(
      ctx,
      ARENA_WIDTH - 22,
      22,
      now,
    );

    this.drawWarningLight(
      ctx,
      22,
      ARENA_HEIGHT - 22,
      now,
    );

    this.drawWarningLight(
      ctx,
      ARENA_WIDTH - 22,
      ARENA_HEIGHT - 22,
      now,
    );

    /*
     * --------------------------------------------------
     * OBSTACLES
     * --------------------------------------------------
     */

    for (const rect of OBSTACLES) {
      this.drawObstacle(
        ctx,
        rect,
      );
    }
  }

  /*
   * ==================================================
   * HAZARD STRIP
   * ==================================================
   */

  private drawHazardStrip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    ctx.save();

    ctx.globalAlpha = 0.45;

    ctx.fillStyle =
      '#020406';

    ctx.fillRect(
      x,
      y,
      width,
      height,
    );

    ctx.strokeStyle =
      'rgba(239, 68, 68, 0.35)';

    ctx.lineWidth = 1;

    ctx.strokeRect(
      x,
      y,
      width,
      height,
    );

    ctx.strokeStyle =
      'rgba(239, 68, 68, 0.22)';

    ctx.lineWidth = 5;

    for (
      let offset = -height;
      offset < width;
      offset += 18
    ) {
      ctx.beginPath();

      ctx.moveTo(
        x + offset,
        y + height,
      );

      ctx.lineTo(
        x + offset + height,
        y,
      );

      ctx.stroke();
    }

    ctx.restore();
  }

  /*
   * ==================================================
   * CONTAMINATION MARK
   * ==================================================
   */

  private drawContaminationMark(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    direction: number,
  ): void {
    ctx.save();

    ctx.globalAlpha = 0.18;

    ctx.strokeStyle =
      '#991b1b';

    ctx.lineWidth = 5;

    ctx.lineCap = 'round';

    ctx.beginPath();

    ctx.moveTo(
      x,
      y,
    );

    ctx.lineTo(
      x + 35 * direction,
      y + 12,
    );

    ctx.lineTo(
      x + 58 * direction,
      y - 8,
    );

    ctx.stroke();

    ctx.lineWidth = 2;

    ctx.beginPath();

    ctx.moveTo(
      x + 18 * direction,
      y + 4,
    );

    ctx.lineTo(
      x + 10 * direction,
      y + 22,
    );

    ctx.stroke();

    ctx.restore();
  }

  /*
   * ==================================================
   * WARNING LIGHT
   * ==================================================
   */

  private drawWarningLight(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    now: number,
  ): void {
    const blink =
      0.45 +
      Math.sin(now / 500) *
        0.25;

    ctx.save();

    ctx.shadowColor =
      'rgba(239, 68, 68, 0.8)';

    ctx.shadowBlur = 12;

    ctx.globalAlpha = blink;

    ctx.fillStyle =
      '#ef4444';

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      4,
      0,
      Math.PI * 2,
    );

    ctx.fill();

    ctx.restore();
  }

  /*
   * ==================================================
   * OBSTACLE
   * ==================================================
   */

  private drawObstacle(
  ctx: CanvasRenderingContext2D,
  rect: {
    x: number;
    y: number;
    w: number;
    h: number;
  },
): void {
  const isVertical = rect.h > rect.w;

  // Deep shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;

  ctx.fillStyle = '#030507';

  ctx.beginPath();
  ctx.roundRect(
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    10,
  );
  ctx.fill();

  ctx.restore();

  // Red emergency glow
  ctx.save();

  ctx.shadowColor = 'rgba(239, 68, 68, 0.25)';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.roundRect(
    rect.x - 1,
    rect.y - 1,
    rect.w + 2,
    rect.h + 2,
    10,
  );
  ctx.stroke();

  ctx.restore();

  // Main metal body
  const gradient = ctx.createLinearGradient(
    rect.x,
    rect.y,
    rect.x + rect.w,
    rect.y + rect.h,
  );

  gradient.addColorStop(0, '#334454');
  gradient.addColorStop(0.35, '#1d2b37');
  gradient.addColorStop(0.7, '#111b24');
  gradient.addColorStop(1, '#070c11');

  ctx.fillStyle = gradient;

  ctx.beginPath();
  ctx.roundRect(
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    9,
  );
  ctx.fill();

  // Inner dark panel
  ctx.fillStyle = 'rgba(2, 6, 10, 0.55)';

  ctx.beginPath();
  ctx.roundRect(
    rect.x + 7,
    rect.y + 7,
    rect.w - 14,
    rect.h - 14,
    6,
  );
  ctx.fill();

  // Outer metal border
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.roundRect(
    rect.x,
    rect.y,
    rect.w,
    rect.h,
    9,
  );
  ctx.stroke();

  // Top hazard strip
  ctx.save();

  ctx.beginPath();
  ctx.roundRect(
    rect.x + 7,
    rect.y + 6,
    rect.w - 14,
    10,
    3,
  );
  ctx.clip();

  ctx.fillStyle = '#13090a';

  ctx.fillRect(
    rect.x + 7,
    rect.y + 6,
    rect.w - 14,
    10,
  );

  ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)';
  ctx.lineWidth = 5;

  for (
    let offset = -rect.h;
    offset < rect.w + rect.h;
    offset += 14
  ) {
    ctx.beginPath();

    ctx.moveTo(
      rect.x + offset,
      rect.y + 17,
    );

    ctx.lineTo(
      rect.x + offset + 9,
      rect.y + 4,
    );

    ctx.stroke();
  }

  ctx.restore();

  // Red warning light
  ctx.save();

  const lightX = rect.x + rect.w - 13;
  const lightY = rect.y + 11;

  ctx.shadowColor = 'rgba(239, 68, 68, 0.95)';
  ctx.shadowBlur = 14;

  ctx.fillStyle = '#ef4444';

  ctx.beginPath();
  ctx.arc(
    lightX,
    lightY,
    3,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.restore();

  // Central control panel
  const panelWidth = Math.max(
    22,
    Math.min(
      rect.w - 18,
      isVertical ? rect.w - 16 : rect.w * 0.45,
    ),
  );

  const panelHeight = Math.max(
    20,
    Math.min(
      rect.h - 30,
      isVertical ? rect.h * 0.25 : rect.h - 18,
    ),
  );

  const panelX =
    rect.x + (rect.w - panelWidth) / 2;

  const panelY =
    rect.y + (rect.h - panelHeight) / 2;

  ctx.save();

  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 8;

  ctx.fillStyle = '#071019';

  ctx.beginPath();
  ctx.roundRect(
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    4,
  );
  ctx.fill();

  ctx.restore();

  ctx.strokeStyle = 'rgba(100, 116, 139, 0.7)';
  ctx.lineWidth = 1;

  ctx.beginPath();
  ctx.roundRect(
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    4,
  );
  ctx.stroke();

  // Blue control screen
  const screenWidth = Math.max(
    10,
    panelWidth - 10,
  );

  const screenHeight = Math.max(
    5,
    Math.min(
      11,
      panelHeight * 0.28,
    ),
  );

  const screenX =
    panelX + (panelWidth - screenWidth) / 2;

  const screenY = panelY + 5;

  const screenGradient =
    ctx.createLinearGradient(
      screenX,
      screenY,
      screenX,
      screenY + screenHeight,
    );

  screenGradient.addColorStop(
    0,
    '#164e63',
  );

  screenGradient.addColorStop(
    1,
    '#082f49',
  );

  ctx.fillStyle = screenGradient;

  ctx.beginPath();
  ctx.roundRect(
    screenX,
    screenY,
    screenWidth,
    screenHeight,
    2,
  );
  ctx.fill();

  // Screen line
  ctx.strokeStyle =
    'rgba(125, 211, 252, 0.6)';

  ctx.lineWidth = 1;

  ctx.beginPath();

  ctx.moveTo(
    screenX + 3,
    screenY + screenHeight / 2,
  );

  ctx.lineTo(
    screenX + screenWidth - 3,
    screenY + screenHeight / 2,
  );

  ctx.stroke();

  // Ventilation grill
  ctx.save();

  ctx.strokeStyle =
    'rgba(148, 163, 184, 0.45)';

  ctx.lineWidth = 2;

  if (isVertical) {
    for (let i = 0; i < 4; i++) {
      const ventY =
        rect.y +
        rect.h * 0.56 +
        i * 7;

      ctx.beginPath();

      ctx.moveTo(
        rect.x + 10,
        ventY,
      );

      ctx.lineTo(
        rect.x + rect.w - 10,
        ventY,
      );

      ctx.stroke();
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const ventX =
        rect.x +
        rect.w * 0.56 +
        i * 7;

      ctx.beginPath();

      ctx.moveTo(
        ventX,
        rect.y + 22,
      );

      ctx.lineTo(
        ventX,
        rect.y + rect.h - 10,
      );

      ctx.stroke();
    }
  }

  ctx.restore();

  // Biohazard symbol
  ctx.save();

  const bioX = isVertical
    ? rect.x + rect.w / 2
    : rect.x + rect.w * 0.76;

  const bioY = isVertical
    ? rect.y + rect.h * 0.78
    : rect.y + rect.h / 2;

  ctx.strokeStyle =
    'rgba(239, 68, 68, 0.55)';

  ctx.lineWidth = 1.5;

  ctx.beginPath();

  ctx.arc(
    bioX,
    bioY,
    8,
    0,
    Math.PI * 2,
  );

  ctx.stroke();

  for (let i = 0; i < 3; i++) {
    const angle =
      i * ((Math.PI * 2) / 3) -
      Math.PI / 2;

    ctx.beginPath();

    ctx.arc(
      bioX +
        Math.cos(angle) * 4,
      bioY +
        Math.sin(angle) * 4,
      3.5,
      angle - 1,
      angle + 1,
    );

    ctx.stroke();
  }

  ctx.fillStyle =
    'rgba(239, 68, 68, 0.6)';

  ctx.beginPath();

  ctx.arc(
    bioX,
    bioY,
    2,
    0,
    Math.PI * 2,
  );

  ctx.fill();

  ctx.restore();

  // Corner bolts
  const bolts: Array<[number, number]> = [
    [
      rect.x + 10,
      rect.y + 22,
    ],
    [
      rect.x + rect.w - 10,
      rect.y + 22,
    ],
    [
      rect.x + 10,
      rect.y + rect.h - 10,
    ],
    [
      rect.x + rect.w - 10,
      rect.y + rect.h - 10,
    ],
  ];

  for (const [boltX, boltY] of bolts) {
    ctx.save();

    ctx.fillStyle = '#475569';
    ctx.strokeStyle =
      'rgba(226, 232, 240, 0.35)';

    ctx.lineWidth = 1;

    ctx.beginPath();

    ctx.arc(
      boltX,
      boltY,
      3,
      0,
      Math.PI * 2,
    );

    ctx.fill();
    ctx.stroke();

    ctx.fillStyle =
      'rgba(255, 255, 255, 0.35)';

    ctx.beginPath();

    ctx.arc(
      boltX - 1,
      boltY - 1,
      0.8,
      0,
      Math.PI * 2,
    );

    ctx.fill();

    ctx.restore();
  }

  // Damage scratches
  ctx.save();

  ctx.strokeStyle =
    'rgba(226, 232, 240, 0.16)';

  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';

  ctx.beginPath();

  ctx.moveTo(
    rect.x + rect.w * 0.2,
    rect.y + rect.h * 0.35,
  );

  ctx.lineTo(
    rect.x + rect.w * 0.3,
    rect.y + rect.h * 0.42,
  );

  ctx.lineTo(
    rect.x + rect.w * 0.37,
    rect.y + rect.h * 0.32,
  );

  ctx.stroke();

  ctx.beginPath();

  ctx.moveTo(
    rect.x + rect.w * 0.62,
    rect.y + rect.h * 0.72,
  );

  ctx.lineTo(
    rect.x + rect.w * 0.7,
    rect.y + rect.h * 0.67,
  );

  ctx.lineTo(
    rect.x + rect.w * 0.77,
    rect.y + rect.h * 0.74,
  );

  ctx.stroke();

  ctx.restore();

  // Bottom emergency status line
  ctx.save();

  ctx.strokeStyle =
    'rgba(239, 68, 68, 0.65)';

  ctx.lineWidth = 2;

  ctx.beginPath();

  ctx.moveTo(
    rect.x + 7,
    rect.y + rect.h - 6,
  );

  ctx.lineTo(
    rect.x + rect.w - 7,
    rect.y + rect.h - 6,
  );

  ctx.stroke();

  ctx.restore();
}

  /*
   * ==================================================
   * PLAYER
   * ==================================================
   */

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    player: {
      x: number;
      y: number;
      color: string;
      nickname: string;
      role: 'survivor' | 'zombie';
      vaccines: number;
      isSelf: boolean;
      sprinting: boolean;
      now: number;
    },
  ): void {
    const {
      x,
      y,
    } = player;

    const isZombie =
      player.role === 'zombie';

    const roleColor =
      isZombie
        ? ZOMBIE_COLOR
        : SURVIVOR_COLOR;

    const roleGlow =
      isZombie
        ? ZOMBIE_GLOW
        : SURVIVOR_GLOW;

    /*
     * ==================================================
     * SPRINT EFFECT
     * ==================================================
     */

    if (player.sprinting) {
      ctx.save();

      ctx.globalAlpha = 0.12;

      ctx.fillStyle =
        roleColor;

      ctx.beginPath();

      ctx.arc(
        x,
        y,
        PLAYER_RADIUS * 2,
        0,
        Math.PI * 2,
      );

      ctx.fill();

      ctx.globalAlpha = 0.05;

      ctx.beginPath();

      ctx.arc(
        x,
        y,
        PLAYER_RADIUS * 2.7,
        0,
        Math.PI * 2,
      );

      ctx.fill();

      ctx.restore();
    }

    /*
     * ==================================================
     * FLASHLIGHT / PLAYER LIGHT
     * ==================================================
     */

    const playerLight =
      ctx.createRadialGradient(
        x,
        y,
        PLAYER_RADIUS,
        x,
        y,
        PLAYER_RADIUS * 4,
      );

    playerLight.addColorStop(
      0,
      isZombie
        ? 'rgba(251, 54, 92, 0.16)'
        : 'rgba(52, 211, 153, 0.12)',
    );

    playerLight.addColorStop(
      1,
      'rgba(0, 0, 0, 0)',
    );

    ctx.fillStyle =
      playerLight;

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      PLAYER_RADIUS * 4,
      0,
      Math.PI * 2,
    );

    ctx.fill();

    /*
     * ==================================================
     * MAIN PLAYER BODY
     * ==================================================
     */

    ctx.save();

    ctx.shadowColor =
      roleGlow;

    ctx.shadowBlur =
      player.sprinting
        ? 34
        : 22;

    ctx.fillStyle =
      roleColor;

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      PLAYER_RADIUS,
      0,
      Math.PI * 2,
    );

    ctx.fill();

    ctx.restore();

    /*
     * ==================================================
     * ROLE RING
     * ==================================================
     */

    ctx.save();

    ctx.strokeStyle =
      roleColor;

    ctx.globalAlpha = 0.85;

    ctx.lineWidth = 3;

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      PLAYER_RADIUS + 5,
      0,
      Math.PI * 2,
    );

    ctx.stroke();

    ctx.restore();

    /*
     * ==================================================
     * ZOMBIE
     * ==================================================
     */

    if (isZombie) {
      const pulse =
        1 +
        Math.sin(
          player.now / 180,
        ) *
          0.1;

      ctx.save();

      ctx.shadowColor =
        'rgba(251, 54, 92, 0.8)';

      ctx.shadowBlur = 18;

      ctx.strokeStyle =
        'rgba(251, 54, 92, 0.75)';

      ctx.lineWidth = 2;

      ctx.globalAlpha = 0.8;

      ctx.beginPath();

      ctx.arc(
        x,
        y,
        (PLAYER_RADIUS + 12) *
          pulse,
        0,
        Math.PI * 2,
      );

      ctx.stroke();

      ctx.restore();

      /*
       * Zombie icon.
       */

      ctx.save();

      ctx.font =
        '700 12px ui-sans-serif, system-ui, sans-serif';

      ctx.textAlign =
        'center';

      ctx.textBaseline =
        'middle';

      ctx.fillStyle =
        '#fb7185';

      ctx.fillText(
        '🧟',
        x,
        y - PLAYER_RADIUS - 25,
      );

      ctx.restore();

      /*
       * Small danger triangles.
       */

      ctx.save();

      ctx.fillStyle =
        'rgba(251, 54, 92, 0.65)';

      for (
        let i = 0;
        i < 3;
        i++
      ) {
        const angle =
          player.now / 800 +
          i *
            ((Math.PI * 2) / 3);

        const markerX =
          x +
          Math.cos(angle) *
            (PLAYER_RADIUS + 18);

        const markerY =
          y +
          Math.sin(angle) *
            (PLAYER_RADIUS + 18);

        ctx.beginPath();

        ctx.arc(
          markerX,
          markerY,
          2,
          0,
          Math.PI * 2,
        );

        ctx.fill();
      }

      ctx.restore();
    }

    /*
     * ==================================================
     * SURVIVOR
     * ==================================================
     */

    if (!isZombie) {
      ctx.save();

      ctx.strokeStyle =
        'rgba(52, 211, 153, 0.5)';

      ctx.lineWidth = 2;

      ctx.beginPath();

      ctx.arc(
        x,
        y,
        PLAYER_RADIUS + 9,
        0,
        Math.PI * 2,
      );

      ctx.stroke();

      ctx.restore();
    }

    /*
     * ==================================================
     * VACCINE SHIELD
     * ==================================================
     */

    if (
      !isZombie &&
      player.vaccines > 0
    ) {
      ctx.save();

      const shieldPulse =
        1 +
        Math.sin(
          player.now / 300,
        ) *
          0.04;

      ctx.shadowColor =
        'rgba(56, 189, 248, 0.9)';

      ctx.shadowBlur = 16;

      ctx.strokeStyle =
        VACCINE_COLOR;

      ctx.globalAlpha = 0.9;

      ctx.lineWidth = 2.5;

      ctx.setLineDash([
        6,
        4,
      ]);

      ctx.beginPath();

      ctx.arc(
        x,
        y,
        (PLAYER_RADIUS + 16) *
          shieldPulse,
        0,
        Math.PI * 2,
      );

      ctx.stroke();

      ctx.setLineDash([]);

      ctx.restore();

      /*
       * Vaccine counter.
       */

      ctx.save();

      ctx.font =
        '700 11px ui-sans-serif, system-ui, sans-serif';

      ctx.textAlign =
        'center';

      ctx.textBaseline =
        'middle';

      ctx.fillStyle =
        '#7dd3fc';

      ctx.fillText(
        `💉 ${String(player.vaccines)}`,
        x,
        y + PLAYER_RADIUS + 22,
      );

      ctx.restore();
    }

    /*
     * ==================================================
     * SELF INDICATOR
     * ==================================================
     */

    if (player.isSelf) {
      ctx.save();

      ctx.strokeStyle =
        SELF_COLOR;

      ctx.globalAlpha = 0.9;

      ctx.lineWidth = 2;

      ctx.setLineDash([
        3,
        5,
      ]);

      ctx.beginPath();

      ctx.arc(
        x,
        y,
        PLAYER_RADIUS + 22,
        0,
        Math.PI * 2,
      );

      ctx.stroke();

      ctx.setLineDash([]);

      ctx.restore();

      /*
       * Four direction markers.
       */

      ctx.save();

      ctx.fillStyle =
        SELF_COLOR;

      const markerDistance =
        PLAYER_RADIUS + 26;

      for (
        let i = 0;
        i < 4;
        i++
      ) {
        const angle =
          i *
          (Math.PI / 2);

        const markerX =
          x +
          Math.cos(angle) *
            markerDistance;

        const markerY =
          y +
          Math.sin(angle) *
            markerDistance;

        ctx.beginPath();

        ctx.arc(
          markerX,
          markerY,
          2.5,
          0,
          Math.PI * 2,
        );

        ctx.fill();
      }

      ctx.restore();
    }

    /*
     * ==================================================
     * PLAYER CENTER
     * ==================================================
     */

    ctx.save();

    ctx.fillStyle =
      player.color;

    ctx.globalAlpha = 0.85;

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      PLAYER_RADIUS * 0.72,
      0,
      Math.PI * 2,
    );

    ctx.fill();

    ctx.restore();

    /*
     * ==================================================
     * PLAYER NAME
     * ==================================================
     */

    ctx.save();

    ctx.font =
      '600 15px ui-sans-serif, system-ui, sans-serif';

    ctx.textAlign =
      'center';

    ctx.textBaseline =
      'bottom';

    const nameY =
      y -
      PLAYER_RADIUS -
      (isZombie ? 34 : 16);

    const textWidth =
      ctx.measureText(
        player.nickname,
      ).width;

    /*
     * Name background.
     */

    ctx.fillStyle =
      'rgba(2, 5, 8, 0.82)';

    ctx.beginPath();

    ctx.roundRect(
      x - textWidth / 2 - 7,
      nameY - 17,
      textWidth + 14,
      21,
      6,
    );

    ctx.fill();

    /*
     * Name text.
     */

    ctx.fillStyle =
      player.isSelf
        ? '#ffffff'
        : isZombie
          ? '#fecdd3'
          : '#d1fae5';

    ctx.fillText(
      player.nickname,
      x,
      nameY,
    );

    ctx.restore();
  }

  /*
   * ==================================================
   * INFECTION FLASH
   * ==================================================
   */

  private drawFlashes(
    ctx: CanvasRenderingContext2D,
    now: number,
  ): void {
    this.flashes =
      this.flashes.filter(
        (flash) =>
          now - flash.at <
          FLASH_MS,
      );

    for (const flash of this.flashes) {
      const t =
        (now - flash.at) /
        FLASH_MS;

      const radius =
        PLAYER_RADIUS *
        (1.2 + t * 6);

      /*
       * Outer infection ring.
       */

      ctx.save();

      ctx.globalAlpha =
        (1 - t) * 0.95;

      ctx.shadowColor =
        'rgba(251, 54, 92, 0.8)';

      ctx.shadowBlur = 18;

      ctx.strokeStyle =
        '#fb7185';

      ctx.lineWidth =
        7 * (1 - t) + 1;

      ctx.beginPath();

      ctx.arc(
        flash.x,
        flash.y,
        radius,
        0,
        Math.PI * 2,
      );

      ctx.stroke();

      /*
       * Inner red flash.
       */

      ctx.globalAlpha =
        (1 - t) * 0.25;

      ctx.fillStyle =
        '#fda4af';

      ctx.beginPath();

      ctx.arc(
        flash.x,
        flash.y,
        radius * 0.7,
        0,
        Math.PI * 2,
      );

      ctx.fill();

      ctx.restore();
    }
  }
}