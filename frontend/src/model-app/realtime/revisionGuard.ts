// Revision-guarding for live model sync. Kept as a tiny standalone module
// (rather than inline in the channel) so it's trivially unit-testable: given
// the highest revision applied so far and an incoming revision number, decide
// whether the incoming message should be applied or dropped.
//
// Rule: drop any incoming message whose revision is <= the highest revision
// already applied locally. This handles both out-of-order delivery (a stale
// message arriving late) and duplicate delivery (Realtime's at-least-once
// semantics), with strict "<=" so an equal revision (a duplicate of the same
// edit) is also dropped, not just older ones.
export function shouldApplyRevision(highestApplied: number, incoming: number): boolean {
  return incoming > highestApplied;
}

// Small mutable holder for the "highest revision applied" counter, since it
// needs to be shared/updated across both local commits (which bump it when
// broadcasting) and incoming remote messages (which bump it when applied).
export class RevisionTracker {
  private highest: number;

  constructor(initial = 0) {
    this.highest = initial;
  }

  get current(): number {
    return this.highest;
  }

  // Returns the next revision number to use when broadcasting a local edit,
  // and advances the tracker so a message we just sent can't be "applied
  // again" if Realtime ever echoes it back to us.
  next(): number {
    this.highest += 1;
    return this.highest;
  }

  // Attempt to apply an incoming revision. Returns true (and advances the
  // tracker) if it passed the guard; false if it was stale/duplicate and
  // should be dropped.
  tryApply(incoming: number): boolean {
    if (!shouldApplyRevision(this.highest, incoming)) return false;
    this.highest = incoming;
    return true;
  }
}
