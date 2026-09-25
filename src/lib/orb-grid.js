// Sizes the rooms view's round area tiles for the width they have. Tiles are
// as big as possible: the row holds as many columns as fit at a minimum size,
// but never more than the busiest floor has areas — so there's no empty
// column left at the end of a row — and the tiles stretch to fill it.

const clamp = (min, v, max) => Math.max(min, Math.min(max, v));

// Past this a photo stops being a tile and starts being a poster; the row
// then simply ends short of the right edge.
export const MAX_ORB_SIZE = 175;

export function orbGrid(width, maxAreasPerFloor) {
  const gap = Math.round(clamp(18, width * 0.035, 48));
  const minSize = clamp(92, width * 0.1 + 40, 180);
  const fit = Math.max(1, Math.floor((width + gap) / (minSize + gap)));
  const cols = Math.max(1, Math.min(fit, maxAreasPerFloor || 1));
  const size = Math.floor(Math.min(MAX_ORB_SIZE, (width - gap * (cols - 1)) / cols));
  return { cols, gap, size };
}
