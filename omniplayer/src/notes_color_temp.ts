/**
 * 流式笔记 / 线索板：击键色温 + 退格变灰。
 * 色温：间隔短偏暖红、长偏冷蓝。退格：删掉的字标 deleted，可单独开关显示为灰色。
 * 流式笔记只作用于 composer 与用户气泡；线索板作用于便签正文。
 */
import {
  hideFloat,
  placeFloatInViewport,
  revealFloat,
} from "./omni_float";
import { shellT } from "./shell_i18n";

export const COLOR_TEMP_STORAGE_KEY = "lifeworldtrace.notes.colorTemp";
export const SHOW_BACKSPACE_STORAGE_KEY = "lifeworldtrace.notes.showBackspace";

const COLOR_DT_WARM_MS = 50;
const COLOR_DT_COLD_MS = 950;
const MAX_GLYPHS = 8000;
const DELETED_INK = "rgb(154, 154, 154)";

export type StreamGlyph = {
  ch: string;
  dtMs: number;
  deleted?: boolean;
  ts?: number;
};

/** 落盘 / IPC 形态（Rust `dt_ms`） */
export type UserGlyphWire = {
  ch: string;
  dt_ms: number;
  deleted?: boolean;
  ts?: number | null;
};

let colorTempOn = readColorTempPref();
let showBackspaceOn = readShowBackspacePref();
let liveGlyphs: StreamGlyph[] = [];
let lastLiveTs = 0;
let composing = false;
let popoverOpen = false;
let popoverOutside: ((e: MouseEvent) => void) | null = null;
let onDisplayChange: (() => void) | null = null;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function readColorTempPref(): boolean {
  try {
    const v = localStorage.getItem(COLOR_TEMP_STORAGE_KEY);
    if (v === null) return false;
    return v === "1";
  } catch {
    return false;
  }
}

export function readShowBackspacePref(): boolean {
  try {
    const v = localStorage.getItem(SHOW_BACKSPACE_STORAGE_KEY);
    if (v === null) return true;
    return v === "1";
  } catch {
    return true;
  }
}

export function isColorTempOn(): boolean {
  return colorTempOn;
}

export function isShowBackspaceOn(): boolean {
  return showBackspaceOn;
}

/** 需要叠色温带时：色温开，或退格灰显开。 */
export function needsGlyphTape(): boolean {
  return colorTempOn || showBackspaceOn;
}

export function setColorTempOn(on: boolean) {
  colorTempOn = on;
  try {
    localStorage.setItem(COLOR_TEMP_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  syncColorTempChrome();
  paintComposerTape();
  onDisplayChange?.();
}

export function setShowBackspaceOn(on: boolean) {
  showBackspaceOn = on;
  try {
    localStorage.setItem(SHOW_BACKSPACE_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  syncColorTempChrome();
  paintComposerTape();
  onDisplayChange?.();
}

export function normalizeGlyphs(raw: unknown): StreamGlyph[] {
  if (!Array.isArray(raw)) return [];
  const out: StreamGlyph[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const g = item as StreamGlyph & { dt_ms?: number };
    const ch = typeof g.ch === "string" ? g.ch : "";
    if (!ch) continue;
    const dtMs =
      typeof g.dtMs === "number"
        ? g.dtMs
        : typeof g.dt_ms === "number"
          ? g.dt_ms
          : 0;
    out.push({
      ch: [...ch].slice(0, 2).join("") || ch.slice(0, 2),
      dtMs: Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0,
      deleted: !!g.deleted,
      ts: typeof g.ts === "number" ? g.ts : undefined,
    });
    if (out.length >= MAX_GLYPHS) break;
  }
  return out;
}

export function glyphsToWire(glyphs: StreamGlyph[]): UserGlyphWire[] {
  return glyphs
    .filter((g) => g.ch)
    .slice(0, MAX_GLYPHS)
    .map((g) => ({
      ch: g.ch,
      dt_ms: Math.round(g.dtMs),
      deleted: !!g.deleted,
      ts: g.ts ?? null,
    }));
}

export function sketchFromGlyphs(glyphs: StreamGlyph[]): string {
  return glyphs.filter((g) => !g.deleted).map((g) => g.ch).join("");
}

/** 输入框里实际排版的字符串：退格灰显开时，删掉的字也占一格。 */
function fieldValue(glyphs: StreamGlyph[]): string {
  if (!showBackspaceOn) return sketchFromGlyphs(glyphs);
  return glyphs.map((g) => g.ch).join("");
}

function utf16Len(chars: string[]): number {
  let n = 0;
  for (const ch of chars) n += ch.length;
  return n;
}

function dtToRgb(dtMs: number): string {
  const t = Math.min(
    1,
    Math.max(0, (dtMs - COLOR_DT_WARM_MS) / (COLOR_DT_COLD_MS - COLOR_DT_WARM_MS))
  );
  const r = Math.round(210 - t * 160);
  const g = Math.round(62 + t * 28);
  const b = Math.round(42 + t * 168);
  return `rgb(${r},${g},${b})`;
}

function glyphInk(g: StreamGlyph): string {
  if (g.deleted) return DELETED_INK;
  if (colorTempOn) return dtToRgb(g.dtMs);
  return "inherit";
}

export function renderGlyphTapeInto(host: HTMLElement, glyphs: StreamGlyph[]) {
  host.replaceChildren();
  for (const g of glyphs) {
    if (g.deleted && !showBackspaceOn) continue;
    const span = document.createElement("span");
    span.className = "temp-ch" + (g.deleted ? " is-deleted" : "");
    const ink = glyphInk(g);
    if (ink !== "inherit") span.style.color = ink;
    span.textContent = g.ch;
    host.appendChild(span);
  }
}

/**
 * 文本变更 → 字形带：共同前缀保留；被删的可见字标 deleted（不丢掉）；新字追加。
 */
export function syncGlyphListToText(
  glyphs: StreamGlyph[],
  text: string,
  dtMs: number,
  now: number
): StreamGlyph[] {
  const nextChars = [...text];
  const visIdx: number[] = [];
  for (let i = 0; i < glyphs.length; i++) {
    if (!glyphs[i].deleted) visIdx.push(i);
  }
  let prefix = 0;
  while (
    prefix < visIdx.length &&
    prefix < nextChars.length &&
    glyphs[visIdx[prefix]].ch === nextChars[prefix]
  ) {
    prefix += 1;
  }
  const next = glyphs.map((g) => ({ ...g }));
  for (let i = prefix; i < visIdx.length; i++) {
    next[visIdx[i]].deleted = true;
  }
  for (let i = prefix; i < nextChars.length; i++) {
    next.push({ ch: nextChars[i], dtMs, ts: now });
  }
  if (next.length > MAX_GLYPHS) {
    return next.slice(next.length - MAX_GLYPHS);
  }
  return next;
}

/**
 * 退格灰显开着时，输入框字符串含灰色删字。
 * 删掉的实字留在原位并标 deleted（仍占格）；再退一格才去掉灰字。
 * 新插入的字排在这些灰字前面，不盖住它们。
 * caret 为 UTF-16 下标；-1 表示不必改光标。
 */
function syncGlyphsKeepingDeleted(
  glyphs: StreamGlyph[],
  text: string,
  dtMs: number,
  now: number
): { glyphs: StreamGlyph[]; caret: number } {
  const old = glyphs.map((g) => g.ch).join("");
  if (old === text) return { glyphs, caret: -1 };

  const chars = [...text];
  let pre = 0;
  const maxPre = Math.min(glyphs.length, chars.length);
  while (pre < maxPre && glyphs[pre].ch === chars[pre]) pre += 1;

  let suf = 0;
  while (
    suf < glyphs.length - pre &&
    suf < chars.length - pre &&
    glyphs[glyphs.length - 1 - suf].ch === chars[chars.length - 1 - suf]
  ) {
    suf += 1;
  }

  const removed = glyphs.slice(pre, glyphs.length - suf);
  const inserted = chars.slice(pre, chars.length - suf);
  const mid: StreamGlyph[] = [];
  for (const ch of inserted) {
    mid.push({ ch, dtMs, ts: now });
  }
  for (const g of removed) {
    if (g.deleted) continue;
    mid.push({ ...g, deleted: true });
  }

  let next = [
    ...glyphs.slice(0, pre).map((g) => ({ ...g })),
    ...mid,
    ...glyphs.slice(glyphs.length - suf).map((g) => ({ ...g })),
  ];
  if (next.length > MAX_GLYPHS) next = next.slice(next.length - MAX_GLYPHS);

  const caret =
    utf16Len(glyphs.slice(0, pre).map((g) => g.ch)) + inserted.join("").length;
  return { glyphs: next, caret };
}

function placeFieldText(
  input: HTMLTextAreaElement,
  glyphs: StreamGlyph[],
  caret: number
) {
  const next = fieldValue(glyphs);
  if (input.value !== next) input.value = next;
  if (caret >= 0) {
    const c = Math.max(0, Math.min(caret, next.length));
    input.setSelectionRange(c, c);
  }
}

export function fillUserTextEl(
  el: HTMLElement,
  text: string,
  glyphs: unknown
) {
  const list = normalizeGlyphs(glyphs);
  if (!needsGlyphTape() || !list.length) {
    el.classList.remove("notes-temp-tape");
    el.textContent = text;
    return;
  }
  const vis = sketchFromGlyphs(list);
  if (vis !== text) {
    el.classList.remove("notes-temp-tape");
    el.textContent = text;
    return;
  }
  el.classList.add("notes-temp-tape");
  renderGlyphTapeInto(el, list);
}

function syncGlyphsToText(text: string, dtMs: number, now: number, caretOut?: { caret: number }) {
  if (showBackspaceOn) {
    const synced = syncGlyphsKeepingDeleted(liveGlyphs, text, dtMs, now);
    liveGlyphs = synced.glyphs;
    if (caretOut) caretOut.caret = synced.caret;
    return;
  }
  liveGlyphs = syncGlyphListToText(liveGlyphs, text, dtMs, now);
  if (caretOut) caretOut.caret = -1;
}

/** 发给模型 / 存成正文的字：不含退格灰字。 */
export function composerSemanticText(): string {
  const input = $("notes-input") as HTMLTextAreaElement | null;
  if (!showBackspaceOn) return input?.value ?? sketchFromGlyphs(liveGlyphs);
  if (!liveGlyphs.length) return input?.value ?? "";
  return sketchFromGlyphs(liveGlyphs);
}

export function onComposerInput() {
  const input = $("notes-input") as HTMLTextAreaElement | null;
  if (!input || composing) return;
  const now = Date.now();
  const dt = lastLiveTs ? now - lastLiveTs : 0;
  lastLiveTs = now;
  const caret = { caret: -1 };
  syncGlyphsToText(input.value, dt, now, caret);
  if (showBackspaceOn) placeFieldText(input, liveGlyphs, caret.caret);
  paintComposerTape();
}

export function paintComposerTape() {
  const composer = document.querySelector(".notes-composer");
  const input = $("notes-input") as HTMLTextAreaElement | null;
  const tape = $("notes-temp-live");
  const on = needsGlyphTape();
  composer?.classList.toggle("is-color-temp", colorTempOn);
  composer?.classList.toggle("is-show-backspace", showBackspaceOn);
  composer?.classList.toggle("is-glyph-tape", on);
  composer?.classList.toggle("is-ime", composing);
  if (!tape) return;
  if (!on || composing || !input) {
    tape.replaceChildren();
    return;
  }
  if (!showBackspaceOn) {
    const plain = sketchFromGlyphs(liveGlyphs);
    if (input.value !== plain) input.value = plain;
  } else if (
    sketchFromGlyphs(liveGlyphs) === input.value &&
    fieldValue(liveGlyphs) !== input.value
  ) {
    placeFieldText(input, liveGlyphs, -1);
  } else if (fieldValue(liveGlyphs) !== input.value) {
    const caret = { caret: -1 };
    syncGlyphsToText(input.value, 0, Date.now(), caret);
    placeFieldText(input, liveGlyphs, caret.caret);
  }
  const showDeleted = liveGlyphs.some((g) => g.deleted && showBackspaceOn);
  if (!fieldValue(liveGlyphs) && !showDeleted) {
    tape.replaceChildren();
    return;
  }
  renderGlyphTapeInto(tape, liveGlyphs);
  tape.scrollTop = input.scrollTop;
  tape.scrollLeft = input.scrollLeft;
}

export function snapshotGlyphsForSend(text: string): UserGlyphWire[] {
  const input = $("notes-input") as HTMLTextAreaElement | null;
  const source = showBackspaceOn && input ? input.value : text;
  if (fieldValue(liveGlyphs) !== source) {
    syncGlyphsToText(source, 0, Date.now());
  }
  return glyphsToWire(liveGlyphs);
}

export function takeGlyphsForSend(text: string): UserGlyphWire[] {
  const wire = snapshotGlyphsForSend(text);
  resetLiveGlyphs();
  paintComposerTape();
  return wire;
}

export function resetLiveGlyphs() {
  liveGlyphs = [];
  lastLiveTs = 0;
}

function makeToggleRow(
  opts: {
    pressed: boolean;
    strong: string;
    hint: string;
    onToggle: () => void;
  }
): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "notes-fwd-toggle-row";
  row.setAttribute("aria-pressed", opts.pressed ? "true" : "false");
  const text = document.createElement("span");
  text.className = "notes-fwd-toggle-text";
  const strong = document.createElement("strong");
  strong.textContent = opts.strong;
  const small = document.createElement("small");
  small.textContent = opts.hint;
  text.append(strong, small);
  const sw = document.createElement("span");
  sw.className = "notes-fwd-switch" + (opts.pressed ? " is-on" : "");
  sw.setAttribute("aria-hidden", "true");
  row.append(text, sw);
  row.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onToggle();
  });
  return row;
}

function syncColorTempChrome() {
  const btn = $("notes-color-temp-btn");
  if (btn) {
    const active = needsGlyphTape();
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.classList.toggle("is-active", active);
    const title = shellT("notes.colorTemp.btnTitle");
    btn.setAttribute("title", title);
    btn.setAttribute("aria-label", title);
  }
  const clueBtn = $("notes-clue-color-temp-btn");
  if (clueBtn) {
    const active = needsGlyphTape();
    clueBtn.setAttribute("aria-pressed", active ? "true" : "false");
    clueBtn.classList.toggle("is-active", active);
    const title = shellT("notes.colorTemp.btnTitle");
    clueBtn.setAttribute("title", title);
    clueBtn.setAttribute("aria-label", title);
  }
  const pop = $("notes-color-temp-popover");
  if (pop && popoverOpen) renderPopover(pop);
}

function renderPopover(host: HTMLElement) {
  host.replaceChildren();
  const head = document.createElement("div");
  head.className = "notes-mcp-pop-head";
  head.textContent = shellT("notes.colorTemp.title");
  host.appendChild(head);

  const note = document.createElement("p");
  note.className = "notes-fwd-note";
  note.textContent = shellT("notes.colorTemp.desc");
  host.appendChild(note);

  const bar = document.createElement("div");
  bar.className = "notes-temp-legend";
  const fast = document.createElement("span");
  fast.textContent = shellT("notes.colorTemp.legendFast");
  const strip = document.createElement("span");
  strip.className = "notes-temp-legend-bar";
  strip.setAttribute("aria-hidden", "true");
  const slow = document.createElement("span");
  slow.textContent = shellT("notes.colorTemp.legendSlow");
  bar.append(fast, strip, slow);
  host.appendChild(bar);

  const sep = document.createElement("div");
  sep.className = "notes-fwd-sep";
  host.appendChild(sep);

  host.appendChild(
    makeToggleRow({
      pressed: colorTempOn,
      strong: shellT("notes.colorTemp.toggle"),
      hint: shellT("notes.colorTemp.toggleHint"),
      onToggle: () => setColorTempOn(!colorTempOn),
    })
  );
  host.appendChild(
    makeToggleRow({
      pressed: showBackspaceOn,
      strong: shellT("notes.colorTemp.backspaceToggle"),
      hint: shellT("notes.colorTemp.backspaceToggleHint"),
      onToggle: () => setShowBackspaceOn(!showBackspaceOn),
    })
  );
}

export function closeColorTempPopover() {
  popoverOpen = false;
  const btn = $("notes-color-temp-btn");
  const clueBtn = $("notes-clue-color-temp-btn");
  const pop = $("notes-color-temp-popover");
  btn?.setAttribute("aria-expanded", "false");
  clueBtn?.setAttribute("aria-expanded", "false");
  hideFloat(pop);
  if (popoverOutside) {
    document.removeEventListener("click", popoverOutside, true);
    popoverOutside = null;
  }
}

function openPopover(anchor: HTMLElement) {
  let pop = $("notes-color-temp-popover");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "notes-color-temp-popover";
    pop.className = "notes-params-popover omni-float hidden";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-hidden", "true");
    document.body.appendChild(pop);
  }
  renderPopover(pop);
  revealFloat(pop);
  placeFloatInViewport(pop, anchor.getBoundingClientRect(), "above", 300);
  popoverOpen = true;
  anchor.setAttribute("aria-expanded", "true");
  if (popoverOutside) {
    document.removeEventListener("click", popoverOutside, true);
  }
  popoverOutside = (e: MouseEvent) => {
    const t = e.target as Element | null;
    if (
      t?.closest?.("#notes-color-temp-popover") ||
      t?.closest?.("#notes-color-temp-btn") ||
      t?.closest?.("#notes-clue-color-temp-btn")
    ) {
      return;
    }
    closeColorTempPopover();
  };
  window.setTimeout(() => {
    document.addEventListener("click", popoverOutside!, true);
  }, 0);
}

function bindComposerField() {
  const input = $("notes-input") as HTMLTextAreaElement | null;
  if (!input) return;
  input.addEventListener("compositionstart", () => {
    composing = true;
    paintComposerTape();
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    onComposerInput();
  });
  input.addEventListener(
    "scroll",
    () => {
      const tape = $("notes-temp-live");
      if (tape) {
        tape.scrollTop = input.scrollTop;
        tape.scrollLeft = input.scrollLeft;
      }
    },
    { passive: true }
  );
}

function bindAnchorButton(btn: HTMLElement | null) {
  if (!btn || (btn as HTMLElement & { __colorTempBound?: boolean }).__colorTempBound) {
    return;
  }
  (btn as HTMLElement & { __colorTempBound?: boolean }).__colorTempBound = true;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (popoverOpen && btn.getAttribute("aria-expanded") === "true") {
      closeColorTempPopover();
    } else {
      closeColorTempPopover();
      openPopover(btn);
    }
  });
}

export type GlyphFieldHandle = {
  onInput: () => void;
  paint: () => void;
  /** 不含退格灰字的正文。 */
  semantic: () => string;
  snapshot: () => UserGlyphWire[];
  setGlyphs: (raw: unknown) => void;
  destroy: () => void;
};

/** 单字段字形跟踪（线索板便签正文）。 */
export function attachGlyphField(opts: {
  input: HTMLTextAreaElement;
  tape: HTMLElement;
  wrap?: HTMLElement;
  initial?: unknown;
  onChange?: (wire: UserGlyphWire[]) => void;
}): GlyphFieldHandle {
  let glyphs = normalizeGlyphs(opts.initial);
  let lastTs = 0;
  let fieldComposing = false;
  const input = opts.input;
  const tape = opts.tape;
  const wrap = opts.wrap;

  const paint = () => {
    const on = needsGlyphTape();
    wrap?.classList.toggle("is-glyph-tape", on);
    wrap?.classList.toggle("is-color-temp", colorTempOn);
    wrap?.classList.toggle("is-show-backspace", showBackspaceOn);
    wrap?.classList.toggle("is-ime", fieldComposing);
    if (!on || fieldComposing) {
      tape.replaceChildren();
      return;
    }
    if (!showBackspaceOn) {
      const plain = sketchFromGlyphs(glyphs);
      if (input.value !== plain) input.value = plain;
    } else if (sketchFromGlyphs(glyphs) === input.value && fieldValue(glyphs) !== input.value) {
      placeFieldText(input, glyphs, -1);
    } else if (fieldValue(glyphs) !== input.value) {
      const synced = syncGlyphsKeepingDeleted(glyphs, input.value, 0, Date.now());
      glyphs = synced.glyphs;
      placeFieldText(input, glyphs, -1);
    }
    if (!fieldValue(glyphs) && !glyphs.some((g) => g.deleted && showBackspaceOn)) {
      tape.replaceChildren();
      return;
    }
    renderGlyphTapeInto(tape, glyphs);
    tape.scrollTop = input.scrollTop;
    tape.scrollLeft = input.scrollLeft;
  };

  const onInput = () => {
    if (fieldComposing) return;
    const now = Date.now();
    const dt = lastTs ? now - lastTs : 0;
    lastTs = now;
    if (showBackspaceOn) {
      const synced = syncGlyphsKeepingDeleted(glyphs, input.value, dt, now);
      glyphs = synced.glyphs;
      placeFieldText(input, glyphs, synced.caret);
    } else {
      glyphs = syncGlyphListToText(glyphs, input.value, dt, now);
    }
    paint();
    opts.onChange?.(glyphsToWire(glyphs));
  };

  const onCompStart = () => {
    fieldComposing = true;
    paint();
  };
  const onCompEnd = () => {
    fieldComposing = false;
    onInput();
  };
  const onScroll = () => {
    tape.scrollTop = input.scrollTop;
    tape.scrollLeft = input.scrollLeft;
  };

  input.addEventListener("compositionstart", onCompStart);
  input.addEventListener("compositionend", onCompEnd);
  input.addEventListener("scroll", onScroll, { passive: true });

  paint();

  return {
    onInput,
    paint,
    semantic: () => sketchFromGlyphs(glyphs),
    snapshot: () => glyphsToWire(glyphs),
    setGlyphs: (raw) => {
      glyphs = normalizeGlyphs(raw);
      lastTs = 0;
      paint();
    },
    destroy: () => {
      input.removeEventListener("compositionstart", onCompStart);
      input.removeEventListener("compositionend", onCompEnd);
      input.removeEventListener("scroll", onScroll);
    },
  };
}

export function initColorTempUi(opts?: { onDisplayChange?: () => void }) {
  onDisplayChange = opts?.onDisplayChange ?? null;
  colorTempOn = readColorTempPref();
  showBackspaceOn = readShowBackspacePref();
  bindAnchorButton($("notes-color-temp-btn"));
  bindAnchorButton($("notes-clue-color-temp-btn"));
  bindComposerField();
  syncColorTempChrome();
  paintComposerTape();
  window.addEventListener("lifeworld_trace-lang", () => syncColorTempChrome());
}

/** 线索板工具栏按钮晚于 init 插入时再绑一次。 */
export function bindColorTempAnchor(btn: HTMLElement | null) {
  bindAnchorButton(btn);
  syncColorTempChrome();
}

export function closeColorTempPopoverOnLeave() {
  closeColorTempPopover();
}
