import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const DEFAULT_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const DEFAULT_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

export async function loginAdmin(
	page: Page,
	opts?: { user?: string; pass?: string }
): Promise<void> {
	const user = opts?.user ?? DEFAULT_ADMIN_USER;
	const pass = opts?.pass ?? DEFAULT_ADMIN_PASS;
	await page.goto( '/wp-login.php', { waitUntil: 'domcontentloaded' } );
	if ( /\/wp-admin\/?/.test( page.url() ) ) {
		return;
	}

	const userField = page.locator( '#user_login' );
	const passField = page.locator( '#user_pass' );
	await expect( userField ).toBeVisible( { timeout: 15_000 } );
	await expect( passField ).toBeVisible( { timeout: 15_000 } );
	await userField.fill( user );
	await passField.fill( pass );
	await Promise.all( [
		page.waitForURL( /\/wp-admin\/?/, { timeout: 45_000 } ),
		page.locator( '#wp-submit' ).click(),
	] );
}
