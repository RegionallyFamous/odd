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
		await expect(
			notes.getByRole( 'heading', { name: 'Catch the thought before it escapes.' } ),
		).toBeVisible();

		await notes.locator( '[data-notes-new]' ).click();
		await expect( notes.locator( '[data-notes-editor]' ) ).toBeVisible();
		await expect( notes.locator( '[data-notes-empty]' ) ).toBeHidden();
		await expect( notes.locator( '[data-notes-title]' ) ).toBeVisible();
		await expect( notes.locator( '[data-notes-body]' ) ).toBeVisible();
	} );
} );
