/**
 * Composer 发送键偏好：Enter 发送 或 Ctrl+Enter 发送（未选项用于换行）。
 */
import { hideFloat, placeFloatInViewport, revealFloat } from "./omni_float";
import { shellT } from "./shell_i18n";

export const SEND_KEY_STORAGE_KEY = "lifeworldtrace.notes.sendKey";
export type SendKeyPref = "enter" | "ctrlEnter";

let popoverOpen = false;
let popoverOutside: ((e: MouseEvent) => void) | null = null;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function readSendKeyPref(): SendKeyPref {
  try {
    const v = localStorage.getItem(SEND_KEY_STORAGE_KEY);
    if (v === "ctrlEnter") return "ctrlEnter";
  } catch {
    /* ignore */
  }
  return "enter";
}

export function setSendKeyPref(pref: SendKeyPref) {
  try {
    localStorage.setItem(SEND_KEY_STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
  const pop = $("notes-send-key-popover");
  if (pop && popoverOpen) renderSendKeyPopover(pop);
}

export function isComposerSendHotkey(e: KeyboardEvent): boolean {
  if (e.key !== "Enter") return false;
  if (e.isComposing || e.keyCode === 229) return false;
  const pref = readSendKeyPref();
  const mod = e.ctrlKey || e.metaKey;
  if (pref === "ctrlEnter") return mod && !e.shiftKey && !e.altKey;
  return !mod && !e.shiftKey && !e.altKey;
}

function renderSendKeyPopover(host: HTMLElement) {
  host.replaceChildren();
  const head = document.createElement("div");
  head.className = "notes-mcp-pop-head";
  head.textContent = shellT("notes.sendKey.title");
  host.appendChild(head);

  const note = document.createElement("p");
  note.className = "notes-fwd-note";
  note.textContent = shellT("notes.sendKey.desc");
  host.appendChild(note);

  const pref = readSendKeyPref();
  host.appendChild(
    makeChoiceRow({
      selected: pref === "enter",
      strong: shellT("notes.sendKey.enter"),
      hint: shellT("notes.sendKey.enterHint"),
      onPick: () => setSendKeyPref("enter"),
    })
  );
  host.appendChild(
    makeChoiceRow({
      selected: pref === "ctrlEnter",
      strong: shellT("notes.sendKey.ctrlEnter"),
      hint: shellT("notes.sendKey.ctrlEnterHint"),
      onPick: () => setSendKeyPref("ctrlEnter"),
    })
  );
}

function makeChoiceRow(opts: {
  selected: boolean;
  strong: string;
  hint: string;
  onPick: () => void;
}): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "notes-fwd-toggle-row";
  row.setAttribute("role", "menuitemradio");
  row.setAttribute("aria-checked", opts.selected ? "true" : "false");
  const text = document.createElement("span");
  text.className = "notes-fwd-toggle-text";
  const strong = document.createElement("strong");
  strong.textContent = opts.strong;
  const small = document.createElement("small");
  small.textContent = opts.hint;
  text.append(strong, small);
  const mark = document.createElement("span");
  mark.className = "notes-send-key-check" + (opts.selected ? " is-on" : "");
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = opts.selected ? "✓" : "";
  row.append(text, mark);
  row.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onPick();
  });
  return row;
}

export function closeSendKeyPopover() {
  popoverOpen = false;
  const pop = $("notes-send-key-popover");
  hideFloat(pop);
  if (popoverOutside) {
    document.removeEventListener("click", popoverOutside, true);
    popoverOutside = null;
  }
}

function openSendKeyPopover(anchor: HTMLElement) {
  let pop = $("notes-send-key-popover");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "notes-send-key-popover";
    pop.className = "notes-params-popover omni-float hidden";
    pop.setAttribute("role", "menu");
    pop.setAttribute("aria-hidden", "true");
    document.body.appendChild(pop);
  }
  renderSendKeyPopover(pop);
  revealFloat(pop);
  placeFloatInViewport(pop, anchor.getBoundingClientRect(), "above", 260);
  popoverOpen = true;
  if (popoverOutside) {
    document.removeEventListener("click", popoverOutside, true);
  }
  popoverOutside = (e: MouseEvent) => {
    const t = e.target as Element | null;
    if (t?.closest?.("#notes-send-key-popover") || t?.closest?.("#notes-send")) {
      return;
    }
    closeSendKeyPopover();
  };
  window.setTimeout(() => {
    document.addEventListener("click", popoverOutside!, true);
  }, 0);
}

export function initSendKeyUi() {
  const sendBtn = $("notes-send");
  if (!sendBtn || (sendBtn as HTMLElement & { __sendKeyBound?: boolean }).__sendKeyBound) {
    return;
  }
  (sendBtn as HTMLElement & { __sendKeyBound?: boolean }).__sendKeyBound = true;
  sendBtn.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (popoverOpen) closeSendKeyPopover();
    else openSendKeyPopover(sendBtn);
  });
  window.addEventListener("lifeworld_trace-lang", () => {
    const pop = $("notes-send-key-popover");
    if (pop && popoverOpen) renderSendKeyPopover(pop);
  });
}
