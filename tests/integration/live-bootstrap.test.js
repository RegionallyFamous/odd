import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetOdd } from './harness.js';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const BOOTSTRAP_JS = resolve( __dirname, '../../odd/src/shared/live-bootstrap.js' );

function loadBootstrap( config = {}, settings = {} ) {
	const updateOsSettings = vi.fn( ( patch ) => {
		Object.assign( settings, patch );
	} );
	window.oddout = Object.assign(
		{
			liveScripts: {},
			shopTaskbar: true,
		},
		config,
	);
	window.odd = window.oddout;
	window.wp = window.wp || {};
	window.wp.desktop = {
		getOsSettings: () => settings,
		updateOsSettings,
	};

	const src = readFileSync( BOOTSTRAP_JS, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=shared/live-bootstrap.js` );
	fn.call( globalThis );

	return { updateOsSettings, settings };
}

describe( 'ODD live bootstrap', () => {
	beforeEach( () => {
		resetOdd();
		window.localStorage.clear();
		delete window.desktopModeWallpapers;
		delete window.desktopModeNativeWindows;
	} );

	it( 'publishes Desktop Mode placeholders synchronously', () => {
		loadBootstrap();

		expect( window.desktopModeWallpapers.odd.id ).toBe( 'odd' );
		expect( window.desktopModeWallpapers.odd.__oddLiveBootstrapPlaceholder ).toBe( true );
		expect( typeof window.desktopModeWallpapers.odd.mount ).toBe( 'function' );
		expect( window.desktopModeNativeWindows.odd.__oddLiveBootstrapPlaceholder ).toBe( true );
		expect( typeof window.desktopModeNativeWindows.odd ).toBe( 'function' );
	} );

	it( 'applies the starter wallpaper, dock size, and ODD launcher live on first install', () => {
		const settings = {
			wallpaper: 'dark',
			dockSize: 'medium',
			itemVisibility: { existing: 'desktop' },
		};
		const { updateOsSettings } = loadBootstrap( { shopTaskbar: true }, settings );

		expect( updateOsSettings ).toHaveBeenCalledWith( {
			wallpaper: 'odd',
			dockSize: 'large',
			itemVisibility: { existing: 'desktop', odd: 'both' },
		} );
		expect( settings.wallpaper ).toBe( 'odd' );
		expect( settings.dockSize ).toBe( 'large' );
		expect( settings.itemVisibility.odd ).toBe( 'both' );
	} );

	it( 'does not overwrite an explicit non-ODD wallpaper choice', () => {
		const settings = {
			wallpaper: 'custom-photo',
			dockSize: 'small',
			itemVisibility: {},
		};
		const { updateOsSettings } = loadBootstrap( { shopTaskbar: false }, settings );

		expect( updateOsSettings ).toHaveBeenCalledWith( {
			itemVisibility: { odd: 'desktop' },
		} );
		expect( settings.wallpaper ).toBe( 'custom-photo' );
		expect( settings.dockSize ).toBe( 'small' );
		expect( settings.itemVisibility.odd ).toBe( 'desktop' );
	} );

	it( 'does not reapply first-run settings after the browser marker is set', () => {
		window.localStorage.setItem( 'odd.liveBootstrap.firstRunApplied', '1' );
		const settings = {
			wallpaper: 'dark',
			dockSize: 'medium',
			itemVisibility: {},
		};
		const { updateOsSettings } = loadBootstrap( { shopTaskbar: true }, settings );

		expect( updateOsSettings ).not.toHaveBeenCalled();
		expect( settings.wallpaper ).toBe( 'dark' );
		expect( settings.itemVisibility.odd ).toBeUndefined();
	} );
} );
