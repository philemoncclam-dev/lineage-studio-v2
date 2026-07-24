// Shared drag-and-drop dropzone with click-to-browse, used by the file-import
// dialogs (ImportModel / ImportSchema / ImportDefinitions). Highlights on
// drag-over and forwards the first dropped/selected file to onFile.
import { useRef, useState, type ReactNode } from "react";

interface Props {
  accept?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  // Optional label shown under the primary line (e.g. accepted formats).
  hint?: ReactNode;
  // Filename to display once a file has been chosen.
  fileName?: string | null;
}

export default function FileDrop({ accept, disabled, onFile, hint, fileName }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f);
  };

  return (
    <div
      className={`filedrop${dragOver ? " filedrop--over" : ""}${disabled ? " filedrop--disabled" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="filedrop-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V4" />
          <path d="M7 9l5-5 5 5" />
          <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
        </svg>
      </div>
      <div className="filedrop-main">
        {fileName ? (
          <span className="filedrop-file">{fileName}</span>
        ) : (
          <>
            <strong>Drop a file</strong> or <span className="filedrop-browse">browse</span>
          </>
        )}
      </div>
      {hint && <div className="filedrop-hint">{hint}</div>}
    </div>
  );
}
