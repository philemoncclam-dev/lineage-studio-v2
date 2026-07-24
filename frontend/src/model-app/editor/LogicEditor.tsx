// Mini SQL editor for transformation logic: a transparent <textarea> layered
// over a highlighted <pre> (no editor dependency), plus autocomplete that
// suggests the upstream attribute names actually feeding the selected node —
// the editor knows the lineage, so it knows what's in scope.
import { useMemo, useRef, useState } from "react";
import { Icon } from "../ui/Icon";

const SQL_KEYWORDS = new Set(
  (
    "select from where join left right inner outer full cross on group by order having " +
    "case when then else end as and or not null in is between like limit offset union all " +
    "distinct insert update delete into values set with over partition rows preceding " +
    "following current row cast coalesce nullif exists"
  ).split(" ")
);
const SQL_FUNCS = new Set(
  "sum count avg min max round floor ceil abs concat substring trim upper lower length now date_trunc extract row_number rank dense_rank lag lead".split(" ")
);

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Tokenize-and-wrap. Order matters: comments, then strings, then words/numbers.
function highlight(src: string): string {
  const out: string[] = [];
  const re = /(--[^\n]*)|('(?:[^']|'')*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w.]*)|([\s\S])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const [, comment, str, num, word, other] = m;
    if (comment) out.push(`<span class="sql-comment">${escapeHtml(comment)}</span>`);
    else if (str) out.push(`<span class="sql-string">${escapeHtml(str)}</span>`);
    else if (num) out.push(`<span class="sql-number">${num}</span>`);
    else if (word) {
      const lower = word.toLowerCase();
      if (SQL_KEYWORDS.has(lower)) out.push(`<span class="sql-keyword">${escapeHtml(word)}</span>`);
      else if (SQL_FUNCS.has(lower)) out.push(`<span class="sql-func">${escapeHtml(word)}</span>`);
      else out.push(escapeHtml(word));
    } else out.push(escapeHtml(other ?? ""));
  }
  return out.join("");
}

interface Props {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  // Upstream attribute names in scope for autocomplete.
  suggestions: string[];
}

export default function LogicEditor({ value, placeholder, onChange, suggestions }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<string[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [wordStart, setWordStart] = useState(0);

  const html = useMemo(() => highlight(value) + "\n", [value]);

  // Recompute the autocomplete state for the word under the caret.
  function refreshSuggest(el: HTMLTextAreaElement) {
    const caret = el.selectionStart;
    const before = el.value.slice(0, caret);
    const m = /[\w.]+$/.exec(before);
    if (!m || m[0].length < 2) {
      setOpen(false);
      return;
    }
    const word = m[0].toLowerCase();
    const found = suggestions
      .filter((s) => s.toLowerCase().includes(word) && s.toLowerCase() !== word)
      .slice(0, 6);
    setWordStart(caret - m[0].length);
    setMatches(found);
    setActiveIdx(0);
    setOpen(found.length > 0);
  }

  function accept(name: string) {
    const el = taRef.current;
    if (!el) return;
    const caret = el.selectionStart;
    const next = value.slice(0, wordStart) + name + value.slice(caret);
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const pos = wordStart + name.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(matches[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="logic-editor">
      <pre ref={preRef} className="logic-editor-hl" aria-hidden="true">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      <textarea
        ref={taRef}
        rows={4}
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          refreshSuggest(e.target);
        }}
        onKeyDown={handleKeyDown}
        onClick={() => setOpen(false)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onScroll={(e) => {
          if (preRef.current) {
            preRef.current.scrollTop = e.currentTarget.scrollTop;
            preRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }
        }}
      />
      {open && (
        <ul className="logic-suggest">
          {matches.map((s, i) => (
            <li key={s}>
              <button
                className={i === activeIdx ? "is-active" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault(); // beat the textarea blur
                  accept(s);
                }}
              >
                <span className="logic-suggest-glyph"><Icon name="arrowUpLeft" /></span>
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
