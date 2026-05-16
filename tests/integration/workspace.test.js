/**
 * workspace.test.js — .odd preset helper coverage.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const WORKSPACE_JS = resolve( __dirname, '../../odd/src/shared/workspace.js' );

function loadWorkspace() {
	const src = readFileSync( WORKSPACE_JS, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=shared/workspace.js` );
	fn.call( globalThis );
}

describe( 'ODD workspace files', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
		window.localStorage.clear();
		delete window.__odd;
		delete window.odd;
		delete window.wp;
		window.odd = {
			version: 'test',
			wallpaper: 'aurora',
			scene: 'aurora',
			iconSet: 'filament',
			cursorSet: 'spark',
			theme: 'dark',
			shuffle: { enabled: true, minutes: 20 },
			screensaver: { enabled: true, minutes: 8, scene: 'flux' },
			audioReactive: true,
			shopTaskbar: true,
			shopDesktopPinned: false,
			favorites: [ 'aurora', 'flux' ],
			recents: [ 'bad slug', 'circuit-garden' ],
			userApps: { installed: [], pinned: [ 'sine' ] },
		};
		window.wp = {
			desktop: {
				widgetLayer: {
					getEnabledIds: () => [ 'odd/sticky', 'eight-ball', '../nope' ],
				},
			},
		};
		loadWorkspace();
	} );

	it( 'exports the current desktop as a safe .odd JSON shape', () => {
		const workspace = window.__odd.workspace.exportData( { name: 'My Weird Desk' } );

		expect( workspace.format ).toBe( 'com.regionallyfamous.odd.workspace' );
		expect( workspace.schema ).toBe( 1 );
		expect( workspace.name ).toBe( 'My Weird Desk' );
		expect( workspace.prefs.wallpaper ).toBe( 'aurora' );
		expect( workspace.prefs.iconSet ).toBe( 'filament' );
		expect( workspace.prefs.cursorSet ).toBe( 'spark' );
		expect( workspace.desktop.widgets.enabled ).toEqual( [ 'odd/sticky', 'odd/eight-ball' ] );
		expect( workspace.content ).toEqual( expect.arrayContaining( [
			{ type: 'scene', slug: 'aurora' },
			{ type: 'scene', slug: 'flux' },
			{ type: 'icon-set', slug: 'filament' },
			{ type: 'cursor-set', slug: 'spark' },
			{ type: 'widget', slug: 'sticky' },
			{ type: 'widget', slug: 'eight-ball' },
			{ type: 'app', slug: 'sine' },
		] ) );
		expect( workspace.content ).not.toContainEqual( { type: 'scene', slug: 'bad slug' } );
	} );

	it( 'exports enabled widgets from Desktop Mode 0.8.5 localStorage when the layer is absent', () => {
		delete window.wp.desktop.widgetLayer;
		window.localStorage.setItem( 'desktop-mode-widgets', JSON.stringify( [ 'odd/sticky', 'odd/eight-ball' ] ) );

		const workspace = window.__odd.workspace.exportData( { name: 'Stored Widgets' } );

		expect( workspace.desktop.widgets.enabled ).toEqual( [ 'odd/sticky', 'odd/eight-ball' ] );
	} );

	it( 'parses only marked ODD workspace files and builds a prefs patch', () => {
		const raw = JSON.stringify( {
			format: 'com.regionallyfamous.odd.workspace',
			schema: 1,
			name: 'Imported',
			prefs: {
				wallpaper: 'aurora',
				iconSet: 'filament',
				cursorSet: 'none',
				theme: 'purple',
				shuffle: { enabled: true, minutes: 999 },
			},
			desktop: { widgets: { enabled: [ 'odd/sticky' ] } },
			content: [
				{ type: 'scene', slug: 'aurora' },
				{ type: 'widget', slug: 'sticky' },
				{ type: 'scene', slug: '../bad' },
			],
		} );

		const workspace = window.__odd.workspace.parseText( raw );
		expect( workspace.prefs.cursorSet ).toBe( '' );
		expect( workspace.prefs.theme ).toBe( 'auto' );
		expect( workspace.prefs.shuffle.minutes ).toBe( 240 );
		expect( window.__odd.workspace.widgetIds( workspace ) ).toEqual( [ 'sticky' ] );
		expect( window.__odd.workspace.buildPrefsPatch( workspace ) ).toMatchObject( {
			wallpaper: 'aurora',
			iconSet: 'filament',
			cursorSet: '',
			theme: 'auto',
		} );
		expect( window.__odd.workspace.requiredContent( workspace ) ).toEqual( expect.arrayContaining( [
			{ type: 'scene', slug: 'aurora' },
			{ type: 'widget', slug: 'sticky' },
		] ) );
		expect( () => window.__odd.workspace.parseText( JSON.stringify( { format: 'not-odd', schema: 1 } ) ) ).toThrow( /not an ODD workspace/ );
	} );
} );
