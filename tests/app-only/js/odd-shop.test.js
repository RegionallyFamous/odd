import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const panelSource = readFileSync( resolve( 'odd/src/panel/index.js' ), 'utf8' );
const registry = JSON.parse( readFileSync( resolve( 'site/catalog/v1/registry.json' ), 'utf8' ) );

describe( 'Apps-only ODD Shop', () => {
	beforeEach( () => {
		document.body.innerHTML = '<div data-odd-shop></div>';
		window.openStationNativeWindows = {};
		window.wp = {
			i18n: { __: ( value ) => value },
			os: {
				getWindowConfig: vi.fn( () => ( {
					canInstall: true,
					restNonce: 'nonce',
					rest: {},
					installedApps: [],
					catalogApps: registry.bundles,
				} ) ),
				fetch: vi.fn(),
				openWindow: vi.fn(),
				refreshMenu: vi.fn(),
			},
		};
		window.eval( panelSource );
	} );

	it( 'publishes only ODD Notes in the production catalog', () => {
		expect( registry.bundles ).toHaveLength( 1 );
		expect( registry.bundles[ 0 ] ).toMatchObject( { type: 'app', slug: 'odd-notes', name: 'ODD Notes' } );
	} );

	it( 'registers and renders through the OpenStation native window API', () => {
		const context = { markLoading: vi.fn(), markReady: vi.fn() };
		window.openStationNativeWindows.odd( document.body, context );
		expect( document.body.textContent ).toContain( 'Apps' );
		expect( document.body.textContent ).toContain( 'ODD Notes' );
		expect( context.markLoading ).toHaveBeenCalledOnce();
		expect( context.markReady ).toHaveBeenCalledOnce();
	} );

	it( 'contains no retired wp.desktop integration calls', () => {
		expect( panelSource ).not.toContain( 'wp.desktop' );
		expect( panelSource ).not.toContain( 'desktopModeNativeWindows' );
		expect( panelSource ).toContain( 'openStationNativeWindows' );
	} );
} );
