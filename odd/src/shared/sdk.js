/**
 * ODD SDK (window.__odd.sdk)
 * ---------------------------------------------------------------
 * A small stable facade for integrations that want one entry point
 * instead of reaching across the individual foundation modules.
 *
 * This intentionally wraps the existing public pieces. It does not
 * replace window.__odd.api, and every method is tolerant of partial
 * ODD boot states so companion plugins can feature-detect safely.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	window.__odd = window.__odd || {};
	if ( window.__odd.sdk ) return;

	var SDK_VERSION = '1.0.0';
	var THEME_CHOICES = [ 'light', 'dark', 'auto' ];
	var PREF_KEYS = [
		'wallpaper',
		'scene',
		'favorites',
		'recents',
		'shuffle',
		'screensaver',
		'audioReactive',
		'shopTaskbar',
		'shopDesktopPinned',
		'theme',
		'chaosMode',
		'initiated',
		'mascotQuiet',
		'winkUnlocked',
		'appsPinned',
		'iconSet',
		'cursorSet',
		'cursorStylesheet',
	];

	function cfg() {
		return window.odd || window.oddout || {};
	}

	function api() {
		return ( window.__odd && window.__odd.api ) || null;
	}

	function store() {
		return ( window.__odd && window.__odd.store ) || null;
	}

	function events() {
		return ( window.__odd && window.__odd.events ) || null;
	}

	function lifecycle() {
		return ( window.__odd && window.__odd.lifecycle ) || null;
	}

	function diagnostics() {
		return ( window.__odd && window.__odd.diagnostics ) || null;
	}

	function noop() {}

	function clone( value ) {
		if ( value === null || typeof value !== 'object' ) return value;
		if ( Array.isArray( value ) ) {
			var arr = new Array( value.length );
			for ( var i = 0; i < value.length; i++ ) arr[ i ] = clone( value[ i ] );
			return arr;
		}
		var out = {};
		for ( var key in value ) {
			if ( Object.prototype.hasOwnProperty.call( value, key ) ) out[ key ] = clone( value[ key ] );
		}
		return out;
	}

	function asArray( value ) {
		return Array.isArray( value ) ? value.slice() : [];
	}

	function normalizeTheme( value ) {
		value = String( value || 'auto' ).toLowerCase();
		return THEME_CHOICES.indexOf( value ) === -1 ? 'auto' : value;
	}

	function preferenceValue( user, key, fallback ) {
		if ( user && Object.prototype.hasOwnProperty.call( user, key ) ) return user[ key ];
		var c = cfg();
		if ( c && Object.prototype.hasOwnProperty.call( c, key ) ) return c[ key ];
		return fallback;
	}

	function readPreferences() {
		var s = store();
		var user = s && typeof s.get === 'function' ? ( s.get( 'user' ) || {} ) : {};
		var c = cfg();
		var wallpaper = preferenceValue( user, 'wallpaper', c.scene || '' );
		var apps = preferenceValue( user, 'apps', c.userApps || {} ) || {};
		return {
			wallpaper: wallpaper || '',
			scene: wallpaper || c.scene || '',
			favorites: asArray( preferenceValue( user, 'favorites', c.favorites ) ),
			recents: asArray( preferenceValue( user, 'recents', c.recents ) ),
			shuffle: clone( preferenceValue( user, 'shuffle', c.shuffle || { enabled: false, minutes: 15 } ) ),
			screensaver: clone( c.screensaver || {} ),
			audioReactive: !! preferenceValue( user, 'audioReactive', c.audioReactive ),
			shopTaskbar: !! c.shopTaskbar,
			shopDesktopPinned: !! c.shopDesktopPinned,
			theme: normalizeTheme( c.theme ),
			chaosMode: !! c.chaosMode,
			initiated: !! preferenceValue( user, 'initiated', c.initiated ),
			mascotQuiet: !! preferenceValue( user, 'mascotQuiet', c.mascotQuiet ),
			winkUnlocked: !! preferenceValue( user, 'winkUnlocked', c.winkUnlocked ),
			appsPinned: asArray( apps.pinned ),
			iconSet: preferenceValue( user, 'iconSet', c.iconSet || '' ) || '',
			cursorSet: c.cursorSet || '',
			cursorStylesheet: c.cursorStylesheet || '',
		};
	}

	function applyPreferenceResult( data ) {
		if ( ! data || typeof data !== 'object' ) return;
		var c = cfg();
		PREF_KEYS.forEach( function ( key ) {
			if ( Object.prototype.hasOwnProperty.call( data, key ) ) c[ key ] = data[ key ];
		} );
		if ( typeof data.wallpaper === 'string' ) {
			c.scene = data.wallpaper;
		}
		var userPatch = {};
		[
			'wallpaper',
			'favorites',
			'recents',
			'shuffle',
			'audioReactive',
			'iconSet',
			'initiated',
			'mascotQuiet',
			'winkUnlocked',
		].forEach( function ( key ) {
			if ( Object.prototype.hasOwnProperty.call( data, key ) ) userPatch[ key ] = clone( data[ key ] );
		} );
		if ( Object.prototype.hasOwnProperty.call( data, 'appsPinned' ) ) {
			userPatch.apps = { pinned: asArray( data.appsPinned ) };
		}
		var keys = Object.keys( userPatch );
		var s = store();
		if ( keys.length && s && typeof s.set === 'function' ) {
			s.set( { user: userPatch }, { source: 'sdk.preferences' } );
		}
	}

	function savePreferences( patch, cb ) {
		patch = patch && typeof patch === 'object' && ! Array.isArray( patch ) ? patch : {};
		var a = api();
		if ( ! a || typeof a.savePrefs !== 'function' ) {
			if ( typeof cb === 'function' ) cb( null );
			return typeof Promise === 'function' ? Promise.resolve( null ) : false;
		}
		if ( typeof Promise !== 'function' ) {
			a.savePrefs( patch, function ( data ) {
				applyPreferenceResult( data );
				if ( typeof cb === 'function' ) cb( data );
			} );
			return true;
		}
		return new Promise( function ( resolve ) {
			a.savePrefs( patch, function ( data ) {
				applyPreferenceResult( data );
				if ( typeof cb === 'function' ) cb( data );
				resolve( data || null );
			} );
		} );
	}

	function getTheme() {
		return normalizeTheme( cfg().theme );
	}

	function setTheme( theme, cb ) {
		var next = normalizeTheme( theme );
		return savePreferences( { theme: next }, function ( data ) {
			cfg().theme = normalizeTheme( data && data.theme ? data.theme : next );
			if ( typeof cb === 'function' ) cb( cfg().theme, data || null );
		} );
	}

	function storageGet( path, fallback ) {
		var s = store();
		if ( ! s || typeof s.get !== 'function' ) return fallback;
		var value = s.get( path );
		return value === undefined ? fallback : clone( value );
	}

	function storageState() {
		var s = store();
		return s && typeof s.getState === 'function' ? clone( s.getState() ) : {};
	}

	function storageSet( patch, opts ) {
		var s = store();
		if ( ! s || typeof s.set !== 'function' || ! patch || typeof patch !== 'object' || Array.isArray( patch ) ) return false;
		s.set( patch, opts || { source: 'sdk.storage' } );
		return true;
	}

	function storageSubscribe( path, cb ) {
		var s = store();
		if ( ! s || typeof s.subscribe !== 'function' ) return noop;
		return s.subscribe( path, cb );
	}

	function capabilitySnapshot() {
		var c = cfg();
		var system = c.systemHealth || {};
		var dm = system.desktopMode || {};
		var desktop = window.wp && window.wp.desktop;
		var d = diagnostics();
		var a = api();
		return {
			canInstall: !! c.canInstall,
			appsEnabled: !! c.appsEnabled,
			desktopMode: !! desktop,
			preferences: !! ( a && typeof a.savePrefs === 'function' ),
			diagnostics: !! d,
			toasts: !! ( desktop && typeof desktop.showToast === 'function' ),
			storage: !! store(),
			desktopModeFeatures: clone( dm ),
		};
	}

	function showToast( message, opts ) {
		var a = api();
		if ( ! a || typeof a.toast !== 'function' ) return false;
		a.toast( message, opts || {} );
		return true;
	}

	function diagnosticSummary() {
		var d = diagnostics();
		if ( d && typeof d.summary === 'function' ) return d.summary();
		return {
			generatedAt: new Date().toISOString(),
			status: 'warn',
			ok: [],
			warn: [ { id: 'diagnostics.unavailable', message: 'ODD diagnostics are not available yet.' } ],
			problems: [],
			counts: { ok: 0, warn: 1, problems: 0 },
		};
	}

	function diagnosticCollect() {
		var d = diagnostics();
		return d && typeof d.collect === 'function' ? d.collect() : {};
	}

	function diagnosticMarkdown() {
		var d = diagnostics();
		return d && typeof d.collectMarkdown === 'function' ? d.collectMarkdown() : '';
	}

	function diagnosticCopy() {
		var d = diagnostics();
		if ( d && typeof d.copy === 'function' ) return d.copy();
		return typeof Promise === 'function' ? Promise.resolve( false ) : false;
	}

	function diagnosticMetrics() {
		var d = diagnostics();
		return d && typeof d.metrics === 'function' ? d.metrics() : { timings: [], counters: {} };
	}

	function onTeardown( cb ) {
		if ( typeof cb !== 'function' ) return noop;
		var ev = events();
		if ( ev && typeof ev.on === 'function' ) {
			return ev.on( 'odd.teardown', cb );
		}
		var lc = lifecycle();
		if ( lc && typeof lc.whenPhase === 'function' ) {
			try {
				var p = lc.whenPhase( 'teardown' );
				if ( p && typeof p.then === 'function' ) p.then( cb );
			} catch ( _ ) {}
		}
		return noop;
	}

	function teardown() {
		var lc = lifecycle();
		if ( lc && typeof lc.advance === 'function' ) {
			return !! lc.advance( 'teardown' );
		}
		var ev = events();
		if ( ev && typeof ev.emit === 'function' ) {
			ev.emit( 'odd.teardown', { source: 'sdk' } );
			return true;
		}
		return false;
	}

	window.__odd.sdk = {
		version: SDK_VERSION,
		get apiVersion() {
			var a = api();
			return a && a.version || '';
		},
		get config() { return cfg(); },
		storage: {
			get: storageGet,
			set: storageSet,
			state: storageState,
			subscribe: storageSubscribe,
		},
		preferences: {
			get: readPreferences,
			save: savePreferences,
		},
		theme: {
			choices: function () { return THEME_CHOICES.slice(); },
			get: getTheme,
			set: setTheme,
		},
		capabilities: capabilitySnapshot,
		toast: showToast,
		diagnostics: {
			summary: diagnosticSummary,
			collect: diagnosticCollect,
			collectMarkdown: diagnosticMarkdown,
			copy: diagnosticCopy,
			metrics: diagnosticMetrics,
		},
		health: diagnosticSummary,
		onTeardown: onTeardown,
		teardown: teardown,
	};
} )();
