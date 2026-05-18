# ODD Game Design Language

ODD games are tiny arcade cabinets that happen to live in WordPress. They should not feel like generic web games placed inside a window. The window is the cabinet.

## Non-Negotiables

- No document scroll. The app owns one fixed `100vw` by `100vh` viewport and scales inside it.
- Every game has a right-side console/sidebar. It stays present at desktop and mobile widths.
- The first screen is the playable game. No landing pages, instruction pages, or marketing hero sections.
- Visible keyboard-help paragraphs are not part of the UI. Keyboard support is expected, but the visible control surface is touch/click-first.
- All real copy, numbers, and jokes are rendered in HTML or canvas. Generated art should not contain readable text.

## Cabinet Layout

Use the same structural grammar for every first-party game:

```html
<main class="app-shell">
  <header class="topbar">...</header>
  <section class="game-layout">
    <div class="canvas-wrap">
      <div class="stage-shell">
        <canvas id="game-canvas"></canvas>
      </div>
    </div>
    <aside class="side-panel">
      <div class="console-cap">...</div>
      <div class="status-card">...</div>
      <div class="control-deck">...</div>
    </aside>
  </section>
</main>
```

For board games without canvas, the board still sits in a stable stage shell. The sidebar still carries status and touch controls.

## Responsive Rules

The app never switches to a scrolling single-column page. At narrow sizes:

- Keep `html`, `body`, and `.app-shell` at fixed viewport height with hidden overflow.
- Keep `.game-layout` as a two-column grid.
- Shrink the HUD, board cells, canvas, side copy, and buttons.
- Prefer shorter status copy over wrapping paragraphs.
- If a game still does not fit, redesign the control deck. Do not add scroll.

Recommended starting point:

```css
html,
body {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.app-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.game-layout {
  display: grid;
  grid-template-columns: minmax(168px, 1fr) minmax(142px, 38%);
  min-width: 0;
  min-height: 0;
}

.side-panel,
.canvas-wrap,
.stage-shell {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
```

## Visual System

- **Topbar:** telemetry rail, not a page header. Use a small brand mark, short title, one compact status line, and score modules.
- **Stage:** the main playfield. It should have a generated or carefully drawn backdrop, stable aspect ratio, and no dead black space.
- **Sidebar:** control console. Include a cap strip, a status/portrait card, compact meters, preview/lives/powerup modules, and touch buttons.
- **Buttons:** arcade controls with strong borders, glow, and stable dimensions. Avoid plain utility buttons.
- **Palette:** dark plum cabinet chrome with cyan, pink, warm yellow, green, and occasional violet. Do not let a game collapse into one hue.
- **Radii:** 8px or less unless an in-game object is intentionally round.

## ImageGen Workflow

Before recoding a first-party game UI, generate a full-interface concept image to establish the cabinet. Then produce or derive:

- One stage/backdrop asset used in the actual game.
- One sticker/portrait/control-deck asset for the sidebar when useful.
- Catalog card and icon assets that still follow the ODD Shop card/icon contracts.

Generated images are references and raster assets. They are not a substitute for clean HTML/CSS/canvas layout.

## Validation

For every changed game, run:

```bash
node --check _tools/catalog-sources/apps/<slug>/bundle-src/app.js
odd/bin/validate-manifest _tools/catalog-sources/apps/<slug>/bundle-src/manifest.json
python3 _tools/build-catalog.py
ODD_VALIDATE_REBUILD=1 odd/bin/validate-catalog
odd/bin/smoke-catalog-apps <slug> --screenshots-dir /tmp/<slug>-smoke
git diff --check
```

`odd/bin/smoke-catalog-apps` treats catalog apps tagged `game` as cabinet apps. It fails if a game scrolls vertically, lacks a sidebar, lacks a stable stage shell, or exposes visible keyboard-instruction copy.
