import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

const DEFAULT_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const DEFAULT_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Signs in as the standard local/dev admin (override with WP_ADMIN_USER /
 * WP_ADMIN_PASS). Use a shared helper so e2e specs do not each duplicate
 * the login ritual and accidentally drift.
 */
export async function loginAdmin(
	page: Page,
	opts?: { user?: string; pass?: string }
): Promise<void> {
	const user = opts?.user ?? DEFAULT_ADMIN_USER;
	const pass = opts?.pass ?? DEFAULT_ADMIN_PASS;
	await page.goto( '/wp-login.php' );
	await page.fill( '#user_login', user );
	await page.fill( '#user_pass', pass );
	await page.click( '#wp-submit' );
	await page.waitForURL( /\/wp-admin\/?/ );
}

/**
 * Enters the WP Desktop Mode shell. ODD’s `desktop-mode` script dependency
 * only loads when the shell renders (`includes/render.php`); a bare
 * `/wp-admin/` request can look “classic” and skip the canvas + scenes.
 * Use the Desktop Mode admin portal query (not legacy `/wp-desktop/`, removed
 * in current wordpress.org Desktop Mode — see CHANGELOG / Playground blueprints).
 */
export async function goDesktopShell( page: Page ) {
	await page.goto( '/wp-admin/index.php?desktop_mode_portal=1', { waitUntil: 'load', timeout: 45_000 } );
	await page.waitForURL( /\/wp-admin/, { timeout: 45_000 } );
	await expect( page.locator( '#desktop-mode-shell' ) ).toBeVisible( { timeout: 20_000 } );
	await dismissDesktopModeWelcomeIfPresent( page );
	await page.waitForFunction( () => {
		const w = window as unknown as { __odd?: object };
		return typeof w.__odd !== 'undefined';
	}, { timeout: 30_000 } );
}

/**
 * Desktop Mode 0.8.5+ renders a first-run welcome dialog in wp-admin.
 * E2E enables Desktop Mode directly through user meta, so this is unrelated
 * to the ODD interaction under test; dismiss it when present so it cannot
 * intercept shop clicks.
 */
export async function dismissDesktopModeWelcomeIfPresent( page: Page ) {
	const welcome = page
		.locator( '.desktop-mode-welcome[data-slug="activation-welcome"], .desktop-mode-welcome' )
		.first();
	try {
		await welcome.waitFor( { state: 'visible', timeout: 1_500 } );
	} catch {
		return;
	}

	const dismiss = welcome
		.locator( '[data-desktop-mode-welcome-dismiss], [data-desktop-mode-welcome-cta]' )
		.first();
	await page.keyboard.press( 'Escape' );

	try {
		await expect( welcome ).toHaveCount( 0, { timeout: 10_000 } );
	} catch {
		if ( await dismiss.isVisible().catch( () => false ) ) {
			await dismiss.click( { force: true, timeout: 5_000 } );
		}
		try {
			await expect( welcome ).toHaveCount( 0, { timeout: 5_000 } );
		} catch {
			await page.evaluate( () => {
				document.querySelectorAll( '.desktop-mode-welcome' ).forEach( ( el ) => el.remove() );
				document.body.classList.remove( 'desktop-mode-welcome-open' );
			} );
		}
	}
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
	await dismissDesktopModeWelcomeIfPresent( page );
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
	await dismissDesktopModeWelcomeIfPresent( page );
}

const SHOP_SECTION_ORDER = [
	'wallpaper',
	'icons',
	'cursors',
	'widgets',
	'apps',
	'install',
	'settings',
	'about',
] as const;

async function ensureInstalledInactiveScene( pane: Locator ): Promise<Locator | null> {
	const installedInactive = pane
		.locator( '[data-odd-card-type="scene"].is-installed:not(.is-active)' )
		.first();
	if ( ( await installedInactive.count() ) > 0 ) {
		return installedInactive;
	}

	const catalogTile = pane
		.locator( '[data-odd-card-type="scene"][data-catalog-slug]:not(.is-installed)' )
		.first();
	if ( ( await catalogTile.count() ) < 1 ) {
		return null;
	}
	const slug = await catalogTile.getAttribute( 'data-slug' );
	const installBtn = catalogTile.locator( '.odd-shop__card-btn', { hasText: /^Install$/ } );
	if ( ( await installBtn.count() ) < 1 ) {
		return null;
	}
	await installBtn.click();
	const installed = slug
		? pane.locator( `[data-odd-card-type="scene"][data-slug="${ slug }"].is-installed` ).first()
		: catalogTile;
	await expect( installed.locator( '.odd-shop__card-btn', { hasText: /^(Apply|Active)$/ } ).first() ).toBeVisible( {
		timeout: 120_000,
	} );
	return installed;
}

/**
 * Assumes the ODD Shop is already open. Clicks every visible rail department,
 * exercises search, and opens a wallpaper preview then cancels — no prefs
 * commit and no icon-set reload.
 */
export async function exerciseOddShopInteractions( page: Page ) {
	const shop = page.locator( '.odd-panel.odd-shop' ).first();
	await expect( shop ).toBeVisible( { timeout: 15_000 } );

	const content = shop.getByTestId( 'odd-shop-content' );
	for ( const id of SHOP_SECTION_ORDER ) {
		await dismissDesktopModeWelcomeIfPresent( page );
		const nav = shop.getByTestId( `odd-shop-nav-${ id }` );
		if ( ! await nav.isVisible() ) {
			continue;
		}
		await nav.click();
		await expect( content ).toBeVisible();
		await expect( shop.getByTestId( 'odd-shop-content' ) ).toBeAttached();
	}

	const search = shop.locator( '[data-odd-search]' );
	await search.fill( 'odd' );
	await expect( search ).toHaveValue( 'odd' );
	await search.clear();
	await expect( search ).toHaveValue( '' );

	await shop.getByTestId( 'odd-shop-nav-wallpaper' ).click();

	const pane = shop.getByTestId( 'odd-shop-content' );
	const previewTile = await ensureInstalledInactiveScene( pane );
	if ( previewTile ) {
		const sceneCard = previewTile.locator( '.odd-shop__card' ).first();
		await expect( sceneCard ).toBeVisible( { timeout: 20_000 } );
		await sceneCard.click();
	}

	await expect( shop.getByTestId( 'odd-preview-cancel' ) ).toBeVisible( { timeout: 15_000 } );
	await expect( shop.getByTestId( 'odd-preview-commit' ) ).toBeVisible();

	await shop.getByTestId( 'odd-preview-cancel' ).click();
	await expect( shop.locator( '[data-odd-preview-bar]' ) ).toHaveCount( 0, { timeout: 10_000 } );
}

/**
 * ODD Shop → Apps → “Open” on a pre-installed catalog app tile, then assert the
 * sandbox iframe hydrates DOM. Requires slug `board` pre-installed by CLI
 * (bin/e2e-local.sh / .github/workflows/e2e.yml). Skips UI `install-from-catalog`
 * because long installs can fail under `wp server`.
 *
 * Same-origin iframe is readable in Playwright — guards the blank-white regressions class.
 */
export async function installCatalogAppOpenAndAssertHydratedIframe( page: Page ) {
	const shop = page.locator( '.odd-panel.odd-shop' ).first();
	await expect( shop ).toBeVisible();
	await shop.getByTestId( 'odd-shop-nav-apps' ).click();

	const paneSel = '[data-testid="odd-shop-content"]';
	await page.waitForSelector( `${ paneSel } [data-odd-apps-gallery]`, { timeout: 30_000 } );
	await page.waitForSelector( `${ paneSel } [data-odd-card-type="app"]`, { timeout: 120_000 } );

	const pane = shop.getByTestId( 'odd-shop-content' );
	const openBtn = pane
		.locator( '[data-odd-card-type="app"][data-slug="board"] .odd-shop__card-btn--open' )
		.first();
	await expect( openBtn ).toBeVisible( { timeout: 45_000 } );
	await openBtn.click();

	await page.waitForFunction(
		() => {
			const f = document.querySelector( 'iframe.odd-app-frame' );
			if ( ! f || ! ( f instanceof HTMLIFrameElement ) ) {
				return false;
			}
			const doc = f.contentDocument;
			if ( ! doc ) {
				return false;
			}
			const frameRect = f.getBoundingClientRect();
			const frameStyle = window.getComputedStyle( f );
			const mount = f.closest( '.odd-app-host' );
			const mountRect = mount?.getBoundingClientRect();
			const mountStyle = mount ? window.getComputedStyle( mount ) : null;
			if (
				frameRect.width <= 0 ||
				frameRect.height <= 0 ||
				frameStyle.display === 'none' ||
				frameStyle.visibility === 'hidden' ||
				frameStyle.opacity === '0' ||
				! mountRect ||
				mountRect.width <= 0 ||
				mountRect.height <= 0 ||
				mountStyle?.display === 'none' ||
				mountStyle?.visibility === 'hidden' ||
				mountStyle?.opacity === '0'
			) {
				return false;
			}
			const root = doc.getElementById( 'root' ) ?? doc.body;
			if ( ! root ) {
				return false;
			}
			if ( root.children && root.children.length > 0 ) {
				return true;
			}
			return ( root.textContent ?? '' ).trim().length > 20;
		},
		{ timeout: 90_000 },
	);
}
