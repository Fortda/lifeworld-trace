/**
 * Dual-button pan helpers for clue-board card drag.
 * Mouse buttons bitmask (UI Events): 1 = LMB, 2 = RMB, 4 = middle.
 * Prefer RMB; middle is a WebView2 fallback when secondary is suppressed.
 */

export const AUX_PAN_RMB = 2;
export const AUX_PAN_MMB = 4;

/** True when RMB and/or middle are held (with or without LMB). */
export function wantAuxPanFromButtons(buttons: number): boolean {
  return (buttons & (AUX_PAN_RMB | AUX_PAN_MMB)) !== 0;
}

/** button on pointerdown/up: 2 = right, 1 = middle. */
export function isAuxPanButton(button: number): boolean {
  return button === 2 || button === 1;
}

export type AuxPanStep = {
  dpx: number;
  dpy: number;
  nextX: number;
  nextY: number;
};

/** Screen-space pan delta from last sample (same units as empty-board LMB pan). */
export function auxPanStep(
  lastX: number,
  lastY: number,
  clientX: number,
  clientY: number
): AuxPanStep {
  return {
    dpx: clientX - lastX,
    dpy: clientY - lastY,
    nextX: clientX,
    nextY: clientY,
  };
}

/** Beyond slop → treat as pan (suppress context menu). */
export function auxPanMovedBeyondSlop(
  totalDx: number,
  totalDy: number,
  slop: number
): boolean {
  return totalDx * totalDx + totalDy * totalDy > slop * slop;
}
