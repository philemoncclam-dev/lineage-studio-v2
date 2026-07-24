// App-wide toast notifications: a lightweight, dependency-free feedback channel
// so async actions can confirm success/failure consistently ("Sync complete",
// "Run failed: …") instead of leaving the user guessing whether anything
// happened. Mount <ToastProvider> once near the app root; call useToast()
// anywhere to push one.
//
// Each toast auto-dismisses after a timeout (errors linger longer) and can be
// dismissed by click. Rendered through a portal so it floats above modals.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({
  toast: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
});

// Errors stay longer (more likely to carry text worth reading); others are brief.
const DURATION: Record<ToastKind, number> = {
  success: 3500,
  info: 3500,
  error: 6000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, kind, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION[kind])
      );
    },
    [dismiss]
  );

  // Clear any pending timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (m) => toast(m, "success"),
      error: (m) => toast(m, "error"),
      info: (m) => toast(m, "info"),
    }),
    [toast]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toast-stack" role="region" aria-label="Notifications">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`toast toast--${t.kind}`}
              role={t.kind === "error" ? "alert" : "status"}
              onClick={() => dismiss(t.id)}
            >
              <span className="toast-icon" aria-hidden>
                {t.kind === "success" ? "✓" : t.kind === "error" ? "!" : "i"}
              </span>
              <span className="toast-msg">{t.message}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
