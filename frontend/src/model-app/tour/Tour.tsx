// First-run interactive onboarding tour: a spotlight + tooltip coach-mark
// walked over real UI elements (tagged data-tour="...") on the editor. Follows
// keytips.tsx's portal-to-body + fixed-overlay convention so it composes with
// the rest of the chrome (and layers above it — same z-index family).
//
// Anchoring: each step names a CSS selector; we re-measure the target's
// bounding rect on mount/step-change/resize/scroll and punch a "spotlight"
// hole via a 4-rectangle overlay (simpler and more robust across browsers
// than box-shadow cutouts or clip-path, and easy to reason about for tests).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TOUR_STEPS, tourReduce, INITIAL_TOUR_STATE, type TourState } from "./tourSteps";
import { markTourSeen } from "./tourSeen";

const PAD = 8; // spotlight padding around the target's bounding box

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// Build the spotlight rect from a target with an even halo around it. The
// per-axis padding is capped by how much room the target has to each viewport
// edge, so the halo stays *symmetric* and never spills off-screen. This matters
// for the left-rail buttons (Add/Connect/Import/Export): they hug the left edge,
// so a fixed 8px pad would clip off-screen on the left and bulge into the canvas
// on the right — the lopsided "notch" that read as a bug. Capping the pad to the
// available room makes the halo hug the edge cleanly and protrude the same small
// amount on the interior side.
function spotlightFor(r: Rect): Rect {
  const availLeft = r.left;
  const availRight = window.innerWidth - (r.left + r.width);
  const availTop = r.top;
  const availBottom = window.innerHeight - (r.top + r.height);
  const padX = Math.max(0, Math.min(PAD, availLeft, availRight));
  const padY = Math.max(0, Math.min(PAD, availTop, availBottom));
  return {
    left: r.left - padX,
    top: r.top - padY,
    width: r.width + padX * 2,
    height: r.height + padY * 2,
  };
}

function measure(selector: string): Rect | null {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function Tour({ run, onDone }: { run: boolean; onDone: () => void }) {
  const [state, setState] = useState<TourState>(INITIAL_TOUR_STATE);
  const [rect, setRect] = useState<Rect | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (run) setState({ active: true, index: 0 });
  }, [run]);

  const finish = useCallback(() => {
    markTourSeen();
    setState(INITIAL_TOUR_STATE);
    onDone();
  }, [onDone]);

  const dispatch = useCallback(
    (action: Parameters<typeof tourReduce>[1]) => {
      const next = tourReduce(stateRef.current, action);
      if (!next.active) {
        finish();
        return;
      }
      setState(next);
    },
    [finish]
  );

  const step = state.active ? TOUR_STEPS[state.index] : null;

  // Re-measure whenever the active step changes, and keep it pinned on
  // resize/scroll (panels resizing, canvas scrolling, etc.).
  useLayoutEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    const update = () => setRect(measure(step.selector));
    update();
    // The target may render a tick late (e.g. right after a route/panel
    // change); retry a couple of times before giving up silently.
    const retry = setTimeout(update, 50);
    const retry2 = setTimeout(update, 250);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      clearTimeout(retry);
      clearTimeout(retry2);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  useEffect(() => {
    if (!state.active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dispatch({ type: "SKIP" });
      }
    };
    // Capture phase so Esc dismisses the tour before it reaches any other
    // handler (e.g. canvas-pick-mode's own Esc listener) — the tour should
    // always win while it's up.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state.active, dispatch]);

  if (!step) return null;

  const total = TOUR_STEPS.length;
  const n = state.index + 1;

  // The spotlight rect = target padded by PAD, then clamped to the viewport so
  // it never spills off an edge (targets flush against the left rail used to
  // push the highlight to x=-2, clipping its rounded corners/accent ring into
  // a lopsided notch). Clamping keeps the highlight fully on-screen and evenly
  // rounded on all four corners.
  const sr = rect ? spotlightFor(rect) : null;

  // Tooltip position: prefer the requested side of the target, clamped to the
  // viewport so it never renders off-screen for narrow windows. Anchored to the
  // *spotlight* rect (sr) rather than the raw target, so GAP is the real visible
  // gap from the highlight edge (not eaten by PAD). For top/bottom placement we
  // pin the card's edge nearest the spotlight (via `bottom`/`top`) so its actual
  // height can't make it overlap the highlight.
  const tooltipStyle: React.CSSProperties = { position: "fixed" };
  const GAP = 14;
  const TOOLTIP_W = 320;
  // Keep a side-placed card vertically on-screen without knowing its height.
  const CARD_MAX_H = 260;
  if (sr) {
    const centeredLeft = Math.max(
      12,
      Math.min(sr.left + sr.width / 2 - TOOLTIP_W / 2, window.innerWidth - TOOLTIP_W - 12)
    );
    const sideTop = Math.max(12, Math.min(sr.top, window.innerHeight - CARD_MAX_H));
    if (step.placement === "right") {
      tooltipStyle.left = Math.min(sr.left + sr.width + GAP, window.innerWidth - TOOLTIP_W - 12);
      tooltipStyle.top = sideTop;
    } else if (step.placement === "left") {
      tooltipStyle.left = Math.max(12, sr.left - GAP - TOOLTIP_W);
      tooltipStyle.top = sideTop;
    } else if (step.placement === "top") {
      tooltipStyle.left = centeredLeft;
      tooltipStyle.bottom = Math.max(12, window.innerHeight - (sr.top - GAP));
    } else {
      tooltipStyle.left = centeredLeft;
      tooltipStyle.top = Math.min(sr.top + sr.height + GAP, window.innerHeight - 120);
    }
  } else {
    // Target not found/visible: center the card so the tour still reads.
    tooltipStyle.left = window.innerWidth / 2 - TOOLTIP_W / 2;
    tooltipStyle.top = window.innerHeight / 2 - 100;
  }

  return createPortal(
    <div className="tour-overlay" role="dialog" aria-label="Product tour">
      {sr ? (
        // A single element whose huge box-shadow spread dims the whole viewport
        // except its own rect (the "hole"). Replaces a 4-rectangle mask that
        // could overlap along shared edges — producing a doubled-darkness band —
        // when the spotlight sat near a viewport edge.
        <div
          className="tour-spotlight"
          style={{ top: sr.top, left: sr.left, width: sr.width, height: sr.height }}
        />
      ) : (
        <div className="tour-dim-full" />
      )}

      <div className="tour-card" style={tooltipStyle}>
        <div className="tour-card-step">
          Step {n} of {total}
        </div>
        <h3 className="tour-card-title">{step.title}</h3>
        <p className="tour-card-body">{step.body}</p>
        <div className="tour-card-actions">
          <button className="tour-btn tour-btn-skip" onClick={() => dispatch({ type: "SKIP" })}>
            Skip
          </button>
          <div className="tour-card-nav">
            {state.index > 0 && (
              <button className="tour-btn" onClick={() => dispatch({ type: "BACK" })}>
                Back
              </button>
            )}
            <button className="tour-btn tour-btn-primary" onClick={() => dispatch({ type: "NEXT" })}>
              {n === total ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
