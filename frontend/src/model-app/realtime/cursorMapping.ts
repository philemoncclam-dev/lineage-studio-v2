// Screen <-> scroll-space coordinate mapping for live cursors.
//
// The canvas pans via native scroll (Canvas.tsx's `.canvas-scroll` div) rather
// than a transform, and zoom is pinned to 1 (minZoom === maxZoom === 1 in
// Canvas.tsx), so "scroll-space" is simply the scrollable content's own
// coordinate system: content-relative-x = clientX - containerLeft + scrollLeft,
// scaled by 1/zoom for forward-compatibility if zoom is ever re-enabled.
// Broadcasting this instead of raw clientX/clientY means a peer who has
// scrolled/panned to a different part of the canvas still sees the cursor at
// the correct spot relative to the shared content, not the shared viewport.

export interface ScrollSpacePoint {
  x: number;
  y: number;
}

export interface ContainerRect {
  left: number;
  top: number;
  scrollLeft: number;
  scrollTop: number;
  zoom?: number; // defaults to 1; kept for forward-compat if zoom is enabled later
}

// Convert a raw mouse event position (viewport-relative clientX/clientY) into
// scroll-space content coordinates for broadcasting to peers.
export function screenToScrollSpace(
  clientX: number,
  clientY: number,
  rect: ContainerRect
): ScrollSpacePoint {
  const zoom = rect.zoom ?? 1;
  return {
    x: (clientX - rect.left + rect.scrollLeft) / zoom,
    y: (clientY - rect.top + rect.scrollTop) / zoom,
  };
}

// Convert a peer's scroll-space content coordinates back into a position
// relative to *this* client's viewport, so the remote cursor renders in the
// right place even if this client is scrolled/panned differently.
export function scrollSpaceToScreen(
  point: ScrollSpacePoint,
  rect: ContainerRect
): ScrollSpacePoint {
  const zoom = rect.zoom ?? 1;
  return {
    x: point.x * zoom - rect.scrollLeft + rect.left,
    y: point.y * zoom - rect.scrollTop + rect.top,
  };
}
