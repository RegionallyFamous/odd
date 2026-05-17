( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	var wpI18nW = window.wp && window.wp.i18n;
	function __( s ) {
		return ( wpI18nW && typeof wpI18nW.__ === 'function' ) ? wpI18nW.__( s, 'odd' ) : s;
	}

	function el( tag, attrs, children ) {
		var n = document.createElement( tag );
		if ( attrs ) {
			for ( var k in attrs ) {
				if ( ! Object.prototype.hasOwnProperty.call( attrs, k ) ) continue;
				if ( k === 'class' ) n.className = attrs[ k ];
				else if ( k === 'style' ) n.setAttribute( 'style', attrs[ k ] );
				else n.setAttribute( k, attrs[ k ] );
			}
		}
		if ( children ) {
			if ( ! Array.isArray( children ) ) children = [ children ];
			children.forEach( function ( c ) {
				if ( c == null ) return;
				n.appendChild( typeof c === 'string' ? document.createTextNode( c ) : c );
			} );
		}
		return n;
	}

	function reducedMotion() {
		try {
			return window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
		} catch ( e ) { return false; }
	}

	function safeMount( fn, source ) {
		return function ( node, ctx ) {
			try {
				return fn( node, ctx || {} );
			} catch ( err ) {
				if ( window.__odd && window.__odd.events ) {
					try {
						window.__odd.events.emit( 'odd.error', {
							source:   source,
							err:      err,
							severity: 'error',
							message:  err && err.message,
							stack:    err && err.stack,
						} );
					} catch ( e2 ) {}
				}
				if ( window.console ) { try { window.console.error( '[ODD ' + source + ']', err ); } catch ( e3 ) {} }
				return function () {};
			}
		};
	}

	function mountTinyAquarium( container ) {
		container.classList.add( 'odd-widget', 'odd-widget--tiny-aquarium' );
		container.textContent = '';

		var reduced = reducedMotion();
		if ( reduced ) container.classList.add( 'is-reduced' );

		var shell = el( 'div', { class: 'odd-aquarium', role: 'group', 'aria-label': __( 'Tiny Aquarium' ) } );
		var tank = el( 'button', { type: 'button', class: 'odd-aquarium__tank', 'aria-label': __( 'Feed the tiny aquarium' ) } );
		var backdrop = el( 'div', { class: 'odd-aquarium__backdrop', 'aria-hidden': 'true' } );
		var shimmer = el( 'div', { class: 'odd-aquarium__shimmer', 'aria-hidden': 'true' } );
		var plants = el( 'div', { class: 'odd-aquarium__plants', 'aria-hidden': 'true' } );
		var bubbles = el( 'div', { class: 'odd-aquarium__bubbles', 'aria-hidden': 'true' } );
		var fishA = el( 'span', { class: 'odd-aquarium__fish odd-aquarium__fish--one', 'aria-hidden': 'true' } );
		var fishB = el( 'span', { class: 'odd-aquarium__fish odd-aquarium__fish--two', 'aria-hidden': 'true' } );
		var fishC = el( 'span', { class: 'odd-aquarium__fish odd-aquarium__fish--three', 'aria-hidden': 'true' } );
		var status = el( 'div', { class: 'odd-aquarium__status', role: 'status', 'aria-live': 'polite' }, __( 'Drifting' ) );

		tank.appendChild( backdrop );
		tank.appendChild( shimmer );
		tank.appendChild( plants );
		tank.appendChild( bubbles );
		tank.appendChild( fishA );
		tank.appendChild( fishB );
		tank.appendChild( fishC );
		shell.appendChild( tank );
		shell.appendChild( status );
		container.appendChild( shell );

		var timers = [];
		var done = false;

		function clearBurst( node, delay ) {
			var id = window.setTimeout( function () {
				if ( node && node.parentNode ) node.parentNode.removeChild( node );
			}, delay );
			timers.push( id );
		}

		function addBurst() {
			if ( done ) return;
			status.textContent = __( 'Bubbles!' );
			var burst = el( 'span', { class: 'odd-aquarium__burst', 'aria-hidden': 'true' } );
			var feed = el( 'span', { class: 'odd-aquarium__feed', 'aria-hidden': 'true' } );
			tank.appendChild( burst );
			tank.appendChild( feed );
			while ( tank.querySelectorAll( '.odd-aquarium__burst' ).length > 3 ) {
				var oldBurst = tank.querySelector( '.odd-aquarium__burst' );
				if ( oldBurst ) oldBurst.remove();
			}
			while ( tank.querySelectorAll( '.odd-aquarium__feed' ).length > 3 ) {
				var oldFeed = tank.querySelector( '.odd-aquarium__feed' );
				if ( oldFeed ) oldFeed.remove();
			}
			clearBurst( burst, reduced ? 600 : 1400 );
			clearBurst( feed, reduced ? 600 : 1600 );
			var id = window.setTimeout( function () {
				if ( ! done ) status.textContent = __( 'Drifting' );
			}, reduced ? 800 : 1800 );
			timers.push( id );
		}

		function onClick( ev ) {
			ev.preventDefault();
			addBurst();
		}

		tank.addEventListener( 'click', onClick );

		return function () {
			if ( done ) return;
			done = true;
			timers.forEach( function ( id ) { window.clearTimeout( id ); } );
			tank.removeEventListener( 'click', onClick );
			container.classList.remove( 'odd-widget', 'odd-widget--tiny-aquarium', 'is-reduced' );
		};
	}

	window.desktopModeWidgets = window.desktopModeWidgets || {};
	window.desktopModeWidgets[ 'odd/tiny-aquarium' ] = safeMount( mountTinyAquarium, 'widget.tiny-aquarium' );
} )();
