/**
 * 实验：逐字击键 → 横向时间轴。
 * 打开：omniplayer/ 下 `npm run dev` → http://127.0.0.1:1420/experiments/notes_timeline_chars.html
 *
 * 缩放 / 平移 / 刻度复用仪表盘：
 *   ../src/time_view_nav.ts
 *   ../src/time_axis.ts
 * 勿从此文件接入正式笔记页。
 */

import { buildTimeTicks, tickLabelCursor } from "../src/time_axis";
import {
  LONG_PRESS_MS,
  CLICK_SLOP_PX,
  clampTimeView,
  applyZoomFactor,
  createInertiaState,
  stopInertia,
  handleTimeAxisWheel,
  installAltZoomGuard,
  type TimeView,
} from "../src/time_view_nav";
type Glyph = {
  /** 插入顺序：时间戳相同时稳定排序 */
  id: number;
  ch: string;
  ts: number;
  /** 绘制字号下的 CSS 像素宽度 */
  w: number;
  x: number;
  /** 重叠堆叠内行号（负=上，正=下） */
  lane: number;
  /** 堆叠竖直居中用的行界（含端点） */
  stackMin: number;
  stackMax: number;
};

type SampleSession = {
  id: string;
  label: string;
  preview: string;
  glyph_count: number;
  span_ms: number;
  uniq_ts: number;
  glyphs: Array<{ ch: string; ts: number; dt_ms?: number }>;
};

type SamplePack = {
  note?: string;
  key_downs?: number[];
  key_down_count?: number;
  sessions: SampleSession[];
};

const PAD_L = 16;
const PAD_R = 16;
const AXIS_Y_FRAC = 0.52;
/** Vertical pitch between glyph row centers */
const LANE_OFFSET_PX = 22;
const GLYPH_PAD_PX = 1.5;
const MAX_LANE_RING = 48;
const INITIAL_SPAN_MS = 8_000;
const FIT_PAD_RATIO = 0.12;
const FIT_MIN_SPAN_MS = 400;

const canvas = document.getElementById("timeline") as HTMLCanvasElement;
const input = document.getElementById("type-input") as HTMLInputElement;
const metaEl = document.getElementById("view-meta") as HTMLSpanElement;
const sampleSelect = document.getElementById("sample-select") as HTMLSelectElement;
const btnLoadSample = document.getElementById("btn-load-sample") as HTMLButtonElement;
const btnToggleKeys = document.getElementById("btn-toggle-keys") as HTMLButtonElement;
const btnZoomIn = document.getElementById("btn-zoom-in") as HTMLButtonElement;
const btnZoomOut = document.getElementById("btn-zoom-out") as HTMLButtonElement;
const btnFit = document.getElementById("btn-fit") as HTMLButtonElement;
const btnClear = document.getElementById("btn-clear") as HTMLButtonElement;

/** 可选本地素材（从 OmniDatabase 导出，不进 Git）。没有文件时实验仍可手打。 */
let pack: SamplePack = { sessions: [] };
let keyDownTs: number[] = [];

const now0 = Date.now();
let viewStart = now0 - INITIAL_SPAN_MS * 0.35;
let viewEnd = viewStart + INITIAL_SPAN_MS;
let glyphs: Glyph[] = [];
let nextGlyphId = 1;
/** 输入框已同步文本（含空格），用于增量重建。 */
let typedText = "";
let showKeySignals = true;
let activeSampleLabel = "";

let dpr = 1;
let raf = 0;
let pointerOver = false;
const inertia = createInertiaState();

type PanState = {
  pointerId: number;
  startX: number;
  startY: number;
  viewStart: number;
  viewEnd: number;
  armed: boolean;
  timer: number | null;
  moved: boolean;
};
let pan: PanState | null = null;

function getView(): TimeView {
  return { start: viewStart, end: viewEnd };
}
function setView(v: TimeView) {
  viewStart = v.start;
  viewEnd = v.end;
}

function plotGeom() {
  const w = canvas.clientWidth || 800;
  const h = canvas.clientHeight || 360;
  const plotLeft = PAD_L;
  const plotW = Math.max(40, w - PAD_L - PAD_R);
  const axisY = Math.round(h * AXIS_Y_FRAC);
  return { w, h, plotLeft, plotW, axisY };
}

function xOf(ts: number, plotLeft: number, plotW: number): number {
  const span = Math.max(1, viewEnd - viewStart);
  return plotLeft + ((ts - viewStart) / span) * plotW;
}

function measureGlyphWidth(ctx: CanvasRenderingContext2D, ch: string): number {
  if (ch === " ") return Math.max(6, ctx.measureText(" ").width);
  return Math.max(4, ctx.measureText(ch).width);
}

function boxesOverlap(a: Glyph, b: Glyph): boolean {
  const aL = a.x - a.w / 2 - GLYPH_PAD_PX;
  const aR = a.x + a.w / 2 + GLYPH_PAD_PX;
  const bL = b.x - b.w / 2 - GLYPH_PAD_PX;
  const bR = b.x + b.w / 2 + GLYPH_PAD_PX;
  return aL < bR && aR > bL;
}

/**
 * 重叠换行：左→上 / 右→下，可扩到多行。
 * 1. 按时间戳从左到右排（同刻按插入 id）。
 * 2. 与前一字水平不撞 → 落在 0 行，开启新堆叠。
 * 3. 堆叠内第一次碰撞：前一字抬到 −1，当前字落到 +1。
 * 4. 后续字优先落在前一字的对侧。
 * 5. 该侧仍撞 → 同圈另一侧；两侧都满 → 外扩 ±2、±3…
 * 6. 连通堆叠记录 stackMin/stackMax，绘制时竖直居中到时间轴。
 */
function assignLanes(list: Glyph[]) {
  const sorted = [...list].sort((a, b) => a.ts - b.ts || a.id - b.id);
  let lastAny: Glyph | null = null;
  let lastByLane = new Map<number, Glyph>();
  let run: Glyph[] = [];

  const flushRun = () => {
    if (!run.length) return;
    let lo = run[0]!.lane;
    let hi = lo;
    for (const g of run) {
      if (g.lane < lo) lo = g.lane;
      if (g.lane > hi) hi = g.lane;
    }
    for (const g of run) {
      g.stackMin = lo;
      g.stackMax = hi;
    }
    run = [];
  };

  const placeOnLane = (g: Glyph, lane: number) => {
    g.lane = lane;
    lastByLane.set(lane, g);
  };

  /** Prefer sign (−1 上 / +1 下)；逐圈外扩直到找到空行。 */
  const pickExpanding = (g: Glyph, preferredSign: -1 | 1): number => {
    for (let ring = 1; ring <= MAX_LANE_RING; ring++) {
      const first = preferredSign * ring;
      const second = -preferredSign * ring;
      const hitFirst = lastByLane.get(first);
      if (!hitFirst || !boxesOverlap(g, hitFirst)) return first;
      const hitSecond = lastByLane.get(second);
      if (!hitSecond || !boxesOverlap(g, hitSecond)) return second;
    }
    return preferredSign * MAX_LANE_RING;
  };

  for (const g of sorted) {
    g.lane = 0;
    g.stackMin = 0;
    g.stackMax = 0;

    if (!lastAny || !boxesOverlap(g, lastAny)) {
      flushRun();
      lastByLane = new Map();
      placeOnLane(g, 0);
      run = [g];
      lastAny = g;
      continue;
    }

    // 仍在同一重叠链
    let preferredSign: -1 | 1;
    if (lastAny.lane === 0) {
      // 打开第一对：左→上，右→下
      lastByLane.delete(0);
      placeOnLane(lastAny, -1);
      preferredSign = 1;
    } else {
      preferredSign = lastAny.lane < 0 ? 1 : -1;
    }

    placeOnLane(g, pickExpanding(g, preferredSign));
    run.push(g);
    lastAny = g;
  }
  flushRun();
}

/** 将 lane 映射到 y，使 [stackMin, stackMax] 的竖直中心落在轴上。 */
function laneToY(lane: number, stackMin: number, stackMax: number, axisY: number): number {
  const center = (stackMin + stackMax) / 2;
  return axisY + (lane - center) * LANE_OFFSET_PX;
}

function scheduleDraw() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    draw();
  });
}

function formatSpan(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} 毫秒`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} 秒`;
  if (ms < 3600_000) return `${(ms / 60_000).toFixed(2)} 分`;
  if (ms < DAY_MS) return `${(ms / 3600_000).toFixed(2)} 小时`;
  return `${(ms / DAY_MS).toFixed(2)} 天`;
}

const DAY_MS = 86_400_000;

function updateMeta(rowCount = 0) {
  const span = viewEnd - viewStart;
  const rows = rowCount > 0 ? ` · ${rowCount} 行` : "";
  const src = activeSampleLabel ? ` · ${activeSampleLabel}` : "";
  const keys =
    showKeySignals && keyDownTs.length
      ? ` · 键下 ${keyDownTs.length}`
      : "";
  metaEl.textContent = `${glyphs.length} 字${rows}${src}${keys} · 视窗 ${formatSpan(span)}`;
}

function glyphFill(lane: number, stackMin: number, stackMax: number): string {
  const center = (stackMin + stackMax) / 2;
  if (Math.abs(lane - center) < 0.01) return "#3d3a34";
  return lane < center ? "#2f6f5e" : "#b35a2e";
}

function draw() {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { w, h, plotLeft, plotW, axisY } = plotGeom();
  dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#faf8f4";
  ctx.fillRect(0, 0, w, h);

  // axis
  ctx.strokeStyle = "#8a8478";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(plotLeft, axisY);
  ctx.lineTo(plotLeft + plotW, axisY);
  ctx.stroke();

  // 键盘按下信号（同日 bin 0xFC），淡竖线对照
  if (showKeySignals && keyDownTs.length) {
    const lo = viewStart;
    const hi = viewEnd;
    ctx.strokeStyle = "rgba(91,110,166,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    let drawn = 0;
    const maxDraw = 4000;
    for (const kt of keyDownTs) {
      if (kt < lo || kt > hi) continue;
      const x = xOf(kt, plotLeft, plotW);
      ctx.moveTo(x, axisY + 4);
      ctx.lineTo(x, axisY + 14);
      drawn++;
      if (drawn >= maxDraw) break;
    }
    ctx.stroke();
  }

  const span = Math.max(1, viewEnd - viewStart);
  const ticks = buildTimeTicks(viewStart, viewEnd, plotW);
  const labelCursor = tickLabelCursor(12);
  ctx.font =
    span <= 30_000
      ? '12px "Cascadia Mono", "Consolas", monospace'
      : '12px "Noto Sans SC", "Segoe UI", sans-serif';
  ctx.fillStyle = "#6e6a62";
  ctx.strokeStyle = "#c4beb4";

  for (const tick of ticks) {
    const x = xOf(tick.ts, plotLeft, plotW);
    if (x < plotLeft - 2 || x > plotLeft + plotW + 2) continue;
    const len = tick.rank === "major" ? 8 : tick.rank === "mid" ? 5 : 3;
    ctx.beginPath();
    ctx.lineWidth = tick.rank === "major" ? 1.35 : 1;
    ctx.moveTo(x, axisY);
    ctx.lineTo(x, axisY + len);
    ctx.stroke();
    ctx.lineWidth = 1;
    if (!tick.label) continue;
    if (tick.rank !== "major" && (x < plotLeft + 8 || x > plotLeft + plotW - 8)) continue;
    if (tick.rank === "major" && (x < plotLeft - 4 || x > plotLeft + plotW + 4)) continue;
    const tw = ctx.measureText(tick.label).width;
    if (!labelCursor.take(x, tw)) continue;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(tick.label, x, axisY - 6);
  }

  // measure + place glyphs
  ctx.font = '18px "Segoe UI", "Noto Sans SC", sans-serif';
  for (const g of glyphs) {
    g.w = measureGlyphWidth(ctx, g.ch);
    g.x = xOf(g.ts, plotLeft, plotW);
  }
  assignLanes(glyphs);

  // Tallest overlap stack (for guides + meta); each stack centers itself
  let tallMin = 0;
  let tallMax = 0;
  let maxRows = 0;
  for (const g of glyphs) {
    const rows = g.stackMax - g.stackMin + 1;
    if (rows > maxRows) {
      maxRows = rows;
      tallMin = g.stackMin;
      tallMax = g.stackMax;
    }
  }

  // Faint guides for the tallest stack’s rows (axis-centered)
  if (maxRows > 1) {
    ctx.strokeStyle = "rgba(138,132,120,0.2)";
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    for (let lane = tallMin; lane <= tallMax; lane++) {
      const y = laneToY(lane, tallMin, tallMax, axisY);
      if (Math.abs(y - axisY) < 0.5) continue;
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotLeft + plotW, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Bracket showing stack height centered on axis (demo affordance)
  if (maxRows > 1) {
    const topY = laneToY(tallMin, tallMin, tallMax, axisY) - 10;
    const botY = laneToY(tallMax, tallMin, tallMax, axisY) + 10;
    const bx = plotLeft + 4;
    ctx.strokeStyle = "rgba(47,111,94,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx + 6, topY);
    ctx.lineTo(bx, topY);
    ctx.lineTo(bx, botY);
    ctx.lineTo(bx + 6, botY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx, axisY);
    ctx.lineTo(bx + 8, axisY);
    ctx.stroke();
    ctx.fillStyle = "rgba(47,111,94,0.85)";
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${maxRows} 行 · 居中`, bx + 12, axisY);
  }

  ctx.font = '18px "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const g of glyphs) {
    if (g.x < plotLeft - 40 || g.x > plotLeft + plotW + 40) continue;
    const y = laneToY(g.lane, g.stackMin, g.stackMax, axisY);
    // 字心到时间戳的竖茎
    if (Math.abs(y - axisY) > 0.5) {
      ctx.strokeStyle = "rgba(90,86,78,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(g.x, axisY);
      ctx.lineTo(g.x, y);
      ctx.stroke();
    }
    // 时间戳短刻
    ctx.strokeStyle = "rgba(47,111,94,0.55)";
    ctx.beginPath();
    ctx.moveTo(g.x, axisY - 3);
    ctx.lineTo(g.x, axisY + 3);
    ctx.stroke();

    ctx.fillStyle = glyphFill(g.lane, g.stackMin, g.stackMax);
    const label = g.ch === " " ? "·" : g.ch === "\n" ? "↵" : g.ch;
    ctx.fillText(label, g.x, y);
  }

  if (!glyphs.length) {
    ctx.fillStyle = "#6e6a62";
    ctx.font = '13px "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "点「加载素材」用笔记击键数据，或在上方输入框试打",
      w / 2,
      axisY - 48
    );
  }

  updateMeta(maxRows);
}

function fitToGlyphs() {
  if (!glyphs.length) return;
  const t0 = Math.min(...glyphs.map((g) => g.ts));
  const t1 = Math.max(...glyphs.map((g) => g.ts));
  let span = Math.max(FIT_MIN_SPAN_MS, t1 - t0);
  span *= 1 + FIT_PAD_RATIO * 2;
  const mid = (t0 + t1) / 2;
  setView(clampTimeView(mid - span / 2, mid + span / 2));
  scheduleDraw();
}

function onInput() {
  const next = input.value;
  activeSampleLabel = "";
  // 增长：后缀新字用当前时间戳
  if (next.startsWith(typedText) && next.length >= typedText.length) {
    for (let i = typedText.length; i < next.length; i++) {
      glyphs.push({
        id: nextGlyphId++,
        ch: next[i]!,
        ts: Date.now(),
        w: 10,
        x: 0,
        lane: 0,
        stackMin: 0,
        stackMax: 0,
      });
    }
    typedText = next;
    // 软跟随最新字
    if (glyphs.length) {
      const last = glyphs[glyphs.length - 1]!;
      const span = viewEnd - viewStart;
      if (last.ts < viewStart || last.ts > viewEnd) {
        const frac = 0.65;
        setView(clampTimeView(last.ts - frac * span, last.ts - frac * span + span));
      }
    }
    scheduleDraw();
    return;
  }

  // 缩短 / 改写：公共前缀保留；新字用 now
  let common = 0;
  const lim = Math.min(typedText.length, next.length);
  while (common < lim && typedText[common] === next[common]) common++;
  glyphs = glyphs.slice(0, common);
  for (let i = common; i < next.length; i++) {
    glyphs.push({
      id: nextGlyphId++,
      ch: next[i]!,
      ts: Date.now(),
      w: 10,
      x: 0,
      lane: 0,
      stackMin: 0,
      stackMax: 0,
    });
  }
  typedText = next;
  scheduleDraw();
}

function zoomAboutCenter(factor: number) {
  stopInertia(inertia);
  setView(applyZoomFactor(getView(), factor, 0.5));
  scheduleDraw();
}

function clearAll() {
  stopInertia(inertia);
  glyphs = [];
  nextGlyphId = 1;
  typedText = "";
  activeSampleLabel = "";
  input.value = "";
  const n = Date.now();
  viewStart = n - INITIAL_SPAN_MS * 0.35;
  viewEnd = viewStart + INITIAL_SPAN_MS;
  scheduleDraw();
  input.focus();
}

function loadSampleSession(session: SampleSession) {
  stopInertia(inertia);
  glyphs = [];
  nextGlyphId = 1;
  for (const g of session.glyphs) {
    if (typeof g.ch !== "string" || typeof g.ts !== "number") continue;
    glyphs.push({
      id: nextGlyphId++,
      ch: g.ch,
      ts: g.ts,
      w: 10,
      x: 0,
      lane: 0,
      stackMin: 0,
      stackMax: 0,
    });
  }
  typedText = glyphs.map((g) => g.ch).join("");
  input.value = typedText.length <= 200 ? typedText : typedText.slice(0, 200) + "…";
  activeSampleLabel = `${session.label}（${glyphs.length} 字）`;
  fitToGlyphs();
  scheduleDraw();
}

function fillSampleSelect() {
  sampleSelect.replaceChildren();
  const sessions = pack.sessions || [];
  if (!sessions.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "（没有可用素材）";
    sampleSelect.appendChild(opt);
    return;
  }
  for (const s of sessions) {
    const opt = document.createElement("option");
    opt.value = s.id;
    const spanSec = (s.span_ms / 1000).toFixed(1);
    opt.textContent = `${s.label} · ${s.glyph_count} 字 · ${spanSec}s`;
    sampleSelect.appendChild(opt);
  }
}

function loadSelectedSample() {
  const id = sampleSelect.value;
  const session = (pack.sessions || []).find((s) => s.id === id);
  if (!session) return;
  loadSampleSession(session);
}

// —— 交互（仪表盘约定 via time_view_nav） ——

const altGuard = installAltZoomGuard({
  isActive: () => true,
  isPointerOver: () => pointerOver,
});

canvas.addEventListener("pointerenter", () => {
  pointerOver = true;
});
canvas.addEventListener("pointerleave", () => {
  pointerOver = false;
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const { plotLeft, plotW } = plotGeom();
    handleTimeAxisWheel(e, {
      plotLeft,
      plotW,
      clientX: e.clientX - canvas.getBoundingClientRect().left,
      altHeld: altGuard.getAltHeld(),
      getView,
      setView,
      inertia,
      onFrame: scheduleDraw,
    });
  },
  { passive: false }
);

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  stopInertia(inertia);
  canvas.setPointerCapture(e.pointerId);
  const st: PanState = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    viewStart,
    viewEnd,
    armed: false,
    timer: window.setTimeout(() => {
      if (pan && pan.pointerId === e.pointerId) {
        pan.armed = true;
        canvas.classList.add("panning");
      }
    }, LONG_PRESS_MS),
    moved: false,
  };
  pan = st;
});

canvas.addEventListener("pointermove", (e) => {
  if (!pan || e.pointerId !== pan.pointerId) return;
  const dx = e.clientX - pan.startX;
  const dy = e.clientY - pan.startY;
  if (!pan.moved && Math.hypot(dx, dy) > CLICK_SLOP_PX) pan.moved = true;
  if (!pan.armed) return;
  const { plotW } = plotGeom();
  const span0 = pan.viewEnd - pan.viewStart;
  const deltaMs = -(dx / Math.max(1, plotW)) * span0;
  setView(clampTimeView(pan.viewStart + deltaMs, pan.viewEnd + deltaMs));
  scheduleDraw();
});

function endPan(e: PointerEvent) {
  if (!pan || e.pointerId !== pan.pointerId) return;
  if (pan.timer != null) window.clearTimeout(pan.timer);
  canvas.classList.remove("panning");
  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  pan = null;
}

canvas.addEventListener("pointerup", endPan);
canvas.addEventListener("pointercancel", endPan);

input.addEventListener("input", onInput);
btnZoomIn.addEventListener("click", () => zoomAboutCenter(1 / 1.25));
btnZoomOut.addEventListener("click", () => zoomAboutCenter(1.25));
btnFit.addEventListener("click", fitToGlyphs);
btnClear.addEventListener("click", clearAll);
btnLoadSample.addEventListener("click", loadSelectedSample);
sampleSelect.addEventListener("change", loadSelectedSample);
btnToggleKeys.addEventListener("click", () => {
  showKeySignals = !showKeySignals;
  btnToggleKeys.classList.toggle("is-on", showKeySignals);
  scheduleDraw();
});

window.addEventListener("resize", scheduleDraw);

async function loadSamplePack() {
  try {
    const res = await fetch("./notes_timeline_sample.json");
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as SamplePack;
    if (!data || !Array.isArray(data.sessions)) throw new Error("bad sample");
    pack = data;
    keyDownTs = Array.isArray(data.key_downs)
      ? data.key_downs.filter((t) => typeof t === "number")
      : [];
  } catch {
    pack = { sessions: [] };
    keyDownTs = [];
  }
  fillSampleSelect();
  if ((pack.sessions || []).length) loadSelectedSample();
  else {
    scheduleDraw();
    input.focus();
  }
}

void loadSamplePack();