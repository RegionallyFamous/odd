/**
 * End-to-end: OpenStation shell → ODD Shop → native ODD Notes → new note.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installOddFailureDiagnostics } from './diagnostics-hooks';
import { loginAdmin } from './helpers';

installOddFailureDiagnostics();

test.describe( 'ODD Apps-only smoke', () => {
	test( 'opens the Shop and creates an ODD Note', async ( { page } ) => {
		test.setTimeout( 180_000 );

		await loginAdmin( page );
		await page.goto( '/wp-admin/index.php?desktop_mode_portal=1', {
			waitUntil: 'load',
			timeout: 45_000,
		} );
		await expect( page.locator( '#os-shell' ) ).toBeVisible( {
			timeout: 30_000,
		} );
		await page.waitForFunction(
			() => !! ( window.wp && window.wp.os && window.wp.os.openWindow ),
			{ timeout: 30_000 },
		);

		await page.evaluate( () => window.wp.os.openWindow( 'odd' ) );
		const shop = page.locator( '.odd-shop' ).first();
		await expect( shop ).toBeVisible( { timeout: 20_000 } );
		await expect( shop.getByRole( 'heading', { name: 'Apps' } ) ).toBeVisible();
		await expect( shop.getByRole( 'heading', { name: 'ODD Notes' } ) ).toBeVisible();
		await expect( shop.getByText( 'One excellent app at a time.' ) ).toBeVisible();

		const results = await new AxeBuilder( { page } )
			.include( '.odd-shop' )
			.withTags( [ 'wcag2a', 'wcag2aa' ] )
			.analyze();
		const serious = results.violations.filter(
			( violation ) => violation.impact === 'critical' || violation.impact === 'serious',
		);
		expect( serious, JSON.stringify( serious, null, 2 ) ).toEqual( [] );

		await shop.getByRole( 'button', { name: 'Open' } ).click();
		const notes = page.locator( '.os-notes-app' ).first();
		await expect( notes ).toBeVisible( { timeout: 20_000 } );
		await expect( notes.getByText( 'ODD Notes', { exact: true } ) ).toBeVisible();

		await notes.locator( '[data-notes-new]' ).click();
		await expect( notes.locator( '[data-notes-editor]' ) ).toBeVisible();
		await expect( notes.locator( '[data-notes-empty]' ) ).toBeHidden();

		const title = notes.locator( '[data-notes-title] input' );
		const body = notes.locator( '[data-notes-body] textarea' );
		await expect( title ).toBeVisible();
		await expect( body ).toBeVisible();
		await title.fill( 'E2E reliability note' );
		await body.fill( 'Saved once, recovered cleanly, and never mistaken for a conflict.' );

		const saveStatus = notes.locator( '[data-notes-save-status]' );
		await expect( saveStatus ).toHaveAttribute( 'phase', 'saved', { timeout: 20_000 } );

		const retry = await page.evaluate( async () => {
			const os = ( window as unknown as {
				wp: {
					os: {
						getWindowConfig( id: string ): { restBase: string; restNonce: string };
					};
				};
			} ).wp.os;
			const config = os.getWindowConfig( 'odd-app-odd-notes' );
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
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': config.restNonce,
				},
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
		await expect(
			page.getByRole( 'heading', { name: 'This note changed elsewhere' } ),
		).toHaveCount( 0 );
	} );
} );
