# @odd/test-harness

Vitest helpers for third-party ODD scenes and widgets.

```sh
npm install --save-dev @odd/test-harness vitest jsdom
```

```js
// vitest.config.js
export default { test: { environment: 'jsdom' } };
```

```js
// scene.test.js
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { mountScene, makeEnv } from '@odd/test-harness';

describe( 'example-rainbow scene', () => {
    it( 'registers and runs 60 ticks without throwing', async () => {
        const source = readFileSync( './scene.js', 'utf8' );
        const scene = await mountScene( { slug: 'example-rainbow', source } );
        const env = makeEnv( { tier: 'normal' } );
        const state = scene.setup( env );
        for ( let i = 0; i < 60; i++ ) scene.tick( state, env );
    } );
} );
```

## What you get

- `mountScene({ slug, source })` — evaluates your scene IIFE, returns the scene module after asserting it registered with `setup()` and `tick()`.
- `mountWidget({ id, source })` — same contract for widgets that define `window.desktopModeWidgets[id]`.
- `makeEnv({ tier, width, height })` — builds a scene env with a Pixi v8 stub. `tier` is `'high' | 'normal' | 'low'`, matching the runtime perf tiers.
- `createPixiStub()` — the Pixi v8 stub directly, for when you want to test a helper outside a scene.
- `reset()` — drops `window.__odd`, handy in `afterEach`.

## What it doesn't do

- It doesn't run real Pixi. Rendering is no-op; you can't assert "this pixel is red". Use Playwright against a WordPress install for that.
- It doesn't load the ODD plugin itself. For full-surface tests — panel, REST, installer — run `install-smoke.yml` or the e2e workflow from the main repo.
- It doesn't simulate the shared mount runner. Your `tick()` is called directly; `onResize` and `cleanup` are available but you trigger them yourself.

## Versioning

The harness follows the same API-version rules as ODD's
[extension surface](https://github.com/RegionallyFamous/odd/blob/main/docs/api-versioning.md).
Minor releases add helpers; major releases break existing ones. The
`1.x.y` line tracks ODD API `1.x`.

## License

GPL-2.0-or-later.
