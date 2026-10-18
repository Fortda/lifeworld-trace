/**
 * Pure checks for dual-button pan while LMB-dragging a clue note.
 * Run: node omniplayer/scripts/clue_dual_pan_test.mjs
 */
import {
  AUX_PAN_MMB,
  AUX_PAN_RMB,
  auxPanMovedBeyondSlop,
  auxPanStep,
  isAuxPanButton,
  wantAuxPanFromButtons,
} from "../src/notes_clue_dual_pan.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(wantAuxPanFromButtons(1) === false, "LMB alone no pan");
assert(wantAuxPanFromButtons(2) === true, "RMB alone pans");
assert(wantAuxPanFromButtons(3) === true, "LMB+RMB pans");
assert(wantAuxPanFromButtons(4) === true, "MMB alone pans (fallback)");
assert(wantAuxPanFromButtons(5) === true, "LMB+MMB pans");
assert(wantAuxPanFromButtons(0) === false, "none");
assert((1 | AUX_PAN_RMB) === 3, "bit const RMB");
assert((1 | AUX_PAN_MMB) === 5, "bit const MMB");

assert(isAuxPanButton(2) === true, "button 2");
assert(isAuxPanButton(1) === true, "button 1 middle");
assert(isAuxPanButton(0) === false, "button 0");

const step = auxPanStep(100, 200, 110, 190);
assert(step.dpx === 10 && step.dpy === -10, "pan delta screen 1:1");
assert(step.nextX === 110 && step.nextY === 190, "next sample");

assert(auxPanMovedBeyondSlop(0, 0, 5) === false, "within slop");
assert(auxPanMovedBeyondSlop(6, 0, 5) === true, "beyond slop");
assert(auxPanMovedBeyondSlop(3, 4, 5) === false, "3-4-5 on slop edge");
assert(auxPanMovedBeyondSlop(3, 5, 5) === true, "beyond hypot");

console.log("clue_dual_pan_test: ok");
