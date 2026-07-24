// Validation flyout: lists likely model problems grouped by kind. Clicking an
// issue selects the offending node so the user can jump to and fix it. Unmapped
// attributes can be marked OK when the missing lineage is intentional, which
// removes them from the count.
import { Icon } from "../ui/Icon";
import { ISSUE_LABELS, type IssueKind, type ValidationResult } from "./validate";

interface Props {
  result: ValidationResult;
  onSelect: (id: string) => void;
  onAcknowledge: (id: string) => void;
  onRestore: (id: string) => void;
}

const ORDER: IssueKind[] = ["typeMismatch", "cycle", "orphan", "unmapped"];

export default function ValidationPanel({ result, onSelect, onAcknowledge, onRestore }: Props) {
  const total = result.issues.length;

  return (
    <div className="filter-panel">
      <div className="tree-header">
        Validation
        <span className="filter-section-hint">
          {total === 0 ? " · all clear" : ` · ${total} issue${total === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="filter-body">
        {total === 0 ? (
          <p className="filter-empty">No problems found</p>
        ) : (
          ORDER.map((kind) => {
            const list = result.byKind[kind];
            if (list.length === 0) return null;
            return (
              <div key={kind}>
                <div className="filter-section-label">
                  {ISSUE_LABELS[kind]}
                  <span className="filter-section-hint"> · {list.length}</span>
                </div>
                <ul className="validation-list">
                  {list.map((it, i) => (
                    <li key={`${it.nodeId}-${i}`} className="validation-row">
                      <button
                        className="validation-item"
                        onClick={() => onSelect(it.nodeId)}
                        title="Select this node"
                      >
                        {it.message}
                      </button>
                      {kind === "unmapped" && (
                        <button
                          className="validation-ok"
                          onClick={() => onAcknowledge(it.nodeId)}
                          title="Mark as intentionally unmapped"
                        >
                          <Icon name="checkmark" /> OK
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}

        {result.acknowledged.length > 0 && (
          <>
            <div className="filter-section-label">
              Marked OK
              <span className="filter-section-hint"> · {result.acknowledged.length}</span>
            </div>
            <ul className="validation-list">
              {result.acknowledged.map((it) => (
                <li key={it.nodeId} className="validation-row">
                  <button
                    className="validation-item is-muted"
                    onClick={() => onSelect(it.nodeId)}
                    title="Select this node"
                  >
                    {it.message}
                  </button>
                  <button
                    className="validation-ok"
                    onClick={() => onRestore(it.nodeId)}
                    title="Move back to issues"
                  >
                    Undo
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
