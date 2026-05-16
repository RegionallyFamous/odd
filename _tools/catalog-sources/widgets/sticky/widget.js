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
				return fn( node, ctx );
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

	function storageGet( ctx, key ) {
		try {
			if ( ctx && ctx.storage && typeof ctx.storage.get === 'function' ) {
				var stored = ctx.storage.get( key );
				return stored == null ? '' : String( stored );
			}
		} catch ( e ) {}
		return '';
	}

	function storageSet( ctx, key, value ) {
		try {
			if ( ctx && ctx.storage && typeof ctx.storage.set === 'function' ) {
				ctx.storage.set( key, value );
			}
		} catch ( e ) {}
	}

	var STICKY_MAX = 2000;

	function readStickyTilt( ctx ) {
		var raw = storageGet( ctx, 'tilt' );
		if ( raw == null || raw === '' ) return null;
		var n = parseFloat( raw );
		if ( ! isFinite( n ) ) return null;
		return Math.max( -3, Math.min( 3, n ) );
	}
	function writeStickyTilt( ctx, n ) {
		storageSet( ctx, 'tilt', n );
	}

	function mountSticky( container, ctx ) {
		container.classList.add( 'odd-widget', 'odd-widget--sticky' );

		var tilt = readStickyTilt( ctx );
		if ( tilt == null ) {
			tilt = ( Math.random() * 4 - 2 ); // -2..+2
			writeStickyTilt( ctx, tilt );
		}
		if ( reducedMotion() ) tilt = 0;

		var paper = el( 'div', { class: 'odd-sticky__paper', style: 'transform:rotate(' + tilt.toFixed( 2 ) + 'deg)' } );
		var peel  = el( 'div', { class: 'odd-sticky__peel', 'aria-hidden': 'true' } );
		var ta    = el( 'textarea', {
			class:       'odd-sticky__text',
			maxlength:   String( STICKY_MAX ),
			placeholder: __( 'Scribble something…' ),
			spellcheck:  'true',
			'aria-label': __( 'Sticky note' ),
		} );
		var meta  = el( 'div', { class: 'odd-sticky__meta', 'aria-hidden': 'true' } );

		paper.appendChild( ta );
		paper.appendChild( peel );
		paper.appendChild( meta );
		container.appendChild( paper );

		ta.value = storageGet( ctx, 'text' );

		function renderMeta() {
			meta.textContent = ta.value.length + ' / ' + STICKY_MAX;
		}
		renderMeta();

		var saveTimer = 0;
		function scheduleSave() {
			if ( saveTimer ) window.clearTimeout( saveTimer );
			saveTimer = window.setTimeout( function () {
				saveTimer = 0;
				storageSet( ctx, 'text', ta.value );
			}, 400 );
		}

		function onInput() {
			renderMeta();
			scheduleSave();
		}
		ta.addEventListener( 'input', onInput );

		return function () {
			if ( saveTimer ) {
				window.clearTimeout( saveTimer );
				storageSet( ctx, 'text', ta.value );
			}
			ta.removeEventListener( 'input', onInput );
			container.classList.remove( 'odd-widget', 'odd-widget--sticky' );
		};
	}

	window.desktopModeWidgets = window.desktopModeWidgets || {};
	window.desktopModeWidgets[ 'odd/sticky' ] = safeMount( mountSticky, 'widget.sticky' );
} )();
