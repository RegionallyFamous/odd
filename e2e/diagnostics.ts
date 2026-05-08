import type { Page, TestInfo } from '@playwright/test';

/**
 * Browser-side snapshot (Playwright `page.evaluate`). Safe to call on any
 * ODD Desktop Mode URL after scripts load.
 */
export type OddClientDiagnostics = {
	href: string;
	userAgent: string;
	pixi: boolean;
	oddSceneKeys: string[] | null;
	oddHasApi: boolean;
	oddRuntimePresent: boolean;
	activeSceneSlug: string | undefined;
	shell: boolean;
	desktopModeWallpaperKeys: string[] | null;
};

export type OddE2eDiagnosticsBundle = {
	schema: 1;
	collectedAt: string;
	server: Record<string, unknown> | null;
	serverFetchError?: string;
	client: OddClientDiagnostics | null;
	clientError?: string;
	appProbe?: Record<string, unknown> | null;
	appProbeError?: string;
};

/**
 * GET /wp-json/odd/v1/e2e-diagnostics — requires an authenticated admin session.
 */
export async function fetchServerDiagnostics(
	page: Page,
	opts?: { probe?: boolean }
): Promise<Record<string, unknown> | null> {
	const probe = opts?.probe === true;
	try {
		return await page.evaluate( async ( probeParam ) => {
			const qPretty = probeParam ? '?probe=1' : '';
			const qPlain = probeParam ? '?rest_route=/odd/v1/e2e-diagnostics&probe=1' : '?rest_route=/odd/v1/e2e-diagnostics';
			const urls = [
				`/wp-json/odd/v1/e2e-diagnostics${ qPretty }`,
				`/index.php${ qPlain }`,
			];
			let lastText = '';
			let lastStatus = 0;
			for ( const p of urls ) {
				const r = await fetch( p, { credentials: 'same-origin' } );
				lastStatus = r.status;
				const text = await r.text();
				lastText = text;
				if ( ! r.ok ) {
					continue;
				}
				try {
					return JSON.parse( text ) as Record<string, unknown>;
				} catch {
					/* likely HTML from plain permalinks — try next URL */
				}
			}
			return {
				_error: true,
				status: lastStatus,
				body: lastText.slice( 0, 8000 ),
			};
		}, probe );
	} catch ( err ) {
		return {
			_error: true,
			message: err instanceof Error ? err.message : String( err ),
		};
	}
}

export async function collectClientDiagnostics( page: Page ): Promise<OddClientDiagnostics> {
	return page.evaluate( () => {
		const w = window as unknown as {
			__odd?: { scenes?: Record<string, object>; runtime?: { activeScene?: { slug?: string } }; api?: object };
			PIXI?: object;
		};
		const dm = ( window as unknown as { desktopModeWallpapers?: Record<string, unknown> } )
			.desktopModeWallpapers;
		const rt = w.__odd?.runtime as { activeScene?: { slug?: string } } | undefined;
		return {
			href: location.href,
			userAgent: navigator.userAgent,
			pixi: typeof w.PIXI !== 'undefined',
			oddSceneKeys: w.__odd?.scenes ? Object.keys( w.__odd.scenes ) : null,
			oddHasApi: !! w.__odd?.api,
			oddRuntimePresent: !! w.__odd?.runtime,
			activeSceneSlug: rt?.activeScene?.slug,
			shell: !! document.getElementById( 'desktop-mode-shell' ),
			desktopModeWallpaperKeys: dm ? Object.keys( dm ) : null,
		};
	} );
}

export async function probeInstalledApp(
	page: Page,
	slug = 'board'
): Promise<Record<string, unknown> | null> {
	return page.evaluate( async ( appSlug ) => {
		const w = window as unknown as {
			__odd?: {
				diagnostics?: {
					probeApp?: ( slug: string, opts?: Record<string, unknown> ) => Promise<Record<string, unknown>>;
				};
			};
		};
		const probe = w.__odd?.diagnostics?.probeApp;
		if ( typeof probe !== 'function' ) {
			return null;
		}
		const timeout = new Promise<Record<string, unknown>>( ( resolve ) => {
			window.setTimeout( () => resolve( { _error: true, message: 'app probe timed out' } ), 10_000 );
		} );
		return Promise.race( [
			probe( appSlug, { reason: 'playwright-failure' } ),
			timeout,
		] );
	}, slug );
}

/**
 * On Playwright failures: attach a JSON bundle (artifact) and echo a short
 * summary to stdout so CI logs stay readable without opening the HTML report.
 */
export async function attachOddDiagnostics( page: Page, testInfo: TestInfo ) {
	const bundle: OddE2eDiagnosticsBundle = {
		schema: 1,
		collectedAt: new Date().toISOString(),
		server: null,
		client: null,
	};

	const probe = process.env.ODD_E2E_DIAG_PROBE === '1';
	try {
		bundle.server = await fetchServerDiagnostics( page, { probe } );
		if ( bundle.server && bundle.server._error ) {
			bundle.serverFetchError = JSON.stringify( bundle.server );
		}
	} catch ( err ) {
		bundle.serverFetchError = err instanceof Error ? err.message : String( err );
	}

	try {
		bundle.client = await collectClientDiagnostics( page );
	} catch ( err ) {
		bundle.clientError = err instanceof Error ? err.message : String( err );
	}

	try {
		bundle.appProbe = await probeInstalledApp( page, 'board' );
	} catch ( err ) {
		bundle.appProbeError = err instanceof Error ? err.message : String( err );
	}

	const text = JSON.stringify( bundle, null, 2 );
	await testInfo.attach( 'odd-diagnostics.json', {
		body: Buffer.from( text, 'utf8' ),
		contentType: 'application/json',
	} );

	// eslint-disable-next-line no-console
	console.log( '[odd-e2e-diagnostics]', text.slice( 0, 6000 ) );

	const s = bundle.server;
	if ( s && ! s._error ) {
		const starterRaw = s.starterPack;
		let starterStatus = '';
		if ( starterRaw && typeof starterRaw === 'object' && 'status' in starterRaw ) {
			starterStatus = String( ( starterRaw as { status?: string } ).status ?? '' );
		}
		// eslint-disable-next-line no-console
		console.log(
			'[odd-e2e-diagnostics:summary]',
			`wp=${ String( ( s.wordpress as { version?: string } )?.version ) } odd=${ String( ( s.odd as { version?: string } )?.version ) } scenes=${ String( ( s.wallpaper as { count?: number } )?.count ) } starter=${ starterStatus }`
		);
	}
}
