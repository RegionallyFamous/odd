/**
 * ODD state store (window.__odd.store)
 * ---------------------------------------------------------------
 * One source of truth for user prefs + registries + runtime state.
 * Hydrates from the inlined `window.oddout` config (populated via
 * wp_localize_script on odd-api) and the host `desktopModeConfig`
 * blob. Subscribers can listen to the whole store ('*') or to a
 * dotted path ('user.wallpaper', 'registries.scenes', …).
 *
 * Every ODD surface — wallpaper engine, panel, widgets, commands —
 * is expected to read state from here rather than re-derive it from
 * `window.oddout`. The store is the stable API; the localized config
 * is an implementation detail that can change shape.
 *
 * Shape:
 *   user: {
 *     wallpaper, favorites[], recents[], shuffle:{enabled,minutes},
 *     audioReactive, iconSet, schemaVersion,
 *   }
 *   registries: {
 *     scenes[], iconSets[], muses[], commands[], widgets[],
 *     rituals[], motionPrimitives[],
 *   }
 *   runtime: {
 *     phase, tod, season, perfTier, reducedMotion, debug,
 *   }
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;
	window.oddout = ( window.oddout && typeof window.oddout === 'object' ) ? window.oddout : ( window.odd || {} );
	window.odd = window.oddout;
	window.__odd = window.__odd || {};
	if ( window.__odd.store ) return;

	var DEFAULT_STATE = {
		user: {
			wallpaper:     '',
			favorites:     [],
			recents:       [],
			shuffle:       { enabled: false, minutes: 15 },
			audioReactive: false,
			iconSet:       '',
			initiated:     false,
			mascotQuiet:   false,
			winkUnlocked:  false,
			schemaVersion: 0,
			apps:          { installed: [], pinned: [] },
		},
		registries: {
			scenes:           [],
			iconSets:         [],
			muses:            [],
			commands:         [],
			widgets:          [],
			rituals:          [],
			motionPrimitives: [],
			apps:             [],
		},
		runtime: {
			phase:         'boot',
			tod:           'day',
			season:        'spring',
			perfTier:      'normal',
			reducedMotion: false,
			debug:         false,
		},
	};

	var state  = clone( DEFAULT_STATE );
	var subs   = [];
	var hydrated = false;

	function clone( v ) {
		if ( v === null || typeof v !== 'object' ) return v;
		if ( Array.isArray( v ) ) {
			var arr = new Array( v.length );
			for ( var i = 0; i < v.length; i++ ) arr[ i ] = clone( v[ i ] );
			return arr;
		}
		var out = {};
		for ( var k in v ) {
			if ( Object.prototype.hasOwnProperty.call( v, k ) ) out[ k ] = clone( v[ k ] );
		}
		return out;
	}

	function dig( obj, path ) {
		if ( ! path ) return obj;
		var parts = String( path ).split( '.' );
		var cur = obj;
		for ( var i = 0; i < parts.length; i++ ) {
			if ( cur == null ) return undefined;
			cur = cur[ parts[ i ] ];
		}
		return cur;
	}

	// Depth-2 merge: top-level objects merge their direct children;
	// arrays and primitives replace. Matches the shape of user/runtime
	// slices (objects of primitives) and registries (objects of arrays).
	function merge( base, patch ) {
		if ( patch === null || typeof patch !== 'object' || Array.isArray( patch ) ) return patch;
		var out = {};
		var k;
		for ( k in base ) {
			if ( Object.prototype.hasOwnProperty.call( base, k ) ) out[ k ] = base[ k ];
		}
		for ( k in patch ) {
			if ( ! Object.prototype.hasOwnProperty.call( patch, k ) ) continue;
			var bv = base ? base[ k ] : undefined;
			var pv = patch[ k ];
			if (
				bv && pv &&
				typeof bv === 'object' && typeof pv === 'object' &&
				! Array.isArray( bv ) && ! Array.isArray( pv )
			) {
				out[ k ] = merge( bv, pv );
			} else {
				out[ k ] = pv;
			}
		}
		return out;
	}

	function getState() { return state; }

	function get( path ) { return dig( state, path ); }

	function set( patch, opts ) {
		opts        = opts || {};
		var silent  = !! opts.silent;
		var source  = opts.source || 'set';
		var before  = state;
		state       = merge( state, patch );
		if ( ! silent ) broadcast( before, state, source );
	}

	function subscribe( path, fn ) {
		if ( typeof path === 'function' ) { fn = path; path = '*'; }
		if ( typeof fn !== 'function' ) return function () {};
		var entry = { path: path || '*', fn: fn };
		subs.push( entry );
		return function unsubscribe() {
			var i = subs.indexOf( entry );
			if ( i >= 0 ) subs.splice( i, 1 );
		};
	}

	function broadcast( before, after, source ) {
		// Iterate a snapshot so subscribers that unsubscribe during
		// dispatch don't shift the live array out from under us.
		var snap = subs.slice();
		for ( var i = 0; i < snap.length; i++ ) {
			var s = snap[ i ];
			try {
				if ( s.path === '*' ) {
					s.fn( after, before, source );
				} else {
					var b = dig( before, s.path );
					var a = dig( after, s.path );
					if ( b !== a ) s.fn( a, b, source );
				}
			} catch ( e ) { /* subscriber errors never block broadcast */ }
		}
	}

	function hasDebugParam() {
		try {
			var q = window.location && window.location.search;
			if ( ! q ) return false;
			return /[?&]odd-debug=1(?:&|$)/.test( q );
		} catch ( e ) { return false; }
	}

	function hydrate() {
		if ( hydrated ) return state;
		hydrated = true;
		var cfg = window.oddout || window.odd || {};
		var wdc = window.desktopModeConfig || {};
		var rm  = false;
		try {
			rm = !! ( window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches );
		} catch ( e ) {}

		set( {
			user: {
				wallpaper:     typeof cfg.wallpaper === 'string' ? cfg.wallpaper : ( typeof cfg.scene === 'string' ? cfg.scene : '' ),
				favorites:     Array.isArray( cfg.favorites ) ? cfg.favorites.slice() : [],
				recents:       Array.isArray( cfg.recents ) ? cfg.recents.slice() : [],
				shuffle:       ( cfg.shuffle && typeof cfg.shuffle === 'object' ) ?
					{ enabled: !! cfg.shuffle.enabled, minutes: cfg.shuffle.minutes || 15 } :
					{ enabled: false, minutes: 15 },
				audioReactive: !! cfg.audioReactive,
				iconSet:       typeof cfg.iconSet === 'string' ? cfg.iconSet : '',
				initiated:     !! cfg.initiated,
				mascotQuiet:   !! cfg.mascotQuiet,
				winkUnlocked:  !! cfg.winkUnlocked,
				schemaVersion: cfg.schemaVersion || 0,
				apps: ( cfg.userApps && typeof cfg.userApps === 'object' ) ? {
					installed: Array.isArray( cfg.userApps.installed ) ? cfg.userApps.installed.slice() : [],
					pinned:    Array.isArray( cfg.userApps.pinned )    ? cfg.userApps.pinned.slice()    : [],
				} : { installed: [], pinned: [] },
			},
			registries: {
				scenes:   Array.isArray( cfg.scenes ) ? cfg.scenes.slice() : [],
				iconSets: Array.isArray( cfg.iconSets ) ? cfg.iconSets.slice() : [],
				muses:            Array.isArray( cfg.muses ) ? cfg.muses.slice() : [],
				commands:         Array.isArray( cfg.commands ) ? cfg.commands.slice() : [],
				widgets:          Array.isArray( cfg.widgets ) ? cfg.widgets.slice() : [],
				rituals:          Array.isArray( cfg.rituals ) ? cfg.rituals.slice() : [],
				motionPrimitives: Array.isArray( cfg.motionPrimitives ) ? cfg.motionPrimitives.slice() : [],
				apps:             Array.isArray( cfg.apps ) ? cfg.apps.slice() : [],
			},
			runtime: {
				phase:         'boot',
				reducedMotion: rm,
				debug:         !! wdc.debug || hasDebugParam(),
			},
		}, { silent: true, source: 'hydrate' } );

		return state;
	}

	function persistUser( patch, cb ) {
		// Delegate the REST round-trip to the existing api layer, then
		// merge any server-confirmed keys back into the store so anyone
		// subscribed sees the truth. api.savePrefs doesn't know about the
		// store; this function is the bridge.
		var api = window.__odd && window.__odd.api;
		if ( ! api || typeof api.savePrefs !== 'function' ) {
			if ( cb ) cb( null );
			return;
		}
		api.savePrefs( patch, function ( resp ) {
			if ( resp && typeof resp === 'object' ) {
				var userPatch = {};
				if ( typeof resp.wallpaper === 'string' )     userPatch.wallpaper = resp.wallpaper;
				if ( typeof resp.iconSet === 'string' )       userPatch.iconSet = resp.iconSet;
				if ( Array.isArray( resp.favorites ) )         userPatch.favorites = resp.favorites;
				if ( Array.isArray( resp.recents ) )           userPatch.recents = resp.recents;
				if ( resp.shuffle && typeof resp.shuffle === 'object' ) {
					userPatch.shuffle = { enabled: !! resp.shuffle.enabled, minutes: resp.shuffle.minutes || 15 };
				}
				if ( typeof resp.audioReactive === 'boolean' ) userPatch.audioReactive = resp.audioReactive;
				if ( typeof resp.initiated === 'boolean' )    userPatch.initiated    = resp.initiated;
				if ( typeof resp.mascotQuiet === 'boolean' )  userPatch.mascotQuiet  = resp.mascotQuiet;
				if ( typeof resp.winkUnlocked === 'boolean' ) userPatch.winkUnlocked = resp.winkUnlocked;
				var keys = Object.keys( userPatch );
				if ( keys.length ) set( { user: userPatch }, { source: 'rest' } );
			}
			if ( cb ) cb( resp );
		} );
	}

	window.__odd.store = {
		DEFAULT_STATE: DEFAULT_STATE,
		getState:      getState,
		get:           get,
		set:           set,
		subscribe:     subscribe,
		hydrate:       hydrate,
		persistUser:   persistUser,
	};

	// Hydrate eagerly. The localized `window.oddout` blob is inlined by
	// WordPress in the same <script> tag batch before this module runs.
	hydrate();
} )();
