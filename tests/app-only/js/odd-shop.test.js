import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const panelSource = readFileSync( resolve( 'odd/src/panel/index.js' ), 'utf8' );
const panelStyles = readFileSync( resolve( 'odd/src/panel/styles.css' ), 'utf8' );
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

	it( 'publishes ODD Notes and ODD Workbench in the production catalog', () => {
		expect( registry.bundles ).toHaveLength( 2 );
		expect( registry.bundles ).toEqual( expect.arrayContaining( [
			expect.objectContaining( { type: 'app', slug: 'odd-notes', name: 'ODD Notes' } ),
			expect.objectContaining( { type: 'app', slug: 'workbench', name: 'ODD Workbench' } ),
		] ) );
	} );

	it( 'registers and renders through the OpenStation native window API', () => {
		const context = { markLoading: vi.fn(), markReady: vi.fn() };
		window.openStationNativeWindows.odd( document.body, context );
		expect( document.body.textContent ).toContain( 'Apps' );
		expect( document.body.textContent ).toContain( 'ODD Notes' );
		expect( document.body.textContent ).toContain( 'ODD Workbench' );
		expect( context.markLoading ).toHaveBeenCalledOnce();
		expect( context.markReady ).toHaveBeenCalledOnce();
	} );

	it( 'renders the apps as bounded, responsive features instead of stretching grid tiles', () => {
		window.openStationNativeWindows.odd( document.body, {} );
		const cards = document.querySelectorAll( '.odd-app-card' );
		const card = cards[ 0 ];

		expect( document.querySelector( '.odd-shop__main' ) ).not.toBeNull();
		expect( document.querySelector( '.odd-shop__intro h1' )?.textContent ).toBe( 'Small tools. Strange polish.' );
		expect( cards ).toHaveLength( 2 );
		expect( card?.dataset.state ).toBe( 'available' );
		expect( card?.querySelector( '.odd-app-card__preview' )?.getAttribute( 'src' ) ).toBe( registry.bundles[ 0 ].card_url );
		expect( card?.querySelector( '.odd-app-card__button--primary' )?.textContent ).toContain( 'Install app' );
		expect( panelStyles ).toContain( 'width: min(100%, 1240px);' );
		expect( panelStyles ).toContain( '@container odd-shop (max-width: 840px)' );
	} );

	it( 'contains no retired wp.desktop integration calls', () => {
		expect( panelSource ).not.toContain( 'wp.desktop' );
		expect( panelSource ).not.toContain( 'desktopModeNativeWindows' );
		expect( panelSource ).toContain( 'openStationNativeWindows' );
	} );
} );
