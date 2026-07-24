// Excel-style "Key Tips": press Alt (Option on Mac) to overlay letter badges on
// every actionable control, then press that letter to activate it. Any element
// opts in with a data-keytip="X" attribute; activation just calls .click(), so
// it reuses the element's existing handler.
//
// Cross-platform note: we match on event.code (the physical key), NOT event.key.
// On macOS, Option+L emits a special character and mutates event.key, but
// event.code stays "KeyL" — so matching by code makes the same letters work on
// Windows (Alt) and Mac (Option) identically.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Tip {
  key: string;
  x: number;
  y: number;
  el: HTMLElement;
}

// "KeyH" -> "H", "Digit1" -> "1", otherwise null.
function letterForCode(code: string): string | null {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return null;
}

function isTypingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || !!el?.isContentEditable;
}

export function KeyTips() {
  const [active, setActive] = useState(false);
  const [tips, setTips] = useState<Tip[]>([]);
  const activeRef = useRef(false);
  const tipsRef = useRef<Tip[]>([]);
  // When a submenu is open, tips are scoped to it (so the second level doesn't
  // collide with the always-present rail badges).
  const scopedRef = useRef(false);

  const setActiveBoth = useCallback((v: boolean) => {
    activeRef.current = v;
    setActive(v);
  }, []);
  const setTipsBoth = useCallback((v: Tip[]) => {
    tipsRef.current = v;
    setTips(v);
  }, []);

  // Snapshot the position of every visible, enabled [data-keytip] element.
  // When scoped, only look inside the open submenu ([data-keytip-menu]).
  const collect = useCallback((): Tip[] => {
    const out: Tip[] = [];
    const seen = new Set<string>();
    const root =
      (scopedRef.current && document.querySelector<HTMLElement>("[data-keytip-menu]")) ||
      document;
    for (const el of root.querySelectorAll<HTMLElement>("[data-keytip]")) {
      if ((el as HTMLButtonElement).disabled) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue; // hidden
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue; // scrolled off
      const key = (el.getAttribute("data-keytip") || "").toUpperCase();
      if (!key || seen.has(key)) continue; // first visible wins on collision
      seen.add(key);
      out.push({ key, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, el });
    }
    return out;
  }, []);

  useEffect(() => {
    const close = () => {
      scopedRef.current = false;
      setActiveBoth(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Toggle on a bare Alt/Option press (not Ctrl/Cmd+Alt combos).
      if (e.key === "Alt" && !e.ctrlKey && !e.metaKey) {
        if (e.repeat) return;
        if (!activeRef.current && isTypingTarget()) return;
        e.preventDefault(); // suppress the browser menu-bar focus on Windows
        if (activeRef.current) {
          setActiveBoth(false);
        } else {
          setTipsBoth(collect());
          setActiveBoth(true);
        }
        return;
      }

      if (!activeRef.current) return;

      // Overlay is up: Esc/Tab cancels; a matching letter activates; anything
      // else just dismisses.
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        close();
        return;
      }
      const letter = letterForCode(e.code);
      const hit = letter ? tipsRef.current.find((t) => t.key === letter) : undefined;
      if (hit) {
        e.preventDefault();
        hit.el.click();
        // A submenu trigger opens a second level: stay active and re-collect
        // (scoped to the menu) once it has rendered, instead of dismissing.
        if (hit.el.hasAttribute("data-keytip-submenu")) {
          scopedRef.current = true;
          setTimeout(() => {
            if (activeRef.current) setTipsBoth(collect());
          }, 60);
          return;
        }
      }
      close();
    };

    // Keep Windows from focusing the menu bar on Alt release while we're active.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt" && activeRef.current) e.preventDefault();
    };

    const reposition = () => {
      if (activeRef.current) setTipsBoth(collect());
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [collect, setActiveBoth, setTipsBoth]);

  if (!active) return null;

  return createPortal(
    <div className="keytips-overlay" aria-hidden>
      <div className="keytips-caption">Shortcuts — press a key · Esc to cancel</div>
      {tips.map((t) => (
        <span key={t.key} className="keytip-badge" style={{ left: t.x, top: t.y }}>
          {t.key}
        </span>
      ))}
    </div>,
    document.body
  );
}
