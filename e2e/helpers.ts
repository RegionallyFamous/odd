import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Enters the WP Desktop Mode shell. ODD’s `desktop-mode` script dependency
 * only loads when the shell renders (`includes/render.php`); a bare
 * `/wp-admin/` request can look “classic” and skip the canvas + scenes.
 * Use `?desktop_mode_portal=1` on wp-admin — the legacy `/wp-desktop/` route
 * shipped in older Desktop Mode builds was removed from wordpress.org releases.
 */
export async function goDesktopShell( page: Page ) {
	await page.goto( '/wp-admin/index.php?desktop_mode_portal=1', { waitUntil: 'load', timeout: 45_000 } );
	await page.waitForURL( /\/wp-admin/, { timeout: 45_000 } );
	await expect( page.locator( '#desktop-mode-shell' ) ).toBeVisible( { timeout: 20_000 } );
	await page.waitForFunction( () => {
		const w = window as unknown as { __odd?: object };
		return typeof w.__odd !== 'undefined';
	}, { timeout: 30_000 } );
}

/**
 * Wallpaper IIFE can’t register scenes until Pixi is present and `mount` runs.
 * This mirrors what panel.spec was polling for, with one explicit contract.
 *
 * Dumps a diagnostic snapshot on timeout so future regressions are easy to
 * triage from CI logs.
 */
export async function waitForWallpaperScenes( page: Page ) {
	try {
		await page.waitForFunction( () => {
			return typeof ( window as unknown as { PIXI?: object } ).PIXI !== 'undefined';
		}, { timeout: 40_000 } );
	} catch ( err ) {
		const diag = await page.evaluate( () => {
			const wp = ( window as unknown as {
				wp?: { desktop?: Record<string, unknown> };
			} ).wp;
			const wallpapers = ( window as unknown as {
				desktopModeWallpapers?: Record<string, unknown>;
			} ).desktopModeWallpapers;
			const cfg = ( window as unknown as {
				desktopModeConfig?: { osSettings?: { wallpaper?: string } };
			} ).desktopModeConfig;
			const odd = ( window as unknown as {
				__odd?: { scenes?: Record<string, object>; api?: object };
			} ).__odd;
			return {
				hasDesktop: !! wp?.desktop,
				desktopKeys: wp?.desktop ? Object.keys( wp.desktop ).sort() : null,
				configWallpaper: cfg?.osSettings?.wallpaper ?? null,
				wallpaperKeys: wallpapers ? Object.keys( wallpapers ) : null,
				oddScenes: odd?.scenes ? Object.keys( odd.scenes ) : null,
				oddApi: !! odd?.api,
				shellVisible: !! document.getElementById( 'desktop-mode-shell' ),
			};
		} );
		// eslint-disable-next-line no-console
		console.log( 'waitForWallpaperScenes diagnostics:', JSON.stringify( diag, null, 2 ) );
		throw err;
	}
	await page.waitForFunction( () => {
		const scenes = ( window as unknown as { __odd?: { scenes?: Record<string, object> } } ).__odd
			?.scenes;
		return !! scenes && Object.keys( scenes ).length > 0;
	}, { timeout: 40_000 } );
}

/**
 * Opens the ODD Shop the same way the Playground mu-plugin does: after
 * `wp.desktop.ready`, retry `api.openPanel()` so the native window
 * actually mounts (a single fire-and-forget call often no-ops in CI).
 */
export async function openOddShop( page: Page ) {
	await page.evaluate( () => {
		function tryOpen() {
			const api = ( window as unknown as { __odd?: { api?: { openPanel?: () => boolean } } } )
				.__odd?.api;
			if ( api && typeof api.openPanel === 'function' && api.openPanel() ) {
				return true;
			}
			const d = ( window as unknown as { wp?: { desktop?: {
				openWindow?: ( id: string ) => boolean | void;
				registerWindow?: ( o: { id: string } ) => void;
			} } } ).wp?.desktop;
			if ( d && typeof d.openWindow === 'function' ) {
				try {
					d.openWindow( 'odd' );
					return true;
				} catch ( e ) {
					/* keep polling */
				}
			}
			if ( d && typeof d.registerWindow === 'function' ) {
				try {
					d.registerWindow( { id: 'odd' } );
					return true;
				} catch ( e ) {
					/* keep polling */
				}
			}
			return false;
		}
		const desktop = ( window as unknown as { wp?: { desktop?: { ready?: ( fn: () => void ) => void } } } )
			.wp?.desktop;
		const kick = () => {
			let n = 0;
			( function attempt() {
				if ( tryOpen() || n++ > 40 ) {
					return;
				}
				setTimeout( attempt, 200 );
			} )();
		};
		if ( desktop && typeof desktop.ready === 'function' ) {
			desktop.ready( kick );
		} else {
			setTimeout( kick, 500 );
		}
	} );
	await expect( page.locator( '[data-odd-panel], .odd-panel' ).first() ).toBeVisible( { timeout: 20_000 } );
}
