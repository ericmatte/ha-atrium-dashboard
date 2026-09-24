// Thin, shared wrappers over hass.callService so the same light/cover idioms
// aren't re-spelled in every component. `entity_id` accepts a single id or an
// array, so these cover both the per-tile and the whole-floor/room cases.

export function callService(hass, domain, service, data) {
  return hass?.callService(domain, service, data);
}

// Toggle a set of lights off if any is on, otherwise on.
export function toggleLights(hass, ids) {
  const anyOn = ids.some((id) => hass.states?.[id]?.state === "on");
  return callService(hass, "light", anyOn ? "turn_off" : "turn_on", { entity_id: ids });
}
