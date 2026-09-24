// hass.labels (the label registry) is only populated once something in the
// frontend session has subscribed to it — HA does that lazily, e.g. when the
// Settings > Labels page loads. A standalone Lovelace strategy dashboard
// like Atrium can run its whole life without that ever happening, so
// hass.labels can stay permanently undefined even though
// hass.entities[id].labels (the label ids assigned to that entity) is
// always populated from the entity registry. We fetch the registry
// ourselves, once, and fall back to it until hass.labels shows up.

let cache = null; // { [label_id]: LabelRegistryEntry } once loaded
let pending = false;
const listeners = new Set();

function loadFromWS(hass) {
  if (cache || pending) return;
  if (typeof hass.callWS !== "function") return;
  pending = true;
  hass
    .callWS({ type: "config/label_registry/list" })
    .then((list) => {
      cache = Object.fromEntries((list || []).map((l) => [l.label_id, l]));
      pending = false;
      for (const fn of listeners) fn();
    })
    .catch(() => {
      pending = false;
    });
}

// Prefers hass.labels (when HA has already populated it) so we never fight
// a fresher source of truth; only reaches for our own fetch as a fallback.
export function getLabel(hass, labelId) {
  if (hass.labels?.[labelId]) return hass.labels[labelId];
  if (cache?.[labelId]) return cache[labelId];
  loadFromWS(hass);
  return null;
}

// Fires once our fallback fetch resolves, so a card that rendered before the
// registry arrived can re-render and pick the labels up.
export function subscribeLabelsLoaded(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function _resetForTests() {
  cache = null;
  pending = false;
  listeners.clear();
}
