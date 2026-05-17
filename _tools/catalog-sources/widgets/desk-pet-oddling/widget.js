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

	function subscribeOddEvent( name, fn ) {
		var events = window.__odd && window.__odd.events;
		if ( ! events || typeof events.on !== 'function' ) return function () {};
		try {
			var off = events.on( name, fn );
			return typeof off === 'function' ? off : function () {};
		} catch ( e ) {
			return function () {};
		}
	}

	var MOODS = {
		idle:      '0% 0%',
		blink:     '50% 0%',
		nap:       '100% 0%',
		surprised: '0% 100%',
		wave:      '50% 100%',
		sign:      '100% 100%',
	};

	var SIGNS = [
		'SHIP IT',
		'CACHE?',
		'HI ADMIN',
		'BRB NAP',
		'LGTM',
		'GOOD ODD',
	];

	function mountDeskPetOddling( container ) {
		container.classList.add( 'odd-widget', 'odd-widget--desk-pet-oddling' );
		container.textContent = '';

		var reduced = reducedMotion();
		if ( reduced ) container.classList.add( 'is-reduced' );

		var shell = el( 'div', { class: 'odd-oddling', role: 'group', 'aria-label': __( 'Desk Pet Oddling' ) } );
		var glow = el( 'div', { class: 'odd-oddling__glow', 'aria-hidden': 'true' } );
		var sign = el( 'div', { class: 'odd-oddling__sign', 'aria-live': 'polite' }, __( 'HI' ) );
		var sprite = el( 'div', { class: 'odd-oddling__sprite', 'aria-hidden': 'true' } );
		var shadow = el( 'div', { class: 'odd-oddling__shadow', 'aria-hidden': 'true' } );
		var status = el( 'div', { class: 'odd-oddling__status', role: 'status', 'aria-live': 'polite' }, __( 'Keeping watch' ) );

		shell.appendChild( glow );
		shell.appendChild( sign );
		shell.appendChild( sprite );
		shell.appendChild( shadow );
		shell.appendChild( status );
		container.appendChild( shell );

		var mood = 'idle';
		var timers = [];
		var cleanups = [];
		var done = false;

		function setLater( fn, delay ) {
			var id = window.setTimeout( fn, delay );
			timers.push( id );
			return id;
		}

		function clearLater( id ) {
			window.clearTimeout( id );
			timers = timers.filter( function ( timer ) { return timer !== id; } );
		}

		function setMood( next, label, hold ) {
			mood = next || 'idle';
			container.setAttribute( 'data-mood', mood );
			container.classList.toggle( 'is-surprised', mood === 'surprised' );
			container.classList.toggle( 'is-napping', mood === 'nap' );
			container.classList.toggle( 'is-holding-sign', mood === 'sign' );
			sprite.style.backgroundPosition = MOODS[ mood ] || MOODS.idle;
			if ( label ) status.textContent = label;
			if ( hold ) {
				setLater( function () {
					if ( ! done && mood === next ) setMood( 'idle', __( 'Keeping watch' ) );
				}, hold );
			}
		}

		function choose( list ) {
			return list[ Math.floor( Math.random() * list.length ) ];
		}

		function showSign() {
			sign.textContent = choose( SIGNS );
			setMood( 'sign', __( 'Important sign deployed' ), reduced ? 1200 : 2400 );
		}

		function blink() {
			setMood( 'blink', __( 'Blink' ), reduced ? 400 : 720 );
		}

		function nap() {
			setMood( 'nap', __( 'Napping softly' ), reduced ? 1200 : 2800 );
		}

		function wave() {
			setMood( 'wave', __( 'Waving hello' ), reduced ? 900 : 1600 );
		}

		function scheduleAmbient() {
			if ( done ) return;
			var id = setLater( function () {
				clearLater( id );
				if ( done ) return;
				if ( mood === 'idle' ) {
					var roll = Math.random();
					if ( roll < 0.28 ) nap();
					else if ( roll < 0.55 ) showSign();
					else if ( roll < 0.78 ) wave();
					else blink();
				}
				scheduleAmbient();
			}, reduced ? 6000 : 3600 + Math.floor( Math.random() * 3200 ) );
		}

		var watchTimer = 0;
		function onPointerMove( ev ) {
			if ( done ) return;
			var rect = container.getBoundingClientRect();
			var x = ( ev.clientX - rect.left ) / Math.max( 1, rect.width ) - 0.5;
			var y = ( ev.clientY - rect.top ) / Math.max( 1, rect.height ) - 0.5;
			x = Math.max( -1, Math.min( 1, x ) );
			y = Math.max( -1, Math.min( 1, y ) );
			container.style.setProperty( '--oddling-look-x', x.toFixed( 3 ) );
			container.style.setProperty( '--oddling-look-y', y.toFixed( 3 ) );
			container.classList.add( 'is-watching' );
			status.textContent = __( 'Watching the cursor' );
			if ( watchTimer ) window.clearTimeout( watchTimer );
			watchTimer = window.setTimeout( function () {
				watchTimer = 0;
				container.classList.remove( 'is-watching' );
				if ( mood === 'idle' ) status.textContent = __( 'Keeping watch' );
			}, 1400 );
		}

		function reactToDesktop() {
			setMood( 'surprised', __( 'Desktop moved' ), reduced ? 900 : 1600 );
		}

		window.addEventListener( 'pointermove', onPointerMove, { passive: true } );
		cleanups.push( function () { window.removeEventListener( 'pointermove', onPointerMove ); } );
		cleanups.push( subscribeOddEvent( 'odd.window-bounds-changed', reactToDesktop ) );
		cleanups.push( subscribeOddEvent( 'odd.window-focused', wave ) );
		cleanups.push( subscribeOddEvent( 'odd.desktop-layout-changed', reactToDesktop ) );

		setMood( 'idle', __( 'Keeping watch' ) );
		scheduleAmbient();

		return function () {
			if ( done ) return;
			done = true;
			timers.forEach( function ( id ) { window.clearTimeout( id ); } );
			if ( watchTimer ) window.clearTimeout( watchTimer );
			cleanups.forEach( function ( cleanup ) {
				try { cleanup(); } catch ( e ) {}
			} );
			container.style.removeProperty( '--oddling-look-x' );
			container.style.removeProperty( '--oddling-look-y' );
			container.classList.remove(
				'odd-widget',
				'odd-widget--desk-pet-oddling',
				'is-reduced',
				'is-watching',
				'is-surprised',
				'is-napping',
				'is-holding-sign'
			);
			container.removeAttribute( 'data-mood' );
		};
	}

	window.desktopModeWidgets = window.desktopModeWidgets || {};
	window.desktopModeWidgets[ 'odd/desk-pet-oddling' ] = safeMount( mountDeskPetOddling, 'widget.desk-pet-oddling' );
} )();
