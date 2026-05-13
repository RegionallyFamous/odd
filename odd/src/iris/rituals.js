/**
 * Iris — the three rituals.
 * ---------------------------------------------------------------
 * Self-installing detectors registered in the `odd.rituals` registry.
 * Each ritual is a pure subscriber — it listens for its trigger
 * (Konami code, 120s idle, seven rapid clicks on the ODD desktop
 * icon) and on match fires an `odd.ritual.<slug>` bus event plus
 * a matching Iris `say()` bucket.
 *
 * Rituals themselves never draw anything. They broadcast. The eye,
 * the active scene, and the motion primitives respond by subscribing.
 * The uninstall handles are kept so a future teardown path (or a
 * hot-swap during tests) can detach them cleanly.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;
	window.__odd = window.__odd || {};
	window.__odd.iris = window.__odd.iris || {};
	if ( window.__odd.iris.rituals ) return;

	function emit( name, payload ) {
		var evt = window.__odd.events;
		if ( evt && typeof evt.emit === 'function' ) evt.emit( name, payload );
	}
	function say( bucket ) {
		var iris = window.__odd.iris;
		if ( iris && typeof iris.say === 'function' ) iris.say( bucket );
	}
	function motion( slug, opts ) {
		var m = window.__odd.iris && window.__odd.iris.motion;
		if ( m && typeof m[ slug ] === 'function' ) m[ slug ]( opts || {} );
	}

	// ---------- The Festival (Konami) ---------- //
	var KONAMI = [
		'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
		'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
		'KeyB', 'KeyA',
	];
	function installFestival() {
		var buf = [];
		function onKey( e ) {
			buf.push( e.code );
			if ( buf.length > KONAMI.length ) buf.shift();
			for ( var i = 0; i < KONAMI.length; i++ ) {
				if ( buf[ i ] !== KONAMI[ i ] ) return;
			}
			buf.length = 0;
			emit( 'odd.ritual.festival', {} );
			say( 'festival' );
			motion( 'glitch', { ms: 220 } );
			motion( 'ripple', { x: 0.5, y: 0.5, intensity: 1.0, normalized: true } );
		}
		window.addEventListener( 'keydown', onKey, { passive: true } );
		return function () { window.removeEventListener( 'keydown', onKey ); };
	}

	// ---------- The Dream (idle) ---------- //
	var DREAM_MS = 120 * 1000;
	function installDream() {
		var t = null;
		var dreaming = false;
		function reset() {
			if ( dreaming ) {
				dreaming = false;
				emit( 'odd.ritual.dream', { state: 'exit' } );
			}
			if ( t ) clearTimeout( t );
			if ( document.hidden ) return;
			t = setTimeout( function () {
				dreaming = true;
				emit( 'odd.ritual.dream', { state: 'enter' } );
				say( 'idle' );
			}, DREAM_MS );
		}
		var opts  = { passive: true };
		var kicks = [ 'pointermove', 'keydown', 'wheel', 'touchstart' ];
		kicks.forEach( function ( n ) { window.addEventListener( n, reset, opts ); } );
		document.addEventListener( 'visibilitychange', reset, opts );
		reset();
		return function () {
			kicks.forEach( function ( n ) { window.removeEventListener( n, reset, opts ); } );
			document.removeEventListener( 'visibilitychange', reset, opts );
			if ( t ) clearTimeout( t );
		};
	}

	// ---------- The Seven (rapid icon pairing) ---------- //
	//
	// Seven pointerdown→pointerup pairs (each under 50 ms, consecutive)
	// on anything marked as an ODD desktop tile, within a 5 s window,
	// unlocks `oddout_wink_unlocked` on the user.
	function installSeven() {
		var pairs = 0;
		var firstAt = 0;
		var downAt = 0;
		var isIrisTarget = function ( el ) {
			while ( el && el !== document.body ) {
				if ( el.dataset && ( el.dataset.desktopModeIconId === 'odd' || el.dataset.oddEye ) ) return true;
				el = el.parentNode;
			}
			return false;
		};
		function onDown( e ) {
			if ( ! isIrisTarget( e.target ) ) return;
			downAt = Date.now();
		}
		function onUp( e ) {
			if ( ! downAt || ! isIrisTarget( e.target ) ) { downAt = 0; return; }
			var dur = Date.now() - downAt;
			downAt = 0;
			if ( dur > 50 ) { pairs = 0; return; }
			if ( ! firstAt ) firstAt = Date.now();
			if ( Date.now() - firstAt > 5000 ) { pairs = 1; firstAt = Date.now(); return; }
			pairs++;
			if ( pairs >= 7 ) {
				pairs = 0;
				firstAt = 0;
				emit( 'odd.ritual.seven', {} );
				say( 'ritual7' );
				for ( var i = 0; i < 7; i++ ) {
					setTimeout( function () { motion( 'blink' ); }, i * 160 );
				}
				var api = window.__odd.api;
				if ( api && typeof api.savePrefs === 'function' ) {
					api.savePrefs( { winkUnlocked: true } );
				}
				var store = window.__odd.store;
				if ( store && typeof store.set === 'function' ) {
					store.set( 'user.winkUnlocked', true );
				}
			}
		}
		document.addEventListener( 'pointerdown', onDown, true );
		document.addEventListener( 'pointerup',   onUp,   true );
		return function () {
			document.removeEventListener( 'pointerdown', onDown, true );
			document.removeEventListener( 'pointerup',   onUp,   true );
		};
	}

	var RITUALS = [
		{ slug: 'festival', label: 'The Festival', install: installFestival },
		{ slug: 'dream',    label: 'The Dream',    install: installDream    },
		{ slug: 'seven',    label: 'The Seven',    install: installSeven    },
	];

	var hooks = window.wp && window.wp.hooks;
	if ( hooks && typeof hooks.addFilter === 'function' ) {
		hooks.addFilter( 'odd.rituals', 'odd.iris-rituals', function ( list ) {
			var arr = Array.isArray( list ) ? list.slice() : [];
			RITUALS.forEach( function ( r ) {
				var exists = arr.some( function ( e ) { return e && e.slug === r.slug; } );
				if ( ! exists ) arr.push( { slug: r.slug, label: r.label } );
			} );
			return arr;
		} );
	}

	// Install once the foundation reaches `ready`. This keeps
	// ritual keyboard/pointer listeners off the window during the
	// brief boot/configured/mounted window.
	var installed = [];
	function installAll() {
		if ( installed.length ) return;
		RITUALS.forEach( function ( r ) {
			try { installed.push( r.install() ); } catch ( e ) { /* ignore */ }
		} );
	}

	var lifecycle = window.__odd.lifecycle;
	if ( lifecycle && typeof lifecycle.whenPhase === 'function' ) {
		lifecycle.whenPhase( 'ready' ).then( installAll, installAll );
	} else {
		setTimeout( installAll, 0 );
	}

	window.__odd.iris.rituals = {
		list:      function () { return RITUALS.map( function ( r ) { return { slug: r.slug, label: r.label }; } ); },
		uninstall: function () { installed.forEach( function ( fn ) { try { fn(); } catch ( e ) {} } ); installed = []; },
	};
} )();
