/**
 * 播放器底栏上的键盘字条。
 * 每个按下（0xFC）的字心落在它自己的时间上；空档就是空白，播放时整条跟着针滚。
 * 尺度固定（不跟时间轴缩放），这样打字速度下能读出字。
 */

type KeyGlyph = { ts: number; ch: string };

const PX_PER_MS = 0.11;
/** 针在字条宽度上的位置：左侧是刚打过的，右侧是还没滚到的 */
const NEEDLE_FRAC = 0.36;

const SHIFT_DIGITS = ")!@#$%^&*(";
const OEM: Record<number, [string, string]> = {
  186: [";", ":"],
  187: ["=", "+"],
  188: [",", "<"],
  189: ["-", "_"],
  190: [".", ">"],
  191: ["/", "?"],
  192: ["`", "~"],
  219: ["[", "{"],
  220: ["\\", "|"],
  221: ["]", "}"],
  222: ["'", '"'],
};

let glyphs: KeyGlyph[] = [];
let shiftDown = 0;
let capsOn = false;
let canvas: HTMLCanvasElement | null = null;

export function resetKeyTape() {
  glyphs = [];
  shiftDown = 0;
  capsOn = false;
}

function isShift(code: number) {
  return code === 16 || code === 160 || code === 161;
}

function glyphFor(code: number, shift: boolean): string | null {
  if (code >= 65 && code <= 90) {
    const upper = shift !== capsOn;
    const ch = String.fromCharCode(code);
    return upper ? ch : ch.toLowerCase();
  }
  if (code >= 48 && code <= 57) {
    return shift ? SHIFT_DIGITS[code - 48]! : String.fromCharCode(code);
  }
  const oem = OEM[code];
  if (oem) return shift ? oem[1] : oem[0];
  if (code === 32) return "␣";
  if (code === 13) return "⏎";
  if (code === 8) return "⌫";
  if (code === 9) return "⇥";
  return null;
}

/** 按时间顺序喂入。抬起只用来维护 Shift。 */
export function ingestKeyEvent(ts: number, code: number, down: boolean) {
  if (!(ts > 0) || !Number.isFinite(code)) return;
  if (isShift(code)) {
    shiftDown += down ? 1 : -1;
    if (shiftDown < 0) shiftDown = 0;
    return;
  }
  if (code === 20 && down) {
    capsOn = !capsOn;
    return;
  }
  if (!down) return;
  const ch = glyphFor(code, shiftDown > 0);
  if (!ch) return;
  const last = glyphs[glyphs.length - 1];
  if (last && ts < last.ts) {
    let i = glyphs.length - 1;
    while (i > 0 && glyphs[i - 1]!.ts > ts) i--;
    glyphs.splice(i, 0, { ts, ch });
    return;
  }
  glyphs.push({ ts, ch });
}

function lowerBound(ts: number): number {
  let lo = 0;
  let hi = glyphs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (glyphs[mid]!.ts < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 回车：先向下再向左，比字体里的 ⏎ 粗，缩在字条里也能认出来。 */
function drawReturnArrow(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle as string;
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x + 4.5, y - 6.5);
  ctx.lineTo(x + 4.5, y + 4);
  ctx.lineTo(x - 3, y + 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 7.5, y + 4);
  ctx.lineTo(x - 2.2, y + 0.6);
  ctx.lineTo(x - 2.2, y + 7.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function paintKeyTape(needleTs: number) {
  if (!canvas) canvas = document.getElementById("player-keytape") as HTMLCanvasElement | null;
  const el = canvas;
  if (!el) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = el.clientWidth || 600;
  const cssH = el.clientHeight || 28;
  const w = Math.floor(cssW * dpr);
  const h = Math.floor(cssH * dpr);
  if (el.width !== w || el.height !== h) {
    el.width = w;
    el.height = h;
  }
  const ctx = el.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const bg = cssVar("--input-bg", "#f3f0eb");
  const text = cssVar("--text", "#2a2a2a");
  const muted = cssVar("--muted", "#6a6560");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssW, cssH);

  const midY = cssH / 2;

  const needle = needleTs > 0 ? needleTs : 0;
  const originX = cssW * NEEDLE_FRAC;
  if (glyphs.length && needle > 0) {
    const t0 = needle - (originX + 24) / PX_PER_MS;
    const t1 = needle + (cssW - originX + 24) / PX_PER_MS;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cssW, cssH);
    ctx.clip();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const textFont = '13px "Cascadia Mono", "Noto Sans SC", sans-serif';
    const symbolFont = '15px "Segoe UI Symbol", "Segoe UI", sans-serif';
    for (let i = lowerBound(t0); i < glyphs.length; i++) {
      const g = glyphs[i]!;
      if (g.ts > t1) break;
      const x = originX + (g.ts - needle) * PX_PER_MS;
      const ahead = g.ts > needle;
      const symbol = g.ch === "␣" || g.ch === "⏎" || g.ch === "⌫" || g.ch === "⇥";
      ctx.font = symbol ? symbolFont : textFont;
      ctx.fillStyle = g.ch === "␣" ? muted : ahead ? muted : text;
      ctx.globalAlpha = g.ch === "␣" ? 0.55 : ahead ? 0.72 : 1;
      if (g.ch === "⏎") drawReturnArrow(ctx, x, midY);
      else ctx.fillText(g.ch, x, midY);
    }
    ctx.restore();
  }

  if (needle > 0) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#c62828";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(originX, 2);
    ctx.lineTo(originX, cssH - 2);
    ctx.stroke();
  }
}
