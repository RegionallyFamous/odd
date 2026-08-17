( function () {
	'use strict';

	var reduce = false;
	try {
		reduce = window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
	} catch ( e ) {}

	if ( reduce ) {
		document.documentElement.classList.add( 'reduce-motion' );
		return;
	}

	var root = document.documentElement;
	var activeCard = null;
	var chaosButton = document.querySelector( '[data-chaos]' );
	var trail = [];
	var maxTrail = 18;
	var hue = 0;

	function clamp( n, min, max ) {
		return Math.max( min, Math.min( max, n ) );
	}

	function makeComet() {
		var el = document.createElement( 'span' );
		el.className = 'cursor-comet';
		document.body.appendChild( el );
		return el;
	}

	for ( var i = 0; i < maxTrail; i++ ) {
		trail.push( makeComet() );
	}

	window.addEventListener( 'pointermove', function ( ev ) {
		root.style.setProperty( '--mx', ev.clientX + 'px' );
		root.style.setProperty( '--my', ev.clientY + 'px' );

		hue = ( hue + 9 ) % 360;
		var dot = trail.pop();
		trail.unshift( dot );
		dot.style.left = ev.clientX + 'px';
		dot.style.top = ev.clientY + 'px';
		dot.style.setProperty( '--hue', hue );
		dot.classList.remove( 'is-on' );
		void dot.offsetWidth;
		dot.classList.add( 'is-on' );

		var card = ev.target && ev.target.closest ? ev.target.closest( '.tilt-card, .wild-card' ) : null;

		if ( activeCard && activeCard !== card ) {
			activeCard.style.setProperty( '--tilt-x', '0deg' );
			activeCard.style.setProperty( '--tilt-y', '0deg' );
		}

		if ( card ) {
			var r = card.getBoundingClientRect();
			var px = ( ev.clientX - r.left ) / Math.max( 1, r.width ) - 0.5;
			var py = ( ev.clientY - r.top ) / Math.max( 1, r.height ) - 0.5;
			card.style.setProperty( '--tilt-x', clamp( py * -14, -14, 14 ).toFixed( 2 ) + 'deg' );
			card.style.setProperty( '--tilt-y', clamp( px * 18, -18, 18 ).toFixed( 2 ) + 'deg' );
		}

		activeCard = card;
	}, { passive: true } );

	if ( chaosButton ) {
		chaosButton.addEventListener( 'click', function () {
			document.body.classList.add( 'chaos-mode' );
			window.setTimeout( function () {
				document.body.classList.remove( 'chaos-mode' );
			}, 1500 );
		} );
	}

	document.querySelectorAll( '.scene-pill' ).forEach( function ( pill, index ) {
		pill.addEventListener( 'mouseenter', function () {
			document.body.style.setProperty( '--scene-hue', ( index * 58 + 180 ) + 'deg' );
			document.body.classList.add( 'scene-hover' );
		} );
		pill.addEventListener( 'mouseleave', function () {
			document.body.classList.remove( 'scene-hover' );
		} );
	} );
} )();
