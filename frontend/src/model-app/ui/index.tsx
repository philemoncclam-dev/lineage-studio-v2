// Reusable styled primitives — one design system shared across the app.
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
} from "react";

type Variant =
  | "primary"
  | "secondary"
  | "subtle"
  | "success"
  | "danger"
  | "toolbar";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Excel-style Alt key-tip letter (see keytips.tsx). */
  keyTip?: string;
  /** When true, shows a spinner, sets aria-busy, and disables the button so
   *  async actions give consistent in-place feedback. */
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  className = "",
  keyTip,
  loading = false,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`ui-btn ui-btn--${variant}${loading ? " is-loading" : ""} ${className}`}
      data-keytip={keyTip}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className="ui-btn-spinner" aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({ className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`ui-iconbtn ${className}`} {...rest} />;
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ui-input ${className}`} {...rest} />;
}

export function Select({ className = "", ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`ui-select ${className}`} {...rest} />;
}

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`ui-textarea ${className}`} {...rest} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ui-field">
      <span className="ui-field-label">{label}</span>
      {children}
    </label>
  );
}

export function Badge({
  children,
  accent,
  className = "",
}: {
  children: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <span className={`ui-badge ${accent ? "ui-badge--accent" : ""} ${className}`}>
      {children}
    </span>
  );
}
