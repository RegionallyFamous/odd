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

		await bench.getByRole( 'tab', { name: /slug/i } ).click();
		await bench.locator( '#slug-input' ).fill( 'Crème brûlée & ODD Tools' );
		await expect( bench.locator( '#slug-output' ) ).toHaveText( 'creme-brulee-odd-tools' );

		await bench.getByRole( 'tab', { name: /JSON/ } ).click();
		await bench.locator( '#json-input' ).fill( '{"b":2,"a":1}' );
		await bench.getByRole( 'button', { name: 'Sort keys' } ).click();
		await expect( bench.locator( '#json-status' ) ).toHaveText( 'Valid JSON' );
		await expect( bench.locator( '#json-output' ) ).toHaveValue( '{\n  "a": 1,\n  "b": 2\n}' );

		await bench.getByRole( 'tab', { name: /Compare drafts/ } ).click();
		await bench.locator( '#diff-left' ).fill( 'same\nold' );
		await bench.locator( '#diff-right' ).fill( 'same\nnew' );
		await expect( bench.locator( '#diff-summary' ) ).toHaveText( '1 added · 1 removed' );
		await expect( bench.locator( '#diff-output .is-added' ) ).toContainText( 'new' );
		await expect( bench.locator( '#diff-output .is-removed' ) ).toContainText( 'old' );

		await bench.getByRole( 'tab', { name: /Encode or decode text/ } ).click();
		await bench.locator( '#convert-input' ).fill( 'ODD ✓' );
		await bench.getByRole( 'button', { name: 'Convert' } ).click();
		await expect( bench.locator( '#convert-output' ) ).toHaveValue( 'T0REIOKckw==' );
	} );

	test('installs Pantry, persists real synced-pattern work, and removes it through OpenStation confirmation', async ({
		page,
	}) => {
		test.setTimeout(300_000);

		await loginAdmin(page);
		await page.goto('/wp-admin/index.php?desktop_mode_portal=1', {
			waitUntil: 'load',
			timeout: 45_000,
		});
		await expect(page.locator('#os-shell')).toBeVisible({ timeout: 30_000 });
		await page.waitForFunction(
			() => !!(window.wp?.os?.openWindow && window.wp.os.updateOsSettings && window.wp.os.confirm),
			undefined,
			{ timeout: 30_000 },
		);

		expect(await page.evaluate(() => window.wp.os.openWindow('odd'))).toBe(true);
		const shop = page.locator('.odd-shop').first();
		await expect(shop).toBeVisible({ timeout: 20_000 });
		await expect(shop.getByRole('heading', { name: 'ODD Pantry' })).toBeVisible();

		const pantryCard = await ensureAppInstalled(page, shop, 'pantry');
		let deniedPatternsRequest = false;
		await page.route('**/wp-json/wp/v2/blocks**', async (route) => {
			if (!deniedPatternsRequest && route.request().method() === 'GET') {
				deniedPatternsRequest = true;
				await route.fulfill({
					status: 403,
					contentType: 'application/json',
					body: JSON.stringify({
						code: 'rest_forbidden',
						message: 'E2E injected permission denial.',
						data: { status: 403 },
					}),
				});
				return;
			}
			await route.continue();
		});

		await pantryCard.getByRole('button', { name: /Open app/ }).click();
		const pantryWindow = page.locator('#wp-window-odd-app-pantry');
		await expect(pantryWindow).toBeVisible({ timeout: 30_000 });
		await expect(pantryWindow.locator('[data-odd-app-trust="verified-same-origin"]')).toBeVisible();
		await expect(pantryWindow.locator('iframe.odd-app-frame')).toHaveAttribute(
			'sandbox',
			'allow-scripts allow-forms allow-popups allow-same-origin allow-downloads',
		);

		const pantry = page.frameLocator('#wp-window-odd-app-pantry iframe.odd-app-frame');
		await expect(pantry.locator('.app-shell')).toBeVisible({ timeout: 30_000 });
		await expect(pantry.locator('#error-state')).toBeVisible();
		await expect(pantry.locator('#error-copy')).toHaveText(
			'Your account cannot manage synced patterns, or the WordPress session has expired.',
		);
		await expect(pantry.getByRole('button', { name: 'Try again' })).toBeVisible();
		expect(deniedPatternsRequest).toBe(true);

		await pantry.getByRole('button', { name: 'Try again' }).click();
		await expect(pantry.locator('#error-state')).toBeHidden();
		await expect(pantry.locator('#pattern-grid')).toHaveAttribute('aria-busy', 'false');

		const runtimeContract = await pantry.locator('body').evaluate(async () => {
			const app = (
				window as typeof window & {
					oddApp: {
						apiVersion: number;
						slug: string;
						windowId: string;
						restRoot: string;
						request: (path: string) => Promise<unknown>;
						storage: {
							get: (key: string) => Promise<unknown>;
							set: (key: string, value: unknown) => Promise<unknown>;
							remove: (key: string) => Promise<unknown>;
						};
					};
				}
			).oddApp;
			const validResponse = await app.request('wp/v2/types');
			let escapedRest = '';
			let escapedStorage = '';
			try {
				await app.request(`${window.location.origin}/wp-admin/users.php`);
			} catch (error) {
				escapedRest = error instanceof Error ? error.message : String(error);
			}
			try {
				await app.storage.get('../other-app');
			} catch (error) {
				escapedStorage = error instanceof Error ? error.message : String(error);
			}
			await app.storage.set('e2e-contract', { scoped: true });
			const stored = await app.storage.get('e2e-contract');
			await app.storage.remove('e2e-contract');
			return {
				apiVersion: app.apiVersion,
				slug: app.slug,
				windowId: app.windowId,
				restPath: new URL(app.restRoot).pathname,
				frozen: Object.isFrozen(app),
				storageFrozen: Object.isFrozen(app.storage),
				validResponse: Boolean(validResponse && typeof validResponse === 'object'),
				escapedRest,
				escapedStorage,
				stored,
			};
		});
		expect(runtimeContract).toMatchObject({
			apiVersion: 1,
			slug: 'pantry',
			windowId: 'odd-app-pantry',
			frozen: true,
			storageFrozen: true,
			validResponse: true,
			stored: { scoped: true },
		});
		expect(runtimeContract.restPath).toMatch(/\/wp-json\/$/);
		expect(runtimeContract.escapedRest).toContain('REST root');
		expect(runtimeContract.escapedStorage).toContain('lowercase slug');

		await page.setViewportSize({ width: 390, height: 844 });
		await expect(pantry.getByRole('button', { name: 'New pattern' })).toBeVisible();
		await expect(pantry.getByRole('searchbox', { name: 'Search synced patterns' })).toBeVisible();
		await expect(pantry.getByRole('button', { name: 'Everything' })).toBeVisible();
		await expect(pantry.locator('#refresh-patterns')).toHaveAttribute('aria-label', 'Refresh patterns');
		await page.setViewportSize({ width: 1280, height: 720 });

		const runId = Date.now();
		const originalTitle = `ODD E2E pantry ${runId}`;
		const renamedTitle = `${originalTitle} renamed`;
		const duplicateTitle = `${renamedTitle} copy`;
		await pantry.getByRole('button', { name: 'New pattern' }).click();
		const createDialog = pantry.locator('#create-dialog');
		await expect(createDialog).toBeVisible();
		await createDialog.locator('#new-pattern-title').fill(originalTitle);
		await createDialog.locator('label').filter({ hasText: 'Call to action' }).click();
		await createDialog.getByRole('button', { name: 'Create pattern' }).click();
		await expect(createDialog).toBeHidden();
		const originalOpen = pantry.getByRole('button', {
			name: `Open details for ${originalTitle}`,
			exact: true,
		});
		await expect(originalOpen).toBeVisible();
		const originalCard = pantry.locator('.pattern-card').filter({ has: originalOpen });
		const originalId = Number(await originalCard.getAttribute('data-pattern-id'));
		expect(originalId).toBeGreaterThan(0);

		await pantry.locator('#rename-pattern').click();
		await pantry.locator('#rename-input').fill(renamedTitle);
		await pantry.locator('#title-editor [type="submit"]').click();
		await expect(pantry.locator('#pattern-title')).toHaveText(renamedTitle);
		const renamedOpen = pantry.getByRole('button', {
			name: `Open details for ${renamedTitle}`,
			exact: true,
		});
		await expect(renamedOpen).toBeVisible();

		await pantry.locator('#favorite-pattern').click();
		await expect(pantry.locator('#favorite-pattern')).toHaveAttribute('aria-label', 'Remove from favorites');
		await expect
			.poll(() =>
				pantry.locator('body').evaluate(async (_body, id) => {
					const app = (
						window as typeof window & {
							oddApp: {
								storage: {
									get: (key: string) => Promise<{ favorites?: number[] } | null>;
								};
							};
						}
					).oddApp;
					const preferences = await app.storage.get('preferences');
					return preferences?.favorites?.map(Number).includes(Number(id)) || false;
				}, originalId),
			)
			.toBe(true);

		const preview = pantry.locator('#pattern-preview iframe.pattern-preview__frame');
		await expect(preview).toHaveAttribute('sandbox', '');
		await expect(preview).toHaveAttribute('title', `Preview of ${renamedTitle}`);
		await expect(preview).toHaveAttribute('srcdoc', /default-src 'none'/);

		await pantryWindow.locator('os-window-button[aria-label="Close"]').click();
		await expect(pantryWindow).toBeHidden();
		await pantryCard.getByRole('button', { name: /Open app/ }).click();
		await expect(pantryWindow).toBeVisible({ timeout: 30_000 });
		await expect(pantry.locator('#pattern-grid')).toHaveAttribute('aria-busy', 'false');
		const reopenedOriginalOpen = pantry.getByRole('button', {
			name: `Open details for ${renamedTitle}`,
			exact: true,
		});
		const reopenedOriginal = pantry.locator('.pattern-card').filter({ has: reopenedOriginalOpen });
		await expect(reopenedOriginal).toBeVisible();
		await expect(reopenedOriginal.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
		await reopenedOriginalOpen.click();

		await pantry.locator('#duplicate-pattern').click();
		const duplicateOpen = pantry.getByRole('button', {
			name: `Open details for ${duplicateTitle}`,
			exact: true,
		});
		await expect(duplicateOpen).toBeVisible();
		const duplicateCard = pantry.locator('.pattern-card').filter({ has: duplicateOpen });
		const duplicateId = Number(await duplicateCard.getAttribute('data-pattern-id'));
		expect(duplicateId).toBeGreaterThan(0);
		expect(duplicateId).not.toBe(originalId);

		await pantry.locator('#trash-pattern').click();
		const trashDialog = pantry.locator('#trash-dialog');
		await expect(trashDialog).toBeVisible();
		await expect(trashDialog.locator('#trash-pattern-name')).toHaveText(duplicateTitle);
		await trashDialog.getByRole('button', { name: 'Move to trash' }).click();
		await expect(duplicateCard).toHaveCount(0);

		const renamedCard = pantry.locator('.pattern-card').filter({ has: reopenedOriginalOpen });
		await reopenedOriginalOpen.click();
		await pantry.locator('#trash-pattern').click();
		await expect(trashDialog.locator('#trash-pattern-name')).toHaveText(renamedTitle);
		await trashDialog.getByRole('button', { name: 'Move to trash' }).click();
		await expect(renamedCard).toHaveCount(0);

		const hardDeleteCleanup = await pantry.locator('body').evaluate(
			async (_body, ids) => {
				const app = (
					window as typeof window & {
						oddApp: {
							request: (path: string, options: { method: string }) => Promise<unknown>;
						};
					}
				).oddApp;
				return Promise.all(
					ids.map(async (id) => {
						await app.request(`wp/v2/blocks/${id}?force=true`, {
							method: 'DELETE',
						});
						return true;
					}),
				);
			},
			[originalId, duplicateId],
		);
		expect(hardDeleteCleanup).toEqual([true, true]);

		await pantryWindow.locator('os-window-button[aria-label="Close"]').click();
		await expect(pantryWindow).toBeHidden();
		await page.evaluate(() => {
			(window as typeof window & { __oddNativeConfirmCalls: number }).__oddNativeConfirmCalls = 0;
			window.confirm = () => {
				(window as typeof window & { __oddNativeConfirmCalls: number }).__oddNativeConfirmCalls++;
				return false;
			};
		});

		await pantryCard.getByRole('button', { name: 'Remove' }).click();
		const removeDialog = page.locator('os-confirm-dialog');
		await expect(removeDialog).toHaveAttribute('title', 'Remove this app?');
		await expect(removeDialog).toHaveAttribute('message', /Remove ODD Pantry from this site\?/);
		await expect(removeDialog).toHaveAttribute('confirm-label', 'Remove');
		await expect(removeDialog).toHaveAttribute('cancel-label', 'Keep it');
		await expect(removeDialog).toHaveAttribute('danger', '');
		await removeDialog.getByRole('button', { name: 'Keep it' }).click();
		await expect(removeDialog).toHaveCount(0);
		await expect(pantryCard).toHaveAttribute('data-state', 'installed');
		await expect(page.locator('[data-icon-id="odd-app-pantry"]')).toHaveCount(1);

		await pantryCard.getByRole('button', { name: 'Remove' }).click();
		await expect(removeDialog).toHaveAttribute('danger', '');
		await removeDialog.getByRole('button', { name: 'Remove', exact: true }).click();
		await expect(pantryCard).toHaveAttribute('data-state', 'available', {
			timeout: 45_000,
		});
		await expect(pantryCard.getByRole('button', { name: /Install app/ })).toBeEnabled();
		await expect(page.locator('[data-icon-id="odd-app-pantry"]')).toHaveCount(0);
		expect(
			await page.evaluate(
				() => (window as typeof window & { __oddNativeConfirmCalls: number }).__oddNativeConfirmCalls,
			),
		).toBe(0);
	});
} );
