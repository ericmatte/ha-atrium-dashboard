import "./components/rooms-view.js";
import "./components/header.js";
import { ALL_FLOOR_KEY } from "./lib/shell.js";

class AtriumStrategy {
  static async generate(_config, hass) {
    // Tabs read top-down: upper floors ascending (1, 2, 3, …), then the
    // basement after them rather than in front. "Other" is appended last.
    const floorSortKey = (f) => {
      const lvl = f.level;
      if (lvl == null) return Number.MAX_SAFE_INTEGER;
      return lvl > 0 ? lvl : 1_000_000 - lvl;
    };
    const floors = Object.values(hass.floors || {}).sort(
      (a, b) => floorSortKey(a) - floorSortKey(b)
    );

    // Virtual floor so areas off-grid (e.g. Outside) still get a tab.
    const orphanAreas = Object.values(hass.areas || {}).filter(
      (a) => !a.floor_id
    );
    const otherFloor = orphanAreas.length
      ? {
          floor_id: null,
          name: "Other",
          icon: "mdi:map-marker-outline",
          level: 999,
        }
      : null;
    const allFloors = otherFloor ? [...floors, otherFloor] : floors;

    const headerCard = (floorScope, title) => ({
      type: "custom:atrium-header",
      ...(title ? { title } : {}),
      floor: floorScope,
    });

    const floorIcon = (floor) => {
      if (floor.icon) return floor.icon;
      const lvl = floor.level;
      if (lvl == null) return "mdi:home";
      if (lvl < 0) return "mdi:home-floor-b";
      if (lvl === 0) return "mdi:home-floor-0";
      return `mdi:home-floor-${Math.min(lvl, 3)}`;
    };

    const roomsCard = (floors) => ({
      type: "custom:atrium-rooms",
      floors: floors.map((f) => ({ floor_id: f.floor_id ?? null, name: f.name, icon: floorIcon(f) })),
    });

    // Each view is `panel: true` so it gets the full viewport width (no
    // sections-view 500px grid clamp), with a vertical-stack inside so we
    // can still ship multiple cards in it.
    const stack = (cards) => ({
      type: "vertical-stack",
      cards: cards.filter(Boolean),
    });

    const baseView = (extra) => ({
      panel: true,
      ...extra,
    });

    // Manual config is additive and tolerant: unknown/missing keys are
    // ignored rather than throwing so a typo can't break the whole dashboard.
    const cfg = _config || {};
    const cfgList = (v) => (Array.isArray(v) ? v : []);

    const entitiesCard = (title, ids) =>
      ids.length
        ? { type: "entities", title, entities: ids.map((entity) => ({ entity })) }
        : null;

    // Home is every floor and area as photo tiles; picking one opens its
    // details panel with lights, climate, covers, scenes and automations —
    // there's no separate Routines tab any more, it's all in that panel.
    const homeView = baseView({
      title: "Home",
      path: "home",
      icon: "mdi:home",
      cards: [
        stack([
          headerCard(ALL_FLOOR_KEY),
          roomsCard(allFloors),
        ]),
      ],
    });

    // Custom tabs are aggregate/manual: only what the user adds via YAML (no
    // auto-discovery — the header pill covers batteries, and the user
    // supplies their own cards). No floor/area accordion. Fully config-driven
    // so the dashboard ships with zero of them until `tabs` is populated.
    const slugify = (title) =>
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "tab";

    const customTabView = (tab) => {
      const title = tab.title || "Tab";
      return baseView({
        title,
        path: tab.path || slugify(title),
        icon: tab.icon || "mdi:view-dashboard",
        cards: [
          stack([
            headerCard(ALL_FLOOR_KEY, title),
            stack([
              entitiesCard(tab.entities_title || title, cfgList(tab.entities)),
              ...cfgList(tab.cards),
            ]),
          ]),
        ],
      });
    };

    const customTabs = cfgList(cfg.tabs).map(customTabView);

    return {
      title: "Atrium",
      views: [
        homeView,
        ...customTabs,
      ],
    };
  }
}

customElements.define("ll-strategy-dashboard-atrium", AtriumStrategy);
