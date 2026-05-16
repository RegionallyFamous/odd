/**
 * api-surface.test.js — guard the documented extension surface.
 *
 * The full contract lives in docs/api-versioning.md. This test is
 * intentionally narrow: it asserts that the version string is present
 * and SemVer-shaped, and that the documented top-level methods are
 * still reachable. Anything more nuanced (per-method behaviour) is
 * covered by the surface-specific tests elsewhere in this folder.
 *
 * When you intentionally remove/rename a method, update this list
 * AND bump the major in api.js's API_VERSION constant AND add a line
 * to the changelog under "API breaking changes". The three have to
 * move together — that's the point.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFoundation } from './harness.js';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const SHARED_DIR = resolve( __dirname, '../../odd/src/shared' );

const EXPECTED_METHODS = [
	'scenes', 'sceneBySlug', 'currentScene',
	'iconSets', 'iconSetBySlug', 'currentIconSet',
	'cursorSets', 'cursorSetBySlug', 'currentCursorSet',
	'installedWidgets', 'apps', 'appBySlug',
	'savePrefs', 'setScene', 'setIconSet', 'setCursorSet',
	'setShuffle', 'setAudioReactive', 'shuffle', 'mountWidget',
	'tidyWidgets', 'openApp', 'resetDecorations',
	'toast', 'openOsSettings', 'showAttention', 'setBadge',
	'diagnosticsSnapshot', 'onSceneChange', 'onIconSetChange', 'openPanel',
];

const EXPECTED_CONSTANTS = [ 'HOOK_SCENE', 'HOOK_ICONSET', 'TOAST_TONE' ];

const EXPECTED_SDK_GROUPS = {
	storage: [ 'get', 'set', 'state', 'subscribe' ],
	preferences: [ 'get', 'save' ],
	theme: [ 'choices', 'get', 'set' ],
	diagnostics: [ 'summary', 'collect', 'collectMarkdown', 'copy', 'metrics' ],
};

function execShared( file ) {
	const src = readFileSync( resolve( SHARED_DIR, file ), 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=${ file }` );
	fn.call( globalThis );
}

describe( 'window.__odd.api surface', () => {
	it( 'loads and exposes a SemVer version + documented methods', () => {
		loadFoundation();
		execShared( 'api.js' );

		const api = window.__odd.api;
		expect( api, 'window.__odd.api must be installed' ).toBeDefined();
		expect( typeof api.version, 'api.version must be a string' ).toBe( 'string' );
		expect( api.version ).toMatch( /^\d+\.\d+\.\d+$/ );

		for ( const method of EXPECTED_METHODS ) {
			expect( typeof api[ method ], `api.${ method } must be a function` ).toBe( 'function' );
		}
		for ( const k of EXPECTED_CONSTANTS ) {
			expect( typeof api[ k ], `api.${ k } must be a string constant` ).toBe( 'string' );
		}
	} );

	it( 'loads the SDK facade without replacing window.__odd.api', () => {
		loadFoundation( {
			config: {
				restUrl: '/wp-json/odd/v1/prefs',
				wallpaper: 'aurora',
				scene: 'aurora',
				theme: 'dark',
				canInstall: true,
				systemHealth: {
					desktopMode: { baseline: true, commandScripts: true },
				},
			},
		} );
		const showToast = vi.fn();
		window.wp.desktop = { showToast };

		execShared( 'api.js' );
		const api = window.__odd.api;
		execShared( 'sdk.js' );

		const sdk = window.__odd.sdk;
		expect( window.__odd.api ).toBe( api );
		expect( sdk, 'window.__odd.sdk must be installed' ).toBeDefined();
		expect( sdk.version ).toMatch( /^\d+\.\d+\.\d+$/ );
		expect( sdk.apiVersion ).toBe( api.version );

		for ( const method of [ 'capabilities', 'toast', 'health', 'onTeardown', 'teardown' ] ) {
			expect( typeof sdk[ method ], `sdk.${ method } must be a function` ).toBe( 'function' );
		}
		for ( const [ group, methods ] of Object.entries( EXPECTED_SDK_GROUPS ) ) {
			expect( sdk[ group ], `sdk.${ group } must exist` ).toBeDefined();
			for ( const method of methods ) {
				expect( typeof sdk[ group ][ method ], `sdk.${ group }.${ method } must be a function` ).toBe( 'function' );
			}
		}

		expect( sdk.storage.get( 'user.wallpaper' ) ).toBe( 'aurora' );
		expect( sdk.storage.set( { user: { wallpaper: 'flux' } } ) ).toBe( true );
		expect( sdk.storage.get( 'user.wallpaper' ) ).toBe( 'flux' );
		expect( sdk.preferences.get().theme ).toBe( 'dark' );
		expect( sdk.theme.get() ).toBe( 'dark' );
		expect( sdk.capabilities().canInstall ).toBe( true );
		expect( sdk.toast( 'Hello from ODD' ) ).toBe( true );
		expect( showToast ).toHaveBeenCalledWith( expect.objectContaining( { message: 'Hello from ODD' } ) );

		const onTearDown = vi.fn();
		sdk.onTeardown( onTearDown );
		expect( sdk.teardown() ).toBe( true );
		expect( onTearDown ).toHaveBeenCalled();
	} );

	it( 'opens the Shop through registerWindow with top-friendly geometry when available', () => {
		loadFoundation( {
			config: {
				pluginUrl: 'https://example.invalid/wp-content/plugins/odd',
			},
		} );
		const render = vi.fn();
		const registerWindow = vi.fn();
		window.desktopModeNativeWindows = { odd: render };
		window.wp.desktop = {
			registerWindow,
			config: {
				nativeWindows: [
					{
						id:        'odd',
						title:     'ODD Shop',
						icon:      'https://example.invalid/odd-eye.svg',
						width:     1040,
						height:    640,
						minWidth:  420,
						minHeight: 420,
					},
				],
			},
		};
		execShared( 'api.js' );

		expect( window.__odd.api.openPanel() ).toBe( true );
		expect( registerWindow ).toHaveBeenCalledWith( expect.objectContaining( {
			id:        'odd',
			x:         96,
			y:         16,
			width:     1040,
			height:    640,
			minWidth:  420,
			minHeight: 420,
			render,
		} ) );
	} );

	it( 'opens installed apps through registerWindow without requiring openWindow', () => {
		loadFoundation( {
			config: {
				apps: [ { slug: 'timer', name: 'Timer' } ],
			},
		} );
		const render = vi.fn();
		const registerWindow = vi.fn();
		window.desktopModeNativeWindows = { 'odd-app-timer': render };
		window.wp.desktop = {
			registerWindow,
			config: {
				nativeWindows: [
					{
						id:        'odd-app-timer',
						title:     'Timer',
						icon:      'dashicons-clock',
						width:     860,
						height:    600,
						minWidth:  420,
						minHeight: 320,
					},
				],
			},
		};
		execShared( 'api.js' );

		expect( window.__odd.api.openApp( 'timer' ) ).toBe( true );
		expect( registerWindow ).toHaveBeenCalledWith( expect.objectContaining( {
			id:     'odd-app-timer',
			title:  'Timer',
			render,
			width:  860,
			height: 600,
		} ) );
	} );

	it( 'tidies widgets through a host redock API before falling back to DOM clicks', () => {
		loadFoundation( {
			config: {
				installedWidgets: [ { id: 'odd/weather' } ],
			},
		} );
		const redock = vi.fn( () => true );
		const ensureMounted = vi.fn( () => true );
		const mountIfEnabled = vi.fn();
		const card = document.createElement( 'div' );
		const button = document.createElement( 'button' );
		button.click = vi.fn();
		card.className = 'desktop-mode-widgets__card desktop-mode-widgets__card--floating';
		card.setAttribute( 'data-widget-id', 'odd/weather' );
		button.className = 'desktop-mode-widgets__card-redock';
		card.appendChild( button );
		document.body.appendChild( card );
		window.wp.desktop = {
			widgetLayer: {
				redock,
				ensureMounted,
				mountIfEnabled,
			},
		};
		execShared( 'api.js' );

		expect( window.__odd.api.tidyWidgets( { quiet: true } ) ).toBe( true );

		expect( redock ).toHaveBeenCalledWith( 'odd/weather' );
		expect( button.click ).not.toHaveBeenCalled();
		expect( ensureMounted ).toHaveBeenCalledWith( 'odd/weather' );
		expect( mountIfEnabled ).toHaveBeenCalledWith( 'odd/weather' );
	} );
} );
