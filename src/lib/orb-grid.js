// Sizes the rooms view's round area tiles for the width they have. Tiles are
// as big as possible: the row holds as many columns as fit at a minimum size,
// but never more than the busiest floor has areas — so there's no empty
// column left at the end of a row — and the tiles stretch to fill it.

const clamp = (min, v, max) => Math.max(min, Math.min(max, v));

// Past this a photo stops being a tile and starts being a poster; the row
// then simply ends short of the right edge.
export const MAX_ORB_SIZE = 175;

export function orbGrid(width, maxAreasPerFloor) {
  const gap = Math.round(clamp(24, width * 0.05, 64));
  const minSize = clamp(92, width * 0.1 + 40, 180);
  const fit = Math.max(1, Math.floor((width + gap) / (minSize + gap)));
  const cols = Math.max(1, Math.min(fit, maxAreasPerFloor || 1));
  const size = Math.floor(Math.min(MAX_ORB_SIZE, (width - gap * (cols - 1)) / cols));
  return { cols, gap, size };
}

// The light/alert badges on a tile, sized from the tile. Proportions come from
// the design's 156px tile (12px text, 4px/8px inset, 3px ring), enlarged ×2
// on a phone-sized tile and easing down to ×1.2 at the largest one — small
// tiles need proportionally bigger badges to stay readable.
const PHONE_ORB_SIZE = 100;
const BADGE_SCALE_PHONE = 2;
const BADGE_SCALE_MAX = 1.2;

export function badgeScale(size) {
  const t = clamp(0, (size - PHONE_ORB_SIZE) / (MAX_ORB_SIZE - PHONE_ORB_SIZE), 1);
  return BADGE_SCALE_PHONE + (BADGE_SCALE_MAX - BADGE_SCALE_PHONE) * t;
}

export function orbBadge(size) {
  const px = (v) => Math.round(v * 100) / 100;
  return {
    font: px(size * (12 / 156) * badgeScale(size)),
    insetX: px(size * (4 / 156)),
    insetY: px(size * (8 / 156)),
    ring: px(size * (3 / 156)),
  };
}
