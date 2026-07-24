// "Have they seen the tour" gate — same one-key-in-localStorage pattern as
// theme.tsx's dark-mode persistence.
const KEY = "ls.tour.seen";

export function hasSeenTour(): boolean {
  return localStorage.getItem(KEY) === "1";
}

export function markTourSeen(): void {
  localStorage.setItem(KEY, "1");
}

// Used by "Take the tour" (replay) so a rerun doesn't require clearing storage
// by hand; harmless if already unset.
export function clearTourSeen(): void {
  localStorage.removeItem(KEY);
}
