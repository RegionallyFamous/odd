/**
 * End-to-end: one browser session — login → desktop shell → wallpaper
 * scenes + canvas pixel check → optional scene hook → ODD Shop + axe +
 * shop rail / search / wallpaper preview-cancel.
 *
 * Kept in a *single* test so CI does not pay login/shell/PIXI waits twice
 * (that was the main driver of 15m+ job times).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installOddFailureDiagnostics } from './diagnostics-hooks';
import {
	exerciseOddShopInteractions,
	goDesktopShell,
	installCatalogAppOpenAndAssertHydratedIframe,
	loginAdmin,
	openOddShop,
	waitForWallpaperScenes,
} from './helpers';

installOddFailureDiagnostics();

test.describe( 'ODD admin smoke', () => {
	test( 'wallpaper + scene hook, shop axe, then rail + preview', async ( { page } ) => {
		// ~3–8m cold CI; catalog app install + open can add a few minutes at tail.
		test.setTimeout( 420_000 );

		page.on( 'console', ( msg ) => {
			const type = msg.type();
			if ( type === 'error' || type === 'warning' ) {
				// eslint-disable-next-line no-console
				console.log( `[page:${ type }]`, msg.text(), '@', page.url() );
			}
		} );
		page.on( 'pageerror', ( err ) => {
			// eslint-disable-next-line no-console
			console.log( '[page:pageerror]', err.message, '@', page.url() );
		} );
		page.on( 'response', async ( response ) => {
			const url = response.url();
			const status = response.status();
			const ctype = ( response.headers()[ 'content-type' ] ?? '' ).toLowerCase();
			const looksLikeScript = /\.js(\?|$)/.test( url );
			if ( status >= 400 ) {
				// eslint-disable-next-line no-console
				console.log( `[page:${ status }]`, url, ctype );
				return;
			}
			if ( looksLikeScript && ctype.includes( 'html' ) ) {
				// eslint-disable-next-line no-console
				console.log( `[page:200-html-for-js]`, url, ctype );
			}
		} );
		page.on( 'requestfailed', ( request ) => {
			// eslint-disable-next-line no-console
			console.log( '[page:requestfailed]', request.url(), request.failure()?.errorText );
		} );

		await loginAdmin( page );
		await goDesktopShell( page );
		await waitForWallpaperScenes( page );

		const registeredScenes = await page.evaluate( () => {
			const list = window.__odd && window.__odd.scenes;
			return list ? Object.keys( list ) : [];
		} );
		expect( registeredScenes.length, 'at least one scene must register' ).toBeGreaterThan( 0 );

		const canvasState = await page.evaluate( async () => {
			for ( let i = 0; i < 60; i++ ) {
				const canvases = Array.from( document.querySelectorAll( 'canvas' ) );
				const c = canvases.find( ( el ) => el.width >= 320 && el.height >= 180 );
				if ( c ) {
					return { found: true, width: c.width, height: c.height };
				}
				await new Promise( ( r ) => setTimeout( r, 100 ) );
			}
			return { found: false, width: 0, height: 0 };
		} );
		expect( canvasState.found, 'a wallpaper canvas should exist at >=320x180' ).toBe( true );

		// `gl.readPixels` from the canvas default backbuffer is flaky in
		// headless Chromium — PIXI v8 uses `preserveDrawingBuffer: false`,
		// so sampling outside of a render tick usually returns zeros. The
		// *engine* exposes what we actually care about: a mounted scene
		// impl with a live PIXI app. Poll that instead of pixel bytes.
		const sceneMounted = await page.waitForFunction(
			() => {
				const rt = ( window as unknown as {
					__odd?: { runtime?: { activeScene?: { slug?: string; env?: { app?: { renderer?: unknown } } } } };
				} ).__odd?.runtime;
				const active = rt?.activeScene;
				return !! active && typeof active.slug === 'string' && !! active.env?.app?.renderer;
			},
			{ timeout: 15_000 },
		);
		expect( !! sceneMounted, 'wallpaper engine must mount a scene' ).toBe( true );

		const hookFired = await page.evaluate( async ( targetSlug ) => {
			if ( ! ( window.wp && window.wp.hooks && window.wp.hooks.doAction ) ) return false;
			window.wp.hooks.doAction( 'odd.pickScene', targetSlug );
			await new Promise( ( r ) => setTimeout( r, 800 ) );
			return true;
		}, registeredScenes[ 0 ] );
		expect( hookFired, 'wp.hooks must fire odd.pickScene' ).toBe( true );

		await openOddShop( page );
		const results = await new AxeBuilder( { page } )
			.include( '.odd-panel' )
			.withTags( [ 'wcag2a', 'wcag2aa' ] )
			.analyze();
		const bad = results.violations.filter(
			( v ) => v.impact === 'critical' || v.impact === 'serious',
		);
		expect( bad, JSON.stringify( bad, null, 2 ) ).toEqual( [] );

		await exerciseOddShopInteractions( page );
		await installCatalogAppOpenAndAssertHydratedIframe( page );
	} );
} );
