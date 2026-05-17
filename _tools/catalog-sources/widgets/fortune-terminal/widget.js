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

	function storageGet( ctx, key, fallback ) {
		try {
			if ( ctx && ctx.storage && typeof ctx.storage.get === 'function' ) {
				var stored = ctx.storage.get( key );
				return stored == null ? fallback : stored;
			}
		} catch ( e ) {}
		return fallback;
	}

	function storageSet( ctx, key, value ) {
		try {
			if ( ctx && ctx.storage && typeof ctx.storage.set === 'function' ) {
				ctx.storage.set( key, value );
			}
		} catch ( e ) {}
	}

	var FORTUNES = [
		'wp_cache_flush() returned a wink.',
		'Hook priority 11 knows too much.',
		'Today favors small commits.',
		'The block editor dreams in JSON.',
		'Permalinks are aligned with the moon.',
		'One stale transient seeks closure.',
		'The console is dramatic but useful.',
		'Your plugin header feels lucky.',
		'Shortcodes whisper from the archive.',
		'A clean diff opens the hidden door.',
		'The admin bar remembers everything.',
		'REST routes hum at low voltage.',
	];

	function restoreLines( ctx ) {
		var lines = storageGet( ctx, 'lines', [] );
		return Array.isArray( lines ) ? lines.slice( -5 ).map( String ) : [];
	}

	function mountFortuneTerminal( container, ctx ) {
		container.classList.add( 'odd-widget', 'odd-widget--fortune-terminal' );
		container.textContent = '';

		var reduced = reducedMotion();
		if ( reduced ) container.classList.add( 'is-reduced' );

		var shell = el( 'div', { class: 'odd-fortune', role: 'group', 'aria-label': __( 'Fortune Terminal' ) } );
		var header = el( 'div', { class: 'odd-fortune__header' }, [
			el( 'span', { class: 'odd-fortune__light odd-fortune__light--red', 'aria-hidden': 'true' } ),
			el( 'span', { class: 'odd-fortune__light odd-fortune__light--yellow', 'aria-hidden': 'true' } ),
			el( 'span', { class: 'odd-fortune__light odd-fortune__light--green', 'aria-hidden': 'true' } ),
			el( 'span', { class: 'odd-fortune__title' }, __( 'ODD TERM' ) ),
		] );
		var output = el( 'div', { class: 'odd-fortune__output', role: 'log', 'aria-live': 'polite' } );
		var prompt = el( 'button', { type: 'button', class: 'odd-fortune__prompt' }, [
			el( 'span', { class: 'odd-fortune__chevron', 'aria-hidden': 'true' }, '>' ),
			el( 'span', {}, __( 'print omen' ) ),
		] );
		var scan = el( 'div', { class: 'odd-fortune__scan', 'aria-hidden': 'true' } );

		shell.appendChild( header );
		shell.appendChild( output );
		shell.appendChild( prompt );
		shell.appendChild( scan );
		container.appendChild( shell );

		var lines = restoreLines( ctx );
		var timers = [];
		var typing = false;
		var done = false;
		var lastIndex = -1;

		function persist() {
			storageSet( ctx, 'lines', lines.slice( -5 ) );
		}

		function renderLine( text, active ) {
			var row = el( 'div', { class: active ? 'odd-fortune__line is-typing' : 'odd-fortune__line' } );
			row.appendChild( el( 'span', { class: 'odd-fortune__mark', 'aria-hidden': 'true' }, '$' ) );
			row.appendChild( el( 'span', { class: 'odd-fortune__text' }, text ) );
			output.appendChild( row );
			output.scrollTop = output.scrollHeight;
			return row.querySelector( '.odd-fortune__text' );
		}

		function renderStored() {
			output.textContent = '';
			lines.forEach( function ( line ) { renderLine( line, false ); } );
		}

		function pickFortune() {
			if ( FORTUNES.length < 2 ) return FORTUNES[ 0 ] || '';
			var idx;
			do {
				idx = Math.floor( Math.random() * FORTUNES.length );
			} while ( idx === lastIndex );
			lastIndex = idx;
			return FORTUNES[ idx ];
		}

		function trimOutput() {
			while ( output.children.length > 5 ) output.removeChild( output.firstChild );
		}

		function printLine() {
			if ( typing || done ) return;
			var text = pickFortune();
			typing = true;
			prompt.disabled = true;
			var target = renderLine( '', true );
			trimOutput();
			var i = 0;

			function finish() {
				target.textContent = text;
				var row = target.closest( '.odd-fortune__line' );
				if ( row ) row.classList.remove( 'is-typing' );
				lines.push( text );
				lines = lines.slice( -5 );
				persist();
				typing = false;
				prompt.disabled = false;
			}

			if ( reduced ) {
				finish();
				return;
			}

			function tick() {
				if ( done ) return;
				i += 1;
				target.textContent = text.slice( 0, i );
				output.scrollTop = output.scrollHeight;
				if ( i >= text.length ) {
					finish();
					return;
				}
				timers.push( window.setTimeout( tick, 18 ) );
			}
			timers.push( window.setTimeout( tick, 18 ) );
		}

		function onClick( ev ) {
			ev.preventDefault();
			printLine();
		}

		function onKey( ev ) {
			if ( ev.key === 'Enter' ) {
				ev.preventDefault();
				printLine();
			}
		}

		prompt.addEventListener( 'click', onClick );
		prompt.addEventListener( 'keydown', onKey );

		if ( lines.length ) renderStored();
		else {
			lines = [ 'boot: omen cache warm' ];
			renderStored();
			persist();
		}

		return function () {
			if ( done ) return;
			done = true;
			timers.forEach( function ( id ) { window.clearTimeout( id ); } );
			prompt.removeEventListener( 'click', onClick );
			prompt.removeEventListener( 'keydown', onKey );
			container.classList.remove( 'odd-widget', 'odd-widget--fortune-terminal', 'is-reduced' );
		};
	}

	window.desktopModeWidgets = window.desktopModeWidgets || {};
	window.desktopModeWidgets[ 'odd/fortune-terminal' ] = safeMount( mountFortuneTerminal, 'widget.fortune-terminal' );
} )();
