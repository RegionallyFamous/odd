/**
 * ODD wallpaper runtime for WP Desktop Mode
 * ---------------------------------------------------------------
 * One Pixi app, swap scenes in place. The scene catalog arrives
 * through `wp_localize_script('odd-api', 'odd', … )`; the engine
 * lazy-loads each scene's JS the first time it's picked.
 *
 * v1 runtime:
 *   - Scene / audio / drifters modules live under `src/wallpaper/`,
 *     so the loaders prefix paths with `src/wallpaper/` (matching
 *     the on-disk + zip layout).
 *   - The native ODD Shop window is the single picker surface.
 *   - Teardown is explicit and idempotent so Desktop Mode swaps,
 *     scene changes, and page shutdowns release the Pixi app.
 *
 * Scenes get a small, stable contract:
 *   env = { app, PIXI, ctx, helpers, dt, parallax, reducedMotion,
 *           tod, todPhase, season, audio, perfTier }
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	window.__odd = window.__odd || {};
	window.__odd.scenes = window.__odd.scenes || {};

	// Foundation module handles. All six install on window.__odd before
	// this script's <script> tag emits (see odd/includes/enqueue.php for
	// the dependency chain). Each of them falls back gracefully when a
	// consumer runs outside the full ODD context (tests, partial boots).
	var _events    = window.__odd.events    || null;
	var _lifecycle = window.__odd.lifecycle || null;
	var _safeCall  = window.__odd.safeCall  || function ( fn ) { try { return fn(); } catch ( e ) {} };

	function emitBus( name, payload ) {
		if ( _events ) { try { _events.emit( name, payload ); } catch ( e ) {} }
	}

	// Wrap an impl method in safeCall without losing its `this`. Each
	// scene's setup/tick/etc. runs as `impl.method(state, env)` so a
	// throw there would have crashed the entire Pixi app pre-Cut 1.
	function safeImpl( impl, method, source, args ) {
		if ( ! impl || typeof impl[ method ] !== 'function' ) return undefined;
		try {
			return impl[ method ].apply( impl, args || [] );
		} catch ( err ) {
			emitBus( 'odd.error', {
				source:   source,
				err:      err,
				severity: 'error',
				message:  err && err.message,
				stack:    err && err.stack,
			} );
			if ( window.console ) { try { window.console.error( '[ODD ' + source + ']', err ); } catch ( e2 ) {} }
			return undefined;
		}
	}

	// ============================================================ //
	// Shared helpers — exposed on env.helpers for scenes.
	// ============================================================ //

	var rand   = function ( a, b ) { return a + Math.random() * ( b - a ); };
	var irand  = function ( a, b ) { return ( a + Math.random() * ( b - a ) ) | 0; };
	var choose = function ( arr ) { return arr[ ( Math.random() * arr.length ) | 0 ]; };
	var clamp  = function ( v, a, b ) { return v < a ? a : v > b ? b : v; };
	var tau    = Math.PI * 2;

	function lerpColor( a, b, t ) {
		var ar = ( a >> 16 ) & 0xff, ag = ( a >> 8 ) & 0xff, ab = a & 0xff;
		var br = ( b >> 16 ) & 0xff, bg = ( b >> 8 ) & 0xff, bb = b & 0xff;
		return ( ( ( ar + ( br - ar ) * t ) | 0 ) << 16 )
			| ( ( ( ag + ( bg - ag ) * t ) | 0 ) << 8 )
			| ( ( ab + ( bb - ab ) * t ) | 0 );
	}

	function paintVGradient( g, w, h, c0, c1, steps ) {
		steps = steps || 24;
		g.clear();
		for ( var i = 0; i < steps; i++ ) {
			var t = i / ( steps - 1 );
			g.rect( 0, ( i * h ) / steps, w, h / steps + 1 ).fill( lerpColor( c0, c1, t ) );
		}
	}

	function isPlaygroundWallpaperShell() {
		try {
			var h = window.location && window.location.hostname ? String( window.location.hostname ).toLowerCase() : '';
			return 'playground.wordpress.net' === h
				|| ( h.length > 24 && /\.playground\.wordpress\.net$/.test( h ) );
		} catch ( _ ) {
			return false;
		}
	}

	function makeBloomLayer( PIXI, strength ) {
		var c = new PIXI.Container();
		c.blendMode = 'add';
		// Pixi v8 blur filters can throw internally during filter passes when
		// FilterSystem textures are unavailable — common during WebGL churn in
		// WordPress Playground iframes. Bloom is purely decorative; omit it
		// there so wallpapers stay alive.
		if ( isPlaygroundWallpaperShell() ) {
			return c;
		}
		var amt = typeof strength === 'number' ? strength : 8;
		try {
			c.filters = [ new PIXI.BlurFilter( { strength: amt, quality: 2 } ) ];
		} catch ( _bf ) {}
		return c;
	}

	function computeTod( date ) {
		date = date || new Date();
		var h = date.getHours() + date.getMinutes() / 60;
		var tod, phase;
		if ( h >= 5 && h < 7 )        { tod = 'dawn';  phase = ( h - 5  ) / 2;  }
		else if ( h >= 7 && h < 17 )  { tod = 'day';   phase = ( h - 7  ) / 10; }
		else if ( h >= 17 && h < 20 ) { tod = 'dusk';  phase = ( h - 17 ) / 3;  }
		else                          { tod = 'night'; phase = h < 5 ? ( h + 4 ) / 9 : ( h - 20 ) / 9; }
		return { tod: tod, phase: phase };
	}

	function computeSeason( date ) {
		date = date || new Date();
		var m = date.getMonth() + 1, d = date.getDate();
		if ( m === 10 && d >= 25 ) return 'halloween';
		if ( ( m === 12 && d >= 28 ) || ( m === 1 && d <= 2 ) ) return 'newYear';
		if ( m >= 3 && m <= 5  ) return 'spring';
		if ( m >= 6 && m <= 8  ) return 'summer';
		if ( m >= 9 && m <= 11 ) return 'autumn';
		return 'winter';
	}

	window.__odd.helpers = {
		rand: rand, irand: irand, choose: choose, clamp: clamp, tau: tau,
		lerpColor: lerpColor, paintVGradient: paintVGradient,
		makeBloomLayer: makeBloomLayer,
		computeTod: computeTod, computeSeason: computeSeason,
	};

	// ============================================================ //
	// Hydrated config.
	// ============================================================ //

	var cfg        = window.odd || {};
	var PLUGIN_URL = cfg.pluginUrl || '';
	var VERSION    = cfg.version   || '0';
	var VER_QS     = VERSION ? '?v=' + encodeURIComponent( VERSION ) : '';
	var SCENES     = Array.isArray( cfg.scenes ) ? cfg.scenes.slice() : [];

	// Always-available built-in fallback. Shown when no scene bundle is
	// installed yet (e.g. immediately after plugin activation while
	// the starter pack is still downloading) so the desktop renders a
	// finished surface instead of a blank Pixi canvas. Also used by
	// the engine as the safe default when `prefs.scene` points at a
	// scene that hasn't been installed (removed bundle, fresh user).
	var PENDING_SLUG = 'odd-pending';
	var PENDING_DESC = {
		slug:          PENDING_SLUG,
		label:         'Setting up ODD…',
		category:     'ODD',
		tags:          [ 'pending', 'builtin' ],
		fallbackColor: '#10121a',
		installed:     true,
	};
	if ( ! SCENES.some( function ( s ) { return s && s.slug === PENDING_SLUG; } ) ) {
		SCENES.push( PENDING_DESC );
	}

	var SCENE_MAP  = {};
	for ( var si = 0; si < SCENES.length; si++ ) {
		SCENE_MAP[ SCENES[ si ].slug ] = SCENES[ si ];
	}

	/**
	 * Merge scene descriptors discovered after page load. The Shop
	 * updates `window.odd.sceneMap` when a bundle installs without
	 * reloading; the store/registry can also grow. The wallpaper engine
	 * snapshots `cfg.scenes` once — fold those in so `swap` resolves.
	 */
	function mergeSceneDescriptor( slug ) {
		if ( ! slug ) return null;
		if ( SCENE_MAP[ slug ] ) return SCENE_MAP[ slug ];
		var om = window.odd && window.odd.sceneMap && window.odd.sceneMap[ slug ];
		if ( om && typeof om === 'object' ) {
			SCENE_MAP[ slug ] = om;
			return om;
		}
		try {
			if ( window.__odd.registries && typeof window.__odd.registries.findScene === 'function' ) {
				var r = window.__odd.registries.findScene( slug );
				if ( r && typeof r === 'object' ) {
					SCENE_MAP[ slug ] = r;
					return r;
				}
			}
		} catch ( _reg ) {}
		return null;
	}

	// Self-register the pending scene impl. A thin animated gradient:
	// two soft radial blobs drifting over a dark midnight field. No
	// assets, no network — works on a fresh install with zero bundles.
	window.__odd.scenes[ PENDING_SLUG ] = {
		setup: function ( env ) {
			var PIXI = env.PIXI;
			var app  = env.app;
			var base = new PIXI.Graphics();
			base.rect( 0, 0, app.renderer.width, app.renderer.height ).fill( 0x10121a );
			app.stage.addChild( base );
			var bloom = env.helpers.makeBloomLayer( PIXI, 18 );
			app.stage.addChild( bloom );
			function blob( color ) {
				var g = new PIXI.Graphics();
				g.circle( 0, 0, 320 ).fill( { color: color, alpha: 0.55 } );
				bloom.addChild( g );
				return g;
			}
			var b1 = blob( 0x8a5cff );
			var b2 = blob( 0xffb000 );
			var t  = 0;
			return { base: base, b1: b1, b2: b2, t: t };
		},
		tick: function ( state, env ) {
			state.t += env.dt * 0.008;
			var w = env.app.renderer.width;
			var h = env.app.renderer.height;
			state.b1.position.set(
				w * 0.5 + Math.sin( state.t ) * w * 0.25,
				h * 0.5 + Math.cos( state.t * 0.7 ) * h * 0.2
			);
			state.b2.position.set(
				w * 0.5 + Math.cos( state.t * 0.6 ) * w * 0.3,
				h * 0.5 + Math.sin( state.t * 0.9 ) * h * 0.25
			);
		},
		stillFrame: function ( state, env ) {
			var w = env.app.renderer.width;
			var h = env.app.renderer.height;
			state.b1.position.set( w * 0.3, h * 0.4 );
			state.b2.position.set( w * 0.7, h * 0.6 );
		},
		onResize: function ( state, env ) {
			state.base.clear();
			state.base.rect( 0, 0, env.app.renderer.width, env.app.renderer.height ).fill( 0x10121a );
		},
	};

	function assetUrl( rel ) {
		return PLUGIN_URL + '/' + rel.replace( /^\/+/, '' ) + VER_QS;
	}

	function defaultScene() {
		// Prefer any real installed scene over the builtin fallback.
		for ( var di = 0; di < SCENES.length; di++ ) {
			var s = SCENES[ di ];
			if ( s && s.slug && s.slug !== PENDING_SLUG ) {
				return s.slug;
			}
		}
		return PENDING_SLUG;
	}

	function previewBg( slug ) {
		var s = mergeSceneDescriptor( slug ) || {};
		var url = s.previewUrl || '';
		if ( ! url ) return s.fallbackColor || '#111';
		return "url(\"" + url + "\") center/cover no-repeat, " + ( s.fallbackColor || '#111' );
	}

	window.__odd.config = {
		pluginUrl: PLUGIN_URL,
		version:   VERSION,
		assetUrl:  assetUrl,
		previewBg: previewBg,
		scenes:    SCENES,
		sceneMap:  SCENE_MAP,
	};

	function desktopStateDefaults() {
		return {
			revision: 0,
			supports: { windows: false, wallpaperSurfaces: false, activity: false },
			document: { hidden: typeof document !== 'undefined' ? !! document.hidden : false },
			wallpaper: { visible: true, state: 'visible', id: '' },
			windows: { all: [], focusedId: '', count: 0 },
			surfaces: { all: [], count: 0 },
			activity: { window: 0, dock: 0, presence: 0 },
			updatedAt: 0,
		};
	}

	function desktopStateRef() {
		window.__odd.desktopState = window.__odd.desktopState || desktopStateDefaults();
		return window.__odd.desktopState;
	}

	// ============================================================ //
	// Lazy loaders.
	//
	// Scene files, the audio module, and any future companion JS
	// all live under `src/wallpaper/` on disk (matches the build-zip
	// layout). Loader URLs MUST match or the engine 404s and the
	// wallpaper renders as a static JPG.
	// ============================================================ //

	var loading = {};
	function loadScript( url ) {
		if ( loading[ url ] ) return loading[ url ];
		loading[ url ] = new Promise( function ( resolve, reject ) {
			var s = document.createElement( 'script' );
			s.src = url;
			s.async = true;
			s.onload = function () { resolve(); };
			s.onerror = function () {
				delete loading[ url ];
				reject( new Error( 'Failed to load ' + url ) );
			};
			document.head.appendChild( s );
		} );
		return loading[ url ];
	}

	function loadScene( slug ) {
		if ( window.__odd.scenes[ slug ] ) return Promise.resolve();
		var desc = mergeSceneDescriptor( slug ) || {};
		// Installed scenes are enqueued via wp_enqueue_script with a
		// dependency on `odd`, so by the time we get here their
		// scene.js has already run and self-registered. If it
		// somehow hasn't, do NOT fall back to the built-in scenes
		// path — that 404 would be misleading.
		if ( desc.installed ) {
			throw new Error( 'Installed scene did not self-register: ' + slug );
		}
		return loadScript( assetUrl( 'src/wallpaper/scenes/' + slug + '.js' ) ).then( function () {
			if ( ! window.__odd.scenes[ slug ] ) {
				throw new Error( 'Scene did not self-register: ' + slug );
			}
		} );
	}

	window.__odd.mountSceneInto = function ( container, slug, opts ) {
		opts = opts || {};
		if ( ! container || ! slug ) {
			return Promise.reject( new Error( 'ODD: mountSceneInto requires a container and scene slug.' ) );
		}
		if ( ! window.PIXI ) {
			return Promise.reject( new Error( 'ODD: PIXI global missing.' ) );
		}
		return loadScene( slug ).then( async function () {
			var PIXI = window.PIXI;
			var impl = window.__odd.scenes[ slug ];
			if ( ! impl || typeof impl.setup !== 'function' ) {
				throw new Error( 'Scene missing setup: ' + slug );
			}
			var app = new PIXI.Application();
			var env = null;
			var parallaxTarget = { x: 0, y: 0 };
			var pointerWired = false;
			var state = null;
			var tick = null;
			var destroyed = false;
			function onPointerMove( ev ) {
				var r = container.getBoundingClientRect();
				if ( ! r.width || ! r.height ) return;
				parallaxTarget.x = ( ( ev.clientX - r.left ) / r.width - 0.5 ) * 2;
				parallaxTarget.y = ( ( ev.clientY - r.top ) / r.height - 0.5 ) * 2;
			}
			function destroy() {
				if ( destroyed ) return;
				destroyed = true;
				container.removeEventListener( 'pointermove', onPointerMove );
				if ( tick && app.ticker ) {
					try { app.ticker.remove( tick ); } catch ( e ) {}
				}
				if ( state && env && impl.cleanup ) safeImpl( impl, 'cleanup', 'hero.cleanup:' + slug, [ state, env ] );
				try { app.destroy( true, { children: true, texture: true } ); } catch ( e ) {}
			}
			try {
				await app.init( {
					resizeTo:        container,
					backgroundAlpha: 0,
					antialias:       ! opts.lowPower,
					resolution:      opts.resolution || 1,
					autoDensity:     true,
				} );
				if ( opts.maxFPS && app.ticker ) {
					app.ticker.maxFPS = opts.maxFPS;
				}
				container.appendChild( app.canvas );
				app.canvas.style.position = 'absolute';
				app.canvas.style.inset = '0';
				app.canvas.style.width = '100%';
				app.canvas.style.height = '100%';

				var initTod = computeTod();
				env = {
					app: app, PIXI: PIXI, ctx: { scene: slug, heroMode: !! opts.heroMode, prefersReducedMotion: !! opts.reducedMotion },
					helpers: window.__odd.helpers,
					parallax: { x: 0, y: 0 },
					reducedMotion: !! opts.reducedMotion,
					tod:      initTod.tod,
					todPhase: initTod.phase,
					season:   computeSeason(),
					audio:    { level: 0, bass: 0, mid: 0, high: 0, enabled: false },
					desktop:  opts.desktopStub || desktopStateDefaults(),
					perfTier: opts.lowPower ? 'normal' : 'high',
					dt:       1,
				};
				container.addEventListener( 'pointermove', onPointerMove, { passive: true } );
				pointerWired = true;

				state = await Promise.resolve( safeImpl( impl, 'setup', 'hero.setup:' + slug, [ env ] ) ) || {};
				if ( impl.onResize ) safeImpl( impl, 'onResize', 'hero.resize:' + slug, [ state, env ] );
				if ( env.reducedMotion && impl.stillFrame ) {
					safeImpl( impl, 'stillFrame', 'hero.stillFrame:' + slug, [ state, env ] );
				} else if ( impl.tick ) {
					tick = function ( ticker ) {
						env.dt = Math.min( 2.5, ticker.deltaTime );
						env.parallax.x += ( parallaxTarget.x - env.parallax.x ) * 0.12;
						env.parallax.y += ( parallaxTarget.y - env.parallax.y ) * 0.12;
						safeImpl( impl, 'tick', 'hero.tick:' + slug, [ state, env ] );
					};
					app.ticker.add( tick );
				}
				return { app: app, env: env, state: state, destroy: destroy };
			} catch ( err ) {
				if ( pointerWired || app ) destroy();
				throw err;
			}
		} );
	};

	function loadAudio() {
		if ( window.__odd.audio && window.__odd.audio._installed ) {
			return Promise.resolve( window.__odd.audio );
		}
		return loadScript( assetUrl( 'src/wallpaper/audio.js' ) ).then( function () {
			return window.__odd.audio;
		} );
	}

	// ============================================================ //
	// Prefs — REST round trip + localStorage offline mirror.
	// ============================================================ //

	var LS_KEY = 'odd:prefs:v1';
	function coerceShuffle( raw ) {
		raw = raw || {};
		var mins = parseInt( raw.minutes, 10 );
		if ( ! isFinite( mins ) || mins < 1 ) mins = 15;
		if ( mins > 240 ) mins = 240;
		return { enabled: !! raw.enabled, minutes: mins };
	}
	var prefsState = {
		scene:         cfg.scene || cfg.wallpaper || defaultScene(),
		favorites:     Array.isArray( cfg.favorites ) ? cfg.favorites.slice() : [],
		recents:       Array.isArray( cfg.recents )   ? cfg.recents.slice()   : [],
		shuffle:       coerceShuffle( cfg.shuffle ),
		audioReactive: !! cfg.audioReactive,
	};
	try {
		var lsRaw = window.localStorage && window.localStorage.getItem( LS_KEY );
		if ( lsRaw ) {
			var ls = JSON.parse( lsRaw );
			if ( ls && typeof ls === 'object' ) {
				if ( ! cfg.scene && typeof ls.scene === 'string' && mergeSceneDescriptor( ls.scene ) ) prefsState.scene = ls.scene;
				if ( ( ! Array.isArray( cfg.favorites ) || ! cfg.favorites.length ) && Array.isArray( ls.favorites ) ) prefsState.favorites = ls.favorites.filter( function ( s ) { return !! mergeSceneDescriptor( s ); } );
				if ( ( ! Array.isArray( cfg.recents ) || ! cfg.recents.length ) && Array.isArray( ls.recents ) ) prefsState.recents = ls.recents.filter( function ( s ) { return !! mergeSceneDescriptor( s ); } );
				if ( cfg.shuffle == null && ls.shuffle ) prefsState.shuffle = coerceShuffle( ls.shuffle );
				if ( cfg.audioReactive == null && typeof ls.audioReactive === 'boolean' ) prefsState.audioReactive = ls.audioReactive;
			}
		}
	} catch ( e ) { /* ignore */ }

	function mirrorToLS() {
		try {
			window.localStorage && window.localStorage.setItem( LS_KEY, JSON.stringify( prefsState ) );
		} catch ( e ) { /* quota / disabled — ignore */ }
	}

	function savePrefs( patch ) {
		Object.keys( patch ).forEach( function ( k ) { prefsState[ k ] = patch[ k ]; } );
		mirrorToLS();
		if ( ! cfg.restUrl ) return Promise.resolve( prefsState );
		// Same path as the Shop + `api.setScene`: `api.savePrefs` notifies
		// Desktop Mode to select the `odd` wallpaper engine (`updateOsSettings`)
		// when the patch touches `wallpaper` / `scene` — raw fetch skipped that
		// (e.g. shuffle timer) so the host could stay on the built-in gradient.
		var api = window.__odd && window.__odd.api;
		if ( api && typeof api.savePrefs === 'function' ) {
			return new Promise( function ( resolve ) {
				api.savePrefs( patch, function ( data ) {
					resolve( data && typeof data === 'object' ? data : prefsState );
				} );
			} ).catch( function ( err ) {
				if ( window.console ) window.console.warn( 'ODD: prefs save deferred to localStorage', err );
				return prefsState;
			} );
		}
		return fetch( cfg.restUrl, {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce':   cfg.restNonce || '',
			},
			body: JSON.stringify( patch ),
		} ).then( function ( r ) {
			if ( ! r.ok ) throw new Error( 'prefs save failed: ' + r.status );
			return r.json();
		} ).catch( function ( err ) {
			if ( window.console ) window.console.warn( 'ODD: prefs save deferred to localStorage', err );
			return prefsState;
		} );
	}

	function recordRecent( slug ) {
		var next = [ slug ].concat( prefsState.recents.filter( function ( s ) { return s !== slug; } ) );
		if ( next.length > 12 ) next = next.slice( 0, 12 );
		return savePrefs( { recents: next } );
	}

	window.__odd.prefs = {
		get: function () { return prefsState; },
		save: savePrefs,
		recordRecent: recordRecent,
	};

	// ------------------------------------------------------------ //
		// Live scene picks (`odd.pickScene`) can fire from the Shop while
		// `mountODD` is still awaiting Pixi (`app.init`). Bridge early:
		// queue the slug until the mount assigns a real `swap`.
	// ------------------------------------------------------------ //

	var wallpaperPickSink  = null;
	var wallpaperPickQueue = null;
	var wallpaperPickBridged = false;

	function exposeWallpaperPickSink( sink ) {
		wallpaperPickSink = sink || null;
		if ( wallpaperPickSink && wallpaperPickQueue != null ) {
			var queued = wallpaperPickQueue;
			wallpaperPickQueue = null;
			try { wallpaperPickSink( queued ); } catch ( _pickFlush ) {}
		}
	}

	function routeWallpaperScenePick( slug ) {
		if ( wallpaperPickSink ) {
			try { wallpaperPickSink( slug ); } catch ( _pickRoute ) {}
		} else {
			wallpaperPickQueue = slug;
		}
	}

	function installWallpaperPickBridge() {
		if ( wallpaperPickBridged ) return;
		var hooks = window.wp && window.wp.hooks;
		if ( ! hooks || typeof hooks.addAction !== 'function' ) return;
		wallpaperPickBridged = true;
		try { hooks.addAction( 'odd.pickScene', 'odd.wallpaper-bridge', routeWallpaperScenePick ); } catch ( _a ) {}
	}

	function desktopHookName( key, fallback ) {
		var d = window.wp && window.wp.desktop;
		return key && d && d.HOOKS && d.HOOKS[ key ] ? d.HOOKS[ key ] : fallback;
	}

	// ------------------------------------------------------------ //
	// Wallpaper visibility toggles Pixi's ticker via
	// `desktop-mode.wallpaper.visibility`; the host may emit that
	// before Pixi finishes `app.init`, so subscribe from `boot` and
	// queue the latest payload until `mountODD` wires `onVis`.
	// ------------------------------------------------------------ //

	var wallpaperVisSink   = null;
	var wallpaperVisQueue  = null;
	var wallpaperVisBridged = false;
	var wallpaperTeardownBridged = false;
	var lifecycleTeardownBridged = false;

	function exposeWallpaperVisSink( sink ) {
		wallpaperVisSink = sink || null;
		if ( wallpaperVisSink && wallpaperVisQueue != null ) {
			var q = wallpaperVisQueue;
			wallpaperVisQueue = null;
			try { wallpaperVisSink( q ); } catch ( _visFlush ) {}
		}
	}

	function routeWallpaperVisibility( detail ) {
		if ( wallpaperVisSink ) {
			try { wallpaperVisSink( detail ); } catch ( _visRoute ) {}
		} else {
			wallpaperVisQueue = detail;
		}
	}

	function installWallpaperVisibilityBridge() {
		if ( wallpaperVisBridged ) return;
		var hooks = window.wp && window.wp.hooks;
		if ( ! hooks || typeof hooks.addAction !== 'function' ) return;
		wallpaperVisBridged = true;
		try {
			hooks.addAction( desktopHookName( 'WALLPAPER_VISIBILITY', 'desktop-mode.wallpaper.visibility' ), 'odd.wallpaper-vis-bridge', routeWallpaperVisibility );
		} catch ( _visBridge ) {}
	}

	function installWallpaperTeardownBridge() {
		if ( wallpaperTeardownBridged ) return;
		var hooks = window.wp && window.wp.hooks;
		if ( ! hooks || typeof hooks.addAction !== 'function' ) return;
		wallpaperTeardownBridged = true;
		try {
			hooks.addAction( desktopHookName( 'WALLPAPER_UNMOUNTING', 'desktop-mode.wallpaper.unmounting' ), 'odd.wallpaper-teardown-bridge', function ( payload ) {
				if ( ! payload || payload.id !== 'odd' ) return;
				var runtime = window.__odd && window.__odd.wallpaperRuntime;
				if ( runtime && typeof runtime.teardownActive === 'function' ) {
					runtime.teardownActive( 'desktop-mode.wallpaper.unmounting' );
				}
			} );
		} catch ( _teardownBridge ) {}
	}

	function installLifecycleTeardownBridge() {
		if ( lifecycleTeardownBridged ) return;
		var evt = window.__odd && window.__odd.events;
		if ( ! evt || typeof evt.once !== 'function' ) return;
		lifecycleTeardownBridged = true;
		evt.once( 'odd.teardown', function () {
			var runtime = window.__odd && window.__odd.wallpaperRuntime;
			if ( runtime && typeof runtime.teardownActive === 'function' ) {
				runtime.teardownActive( 'odd.teardown' );
			}
			if ( window.__odd && window.__odd.audio && typeof window.__odd.audio.disable === 'function' ) {
				try { window.__odd.audio.disable(); } catch ( e ) {}
			}
		} );
	}

	// ============================================================ //
	// Mount — one Pixi app, swap scenes in place.
	// ============================================================ //

	function mountODD( container, ctx ) {
		var disposed = false;
		var readyTeardown = null;
		var earlyTeardown = function () {};
		var bootApp = null;
		var bootAppDestroyed = false;
		var mountToken = {};

		function destroyBootApp() {
			if ( bootApp && ! bootAppDestroyed ) {
				bootAppDestroyed = true;
				try { bootApp.destroy( true, { children: true, texture: true } ); } catch ( e ) {}
			}
		}

		function clearRuntimeHandle() {
			var runtime = window.__odd && window.__odd.wallpaperRuntime;
			if ( runtime && runtime.active && runtime.active.token === mountToken ) {
				runtime.active = null;
			}
		}

		function teardown( reason ) {
			if ( disposed ) return;
			disposed = true;
			if ( readyTeardown ) {
				try { readyTeardown( reason || 'teardown' ); } catch ( e ) {}
			} else {
				try { earlyTeardown( reason || 'teardown' ); } catch ( e2 ) {}
			}
			clearRuntimeHandle();
		}

		window.__odd = window.__odd || {};
		window.__odd.wallpaperRuntime = window.__odd.wallpaperRuntime || {};
		window.__odd.wallpaperRuntime.active = {
			id:       'odd',
			token:    mountToken,
			teardown: teardown,
		};
		window.__odd.wallpaperRuntime.teardownActive = function ( reason ) {
			var active = window.__odd && window.__odd.wallpaperRuntime && window.__odd.wallpaperRuntime.active;
			if ( active && typeof active.teardown === 'function' ) {
				active.teardown( reason || 'runtime' );
			}
		};

		(async function () {
			// Instant first-paint backdrop (plain <div>), so even
			// before Pixi boots the user sees the painted wallpaper.
			var firstPaint = document.createElement( 'div' );
			firstPaint.setAttribute( 'data-odd-firstpaint', '' );
			firstPaint.style.cssText =
				'position:absolute;inset:0;background-size:cover;' +
				'background-position:center;background-repeat:no-repeat;' +
				'transition:opacity .4s ease;opacity:1;pointer-events:none;';
			container.appendChild( firstPaint );
			earlyTeardown = function () {
				if ( firstPaint.parentNode ) firstPaint.parentNode.removeChild( firstPaint );
				destroyBootApp();
			};
			function setFirstPaint( slug ) {
				var s = mergeSceneDescriptor( slug ) || {};
				if ( slug === PENDING_SLUG || ! s.wallpaperUrl ) {
					// Pending fallback + edge cases (no installed bundle
					// yet) have no static backdrop — fade the Pixi canvas
					// in over the scene's fallbackColor.
					firstPaint.style.backgroundImage = '';
					firstPaint.style.backgroundColor = s.fallbackColor || '#10121a';
					return;
				}
				firstPaint.style.backgroundImage = 'url("' + s.wallpaperUrl + '")';
			}

			if ( ! window.PIXI ) {
				if ( firstPaint.parentNode ) firstPaint.parentNode.removeChild( firstPaint );
				throw new Error( 'ODD: PIXI global missing — the WP Desktop Mode shell should have provided it.' );
			}

			var PIXI = window.PIXI;
			var app  = new PIXI.Application();
			bootApp = app;
			await app.init( {
				resizeTo:        container,
				backgroundAlpha: 0,
				antialias:       true,
				resolution:      Math.min( 2, window.devicePixelRatio || 1 ),
				autoDensity:     true,
			} );
			if ( disposed ) {
				if ( firstPaint.parentNode ) firstPaint.parentNode.removeChild( firstPaint );
				destroyBootApp();
				return;
			}
			container.appendChild( app.canvas );
			app.canvas.style.position = 'absolute';
			app.canvas.style.inset = '0';
			app.canvas.style.width = '100%';
			app.canvas.style.height = '100%';

			// Polite ARIA live region so assistive tech hears scene swaps.
			var live = document.createElement( 'div' );
			live.setAttribute( 'data-odd-live', '' );
			live.setAttribute( 'role', 'status' );
			live.setAttribute( 'aria-live', 'polite' );
			live.setAttribute( 'aria-atomic', 'true' );
			live.style.cssText =
				'position:absolute;width:1px;height:1px;margin:-1px;' +
				'padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);' +
				'clip-path:inset(50%);white-space:nowrap;';
			document.body.appendChild( live );
			function announce( slug ) {
				var s = mergeSceneDescriptor( slug );
				if ( ! s ) return;
				live.textContent = 'Now playing: ' + ( s.label || slug );
			}

			var initTod = computeTod();
			var env = {
				app: app, PIXI: PIXI, ctx: ctx,
				helpers: window.__odd.helpers,
				parallax: { x: 0, y: 0 },
				reducedMotion: !! ctx.prefersReducedMotion,
				tod:      initTod.tod,
				todPhase: initTod.phase,
				season:   computeSeason(),
				audio:    { level: 0, bass: 0, mid: 0, high: 0, enabled: false },
				desktop:  desktopStateRef(),
				perfTier: 'high',
				dt:       1,
			};

			var parallaxTarget = { x: 0, y: 0 };
			function onPointerMove( ev ) {
				var r = container.getBoundingClientRect();
				if ( ! r.width || ! r.height ) return;
				parallaxTarget.x = ( ( ev.clientX - r.left ) / r.width  - 0.5 ) * 2;
				parallaxTarget.y = ( ( ev.clientY - r.top )  / r.height - 0.5 ) * 2;
			}
			window.addEventListener( 'pointermove', onPointerMove, { passive: true } );

			var currentSlug  = null;
			var currentImpl  = null;
			var currentState = null;
			var currentTick  = null;
			var swapping     = false;

			// Latest-wins coalescing for hover previews fired faster
			// than scenes can load.
			var pendingSlug = null;
			function drainPending() {
				if ( pendingSlug && pendingSlug !== currentSlug ) {
					var next = pendingSlug;
					pendingSlug = null;
					swap( next );
				} else {
					pendingSlug = null;
				}
			}

			// Rolling frame-time buffer for the perf auto-dim tier.
			var frameTimes = [];
			var FRAME_BUF  = 120;
			var slowSince  = 0;
			var todStamp   = 0;
			function refreshTod( now ) {
				if ( now - todStamp < 60000 ) return;
				todStamp = now;
				var t = computeTod();
				env.tod      = t.tod;
				env.todPhase = t.phase;
			}
			function stepFactory( impl, state ) {
				return function ( ticker ) {
					env.dt = Math.min( 2.5, ticker.deltaTime );
					env.parallax.x += ( parallaxTarget.x - env.parallax.x ) * 0.12;
					env.parallax.y += ( parallaxTarget.y - env.parallax.y ) * 0.12;

					var dms = ticker.deltaMS != null ? ticker.deltaMS : 16.7;
					frameTimes.push( dms );
					if ( frameTimes.length > FRAME_BUF ) frameTimes.shift();
					if ( frameTimes.length === FRAME_BUF ) {
						var sum = 0;
						for ( var fi = 0; fi < frameTimes.length; fi++ ) sum += frameTimes[ fi ];
						var avg = sum / frameTimes.length;
						var now = Date.now();
						if ( avg > 25 ) {
							if ( slowSince === 0 ) slowSince = now;
							if ( now - slowSince > 2000 ) env.perfTier = 'low';
						} else {
							slowSince = 0;
							env.perfTier = avg < 14 ? 'high' : 'normal';
						}
						refreshTod( now );
					}

					if ( window.__odd.audio && window.__odd.audio.sample ) {
						window.__odd.audio.sample( env.audio );
					}
					if ( impl.onAudio && env.audio && env.audio.enabled ) {
						safeImpl( impl, 'onAudio', 'wallpaper.onAudio:' + currentSlug, [ state, env ] );
					}

					if ( impl.tick ) safeImpl( impl, 'tick', 'wallpaper.tick:' + currentSlug, [ state, env ] );
				};
			}

			function onResize() {
				if ( currentImpl && currentImpl.onResize ) {
					safeImpl( currentImpl, 'onResize', 'wallpaper.onResize:' + currentSlug, [ currentState, env ] );
				}
			}
			app.renderer.on( 'resize', onResize );
			if ( disposed ) {
				try { app.renderer.off( 'resize', onResize ); } catch ( e ) {}
				if ( firstPaint.parentNode ) firstPaint.parentNode.removeChild( firstPaint );
				try { app.destroy( true, { children: true, texture: true } ); } catch ( e2 ) {}
				return;
			}

			// Color-aware OS accent — sample each backdrop once and
			// push the dominant saturated hue into `--wp-admin-theme-color`
			// so the Dock + Admin Bar tint to match.
			var accentCache = {};
			var originalAccent = document.documentElement.style.getPropertyValue( '--wp-admin-theme-color' );
			function sampleAccent( slug ) {
				if ( accentCache[ slug ] ) return Promise.resolve( accentCache[ slug ] );
				var s   = mergeSceneDescriptor( slug ) || {};
				if ( ! s.wallpaperUrl ) return Promise.resolve( null );
				var url = s.wallpaperUrl;
				return new Promise( function ( resolve ) {
					var img = new window.Image();
					img.onload = function () {
						try {
							var W = 32, H = 32;
							var c = document.createElement( 'canvas' );
							c.width = W; c.height = H;
							var g = c.getContext( '2d' );
							if ( ! g ) { resolve( null ); return; }
							g.drawImage( img, 0, 0, W, H );
							var data = g.getImageData( 0, 0, W, H ).data;
							var sumR = 0, sumG = 0, sumB = 0, totalW = 0;
							for ( var i = 0; i < data.length; i += 4 ) {
								var r = data[ i ], gg = data[ i + 1 ], b = data[ i + 2 ];
								var mx = Math.max( r, gg, b ), mn = Math.min( r, gg, b );
								var sat = mx === 0 ? 0 : ( mx - mn ) / mx;
								var bri = mx / 255;
								var w = sat * ( 0.35 + bri * 0.65 );
								if ( w <= 0 ) continue;
								sumR += r * w; sumG += gg * w; sumB += b * w;
								totalW += w;
							}
							if ( totalW <= 0 ) { resolve( null ); return; }
							var R = Math.round( sumR / totalW );
							var G = Math.round( sumG / totalW );
							var B = Math.round( sumB / totalW );
							var L = ( 0.299 * R + 0.587 * G + 0.114 * B ) / 255;
							var target = L < 0.35 ? 0.45 : L > 0.75 ? 0.60 : L;
							var k = target / Math.max( 0.05, L );
							R = Math.min( 255, Math.round( R * k ) );
							G = Math.min( 255, Math.round( G * k ) );
							B = Math.min( 255, Math.round( B * k ) );
							var css = 'rgb(' + R + ',' + G + ',' + B + ')';
							accentCache[ slug ] = css;
							resolve( css );
						} catch ( e ) { resolve( null ); }
					};
					img.onerror = function () { resolve( null ); };
					img.src = url;
				} );
			}
			function applyAccent( slug ) {
				sampleAccent( slug ).then( function ( css ) {
					if ( disposed ) return;
					if ( ! css ) return;
					document.documentElement.style.setProperty( '--odd-accent', css );
					document.documentElement.style.setProperty( '--wp-admin-theme-color', css );
				} );
			}

			// Cross-fade snapshot so the still-live frame covers the
			// seam while the next scene's setup runs. Respects
			// prefers-reduced-motion.
			function snapshotOverlay() {
				if ( env.reducedMotion ) return null;
				var src = app.canvas;
				if ( ! src || ! src.width || ! src.height ) return null;
				try {
					var snap = document.createElement( 'canvas' );
					snap.width  = src.width;
					snap.height = src.height;
					var g = snap.getContext( '2d' );
					if ( ! g ) return null;
					g.drawImage( src, 0, 0 );
					snap.style.cssText =
						'position:absolute;inset:0;width:100%;height:100%;' +
						'pointer-events:none;opacity:1;' +
						'transition:opacity .38s cubic-bezier(.2,.8,.2,1);';
					container.appendChild( snap );
					return snap;
				} catch ( e ) { return null; }
			}
			function fadeAndRemove( node ) {
				if ( ! node ) return;
				window.requestAnimationFrame( function () {
					if ( disposed ) {
						if ( node.parentNode ) node.parentNode.removeChild( node );
						return;
					}
					window.requestAnimationFrame( function () {
						if ( disposed ) {
							if ( node.parentNode ) node.parentNode.removeChild( node );
							return;
						}
						node.style.opacity = '0';
						setTimeout( function () {
							if ( node.parentNode ) node.parentNode.removeChild( node );
						}, 420 );
					} );
				} );
			}

			function runTransitionOut( prev ) {
				if ( env.reducedMotion ) return Promise.resolve();
				if ( ! prev || ! prev.impl || typeof prev.impl.transitionOut !== 'function' ) {
					return Promise.resolve();
				}
				return new Promise( function ( resolve ) {
					var settled = false;
					var fallback = setTimeout( function () {
						if ( settled ) return;
						settled = true;
						resolve();
					}, 1100 );
					try {
						prev.impl.transitionOut( prev.state, env, function () {
							if ( settled ) return;
							settled = true;
							clearTimeout( fallback );
							resolve();
						} );
					} catch ( e ) {
						if ( settled ) return;
						settled = true;
						clearTimeout( fallback );
						resolve();
					}
				} );
			}

			async function swap( nextSlug ) {
				if ( disposed ) return { ok: false, error: new Error( 'disposed' ) };
				if ( swapping ) {
					pendingSlug = nextSlug;
					return { ok: false, error: new Error( 'queued' ) };
				}
				if ( nextSlug === currentSlug ) return { ok: true };
				if ( ! mergeSceneDescriptor( nextSlug ) ) {
					return { ok: false, error: new Error( 'unknown scene: ' + nextSlug ) };
				}
				swapping = true;
				var swapStart = ( window.performance && window.performance.now ) ? window.performance.now() : Date.now();
				var stopSwapMetric = window.__odd && window.__odd.diagnostics && typeof window.__odd.diagnostics.time === 'function'
					? window.__odd.diagnostics.time( 'wallpaper.scene.swap', { to: nextSlug, from: currentSlug || '' } )
					: function () {};
				var prev = {
					slug: currentSlug, impl: currentImpl, state: currentState, tick: currentTick,
				};
				emitBus( 'odd.scene-swap-started', { from: prev.slug, to: nextSlug } );
				var crossfadeNode = null;
				try {
					await loadScene( nextSlug );
					if ( disposed ) {
						swapping = false;
						return { ok: false, error: new Error( 'disposed' ) };
					}
					var impl = window.__odd.scenes[ nextSlug ];
					if ( ! impl || typeof impl.setup !== 'function' ) {
						throw new Error( 'Scene impl missing: ' + nextSlug );
					}

					await runTransitionOut( prev );
					if ( disposed ) {
						swapping = false;
						return { ok: false, error: new Error( 'disposed' ) };
					}

					if ( prev.impl ) crossfadeNode = snapshotOverlay();

					setFirstPaint( nextSlug );
					applyAccent( nextSlug );

					if ( prev.impl ) {
						if ( prev.tick ) app.ticker.remove( prev.tick );
						if ( prev.impl.cleanup ) {
							safeImpl( prev.impl, 'cleanup', 'wallpaper.cleanup:' + prev.slug, [ prev.state, env ] );
						}
						currentImpl = null;
						currentState = null;
						currentTick = null;
						currentSlug = null;
					}
					app.stage.removeChildren();
					frameTimes = [];
					slowSince  = 0;

					// Setup can be sync or async (Promise). safeImpl can't
					// await for us — keep the existing await on the impl
					// method but guard the throw path manually so one bad
					// scene can't take the entire Pixi app down.
					var state;
					try {
						state = await impl.setup( env );
					} catch ( setupErr ) {
						emitBus( 'odd.error', {
							source:   'wallpaper.setup:' + nextSlug,
							err:      setupErr,
							severity: 'error',
							message:  setupErr && setupErr.message,
							stack:    setupErr && setupErr.stack,
						} );
						throw setupErr;
					}
					if ( disposed ) {
						if ( impl.cleanup ) {
							safeImpl( impl, 'cleanup', 'wallpaper.cleanup:' + nextSlug, [ state, env ] );
						}
						try { app.stage.removeChildren(); } catch ( e ) {}
						swapping = false;
						if ( crossfadeNode && crossfadeNode.parentNode ) {
							crossfadeNode.parentNode.removeChild( crossfadeNode );
						}
						return { ok: false, error: new Error( 'disposed' ) };
					}
					var tick  = stepFactory( impl, state );
					currentImpl  = impl;
					currentState = state;
					currentTick  = tick;
					currentSlug  = nextSlug;

					window.__odd = window.__odd || {};
					window.__odd.runtime = window.__odd.runtime || {};
					window.__odd.runtime.activeScene = {
						slug:  nextSlug,
						scene: impl,
						state: state,
						env:   env,
					};

					if ( ! env.reducedMotion && typeof impl.transitionIn === 'function' ) {
						safeImpl( impl, 'transitionIn', 'wallpaper.transitionIn:' + nextSlug, [ state, env ] );
					}

					if ( ctx.prefersReducedMotion ) {
						env.dt = 0;
						if ( typeof impl.stillFrame === 'function' ) {
							safeImpl( impl, 'stillFrame', 'wallpaper.stillFrame:' + nextSlug, [ state, env ] );
						} else if ( impl.tick ) {
							safeImpl( impl, 'tick', 'wallpaper.tick:' + nextSlug, [ state, env ] );
						}
						app.ticker.stop();
					} else {
						app.ticker.add( tick );
						app.ticker.start();
					}

					swapping = false;
					fadeAndRemove( crossfadeNode );
					announce( nextSlug );
					var swapMs = ( ( window.performance && window.performance.now ) ? window.performance.now() : Date.now() ) - swapStart;
					emitBus( 'odd.scene-swap-completed', { from: prev.slug, to: nextSlug, ms: Math.round( swapMs ) } );
					stopSwapMetric( { status: 'ok', ms: Math.round( swapMs ) } );
					if ( window.__odd && window.__odd.diagnostics && typeof window.__odd.diagnostics.count === 'function' ) {
						window.__odd.diagnostics.count( 'wallpaper.scene.swap.ok' );
					}
					emitBus( 'odd.scene-changed', { from: prev.slug, to: nextSlug } );
					drainPending();
					return { ok: true };
				} catch ( err ) {
					if ( window.console ) window.console.error( 'ODD: swap failed', nextSlug, err );
					emitBus( 'odd.scene-mount-failed', { slug: nextSlug, err: err, message: err && err.message } );
					stopSwapMetric( { status: 'error' } );
					if ( window.__odd && window.__odd.diagnostics && typeof window.__odd.diagnostics.count === 'function' ) {
						window.__odd.diagnostics.count( 'wallpaper.scene.swap.error' );
					}
					if ( crossfadeNode && crossfadeNode.parentNode ) {
						crossfadeNode.parentNode.removeChild( crossfadeNode );
					}
					swapping = false;
					drainPending();
					return { ok: false, error: err };
				}
			}

			// ---------- Shuffle scheduler ---------------------------- //

			var shuffleTimer = null;
			function shufflePool() {
				var favs = ( prefsState.favorites || [] ).filter( function ( s ) { return !! mergeSceneDescriptor( s ); } );
				if ( favs.length >= 2 ) return favs;
				return SCENES.map( function ( s ) { return s.slug; } );
			}
			function pickShuffleNext() {
				var pool = shufflePool().filter( function ( s ) { return s !== currentSlug; } );
				if ( ! pool.length ) return null;
				return pool[ ( Math.random() * pool.length ) | 0 ];
			}
			function applyShuffle() {
				if ( shuffleTimer ) { clearInterval( shuffleTimer ); shuffleTimer = null; }
				var sh = prefsState.shuffle || { enabled: false, minutes: 15 };
				if ( ! sh.enabled || ctx.prefersReducedMotion ) return;
				var ms = Math.max( 60000, sh.minutes * 60000 );
				shuffleTimer = setInterval( function () {
					if ( disposed ) return;
					if ( document.hidden ) return;
					var next = pickShuffleNext();
					if ( ! next ) return;
					swap( next ).then( function ( res ) {
						if ( res && res.ok ) savePrefs( { wallpaper: next } );
					} );
				}, ms );
			}

			// ---------- Audio bootstrap ------------------------------ //
			//
			// If the user previously opted in, probe mic state
			// without re-prompting. getUserMedia resolves silently
			// when the origin already has a persistent grant.
			function bootstrapAudio() {
				if ( ! prefsState.audioReactive ) return;
				loadAudio().then( function ( a ) {
					if ( disposed ) {
						if ( a && a.disable ) a.disable();
						return;
					}
					if ( a && a.enable ) a.enable();
				} ).catch( function () { /* non-fatal */ } );
			}

			// ---------- Visibility + wp.hooks bridge ---------------- //

			function onVis( detail ) {
				if ( disposed ) return;
				if ( ! detail || detail.id !== ctx.id ) return;
				if ( detail.state === 'hidden' ) app.ticker.stop();
				else if ( ! ctx.prefersReducedMotion ) app.ticker.start();
			}
			exposeWallpaperVisSink( onVis );

			// Wired through the bridge (installed from `boot`) so picks
			// during Pixi bootstrap are not dropped.
			exposeWallpaperPickSink( function ( slug ) {
				if ( disposed ) return;
				if ( ! slug || slug === currentSlug ) return;
				swap( slug ).then( function ( res ) {
					if ( res && res.ok ) recordRecent( slug );
				} );
			} );

			function onDocVis() {
				if ( disposed ) return;
				if ( document.hidden ) app.ticker.stop();
				else if ( ! ctx.prefersReducedMotion ) app.ticker.start();
			}
			document.addEventListener( 'visibilitychange', onDocVis );

			readyTeardown = function () {
				bootApp = null;
				bootAppDestroyed = true;
				if ( shuffleTimer ) { clearInterval( shuffleTimer ); shuffleTimer = null; }
				if ( window.__odd.audio && window.__odd.audio.disable ) {
					try { window.__odd.audio.disable(); } catch ( e ) { /* ignore */ }
				}
				exposeWallpaperPickSink( null );
				exposeWallpaperVisSink( null );
				document.removeEventListener( 'visibilitychange', onDocVis );
				window.removeEventListener( 'pointermove', onPointerMove );
				if ( live.parentNode ) live.parentNode.removeChild( live );
				if ( firstPaint.parentNode ) firstPaint.parentNode.removeChild( firstPaint );
				if ( originalAccent ) {
					document.documentElement.style.setProperty( '--wp-admin-theme-color', originalAccent );
				} else {
					document.documentElement.style.removeProperty( '--wp-admin-theme-color' );
				}
				document.documentElement.style.removeProperty( '--odd-accent' );
				try { app.renderer.off( 'resize', onResize ); } catch ( e2 ) {}
				if ( currentTick ) app.ticker.remove( currentTick );
				if ( currentImpl && currentImpl.cleanup ) {
					safeImpl( currentImpl, 'cleanup', 'wallpaper.cleanup:' + currentSlug, [ currentState, env ] );
				}
				currentImpl = null;
				currentState = null;
				currentTick = null;
				currentSlug = null;
				if ( window.__odd && window.__odd.runtime ) {
					window.__odd.runtime.activeScene = null;
				}
				try { app.stage.removeChildren(); } catch ( e3 ) {}
				try { app.destroy( true, { children: true, texture: true } ); } catch ( e4 ) {}
			};
			if ( disposed ) {
				readyTeardown( 'disposed-before-ready' );
				clearRuntimeHandle();
				return;
			}

			applyShuffle();
			bootstrapAudio();

			var initial = prefsState.scene || defaultScene();
			setFirstPaint( initial );
			var first = await swap( initial );
			if ( disposed ) return;
			if ( ! first.ok && initial !== defaultScene() ) {
				savePrefs( { wallpaper: '' } );
				setFirstPaint( defaultScene() );
				await swap( defaultScene() );
			}
			if ( disposed ) return;

			// Lifecycle: first scene painted. Advance to `mounted` so
			// anything awaiting that phase (widgets, commands) can fire
			// their own init. `ready` follows on the next frame so every
			// enqueued subsystem has a chance to install before it's
			// emitted.
			if ( _lifecycle ) {
				try { _lifecycle.advance( 'mounted' ); } catch ( e ) {}
				window.requestAnimationFrame( function () {
					if ( disposed ) return;
					try { _lifecycle.advance( 'ready' ); } catch ( e ) {}
				} );
			}

			if ( disposed ) {
				readyTeardown( 'disposed-before-ready' );
				clearRuntimeHandle();
			}
		})().catch( function ( err ) {
			if ( ! disposed ) {
				if ( window.console ) window.console.error( 'ODD: mount failed', err );
				if ( readyTeardown ) {
					try { readyTeardown( 'mount-failed' ); } catch ( e ) {}
				} else {
					try { earlyTeardown( 'mount-failed' ); } catch ( e2 ) {}
				}
			}
			clearRuntimeHandle();
		} );
		return teardown;
	}

	function renderWallpaperEditor( mount, ctx ) {
		if ( ! mount || ! document ) return function () {};
		var api = window.__odd && window.__odd.api;
		var config = window.odd || {};
		var scenesList = api && typeof api.scenes === 'function' ? api.scenes() : ( Array.isArray( config.scenes ) ? config.scenes : [] );
		var current = api && typeof api.currentScene === 'function' ? api.currentScene() : ( config.wallpaper || config.scene || '' );
		var shuffle = config.shuffle && typeof config.shuffle === 'object' ? config.shuffle : { enabled: false, minutes: 15 };
		var disposed = false;

		mount.classList.add( 'odd-wallpaper-editor' );
		mount.innerHTML = [
			'<div class="odd-wallpaper-editor__grid">',
			'<label class="odd-wallpaper-editor__field"><span>Scene</span><select data-odd-wallpaper-scene></select></label>',
			'<label class="odd-wallpaper-editor__field odd-wallpaper-editor__inline"><input type="checkbox" data-odd-wallpaper-shuffle> <span>Shuffle scenes</span></label>',
			'<label class="odd-wallpaper-editor__field"><span>Every</span><input type="number" min="1" max="240" step="1" data-odd-wallpaper-minutes></label>',
			'<label class="odd-wallpaper-editor__field odd-wallpaper-editor__inline"><input type="checkbox" data-odd-wallpaper-audio> <span>Audio reactive</span></label>',
			'</div>',
			'<div class="odd-wallpaper-editor__actions">',
			'<button type="button" class="button button-secondary" data-odd-wallpaper-shuffle-now>Shuffle now</button>',
			'<button type="button" class="button button-secondary" data-odd-wallpaper-open-shop>Open ODD Shop</button>',
			'</div>',
		].join( '' );

		var style = document.getElementById( 'odd-wallpaper-editor-style' );
		if ( ! style ) {
			style = document.createElement( 'style' );
			style.id = 'odd-wallpaper-editor-style';
			style.textContent = [
				'.odd-wallpaper-editor{display:block;padding:10px 0 2px;}',
				'.odd-wallpaper-editor__grid{display:grid;grid-template-columns:minmax(180px,1fr) minmax(130px,.55fr);gap:10px;align-items:end;}',
				'.odd-wallpaper-editor__field{display:grid;gap:6px;font-size:12px;color:inherit;}',
				'.odd-wallpaper-editor__field>span{font-weight:700;}',
				'.odd-wallpaper-editor__field select,.odd-wallpaper-editor__field input[type="number"]{width:100%;min-height:34px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:inherit;padding:4px 8px;}',
				'.odd-wallpaper-editor__inline{display:flex;gap:8px;align-items:center;min-height:34px;}',
				'.odd-wallpaper-editor__inline input{margin:0;}',
				'.odd-wallpaper-editor__actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}',
				'@media (max-width:560px){.odd-wallpaper-editor__grid{grid-template-columns:1fr;}}',
			].join( '\n' );
			document.head.appendChild( style );
		}

		var select = mount.querySelector( '[data-odd-wallpaper-scene]' );
		var shuffleToggle = mount.querySelector( '[data-odd-wallpaper-shuffle]' );
		var minutes = mount.querySelector( '[data-odd-wallpaper-minutes]' );
		var audio = mount.querySelector( '[data-odd-wallpaper-audio]' );
		var shuffleNow = mount.querySelector( '[data-odd-wallpaper-shuffle-now]' );
		var openShop = mount.querySelector( '[data-odd-wallpaper-open-shop]' );

		function htmlEsc( value ) {
			return String( value || '' )
				.replace( /&/g, '&amp;' )
				.replace( /</g, '&lt;' )
				.replace( />/g, '&gt;' )
				.replace( /"/g, '&quot;' );
		}

		if ( select ) {
			select.innerHTML = scenesList.map( function ( scene ) {
				if ( ! scene || ! scene.slug ) return '';
				return '<option value="' + htmlEsc( scene.slug ) + '">' + htmlEsc( scene.label || scene.slug ) + '</option>';
			} ).join( '' );
			select.value = current;
		}
		if ( shuffleToggle ) shuffleToggle.checked = !! shuffle.enabled;
		if ( minutes ) minutes.value = String( parseInt( shuffle.minutes, 10 ) || 15 );
		if ( audio ) audio.checked = !! config.audioReactive;

		function setShuffle() {
			if ( ! api || typeof api.setShuffle !== 'function' ) return;
			api.setShuffle( {
				enabled: !! ( shuffleToggle && shuffleToggle.checked ),
				minutes: parseInt( minutes && minutes.value, 10 ) || 15,
			}, { quiet: true } );
		}

		function onScene() {
			if ( ! api || typeof api.setScene !== 'function' || ! select ) return;
			api.setScene( select.value );
		}
		function onShuffleChange() { setShuffle(); }
		function onAudio() {
			if ( api && typeof api.setAudioReactive === 'function' ) {
				api.setAudioReactive( !! ( audio && audio.checked ), { quiet: true } );
			}
		}
		function onShuffleNow() {
			if ( api && typeof api.shuffle === 'function' ) api.shuffle();
		}
		function onOpenShop() {
			if ( api && typeof api.openPanel === 'function' ) api.openPanel();
		}

		if ( select ) select.addEventListener( 'change', onScene );
		if ( shuffleToggle ) shuffleToggle.addEventListener( 'change', onShuffleChange );
		if ( minutes ) minutes.addEventListener( 'change', onShuffleChange );
		if ( audio ) audio.addEventListener( 'change', onAudio );
		if ( shuffleNow ) shuffleNow.addEventListener( 'click', onShuffleNow );
		if ( openShop ) openShop.addEventListener( 'click', onOpenShop );

		return function () {
			if ( disposed ) return;
			disposed = true;
			if ( select ) select.removeEventListener( 'change', onScene );
			if ( shuffleToggle ) shuffleToggle.removeEventListener( 'change', onShuffleChange );
			if ( minutes ) minutes.removeEventListener( 'change', onShuffleChange );
			if ( audio ) audio.removeEventListener( 'change', onAudio );
			if ( shuffleNow ) shuffleNow.removeEventListener( 'click', onShuffleNow );
			if ( openShop ) openShop.removeEventListener( 'click', onOpenShop );
			try { mount.replaceChildren(); } catch ( e ) { mount.innerHTML = ''; }
		};
	}

	// ============================================================ //
	// Registration — one wallpaper card.
	// ============================================================ //

	var oddWallpaperDef = {
		id:      'odd',
		label:   'ODD',
		type:    'canvas',
		preview: previewBg( defaultScene() ),
		needs:   [ 'pixijs' ],
		mount:   mountODD,
		renderEditor: renderWallpaperEditor,
	};

	function publishWallpaperDef() {
		window.desktopModeWallpapers = window.desktopModeWallpapers || {};
		window.desktopModeWallpapers.odd = oddWallpaperDef;
		return oddWallpaperDef;
	}

	publishWallpaperDef();

	var registered = false;
	function registerAll() {
		if ( registered ) return;
		if ( ! window.wp || ! window.wp.desktop ) return;
		if ( typeof window.wp.desktop.registerWallpaper !== 'function' ) return;
		registered = true;

		try {
			window.wp.desktop.registerWallpaper( publishWallpaperDef() );
		} catch ( e ) {
			if ( window.console ) window.console.warn( 'ODD: registerWallpaper failed', e );
		}
	}

	function boot() {
		if ( ! window.wp || ! window.wp.hooks ) {
			// Polyfill-free fallback — WP Desktop Mode always provides
			// @wordpress/hooks, so if it's absent the admin page almost
			// certainly doesn't have the shell loaded and we can bail.
			return;
		}
		installWallpaperPickBridge();
		installWallpaperVisibilityBridge();
		installWallpaperTeardownBridge();
		installLifecycleTeardownBridge();
		if ( window.wp.desktop && typeof window.wp.desktop.ready === 'function' ) {
			window.wp.desktop.ready( registerAll );
		} else {
			registerAll();
		}
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', boot, { once: true } );
	} else {
		boot();
	}
} )();
