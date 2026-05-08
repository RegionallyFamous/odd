/**
 * ODD diagnostics (window.__odd.diagnostics)
 * ---------------------------------------------------------------
 * Local-only, zero-telemetry diagnostics bundle for bug reports.
 *
 * Everything this module collects stays on the user's machine. The
 * only side effect that leaves the browser is the user manually
 * copying the payload into a GitHub issue. There is no network
 * transport, no opt-in flag, no ping-back; if we ever add server-side
 * telemetry it MUST be a separate module so this one keeps its
 * "safe to run, always" contract.
 *
 * Exposes:
 *   window.__odd.diagnostics.collect()              → payload object
 *   window.__odd.diagnostics.collectMarkdown()      → markdown string
 *   window.__odd.diagnostics.appsSnapshot()     → structured apps / iframe peek
 *   window.__odd.diagnostics.appIframes()       → live iframe snapshots only
 *
 * Also installs a ring buffer that captures the last 100 entries from
 * console.error + console.warn + unhandled errors so the report has
 * something useful even when the panel wasn't open when things went
 * wrong. The buffer size is capped to keep `localStorage` clean.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	window.__odd = window.__odd || {};
	if ( window.__odd.diagnostics ) return;

	var MAX_ENTRIES = 100;
	var MAX_METRICS = 80;
	var buffer = [];
	var metrics = {
		timings: [],
		counters: {},
	};

	function now() {
		return new Date().toISOString();
	}

	function safeStringify( arg ) {
		if ( arg === undefined ) return 'undefined';
		if ( arg === null ) return 'null';
		if ( arg instanceof Error ) {
			return ( arg.name || 'Error' ) + ': ' + arg.message +
				( arg.stack ? '\n' + arg.stack : '' );
		}
		if ( typeof arg === 'string' ) return arg;
		try { return JSON.stringify( arg ); }
		catch ( _ ) { return String( arg ); }
	}

	function record( level, args ) {
		try {
			var line = Array.prototype.slice.call( args || [] ).map( safeStringify ).join( ' ' );
			buffer.push( { at: now(), level: level, message: line.slice( 0, 2000 ) } );
			while ( buffer.length > MAX_ENTRIES ) buffer.shift();
		} catch ( _ ) {}
	}

	function monotonicNow() {
		try {
			return ( window.performance && typeof window.performance.now === 'function' ) ? window.performance.now() : Date.now();
		} catch ( _ ) {
			return Date.now();
		}
	}

	function metricName( name ) {
		return String( name || '' ).replace( /[^a-zA-Z0-9_.:-]/g, '-' ).slice( 0, 96 );
	}

	function timing( name, ms, meta ) {
		name = metricName( name );
		if ( ! name ) return null;
		var row = {
			at:   now(),
			name: name,
			ms:   Math.max( 0, Math.round( Number( ms ) || 0 ) ),
		};
		if ( meta && typeof meta === 'object' ) {
			row.meta = {};
			Object.keys( meta ).slice( 0, 12 ).forEach( function ( key ) {
				var value = meta[ key ];
				if ( value === null || [ 'string', 'number', 'boolean' ].indexOf( typeof value ) !== -1 ) {
					row.meta[ key ] = value;
				}
			} );
		}
		metrics.timings.push( row );
		while ( metrics.timings.length > MAX_METRICS ) metrics.timings.shift();
		return row;
	}

	function count( name, by ) {
		name = metricName( name );
		if ( ! name ) return 0;
		by = Number( by );
		if ( ! by ) by = 1;
		metrics.counters[ name ] = ( metrics.counters[ name ] || 0 ) + by;
		return metrics.counters[ name ];
	}

	function time( name, meta ) {
		var start = monotonicNow();
		return function ( doneMeta ) {
			var merged = {};
			var key;
			if ( meta && typeof meta === 'object' ) {
				for ( key in meta ) {
					if ( Object.prototype.hasOwnProperty.call( meta, key ) ) merged[ key ] = meta[ key ];
				}
			}
			if ( doneMeta && typeof doneMeta === 'object' ) {
				for ( key in doneMeta ) {
					if ( Object.prototype.hasOwnProperty.call( doneMeta, key ) ) merged[ key ] = doneMeta[ key ];
				}
			}
			return timing( name, monotonicNow() - start, merged );
		};
	}

	function metricsSnapshot() {
		return {
			timings:  metrics.timings.slice(),
			counters: Object.assign( {}, metrics.counters ),
		};
	}

	var c = window.console;
	if ( c ) {
		var origError = c.error && c.error.bind( c );
		var origWarn  = c.warn  && c.warn.bind( c );
		if ( origError ) { c.error = function () { record( 'error', arguments ); return origError.apply( null, arguments ); }; }
		if ( origWarn )  { c.warn  = function () { record( 'warn',  arguments ); return origWarn.apply( null, arguments ); }; }
	}

	window.addEventListener( 'error', function ( e ) {
		record( 'error', [ e && ( e.message || 'Uncaught' ), e && e.filename, e && e.lineno ] );
	} );
	window.addEventListener( 'unhandledrejection', function ( e ) {
		record( 'error', [ 'UnhandledRejection:', e && ( e.reason && e.reason.message ) || e ] );
	} );

	// Also mirror whatever the event bus routed as `odd.error` so scene
	// boundary errors show up in the report even when they were only
	// logged through wrapMethod.
	try {
		if ( window.__odd.events && typeof window.__odd.events.on === 'function' ) {
			window.__odd.events.on( 'odd.error', function ( payload ) {
				record( 'error', [ 'odd.error', payload && payload.scope, payload && payload.error && payload.error.message ] );
			} );
			window.__odd.events.on( 'odd.iframe-error', function ( payload ) {
				record( 'error', [
					'odd.iframe-error',
					payload && payload.message,
					payload && payload.slug,
					payload && payload.err,
				] );
				pushAppIframeError( payload || {} );
			} );
		}
	} catch ( _ ) {}

	var APP_ERRORS_MAX = 24;
	var appIframeErrors = [];
	var APP_PROBES_MAX = 12;
	var appProbeRuns = [];

	function truncate( value, max ) {
		value = value === undefined || value === null ? '' : String( value );
		max = max || 1200;
		return value.length > max ? value.slice( 0, max ) : value;
	}

	function redactAppServeUrlForReport( url ) {
		if ( typeof url !== 'string' || ! url ) return '';
		return url.replace( /([?&])_wpnonce=[^&]*/g, '$1_wpnonce=[redacted]' );
	}

	function slugFromFrame( frame ) {
		try {
			var mount = frame && frame.closest ? frame.closest( '.odd-app-host' ) : null;
			return mount && mount.getAttribute ? ( mount.getAttribute( 'data-odd-app-slug' ) || '' ) : '';
		} catch ( _ ) {}
		return '';
	}

	function frameForContentWindow( source ) {
		try {
			var frames = document.querySelectorAll ? document.querySelectorAll( 'iframe.odd-app-frame' ) : [];
			for ( var i = 0; i < frames.length; i++ ) {
				try {
					if ( frames[ i ].contentWindow === source ) return frames[ i ];
				} catch ( _ ) {}
			}
		} catch ( _ ) {}
		return null;
	}

	function slugForMessageSource( source ) {
		return slugFromFrame( frameForContentWindow( source ) );
	}

	function normalizeAppIframeError( row, source ) {
		row = row || {};
		return {
			at:       row.at ? String( row.at ) : now(),
			source:   row.source ? String( row.source ) : 'odd-app-iframe',
			type:     row.type ? String( row.type ) : '',
			message:  truncate( row.message || row.reason || row.error || '', 1600 ),
			slug:     row.slug ? String( row.slug ) : slugForMessageSource( source ),
			href:     redactAppServeUrlForReport( row.href ? String( row.href ) : '' ),
			filename: redactAppServeUrlForReport( row.filename ? String( row.filename ) : '' ),
			lineno:   Number( row.lineno ) || 0,
			colno:    Number( row.colno ) || 0,
			stack:    truncate( row.stack || '', 2400 ),
		};
	}

	function pushAppIframeError( row, source ) {
		var normalized = normalizeAppIframeError( row, source );
		try {
			appIframeErrors.push( normalized );
			while ( appIframeErrors.length > APP_ERRORS_MAX ) appIframeErrors.shift();
		} catch ( _ ) {}
		return normalized;
	}

	function recentAppIframeErrors( slug ) {
		var needle = String( slug || '' );
		return appIframeErrors.filter( function ( row ) {
			return ! needle || ! row.slug || row.slug === needle;
		} ).slice( -8 );
	}

	function rectSnapshot( node ) {
		if ( ! node || typeof node.getBoundingClientRect !== 'function' ) return null;
		try {
			var r = node.getBoundingClientRect();
			return {
				x: Math.round( r.left ),
				y: Math.round( r.top ),
				w: Math.round( r.width ),
				h: Math.round( r.height ),
			};
		} catch ( _ ) {
			return null;
		}
	}

	function styleSnapshot( win, node ) {
		if ( ! win || ! node || typeof win.getComputedStyle !== 'function' ) return null;
		try {
			var s = win.getComputedStyle( node );
			return {
				display:         s.display,
				visibility:      s.visibility,
				opacity:         s.opacity,
				position:        s.position,
				overflow:        s.overflow,
				backgroundColor: s.backgroundColor,
				color:           s.color,
				width:           s.width,
				height:          s.height,
			};
		} catch ( _ ) {
			return null;
		}
	}

	function nodeSnapshot( win, node ) {
		if ( ! node ) return { exists: false };
		var text = '';
		try {
			text = ( node.textContent || '' ).replace( /\s+/g, ' ' ).trim();
		} catch ( _ ) {}
		return {
			exists:            true,
			tagName:           node.tagName || '',
			childElementCount: node.children ? node.children.length : 0,
			textLength:        text.length,
			textPreview:       truncate( text, 500 ),
			htmlHead:          truncate( node.innerHTML || '', 1600 ),
			rect:              rectSnapshot( node ),
			style:             styleSnapshot( win, node ),
		};
	}

	/**
	 * Live snapshot of sandboxed app iframes and same-origin iframe DOM.
	 *
	 * @return {array}
	 */
	function appIframesSnapshot() {
		var out = [];
		try {
			var frames = document.querySelectorAll ? document.querySelectorAll( 'iframe.odd-app-frame' ) : [];
			for ( var i = 0; i < frames.length; i++ ) {
				var frame = frames[ i ];
				var mount = frame.closest ? frame.closest( '.odd-app-host' ) : null;
				var slug = slugFromFrame( frame );
				var row = {
					slug:       slug || '',
					iframeSrc:  redactAppServeUrlForReport( frame.getAttribute( 'src' ) || '' ),
					iframeRect: rectSnapshot( frame ),
					iframeStyle: styleSnapshot( window, frame ),
					mountRect:  rectSnapshot( mount ),
					mountStyle: styleSnapshot( window, mount ),
					title:      '',
					rootKids:   null,
					bodyScript: null,
					recentErrors: recentAppIframeErrors( slug ),
				};
				try {
					var loading = mount && mount.querySelector ? mount.querySelector( '.odd-app-host__loading' ) : null;
					if ( loading ) {
						row.loading = {
							text:  truncate( ( loading.textContent || '' ).replace( /\s+/g, ' ' ).trim(), 500 ),
							rect:  rectSnapshot( loading ),
							style: styleSnapshot( window, loading ),
						};
					}
				} catch ( _ ) {}
				try {
					var doc = frame.contentDocument;
					if ( doc ) {
						var frameWin = frame.contentWindow || null;
						row.title = doc.title || '';
						var rt = doc.getElementById( 'root' ) || doc.body;
						if ( rt ) {
							row.rootKids = rt.children ? rt.children.length : 0;
						}
						row.bodyScript = doc.body ? doc.body.querySelectorAll( 'script' ).length : 0;
						row.document = {
							readyState: doc.readyState || '',
							title:      doc.title || '',
							url:        redactAppServeUrlForReport( doc.URL || '' ),
							root:       nodeSnapshot( frameWin, doc.getElementById( 'root' ) ),
							body:       nodeSnapshot( frameWin, doc.body ),
							scripts:    {
								total:      doc.scripts ? doc.scripts.length : 0,
								withSrc:    doc.querySelectorAll ? doc.querySelectorAll( 'script[src]' ).length : 0,
								modules:    doc.querySelectorAll ? doc.querySelectorAll( 'script[type="module"]' ).length : 0,
								importMaps: doc.querySelectorAll ? doc.querySelectorAll( 'script[type="importmap"]' ).length : 0,
							},
							stylesheets: doc.styleSheets ? doc.styleSheets.length : 0,
						};
						try {
							var embedded = frameWin && frameWin.__oddAppDiagnostics && frameWin.__oddAppDiagnostics.events;
							if ( embedded && embedded.length ) {
								row.embeddedDiagnostics = Array.prototype.slice.call( embedded, -8 ).map( function ( evt ) {
									return normalizeAppIframeError( evt );
								} );
							}
						} catch ( _ ) {}
						try {
							if ( frame.contentWindow && frame.contentWindow.location && frame.contentWindow.location.href ) {
								row.frameLocation = redactAppServeUrlForReport( frame.contentWindow.location.href );
							}
						} catch ( _ ) {
							row.frameLocation = '(cross-origin or blocked)';
						}
					}
				} catch ( _ ) {
					row.peekError = 'no document access';
				}
				out.push( row );
			}
		} catch ( _ ) {}
		return out;
	}

	function appIframeSnapshotForSlug( slug ) {
		slug = String( slug || '' );
		var frames = appIframesSnapshot();
		for ( var i = frames.length - 1; i >= 0; i-- ) {
			if ( frames[ i ].slug === slug ) return frames[ i ];
		}
		return null;
	}

	window.addEventListener( 'message', function ( e ) {
		try {
			var data = e && e.data;
			if ( ! data || data.type !== 'odd-app-diagnostic' || ! data.event ) return;
			var row = pushAppIframeError( data.event, e.source );
			record(
				row.type === 'console.warn' ? 'warn' : 'error',
				[ 'odd.app.iframe', row.slug, row.type, row.message ]
			);
		} catch ( _ ) {}
	} );

	function appServeUrlsSnapshot() {
		try {
			var m = window.odd && window.odd.appServeUrls;
			if ( ! m || typeof m !== 'object' ) return {};
			var o = {};
			Object.keys( m ).slice( 0, 40 ).forEach( function ( k ) {
				o[ k ] = redactAppServeUrlForReport( m[ k ] );
			} );
			return o;
		} catch ( _ ) {
			return {};
		}
	}

	function pushAppProbeRun( row ) {
		try {
			appProbeRuns.push( row );
			while ( appProbeRuns.length > APP_PROBES_MAX ) appProbeRuns.shift();
		} catch ( _ ) {}
		return row;
	}

	function appRestUrl( path ) {
		path = String( path || '' ).replace( /^\/+/, '' );
		try {
			var rest = ( window.odd && window.odd.restUrl ) || '';
			var marker = '/odd/v1/';
			var i = rest.indexOf( marker );
			if ( i !== -1 ) {
				return rest.slice( 0, i + marker.length ) + path;
			}
		} catch ( _ ) {}
		return '/wp-json/odd/v1/' + path;
	}

	function appProbeHeaders() {
		var h = {};
		try {
			if ( window.odd && window.odd.restNonce ) h[ 'X-WP-Nonce' ] = window.odd.restNonce;
		} catch ( _ ) {}
		return h;
	}

	function absoluteUrl( ref, base ) {
		try {
			return new URL( ref, base || window.location.href ).href;
		} catch ( _ ) {
			return ref;
		}
	}

	function fetchProbeText( url, opts ) {
		opts = opts || {};
		var started = monotonicNow();
		if ( typeof window.fetch !== 'function' ) {
			return Promise.resolve( {
				ok: false,
				url: redactAppServeUrlForReport( url ),
				status: 0,
				error: 'window.fetch unavailable',
			} );
		}
		return window.fetch( url, {
			cache:       'no-store',
			credentials: 'same-origin',
			headers:     opts.headers || {},
		} ).then( function ( res ) {
			return res.text().then( function ( text ) {
				return {
					ok:          res.ok,
					status:      res.status,
					statusText:  res.statusText || '',
					contentType: res.headers && res.headers.get ? ( res.headers.get( 'content-type' ) || '' ) : '',
					url:         redactAppServeUrlForReport( res.url || url ),
					redirected:  !! res.redirected,
					elapsedMs:   Math.round( monotonicNow() - started ),
					bytes:       text.length,
					head:        text.slice( 0, 1000 ),
					text:        opts.keepText ? text : undefined,
				};
			} );
		}, function ( err ) {
			return {
				ok:        false,
				url:       redactAppServeUrlForReport( url ),
				status:    0,
				elapsedMs: Math.round( monotonicNow() - started ),
				error:     err && err.message ? err.message : String( err ),
			};
		} );
	}

	function parseAppHtmlForProbe( html, baseUrl ) {
		var out = {
			title: '',
			hasRoot: false,
			hasImportmap: false,
			hasFetchBootstrap: html.indexOf( 'odd_apps_iframe_fetch_bootstrap' ) !== -1,
			hasDiagnosticsBootstrap: html.indexOf( 'odd_apps_iframe_diagnostics_bootstrap' ) !== -1,
			moduleScripts: [],
			styles: [],
			imports: {},
		};
		try {
			var doc = new DOMParser().parseFromString( html, 'text/html' );
			out.title = doc.title || '';
			out.hasRoot = !! doc.getElementById( 'root' );
			var maps = doc.querySelectorAll( 'script[type="importmap"]' );
			out.hasImportmap = maps.length > 0;
			if ( maps[0] ) {
				try {
					var decoded = JSON.parse( maps[0].textContent || '{}' );
					if ( decoded && decoded.imports && typeof decoded.imports === 'object' ) {
						Object.keys( decoded.imports ).slice( 0, 12 ).forEach( function ( key ) {
							out.imports[ key ] = absoluteUrl( decoded.imports[ key ], baseUrl );
						} );
					}
				} catch ( err ) {
					out.importmapParseError = err && err.message ? err.message : String( err );
				}
			}
			Array.prototype.slice.call( doc.querySelectorAll( 'script[type="module"][src]' ), 0, 12 )
				.forEach( function ( node ) {
					out.moduleScripts.push( absoluteUrl( node.getAttribute( 'src' ) || '', baseUrl ) );
				} );
			Array.prototype.slice.call( doc.querySelectorAll( 'link[rel="stylesheet"][href]' ), 0, 12 )
				.forEach( function ( node ) {
					out.styles.push( absoluteUrl( node.getAttribute( 'href' ) || '', baseUrl ) );
				} );
		} catch ( err ) {
			out.parseError = err && err.message ? err.message : String( err );
		}
		return out;
	}

	function summarizeAppProbe( probe ) {
		var checks = [];
		function add( id, ok, message ) {
			checks.push( { id: id, status: ok ? 'pass' : 'fail', message: message } );
		}
		add( 'serveUrl', !! probe.serveUrl, probe.serveUrl ? 'Serve URL is present.' : 'Serve URL is missing.' );
		if ( probe.fetches && probe.fetches.iframe ) {
			add( 'iframeFetch', !! probe.fetches.iframe.ok, 'Iframe HTML fetch returned ' + probe.fetches.iframe.status + '.' );
		}
		if ( probe.html ) {
			add( 'htmlImportmap', !! probe.html.hasImportmap, 'HTML contains a runtime import map.' );
			add( 'htmlFetchBootstrap', !! probe.html.hasFetchBootstrap, 'HTML contains the iframe fetch bootstrap.' );
			add( 'htmlDiagnosticsBootstrap', !! probe.html.hasDiagnosticsBootstrap, 'HTML contains the iframe runtime diagnostics bootstrap.' );
			if ( probe.html.moduleScripts.length > 0 ) {
				add( 'htmlModules', true, 'HTML references at least one module script.' );
			}
		}
		if ( probe.fetches && probe.fetches.modules && probe.fetches.modules.length ) {
			add(
				'moduleFetches',
				probe.fetches.modules.every( function ( row ) { return row.ok; } ),
				'Module script fetches completed.'
			);
		}
		if ( probe.fetches && probe.fetches.runtimes && probe.fetches.runtimes.length ) {
			add(
				'runtimeFetches',
				probe.fetches.runtimes.every( function ( row ) { return row.ok; } ),
				'Runtime module fetches completed.'
			);
		}
		if ( probe.serverDiag && probe.serverDiag.summary ) {
			add(
				'serverDiag',
				probe.serverDiag.summary.status !== 'fail',
				'Server diagnostics returned ' + probe.serverDiag.summary.status + '.'
			);
		}
		if ( probe.liveIframe ) {
			add( 'liveIframe', true, 'Live iframe is present in the desktop DOM.' );
			if ( probe.liveIframe.document && probe.liveIframe.document.root && probe.liveIframe.document.root.exists ) {
				var root = probe.liveIframe.document.root;
				add(
					'liveRootRendered',
					root.childElementCount > 0 || root.textLength > 0,
					root.childElementCount > 0 || root.textLength > 0
						? 'Live iframe root has rendered content.'
						: 'Live iframe root is still empty after execution.'
				);
			}
			var hardErrors = ( probe.liveIframe.recentErrors || [] ).filter( function ( row ) {
				return row && row.type !== 'console.warn';
			} );
			if ( hardErrors.length ) {
				add( 'liveIframeErrors', false, 'Live iframe recorded runtime errors.' );
			}
		}
		probe.checks = checks;
		probe.status = checks.some( function ( row ) { return row.status === 'fail'; } ) ? 'fail' : 'pass';
		return probe;
	}

	function probeApp( slug, opts ) {
		opts = opts || {};
		slug = String( slug || '' );
		var serveUrls = appServeUrlsSnapshot();
		var rawMap = ( window.odd && window.odd.appServeUrls ) || {};
		var rawServeUrl = rawMap && typeof rawMap[ slug ] === 'string' ? rawMap[ slug ] : '';
		var probe = {
			at: now(),
			slug: slug,
			reason: opts.reason || 'manual',
			serveUrl: serveUrls[ slug ] || '',
			fetches: {
				iframe: null,
				modules: [],
				runtimes: [],
				serverDiag: null,
			},
		};
		if ( ! slug ) {
			probe.error = 'missing slug';
			return Promise.resolve( pushAppProbeRun( summarizeAppProbe( probe ) ) );
		}
		var diagUrl = appRestUrl( 'apps/diag/' + encodeURIComponent( slug ) + '?client=1' );
		return fetchProbeText( diagUrl, { headers: appProbeHeaders(), keepText: true } )
			.then( function ( serverFetch ) {
				probe.fetches.serverDiag = serverFetch;
				if ( serverFetch.ok && serverFetch.text ) {
					try {
						probe.serverDiag = JSON.parse( serverFetch.text );
					} catch ( err ) {
						probe.serverDiagParseError = err && err.message ? err.message : String( err );
					}
				}
				if ( ! rawServeUrl ) {
					return probe;
				}
				return fetchProbeText( rawServeUrl, { keepText: true } ).then( function ( iframeFetch ) {
					probe.fetches.iframe = iframeFetch;
					if ( ! iframeFetch.ok || ! iframeFetch.text ) {
						return probe;
					}
					probe.html = parseAppHtmlForProbe(
						iframeFetch.text,
						absoluteUrl( rawServeUrl, window.location.href )
					);
					var moduleFetches = probe.html.moduleScripts.slice( 0, 4 ).map( function ( url ) {
						return fetchProbeText( url );
					} );
					var runtimeFetches = Object.keys( probe.html.imports ).slice( 0, 6 ).map( function ( key ) {
						return fetchProbeText( probe.html.imports[ key ] ).then( function ( row ) {
							row.specifier = key;
							return row;
						} );
					} );
					return Promise.all( moduleFetches.concat( runtimeFetches ) ).then( function ( rows ) {
						probe.fetches.modules = rows.slice( 0, moduleFetches.length );
						probe.fetches.runtimes = rows.slice( moduleFetches.length );
						return probe;
					} );
				} );
			} )
			.then( function () {
				probe.liveIframe = appIframeSnapshotForSlug( slug );
				var done = pushAppProbeRun( summarizeAppProbe( probe ) );
				record( done.status === 'pass' ? 'info' : 'warn', [ 'odd.app.probe', done.slug, done.status, done.reason ] );
				return done;
			} );
	}

	function appsDiagnosticsSnapshot() {
		var snap = {
			appsEnabled: typeof window.odd !== 'undefined' && !! window.odd.appsEnabled,
			serveUrls:   appServeUrlsSnapshot(),
			iframes:     appIframesSnapshot(),
			iframeErrors: appIframeErrors.slice(),
			probes:      appProbeRuns.slice(),
		};
		try {
			if ( window.__odd && window.__odd.debug && window.__odd.debug.enabled && typeof window.__odd.debug.apps === 'function' ) {
				snap.debugRegistry = window.__odd.debug.apps();
			}
		} catch ( _ ) {}
		return snap;
	}

	function environment() {
		var c = window.odd || {};
		return {
			oddVersion:   c.version || '',
			pluginUrl:    c.pluginUrl || '',
			restUrl:      c.restUrl ? '(present)' : '(missing)',
			apiVersion:   ( window.__odd && window.__odd.api && window.__odd.api.version ) || '',
			wpHooks:      !! ( window.wp && window.wp.hooks ),
			desktopMode:  !! ( window.wp && window.wp.desktop ),
			desktopLayout: ( window.wp && window.wp.desktop && window.wp.desktop.desktopLayout ) || '',
			desktopHookBridge: !! ( window.__odd && window.__odd.desktopHooks ),
			pixi:         !! window.PIXI,
			userAgent:    ( navigator && navigator.userAgent ) || '',
			viewport:     { w: window.innerWidth, h: window.innerHeight },
			devicePixelRatio: window.devicePixelRatio || 1,
			language:     ( navigator && navigator.language ) || '',
		};
	}

	function lifecyclePhase() {
		try {
			return ( window.__odd.lifecycle && window.__odd.lifecycle.phase && window.__odd.lifecycle.phase() ) || 'unknown';
		} catch ( _ ) { return 'unknown'; }
	}

	function registriesSnapshot() {
		try {
			var r = window.__odd.registries;
			if ( ! r ) return {};
			function countOrEmpty( list ) { return Array.isArray( list ) ? list.length : 0; }
			return {
				scenes:   countOrEmpty( r.readScenes && r.readScenes() ),
				iconSets: countOrEmpty( r.readIconSets && r.readIconSets() ),
				widgets:  countOrEmpty( r.readWidgets && r.readWidgets() ),
				commands: countOrEmpty( r.readCommands && r.readCommands() ),
				apps:     countOrEmpty( r.readApps && r.readApps() ),
			};
		} catch ( _ ) { return {}; }
	}

	function storeSnapshot() {
		try {
			if ( ! window.__odd.store ) return {};
			var snap = window.__odd.store.getState();
			if ( snap && snap.user ) {
				return { user: { wallpaper: snap.user.wallpaper, iconSet: snap.user.iconSet, cursorSet: snap.user.cursorSet } };
			}
			return {};
		} catch ( _ ) { return {}; }
	}

	function systemHealthSnapshot() {
		try {
			var c = window.odd || {};
			return c.systemHealth || {};
		} catch ( _ ) { return {}; }
	}

	function desktopSnapshot() {
		try {
			var api = window.__odd && window.__odd.api;
			return api && typeof api.diagnosticsSnapshot === 'function' ? api.diagnosticsSnapshot() : {};
		} catch ( _ ) { return {}; }
	}

	function collect() {
		return {
			collectedAt:   now(),
			phase:         lifecyclePhase(),
			environment:   environment(),
			registries:    registriesSnapshot(),
			state:         storeSnapshot(),
			systemHealth:  systemHealthSnapshot(),
			desktop:       desktopSnapshot(),
			apps:          appsDiagnosticsSnapshot(),
			metrics:       metricsSnapshot(),
			recentLog:     buffer.slice().reverse().slice( 0, 50 ),
		};
	}

	function collectMarkdown() {
		var p = collect();
		var env = p.environment;
		var lines = [
			'# ODD diagnostics',
			'',
			'_Collected at ' + p.collectedAt + '. No information has been sent anywhere — this was assembled locally and copied to your clipboard. Paste it into a GitHub issue as-is._',
			'',
			'## Environment',
			'- ODD version: `' + env.oddVersion + '`',
			'- API version: `' + env.apiVersion + '`',
			'- Lifecycle phase: `' + p.phase + '`',
			'- WP Desktop Mode present: ' + ( env.desktopMode ? 'yes' : 'no' ),
			'- Desktop layout: `' + env.desktopLayout + '`',
			'- Desktop hook bridge: ' + ( env.desktopHookBridge ? 'yes' : 'no' ),
			'- PIXI global present: ' + ( env.pixi ? 'yes' : 'no' ),
			'- REST URL localized: ' + env.restUrl,
			'- User agent: `' + env.userAgent + '`',
			'- Viewport: `' + env.viewport.w + '×' + env.viewport.h + '` @ `' + env.devicePixelRatio + 'x`',
			'- Language: `' + env.language + '`',
			'',
			'## Registries',
			'- scenes: `' + p.registries.scenes + '` / iconSets: `' + p.registries.iconSets + '` / widgets: `' + p.registries.widgets + '` / commands: `' + p.registries.commands + '` / apps: `' + p.registries.apps + '`',
			'',
			'## State',
			'- wallpaper: `' + ( p.state.user && p.state.user.wallpaper || '' ) + '`',
			'- iconSet: `' + ( p.state.user && p.state.user.iconSet || '' ) + '`',
			'',
			'## System Health',
			'- catalog source: `' + ( p.systemHealth.catalog && p.systemHealth.catalog.source || '' ) + '`',
			'- catalog bundles: `' + ( p.systemHealth.catalog && p.systemHealth.catalog.bundle_count || 0 ) + '`',
			'- catalog last error: `' + ( p.systemHealth.catalog && p.systemHealth.catalog.last_error_message || '' ) + '`',
			'- starter status: `' + ( p.systemHealth.starter && p.systemHealth.starter.status || '' ) + '`',
			'- installed apps: `' + ( p.systemHealth.apps && p.systemHealth.apps.installed || 0 ) + '`',
			'- installed scenes/icon sets/cursor sets/widgets: `' + [
				p.systemHealth.content && p.systemHealth.content.scenes || 0,
				p.systemHealth.content && p.systemHealth.content.iconSets || 0,
				p.systemHealth.content && p.systemHealth.content.cursorSets || 0,
				p.systemHealth.content && p.systemHealth.content.widgets || 0,
			].join( '/' ) + '`',
			'- active cursor set: `' + ( p.systemHealth.cursors && p.systemHealth.cursors.active || ( p.state.user && p.state.user.cursorSet ) || '' ) + '`',
			'- cursor stylesheet: `' + ( p.systemHealth.cursors && p.systemHealth.cursors.stylesheet ? '(present)' : '(missing)' ) + '`',
			'- Desktop Mode version: `' + ( p.systemHealth.desktopMode && p.systemHealth.desktopMode.version || '' ) + '`',
			'- Desktop Mode baseline met: `' + ( p.systemHealth.desktopMode && p.systemHealth.desktopMode.baseline ? 'yes' : 'no' ) + '`',
			'- Desktop Mode settings tabs/system tiles/palettes: `' + [
				p.desktop.settingsTabs && p.desktop.settingsTabs.length || 0,
				p.desktop.systemTiles && p.desktop.systemTiles.length || 0,
				p.desktop.palettes && p.desktop.palettes.length || 0,
			].join( '/' ) + '`',
			'',
			'## Apps (ODD Shop / odd-app iframes)',
			'- apps feature flag (localized): `' + ( p.apps && p.apps.appsEnabled ? 'yes' : 'no' ) + '`',
			'- open app iframes: `' + ( p.apps && p.apps.iframes && p.apps.iframes.length || 0 ) + '`',
			'- recent odd.iframe-error events: `' + ( p.apps && p.apps.iframeErrors && p.apps.iframeErrors.length || 0 ) + '`',
			'- active app probes: `' + ( p.apps && p.apps.probes && p.apps.probes.length || 0 ) + '`',
			'```json',
			JSON.stringify( p.apps || {}, null, 2 ),
			'```',
			'',
			'## Local Metrics',
			'- timings captured: `' + ( p.metrics.timings && p.metrics.timings.length || 0 ) + '`',
			'- counters: `' + Object.keys( p.metrics.counters || {} ).map( function ( key ) { return key + '=' + p.metrics.counters[ key ]; } ).join( ', ' ) + '`',
			'',
			'## Recent log (' + p.recentLog.length + ' entries, newest first)',
			'```',
		];
		for ( var i = 0; i < p.recentLog.length; i++ ) {
			var e = p.recentLog[ i ];
			lines.push( '[' + e.at + '] [' + e.level + '] ' + e.message );
		}
		lines.push( '```' );
		return lines.join( '\n' );
	}

	function copy() {
		var md = collectMarkdown();
		if ( navigator && navigator.clipboard && navigator.clipboard.writeText ) {
			return navigator.clipboard.writeText( md ).then( function () { return true; }, function () { return fallbackCopy( md ); } );
		}
		return Promise.resolve( fallbackCopy( md ) );
	}

	function fallbackCopy( text ) {
		try {
			var ta = document.createElement( 'textarea' );
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			document.body.appendChild( ta );
			ta.select();
			var ok = document.execCommand && document.execCommand( 'copy' );
			document.body.removeChild( ta );
			return !! ok;
		} catch ( _ ) { return false; }
	}

	window.__odd.diagnostics = {
		collect:         collect,
		collectMarkdown: collectMarkdown,
		copy:            copy,
		count:           count,
		metrics:         metricsSnapshot,
		probeApp:        probeApp,
		appProbes:       function () { return appProbeRuns.slice(); },
		recordAppIframeError: pushAppIframeError,
		record:          record,
		recent:          function () { return buffer.slice(); },
		time:            time,
		timing:          timing,
		appsSnapshot:    appsDiagnosticsSnapshot,
		appIframes:      appIframesSnapshot,
	};
} )();
