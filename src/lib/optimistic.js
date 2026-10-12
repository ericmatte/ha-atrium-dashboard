// Optimistic values: right after the view asks Home Assistant for a change,
// it shows the value it asked for instead of what HA reports in the meantime
// (a light fading through intermediate brightnesses, a cover still on its
// way, an echo of the old setpoint). A value is dropped as soon as HA's state
// matches it, or after `ttl` ms regardless — from then on the real state
// shows again. `onExpire(key)` lets the view redraw with the real state when
// a value times out without ever being confirmed.

export const OPTIMISTIC_MS = 5000;

export class Optimistic {
  constructor({ ttl = OPTIMISTIC_MS, onExpire = () => {}, now = () => Date.now() } = {}) {
    this.ttl = ttl;
    this.onExpire = onExpire;
    this.now = now;
    this.entries = new Map();
  }

  set(key, value) {
    clearTimeout(this.entries.get(key)?.timer);
    const timer = setTimeout(() => {
      if (this.entries.get(key)?.timer !== timer) return;
      this.entries.delete(key);
      this.onExpire(key);
    }, this.ttl);
    this.entries.set(key, { value, until: this.now() + this.ttl, timer });
  }

  // The value to show for `key`, or undefined to show the real state.
  // `confirmed(value)` says whether HA's state has caught up with it.
  get(key, confirmed = () => false) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.until || confirmed(entry.value)) {
      clearTimeout(entry.timer);
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  clear() {
    for (const { timer } of this.entries.values()) clearTimeout(timer);
    this.entries.clear();
  }
}
