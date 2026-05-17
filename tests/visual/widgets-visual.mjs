#!/usr/bin/env node
/**
 * Browser visual contract checks for catalog widgets.
 *
 * This intentionally runs outside Vitest because it needs a real browser,
 * real CSS layout, media emulation, and local asset loading. The runner is
 * manifest-driven: every source widget with manifest.json, widget.js, and
 * widget.css gets min/default/reduced-motion coverage automatically.
 */
import { chromium } from '@playwright/test';
import { existsSync, createReadStream, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const ROOT = resolve( __dirname, '../..' );
const WIDGETS_ROOT = resolve( ROOT, '_tools/catalog-sources/widgets' );
const DEFAULT_OUT = join( tmpdir(), 'odd-widget-visual' );
const outDir = resolve( process.env.ODD_WIDGET_VISUAL_OUT || DEFAULT_OUT );

const args = new Set( process.argv.slice( 2 ) );
const headed = args.has( '--headed' );
const keepOpen = args.has( '--keep-open' );
const onlySlug = readArgValue( '--widget' );

const EXERCISES = {
	sticky: async ( page ) => {
		const textarea = page.locator( 'textarea.odd-sticky__text' );
		if ( await textarea.count() ) await textarea.fill( 'Visual test note' );
	},
	'eight-ball': async ( page ) => {
		await clickIfPresent( page, '.odd-eight__stage' );
		await page.waitForTimeout( 650 );
	},
	spotify: async ( page ) => {
		await clickIfPresent( page, '.odd-spotify__btn[aria-label="Change Spotify embed"]' );
	},
	'desk-pet-oddling': async ( page ) => {
		await page.mouse.move( 40, 42 );
		await page.evaluate( () => {
			const handler = window.__oddHandlers && window.__oddHandlers[ 'odd.window-bounds-changed' ];
			if ( handler ) handler();
		} );
	},
	'fortune-terminal': async ( page ) => {
		await clickIfPresent( page, '.odd-fortune__prompt' );
		await page.waitForTimeout( 900 );
	},
	'plugin-panic-button': async ( page ) => {
		await clickIfPresent( page, '.odd-panic__button' );
		await page.waitForTimeout( 1500 );
		await clickIfPresent( page, '.odd-panic__item' );
	},
	'tiny-aquarium': async ( page ) => {
		await clickIfPresent( page, '.odd-aquarium__tank' );
		await page.waitForTimeout( 300 );
	},
};

const MIME = new Map( [
	[ '.css', 'text/css; charset=utf-8' ],
	[ '.js', 'application/javascript; charset=utf-8' ],
	[ '.json', 'application/json; charset=utf-8' ],
	[ '.svg', 'image/svg+xml' ],
	[ '.webp', 'image/webp' ],
	[ '.png', 'image/png' ],
	[ '.jpg', 'image/jpeg' ],
	[ '.jpeg', 'image/jpeg' ],
] );

function readArgValue( name ) {
	const raw = process.argv.slice( 2 );
	for ( let i = 0; i < raw.length; i += 1 ) {
		if ( raw[ i ] === name ) return raw[ i + 1 ] || '';
		if ( raw[ i ].startsWith( `${ name }=` ) ) return raw[ i ].slice( name.length + 1 );
	}
	return '';
}

function discoverWidgets() {
	return readdirSync( WIDGETS_ROOT, { withFileTypes: true } )
		.filter( ( item ) => item.isDirectory() )
		.map( ( item ) => item.name )
		.filter( ( slug ) => ! onlySlug || slug === onlySlug )
		.map( ( slug ) => {
			const dir = join( WIDGETS_ROOT, slug );
			const manifestPath = join( dir, 'manifest.json' );
			const jsPath = join( dir, 'widget.js' );
			const cssPath = join( dir, 'widget.css' );
			if ( ! existsSync( manifestPath ) || ! existsSync( jsPath ) || ! existsSync( cssPath ) ) {
				return null;
			}
			const manifest = JSON.parse( readFileSync( manifestPath, 'utf8' ) );
			return {
				slug,
				dir,
				manifest,
				widths: {
					min: [
						Number( manifest.minWidth || manifest.defaultWidth || 300 ),
						Number( manifest.minHeight || manifest.defaultHeight || 220 ),
					],
					default: [
						Number( manifest.defaultWidth || manifest.minWidth || 300 ),
						Number( manifest.defaultHeight || manifest.minHeight || 220 ),
					],
				},
			};
		} )
		.filter( Boolean )
		.sort( ( a, b ) => a.slug.localeCompare( b.slug ) );
}

function startServer() {
	const server = createServer( ( req, res ) => {
		const url = new URL( req.url || '/', 'http://127.0.0.1' );
		const requested = decodeURIComponent( url.pathname ).replace( /^\/+/, '' );
		const file = resolve( WIDGETS_ROOT, requested );
		if ( ! file.startsWith( WIDGETS_ROOT ) || ! existsSync( file ) ) {
			res.writeHead( 404, { 'content-type': 'text/plain; charset=utf-8' } );
			res.end( 'not found' );
			return;
		}
		res.writeHead( 200, {
			'content-type': MIME.get( extname( file ).toLowerCase() ) || 'application/octet-stream',
			'x-content-type-options': 'nosniff',
		} );
		createReadStream( file ).pipe( res );
	} );
	return new Promise( ( resolveServer ) => {
		server.listen( 0, '127.0.0.1', () => resolveServer( server ) );
	} );
}

async function clickIfPresent( page, selector ) {
	const locator = page.locator( selector ).first();
	if ( await locator.count() ) await locator.click();
}

function pageMarkup( widget, size, port ) {
	const base = `http://127.0.0.1:${ port }/${ widget.slug }/`;
	const id = JSON.stringify( widget.manifest.id );
	return `<!doctype html>
<html>
<head>
	<meta charset="utf-8">
	<base href="${ base }">
	<style>
		html,
		body {
			width: 100%;
			height: 100%;
			margin: 0;
			background: #05070f;
		}
		body {
			display: grid;
			place-items: center;
			font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		}
		#host {
			width: ${ size[ 0 ] }px;
			height: ${ size[ 1 ] }px;
		}
	</style>
	<link rel="stylesheet" href="widget.css">
</head>
<body>
	<div id="host"></div>
	<script>
		window.wp = {
			i18n: { __: function ( s ) { return s; } },
			desktop: {
				registerWidget: function () {
					throw new Error( 'Widget bundles must expose window.desktopModeWidgets[id], not call wp.desktop.registerWidget().' );
				}
			}
		};
		window.__oddHandlers = {};
		window.__oddEmitted = [];
		window.__oddStorage = {};
		window.__odd = {
			events: {
				on: function ( name, fn ) {
					window.__oddHandlers[ name ] = fn;
					return function () { delete window.__oddHandlers[ name ]; };
				},
				emit: function ( name, payload ) {
					window.__oddEmitted.push( { name: name, payload: payload } );
				}
			}
		};
	</script>
	<script src="widget.js"></script>
	<script>
		const mount = window.desktopModeWidgets && window.desktopModeWidgets[ ${ id } ];
		if ( typeof mount !== 'function' ) {
			throw new Error( 'Missing widget mount for ' + ${ id } );
		}
		const cleanup = mount( document.getElementById( 'host' ), {
			storage: {
				get: function ( key ) { return Object.prototype.hasOwnProperty.call( window.__oddStorage, key ) ? window.__oddStorage[ key ] : null; },
				set: function ( key, value ) { window.__oddStorage[ key ] = value; },
				remove: function ( key ) { delete window.__oddStorage[ key ]; },
				clear: function () { window.__oddStorage = {}; }
			}
		} );
		if ( typeof cleanup !== 'function' ) {
			throw new Error( 'Widget mount did not return a cleanup function for ' + ${ id } );
		}
		window.__cleanup = cleanup;
	</script>
</body>
</html>`;
}

async function installNetworkPolicy( page, port, localFailures, externalRequests ) {
	await page.route( '**/*', async ( route ) => {
		const req = route.request();
		const url = new URL( req.url() );
		const isLocal = url.hostname === '127.0.0.1' && url.port === String( port );
		if ( isLocal || url.protocol === 'data:' || url.protocol === 'about:' ) {
			await route.continue();
			return;
		}
		externalRequests.push( req.url() );
		if ( req.resourceType() === 'document' ) {
			await route.fulfill( {
				status: 200,
				contentType: 'text/html; charset=utf-8',
				body: '<!doctype html><title>External embed stub</title>',
			} );
			return;
		}
		await route.fulfill( { status: 204, body: '' } );
	} );
	page.on( 'requestfailed', ( req ) => {
		const url = new URL( req.url() );
		if ( url.hostname === '127.0.0.1' && url.port === String( port ) ) {
			localFailures.push( `${ req.url() } ${ req.failure()?.errorText || '' }` );
		}
	} );
	page.on( 'response', ( response ) => {
		const url = new URL( response.url() );
		if ( url.hostname === '127.0.0.1' && url.port === String( port ) && response.status() >= 400 ) {
			localFailures.push( `${ response.status() } ${ response.url() }` );
		}
	} );
}

async function inspectPage( page, reducedMotion ) {
	return page.evaluate( ( reduced ) => {
		const host = document.getElementById( 'host' );
		const hostRect = host.getBoundingClientRect();
		const hostOverflow = host.scrollWidth > host.clientWidth + 2 || host.scrollHeight > host.clientHeight + 2;
		const brokenImages = Array.from( host.querySelectorAll( 'img' ) )
			.filter( ( img ) => img.complete && img.naturalWidth === 0 )
			.map( ( img ) => img.currentSrc || img.src );
		const textOutsideHost = [];
		for ( const node of Array.from( host.querySelectorAll( '*' ) ) ) {
			const text = ( node.textContent || '' ).trim();
			if ( ! text ) continue;
			const style = getComputedStyle( node );
			if ( style.display === 'none' || style.visibility === 'hidden' || Number( style.opacity ) === 0 ) continue;
			const rect = node.getBoundingClientRect();
			if ( ! rect.width || ! rect.height ) continue;
			if (
				rect.left < hostRect.left - 1 ||
				rect.right > hostRect.right + 1 ||
				rect.top < hostRect.top - 1 ||
				rect.bottom > hostRect.bottom + 1
			) {
				textOutsideHost.push( {
					text: text.slice( 0, 80 ),
					className: String( node.className || '' ),
					rect: {
						left: Math.round( rect.left ),
						top: Math.round( rect.top ),
						right: Math.round( rect.right ),
						bottom: Math.round( rect.bottom ),
					},
				} );
			}
		}
		const runningAnimations = reduced ? Array.from( host.querySelectorAll( '*' ) )
			.filter( ( node ) => {
				const style = getComputedStyle( node );
				const names = style.animationName.split( ',' ).map( ( name ) => name.trim() );
				const durations = style.animationDuration.split( ',' ).map( ( duration ) => parseFloat( duration ) || 0 );
				return names.some( ( name, index ) => name !== 'none' && durations[ index ] > 0 );
			} )
			.map( ( node ) => String( node.className || node.tagName ) )
			.slice( 0, 12 ) : [];
		return {
			hostClass: host.className,
			hostOverflow,
			brokenImages,
			textOutsideHost,
			runningAnimations,
		};
	}, reducedMotion );
}

async function runWidgetCase( browser, widget, label, size, reducedMotion, port ) {
	const page = await browser.newPage( {
		viewport: { width: size[ 0 ] + 80, height: size[ 1 ] + 80 },
		deviceScaleFactor: 1,
	} );
	const localFailures = [];
	const externalRequests = [];
	const consoleErrors = [];
	const pageErrors = [];
	page.on( 'console', ( msg ) => {
		if ( msg.type() === 'error' ) consoleErrors.push( msg.text() );
	} );
	page.on( 'pageerror', ( err ) => {
		pageErrors.push( err && err.stack ? err.stack : String( err ) );
	} );
	await installNetworkPolicy( page, port, localFailures, externalRequests );
	await page.emulateMedia( { reducedMotion: reducedMotion ? 'reduce' : 'no-preference' } );
	await page.setContent( pageMarkup( widget, size, port ), { waitUntil: 'load' } );
	await page.waitForTimeout( reducedMotion ? 150 : 450 );
	if ( EXERCISES[ widget.slug ] ) await EXERCISES[ widget.slug ]( page );
	await page.waitForLoadState( 'networkidle' );

	const screenshot = join( outDir, `${ widget.slug }-${ label }.png` );
	await page.screenshot( { path: screenshot } );
	const inspected = await inspectPage( page, reducedMotion );
	const cleanupErrors = await page.evaluate( () => {
		const errors = [];
		try { window.__cleanup && window.__cleanup(); } catch ( e ) { errors.push( e && e.message ? e.message : String( e ) ); }
		try { window.__cleanup && window.__cleanup(); } catch ( e ) { errors.push( e && e.message ? e.message : String( e ) ); }
		return errors;
	} );
	await page.close();

	return {
		widget: widget.slug,
		label,
		size,
		screenshot,
		externalRequests,
		failures: [
			...localFailures.map( ( message ) => `local asset failed: ${ message }` ),
			...consoleErrors.map( ( message ) => `console.error: ${ message }` ),
			...pageErrors.map( ( message ) => `page error: ${ message }` ),
			...cleanupErrors.map( ( message ) => `cleanup error: ${ message }` ),
			...( inspected.hostOverflow ? [ 'host has scroll overflow' ] : [] ),
			...inspected.brokenImages.map( ( src ) => `broken img: ${ src }` ),
			...inspected.textOutsideHost.map( ( item ) => `text outside host: ${ item.text } (${ item.className })` ),
			...inspected.runningAnimations.map( ( className ) => `running reduced-motion animation: ${ className }` ),
		],
	};
}

async function main() {
	const widgets = discoverWidgets();
	if ( onlySlug && widgets.length === 0 ) {
		throw new Error( `No widget found for --widget=${ onlySlug }` );
	}
	if ( widgets.length === 0 ) {
		throw new Error( 'No widget sources found.' );
	}
	mkdirSync( outDir, { recursive: true } );
	const server = await startServer();
	const port = server.address().port;
	const browser = await chromium.launch( { headless: ! headed } );
	const results = [];
	try {
		for ( const widget of widgets ) {
			const cases = [
				[ 'min', widget.widths.min, false ],
				[ 'default', widget.widths.default, false ],
				[ 'default-reduced', widget.widths.default, true ],
			];
			for ( const [ label, size, reducedMotion ] of cases ) {
				const result = await runWidgetCase( browser, widget, label, size, reducedMotion, port );
				results.push( result );
				const externalNote = result.externalRequests.length ? `, external stubs=${ result.externalRequests.length }` : '';
				if ( result.failures.length ) {
					console.error( `FAIL ${ widget.slug } ${ label } (${ size[ 0 ] }x${ size[ 1 ] }) -> ${ result.screenshot }${ externalNote }` );
					for ( const failure of result.failures ) console.error( `  - ${ failure }` );
				} else {
					console.log( `ok   ${ widget.slug } ${ label } (${ size[ 0 ] }x${ size[ 1 ] }) -> ${ result.screenshot }${ externalNote }` );
				}
			}
		}
	} finally {
		if ( keepOpen && headed ) {
			console.log( 'Keeping browser open because --keep-open was passed.' );
		} else {
			await browser.close();
		}
		server.close();
	}

	const failed = results.filter( ( result ) => result.failures.length );
	if ( failed.length ) {
		console.error( `\nWidget visual checks failed: ${ failed.length }/${ results.length } cases` );
		process.exitCode = 1;
		return;
	}
	console.log( `\nWidget visual checks passed: ${ results.length } cases across ${ widgets.length } widgets.` );
}

main().catch( ( err ) => {
	console.error( err && err.stack ? err.stack : err );
	process.exitCode = 1;
} );
