( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	var wpI18nW = window.wp && window.wp.i18n;
	function __( s ) {
		return ( wpI18nW && typeof wpI18nW.__ === 'function' ) ? wpI18nW.__( s, 'odd' ) : s;
	}

	function ready( cb ) {
		if ( window.wp && window.wp.desktop && typeof window.wp.desktop.ready === 'function' ) {
			window.wp.desktop.ready( cb );
		} else if ( document.readyState === 'loading' ) {
			document.addEventListener( 'DOMContentLoaded', cb, { once: true } );
		} else {
			cb();
		}
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

	var EIGHT_ANSWERS = [
			'It is decidedly so',
			'Without a doubt, ship it',
			'Yes — definitely',
			'You may rely on it',
			'As I see it, yes',
			'Most likely',
			'Outlook good',
			'Signs point to yes',
			'Signs point to plugin conflict',
			'My sources say Gutenberg',
			'Reply hazy — flush permalinks',
			'Ask again after wp_cache_flush()',
			'Better not tell you now',
			'Cannot predict now — wp-admin is down',
			'Concentrate and ask again',
			'Consult your staging env',
			'Outlook unclear — try incognito',
			'Don’t count on it',
			'My reply is no',
			'My sources say no',
			'Very doubtful — check wp-config.php',
			'The classic editor says otherwise',
			'It has been filtered to false',
			'Hooks say yes, themes say no',
			'Try again after `wp plugin deactivate`',
			'The cache knows, but it isn’t telling',
			'Only on Tuesdays',
			'The database has the final word',
			'Ask a block, it depends',
			'Chmod 644 says maybe'
		];
	
		function mountEightBall( container ) {
			container.classList.add( 'odd-widget', 'odd-widget--eight' );
	
			var reduced = reducedMotion();
	
			var stage = el( 'button', {
				type:       'button',
				class:      'odd-eight__stage',
				'aria-label': __( 'Magic 8-ball. Click to shake for a new answer.' ),
			} );
	
			var ball      = el( 'div', { class: 'odd-eight__ball' } );
			var shine     = el( 'div', { class: 'odd-eight__shine', 'aria-hidden': 'true' } );
			var badge     = el( 'div', { class: 'odd-eight__badge', 'aria-hidden': 'true' }, '8' );
			var window_   = el( 'div', { class: 'odd-eight__window' } );
			var triangle  = el( 'div', { class: 'odd-eight__triangle' } );
			var answer    = el( 'div', { class: 'odd-eight__answer', role: 'status', 'aria-live': 'polite' }, 'Ask a question' );
			var hint      = el( 'div', { class: 'odd-eight__hint', 'aria-hidden': 'true' }, 'Click to consult' );
	
			triangle.appendChild( answer );
			window_.appendChild( triangle );
			ball.appendChild( shine );
			ball.appendChild( badge );
			ball.appendChild( window_ );
			stage.appendChild( ball );
			container.appendChild( stage );
			container.appendChild( hint );
	
			if ( reduced ) container.classList.add( 'is-reduced' );
	
			var lastIdx = -1;
			var shaking = false;
	
			function pickAnswer() {
				if ( EIGHT_ANSWERS.length < 2 ) return EIGHT_ANSWERS[ 0 ] || '';
				var idx;
				do {
					idx = Math.floor( Math.random() * EIGHT_ANSWERS.length );
				} while ( idx === lastIdx );
				lastIdx = idx;
				return EIGHT_ANSWERS[ idx ];
			}
	
			var shakeTimer = 0;
			var fadeTimer  = 0;
	
			function shake() {
				if ( shaking ) return;
				shaking = true;
				hint.textContent = __( 'Consulting…' );
	
				var next = pickAnswer();
	
				if ( reduced ) {
					answer.classList.add( 'is-fading' );
					fadeTimer = window.setTimeout( function () {
						answer.textContent = next;
						answer.classList.remove( 'is-fading' );
						shaking = false;
						hint.textContent = __( 'Click to consult' );
					}, 180 );
					return;
				}
	
				ball.classList.add( 'is-shaking' );
				answer.classList.add( 'is-fading' );
				shakeTimer = window.setTimeout( function () {
					ball.classList.remove( 'is-shaking' );
					answer.textContent = next;
					// Let the fade out finish, then fade in.
					window.requestAnimationFrame( function () {
						answer.classList.remove( 'is-fading' );
						shaking = false;
						hint.textContent = __( 'Click to consult' );
					} );
				}, 520 );
			}
	
			function onClick( ev ) { ev.preventDefault(); shake(); }
			function onKey( ev ) {
				if ( ev.key === 'Enter' || ev.key === ' ' ) { ev.preventDefault(); shake(); }
			}
	
			stage.addEventListener( 'click', onClick );
			stage.addEventListener( 'keydown', onKey );
	
			// Subtle mouse parallax on the highlight. Skipped in reduced motion.
			function onMove( ev ) {
				if ( reduced ) return;
				var r = ball.getBoundingClientRect();
				var x = ( ev.clientX - r.left ) / Math.max( 1, r.width )  - 0.5;
				var y = ( ev.clientY - r.top  ) / Math.max( 1, r.height ) - 0.5;
				shine.style.transform = 'translate3d(' + ( -x * 14 ).toFixed( 2 ) + 'px,' + ( -y * 14 ).toFixed( 2 ) + 'px,0)';
			}
			function onLeave() { shine.style.transform = ''; }
			stage.addEventListener( 'pointermove', onMove );
			stage.addEventListener( 'pointerleave', onLeave );
	
			return function () {
				if ( shakeTimer ) window.clearTimeout( shakeTimer );
				if ( fadeTimer )  window.clearTimeout( fadeTimer );
				stage.removeEventListener( 'click', onClick );
				stage.removeEventListener( 'keydown', onKey );
				stage.removeEventListener( 'pointermove', onMove );
				stage.removeEventListener( 'pointerleave', onLeave );
				container.classList.remove( 'odd-widget', 'odd-widget--eight', 'is-reduced' );
			};
		}

	ready( function () {
		if ( ! window.wp || ! window.wp.desktop || typeof window.wp.desktop.registerWidget !== 'function' ) return;
		window.wp.desktop.registerWidget( {
			id:            'odd/eight-ball',
			label:         __( 'ODD · Magic 8-Ball' ),
			description:   __( 'A WordPress-flavored magic 8-ball. Click to shake.' ),
			icon:          'dashicons-editor-help',
			movable:       true,
			resizable:     true,
			minWidth:      200,
			minHeight:     220,
			defaultWidth:  240,
			defaultHeight: 260,
			mount:         safeMount( mountEightBall, 'widget.eight-ball' ),
		} );
	} );
} )();
