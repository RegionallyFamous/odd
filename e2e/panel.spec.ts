/**
 * End-to-end: same-session Shop installs, native Notes, and every Workbench tool.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAdmin } from './helpers';

async function ensureAppInstalled( page: Page, shop: Locator, slug: string ) {
	const card = shop.locator( `.odd-app-card[data-slug="${ slug }"]` );
	await expect( card ).toBeVisible();
	if ( await card.getAttribute( 'data-state' ) !== 'installed' ) {
		await card.getByRole( 'button', { name: /Install app/ } ).click( {
			timeout: 15_000,
		} );
	}
	await expect( card ).toHaveAttribute( 'data-state', 'installed', {
		timeout: 45_000,
	} );
	await expect( card.getByRole( 'button', { name: /Open app/ } ) ).toBeEnabled();
	await expect.poll( () => page.evaluate( ( id ) => (
		window.wp.os.getOsSettings().itemVisibility?.[ id ]
	), `odd-app-${ slug }` ) ).toBe( 'desktop' );
	await expect( page.locator( `[data-icon-id="odd-app-${ slug }"]` ) ).toHaveCount( 1 );
	return card;
}

test.describe( 'ODD Apps-only smoke', () => {
	test( 'installs and opens Notes and exercises all Workbench tools without a refresh', async ( { page } ) => {
		test.setTimeout( 240_000 );

		await loginAdmin( page );
		await page.goto( '/wp-admin/index.php?desktop_mode_portal=1', {
			waitUntil: 'load',
			timeout: 45_000,
		} );
		await expect( page.locator( '#os-shell' ) ).toBeVisible( { timeout: 30_000 } );
		await page.waitForFunction(
			() => !! ( window.wp?.os?.openWindow && window.wp.os.updateOsSettings ),
			undefined,
			{ timeout: 30_000 },
		);

		expect( await page.evaluate( () => window.wp.os.openWindow( 'odd' ) ) ).toBe( true );
		const shop = page.locator( '.odd-shop' ).first();
		await expect( shop ).toBeVisible( { timeout: 20_000 } );
		await expect( shop.getByRole( 'heading', { name: 'ODD Notes' } ) ).toBeVisible();
		await expect( shop.getByRole( 'heading', { name: 'ODD Workbench' } ) ).toBeVisible();

		const results = await new AxeBuilder( { page } )
			.include( '.odd-shop' )
			.withTags( [ 'wcag2a', 'wcag2aa' ] )
			.analyze();
		const serious = results.violations.filter(
			( violation ) => violation.impact === 'critical' || violation.impact === 'serious',
		);
		expect( serious, JSON.stringify( serious, null, 2 ) ).toEqual( [] );

		const notesCard = await ensureAppInstalled( page, shop, 'odd-notes' );
		await notesCard.getByRole( 'button', { name: /Open app/ } ).click();
		const notes = page.locator( '.os-notes-app' ).first();
		await expect( notes ).toBeVisible( { timeout: 30_000 } );
		await notes.locator( '[data-notes-new]' ).click();
		const title = notes.locator( '[data-notes-title] input' );
		const body = notes.locator( '[data-notes-body] textarea' );
		await title.fill( 'E2E reliability note' );
		await body.fill( 'Saved once, recovered cleanly, and never mistaken for a conflict.' );
		await expect( notes.locator( '[data-notes-save-status]' ) ).toHaveAttribute(
			'phase',
			'saved',
			{ timeout: 20_000 },
		);

		const retry = await page.evaluate( async () => {
			const config = window.wp.os.getWindowConfig( 'odd-app-odd-notes' );
			const libraryResponse = await fetch( new URL( 'notes', config.restBase ), {
				credentials: 'same-origin',
				headers: { 'X-WP-Nonce': config.restNonce },
			} );
			const library = await libraryResponse.json() as {
				notes: Array< {
					id: number;
					title: string;
					body: string;
					color: string;
					tags: string[];
					favorite: boolean;
					archived: boolean;
					onDesktop: boolean;
					public: boolean;
					version: number;
					updatedAtMs: number;
				} >;
			};
			const current = library.notes.find( ( note ) => note.title === 'E2E reliability note' );
			if ( ! current ) {
				return { status: 0, title: '' };
			}
			const response = await fetch( new URL( `notes/${ current.id }`, config.restBase ), {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': config.restNonce },
				body: JSON.stringify( {
					title: current.title,
					body: current.body,
					color: current.color,
					tags: current.tags,
					favorite: current.favorite,
					archived: current.archived,
					onDesktop: current.onDesktop,
					public: current.public,
					version: Math.max( 0, current.version - 1 ),
					updatedAtMs: current.updatedAtMs - 1_000,
				} ),
			} );
			const saved = await response.json();
			return { status: response.status, title: saved.title ?? '' };
		} );
		expect( retry ).toEqual( { status: 200, title: 'E2E reliability note' } );
		await notes.locator( '[data-notes-refresh]' ).click();
		await expect( title ).toHaveValue( 'E2E reliability note' );
		await expect( body ).toHaveValue(
			'Saved once, recovered cleanly, and never mistaken for a conflict.',
		);
		const notesWindow = page.locator( '#wp-window-odd-app-odd-notes' );
		await notesWindow.locator( 'os-window-button[aria-label="Close"]' ).click();
		await expect( notesWindow ).toBeHidden();

		const workbenchCard = await ensureAppInstalled( page, shop, 'workbench' );
		await workbenchCard.getByRole( 'button', { name: /Open app/ } ).click();
		const workbenchWindow = page.locator( '#wp-window-odd-app-workbench' );
		await expect( workbenchWindow ).toBeVisible( { timeout: 30_000 } );
		await expect( workbenchWindow ).not.toHaveClass( /os-window--(?:maximized|fullscreen)/ );
		const bounds = await workbenchWindow.boundingBox();
		expect( bounds ).not.toBeNull();
		expect( bounds!.width ).toBeLessThan( 1200 );
		expect( bounds!.height ).toBeLessThan( 800 );

		const bench = page.frameLocator( '#wp-window-odd-app-workbench iframe.odd-app-frame' );
		await expect( bench.locator( '.app-shell' ) ).toBeVisible( { timeout: 30_000 } );
		await expect( bench.locator( '.tool-tab img' ) ).toHaveCount( 0 );
		await expect( bench.locator( '.tool-tab .ui-icon' ) ).toHaveCount( 6 );

		await bench.locator( '#clean-input' ).fill( '  Messy\u00a0text   \n\n\n\n' );
		await bench.getByRole( 'button', { name: 'Smart clean' } ).click();
		await expect( bench.locator( '#clean-output' ) ).toHaveValue( 'Messy text' );

		await bench.getByRole( 'tab', { name: /Markdown/ } ).click();
		await bench.locator( '#markdown-input' ).fill( '# Hello **ODD**\n\n<script>alert(1)</script>' );
		await expect( bench.locator( '#markdown-preview h1' ) ).toHaveText( 'Hello ODD' );
		await expect( bench.locator( '#markdown-preview script' ) ).toHaveCount( 0 );
		await expect( bench.locator( '#markdown-preview' ) ).toContainText( '<script>alert(1)</script>' );

		await bench.getByRole( 'tab', { name: /Slug/ } ).click();
		await bench.locator( '#slug-input' ).fill( 'Crème brûlée & ODD Tools' );
		await expect( bench.locator( '#slug-output' ) ).toHaveText( 'creme-brulee-odd-tools' );

		await bench.getByRole( 'tab', { name: /JSON/ } ).click();
		await bench.locator( '#json-input' ).fill( '{"b":2,"a":1}' );
		await bench.getByRole( 'button', { name: 'Sort keys' } ).click();
		await expect( bench.locator( '#json-status' ) ).toHaveText( 'Valid JSON' );
		await expect( bench.locator( '#json-output' ) ).toHaveValue( '{\n  "a": 1,\n  "b": 2\n}' );

		await bench.getByRole( 'tab', { name: /Diff/ } ).click();
		await bench.locator( '#diff-left' ).fill( 'same\nold' );
		await bench.locator( '#diff-right' ).fill( 'same\nnew' );
		await expect( bench.locator( '#diff-summary' ) ).toHaveText( '1 added · 1 removed' );
		await expect( bench.locator( '#diff-output .is-added' ) ).toContainText( 'new' );
		await expect( bench.locator( '#diff-output .is-removed' ) ).toContainText( 'old' );

		await bench.getByRole( 'tab', { name: /Convert/ } ).click();
		await bench.locator( '#convert-input' ).fill( 'ODD ✓' );
		await bench.getByRole( 'button', { name: 'Convert' } ).click();
		await expect( bench.locator( '#convert-output' ) ).toHaveValue( 'T0REIOKckw==' );
	} );
} );
