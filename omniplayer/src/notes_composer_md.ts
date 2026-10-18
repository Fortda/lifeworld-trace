/**
 * Composer 长文 Markdown：源码 / 预览，与输入框往返同步。
 */
import { renderAssistantMarkdown } from "./notes_markdown";
import { shellT } from "./shell_i18n";

export type ComposerMdHooks = {
  getText: () => string;
  setText: (text: string) => void;
  send: () => void;
};

let hooks: ComposerMdHooks | null = null;
let mode: "source" | "preview" = "source";
let editorOpen = false;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function isComposerMdEditorOpen(): boolean {
  return editorOpen;
}

function syncChrome() {
  const composer = document.querySelector(".notes-composer");
  const panel = $("notes-md-editor");
  const btn = $("notes-composer-md-btn");
  const source = $("notes-md-source") as HTMLTextAreaElement | null;
  const preview = $("notes-md-preview");
  const tabSource = $("notes-md-tab-source");
  const tabPreview = $("notes-md-tab-preview");
  composer?.classList.toggle("is-md-open", editorOpen);
  btn?.setAttribute("aria-expanded", editorOpen ? "true" : "false");
  btn?.classList.toggle("is-active", editorOpen);
  if (panel) {
    panel.hidden = !editorOpen;
    panel.setAttribute("aria-hidden", editorOpen ? "false" : "true");
  }
  if (source) source.hidden = !editorOpen || mode !== "source";
  if (preview) preview.hidden = !editorOpen || mode !== "preview";
  tabSource?.classList.toggle("is-active", mode === "source");
  tabPreview?.classList.toggle("is-active", mode === "preview");
  tabSource?.setAttribute("aria-selected", mode === "source" ? "true" : "false");
  tabPreview?.setAttribute("aria-selected", mode === "preview" ? "true" : "false");
  if (editorOpen && mode === "preview") paintPreview();
}

function paintPreview() {
  const preview = $("notes-md-preview");
  const source = $("notes-md-source") as HTMLTextAreaElement | null;
  if (!preview) return;
  const text = source?.value ?? "";
  preview.classList.add("is-md", "notes-md-preview");
  if (!text.trim()) {
    preview.textContent = shellT("notes.mdEditor.emptyPreview");
    preview.classList.add("is-empty");
    return;
  }
  preview.classList.remove("is-empty");
  preview.innerHTML = renderAssistantMarkdown(text);
}

function applyI18n() {
  const map: Array<[string, string]> = [
    ["notes-composer-md-btn", "notes.mdEditor.btnTitle"],
    ["notes-md-editor-close", "notes.mdEditor.close"],
    ["notes-md-tab-source", "notes.mdEditor.source"],
    ["notes-md-tab-preview", "notes.mdEditor.preview"],
    ["notes-md-apply", "notes.mdEditor.done"],
    ["notes-md-send", "notes.mdEditor.send"],
  ];
  for (const [id, key] of map) {
    const el = $(id);
    if (!el) continue;
    const label = shellT(key);
    if (id === "notes-composer-md-btn" || id === "notes-md-editor-close") {
      el.setAttribute("title", label);
      el.setAttribute("aria-label", label);
    } else {
      el.textContent = label;
    }
  }
  const source = $("notes-md-source") as HTMLTextAreaElement | null;
  if (source) source.placeholder = shellT("notes.mdEditor.placeholder");
  const title = $("notes-md-editor-title");
  if (title) title.textContent = shellT("notes.mdEditor.title");
  if (editorOpen && mode === "preview") paintPreview();
}

function pullFromComposer() {
  const source = $("notes-md-source") as HTMLTextAreaElement | null;
  if (!source || !hooks) return;
  source.value = hooks.getText();
}

function pushToComposer() {
  const source = $("notes-md-source") as HTMLTextAreaElement | null;
  if (!source || !hooks) return;
  hooks.setText(source.value);
}

export function closeComposerMdEditor(opts?: { discard?: boolean }) {
  if (!editorOpen) return;
  if (!opts?.discard) pushToComposer();
  editorOpen = false;
  mode = "source";
  syncChrome();
  ($("notes-input") as HTMLTextAreaElement | null)?.focus();
}

export function openComposerMdEditor() {
  if (!hooks) return;
  pullFromComposer();
  editorOpen = true;
  mode = "source";
  syncChrome();
  applyI18n();
  window.setTimeout(() => {
    const source = $("notes-md-source") as HTMLTextAreaElement | null;
    source?.focus();
    const n = source?.value.length ?? 0;
    source?.setSelectionRange(n, n);
  }, 0);
}

function toggleComposerMdEditor() {
  if (editorOpen) closeComposerMdEditor();
  else openComposerMdEditor();
}

export function initComposerMdEditor(h: ComposerMdHooks) {
  hooks = h;
  const btn = $("notes-composer-md-btn");
  btn?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleComposerMdEditor();
  });
  $("notes-md-editor-close")?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeComposerMdEditor();
  });
  $("notes-md-tab-source")?.addEventListener("click", () => {
    if (mode === "source") return;
    mode = "source";
    syncChrome();
    ($("notes-md-source") as HTMLTextAreaElement | null)?.focus();
  });
  $("notes-md-tab-preview")?.addEventListener("click", () => {
    if (mode === "preview") return;
    mode = "preview";
    syncChrome();
  });
  $("notes-md-apply")?.addEventListener("click", () => {
    closeComposerMdEditor();
  });
  $("notes-md-send")?.addEventListener("click", () => {
    pushToComposer();
    editorOpen = false;
    mode = "source";
    syncChrome();
    hooks?.send();
  });
  const source = $("notes-md-source") as HTMLTextAreaElement | null;
  source?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeComposerMdEditor();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      pushToComposer();
      editorOpen = false;
      mode = "source";
      syncChrome();
      hooks?.send();
    }
  });
  applyI18n();
  syncChrome();
  window.addEventListener("lifeworld_trace-lang", () => applyI18n());
}
