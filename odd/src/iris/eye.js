/**
 * Iris — optional in-DOM eye overlay.
 * ---------------------------------------------------------------
 * A lightweight, purely visual companion that responds to the
 * motion primitives. The canonical "eye" of ODD remains the
 * desktop-icon tile (see `odd/includes/native-window.php` →
 * `oddout_control_icon_url`). This module adds an
 * ephemeral floating eye at the top-right of the viewport that
 * materializes only for rituals and occasional reactions, then
 * fades back out.
 *
 * Keeping it transient means:
 *   - it does not compete with the OS accent / scene aesthetic
 *   - it does not ship a persistent DOM element that a user has
 *     to mentally filter out of every frame
 *   - it can be removed entirely by disabling one subscriber
 *
 * Respects `user.mascotQuiet` (still appears for rituals, but
 * silent — no said lines), `runtime.reducedMotion` (shows only a
 * static pose, no blinks).
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;
	window.__odd = window.__odd || {};
	window.__odd.iris = window.__odd.iris || {};
	if ( window.__odd.iris.eye ) return;

	var SVG_NS = 'http://www.w3.org/2000/svg';
	var HOLD_MS = 1600;
	var FADE_MS = 300;

	var root = null;
	var lid  = null;
	var pupil = null;
	var hideTimer = null;
	var state = 'hidden';
	var trackedIcons = [];
	var pointer = { x: null, y: null };
	var trackingRaf = 0;
	var scanTimer = 0;
	var scanInterval = 0;
	var observer = null;
	var pointerHandler = null;
	var domReadyHandler = null;
	var timers = [];
	var eventOffs = [];
	var destroyed = false;

	function clearTrackedTimer( id ) {
		if ( ! id ) return;
		clearTimeout( id );
		timers = timers.filter( function ( item ) { return item !== id; } );
	}

	function later( fn, ms ) {
		var id = setTimeout( function () {
			timers = timers.filter( function ( item ) { return item !== id; } );
			if ( destroyed ) return;
			fn();
		}, ms );
		timers.push( id );
		return id;
	}

	function reducedMotion() {
		var s = window.__odd.store;
		return !! ( s && s.get( 'runtime.reducedMotion' ) );
	}

	function ensure() {
		if ( root ) return;
		root = document.createElementNS( SVG_NS, 'svg' );
		root.setAttribute( 'viewBox', '0 0 64 40' );
		root.setAttribute( 'aria-hidden', 'true' );
		root.setAttribute( 'data-odd-iris', '' );
		root.style.cssText = [
			'position:fixed',
			'top:20px',
			'right:20px',
			'width:80px',
			'height:50px',
			'pointer-events:none',
			'z-index:2147483600',
			'opacity:0',
			'transition:opacity ' + FADE_MS + 'ms ease',
			'filter:drop-shadow(0 4px 12px rgba(0,0,0,0.35))',
		].join( ';' );

		root.innerHTML = [
			'<defs>',
				'<radialGradient id="iris-sclera" cx="42%" cy="40%" r="65%">',
					'<stop offset="0" stop-color="#fdfaf2"/>',
					'<stop offset="1" stop-color="#cdbfa6"/>',
				'</radialGradient>',
				'<radialGradient id="iris-iris" cx="42%" cy="40%" r="65%">',
					'<stop offset="0" stop-color="#ffdd4d"/>',
					'<stop offset="0.45" stop-color="#d946ef"/>',
					'<stop offset="1" stop-color="#2b3dff"/>',
				'</radialGradient>',
			'</defs>',
			'<path d="M 2 20 Q 32 2 62 20 Q 32 38 2 20 Z" fill="url(#iris-sclera)" stroke="#130826" stroke-width="1.3"/>',
			'<g data-eye-pupil>',
				'<circle cx="32" cy="20" r="9" fill="url(#iris-iris)"/>',
				'<circle cx="32" cy="20" r="3.8" fill="#0a0416"/>',
				'<ellipse cx="29" cy="17.5" rx="1.8" ry="1.3" fill="#ffffff" opacity="0.9"/>',
			'</g>',
			'<path data-eye-lid d="M 2 20 Q 32 2 62 20 Q 32 2 2 20 Z" fill="#130826" opacity="0" style="transition:opacity 80ms linear"/>',
		].join( '' );

		document.body.appendChild( root );
		lid   = root.querySelector( '[data-eye-lid]' );
		pupil = root.querySelector( '[data-eye-pupil]' );
	}

	function show( hold ) {
		if ( destroyed ) return;
		ensure();
		if ( hideTimer ) clearTrackedTimer( hideTimer );
		root.style.opacity = '1';
		root.setAttribute( 'data-odd-iris-state', state );
		hideTimer = later( function () {
			root.style.opacity = '0';
			state = 'hidden';
			root.setAttribute( 'data-odd-iris-state', state );
		}, hold == null ? HOLD_MS : hold );
	}

	function pulseLid( count, gap ) {
		if ( ! lid ) return;
		var i = 0;
		function step() {
			if ( destroyed ) return;
			if ( i++ >= count ) return;
			lid.style.opacity = '0.92';
			later( function () {
				lid.style.opacity = '0';
				later( step, gap || 160 );
			}, 90 );
		}
		step();
	}

	function glancePupil( dx, dy ) {
		if ( ! pupil ) return;
		pupil.setAttribute( 'transform', 'translate(' + dx + ',' + dy + ')' );
		later( function () {
			pupil.setAttribute( 'transform', 'translate(0,0)' );
		}, 220 );
	}

	function jitterRoot( ms ) {
		if ( ! root ) return;
		var end = Date.now() + ms;
		function step() {
			if ( destroyed ) return;
			if ( Date.now() > end ) {
				root.style.transform = '';
				return;
			}
			var j = ( Math.random() - 0.5 ) * 4;
			var k = ( Math.random() - 0.5 ) * 4;
			root.style.transform = 'translate(' + j.toFixed( 1 ) + 'px,' + k.toFixed( 1 ) + 'px)';
			later( step, 40 );
		}
		step();
	}

	function makeInlineOddEye( source ) {
		var svg = document.createElementNS( SVG_NS, 'svg' );
		svg.setAttribute( 'viewBox', '0 0 64 64' );
		svg.setAttribute( 'aria-hidden', 'true' );
		svg.setAttribute( 'focusable', 'false' );
		svg.setAttribute( 'data-odd-eye-inline', '' );
		if ( source && source.className ) {
			svg.setAttribute( 'class', source.className );
		}
		svg.style.cssText = [
			'display:block',
			'width:' + ( source && source.offsetWidth ? source.offsetWidth + 'px' : '100%' ),
			'height:' + ( source && source.offsetHeight ? source.offsetHeight + 'px' : '100%' ),
			'overflow:visible',
		].join( ';' );
		svg.innerHTML = [
			'<defs>',
				'<linearGradient id="odd-bg-inline" x1="0" y1="0" x2="1" y2="1">',
					'<stop offset="0" stop-color="#ff4fa8"/>',
					'<stop offset=".55" stop-color="#b04be1"/>',
					'<stop offset="1" stop-color="#5a35d6"/>',
				'</linearGradient>',
				'<radialGradient id="odd-eyeball-inline" cx=".35" cy=".32" r=".95">',
					'<stop offset="0" stop-color="#ffffff"/>',
					'<stop offset=".85" stop-color="#f3f4fa"/>',
					'<stop offset="1" stop-color="#d4d8ea"/>',
				'</radialGradient>',
				'<radialGradient id="odd-iris-inline" cx=".35" cy=".32" r=".9">',
					'<stop offset="0" stop-color="#7ee3ff"/>',
					'<stop offset=".6" stop-color="#1e7ac9"/>',
					'<stop offset="1" stop-color="#0a356b"/>',
				'</radialGradient>',
			'</defs>',
			'<rect x="2" y="2" width="60" height="60" rx="14" fill="url(#odd-bg-inline)"/>',
			'<ellipse cx="32" cy="45" rx="16" ry="2.4" fill="#2a0b52" opacity=".28"/>',
			'<circle cx="32" cy="33" r="21" fill="url(#odd-eyeball-inline)"/>',
			'<g data-odd-eye-pupil style="transition:transform 90ms ease-out">',
				'<circle cx="27" cy="29" r="9.5" fill="url(#odd-iris-inline)"/>',
				'<circle cx="27" cy="29" r="4.2" fill="#091425"/>',
				'<circle cx="24.8" cy="26.8" r="1.9" fill="#ffffff"/>',
				'<circle cx="29.5" cy="31.2" r=".9" fill="#ffffff" opacity=".8"/>',
			'</g>',
			'<path d="M45 14 Q54 8 55 3" fill="none" stroke="#1a0d32" stroke-width="2.4" stroke-linecap="round"/>',
			'<path d="M49.5 46 l1.2 2.8 l2.8 .8 l-2.8 .8 l-1.2 2.8 l-1.2-2.8 l-2.8-.8 l2.8-.8z" fill="#ffe9a8" opacity=".95"/>',
		].join( '' );
		return svg;
	}

	function trackInlineIcon( svg ) {
		if ( ! svg || svg.__oddEyeTracked ) return;
		var p = svg.querySelector( '[data-odd-eye-pupil]' );
		if ( ! p ) return;
		svg.__oddEyeTracked = true;
		trackedIcons.push( { svg: svg, pupil: p } );
	}

	function replaceOddEyeImages() {
		if ( destroyed ) return;
		var imgs = document.querySelectorAll( 'img[src*="/assets/odd-eye.svg"]' );
		for ( var i = 0; i < imgs.length; i++ ) {
			var img = imgs[ i ];
			if ( img.__oddEyeReplaced || ! img.parentNode ) continue;
			img.__oddEyeReplaced = true;
			var inline = makeInlineOddEye( img );
			img.parentNode.replaceChild( inline, img );
			trackInlineIcon( inline );
		}

		var inlineEyes = document.querySelectorAll( 'svg[data-odd-eye-inline]' );
		for ( var j = 0; j < inlineEyes.length; j++ ) {
			trackInlineIcon( inlineEyes[ j ] );
		}
	}

	function updateTrackedEyes() {
		trackingRaf = 0;
		if ( destroyed ) return;
		if ( pointer.x == null || pointer.y == null ) return;
		trackedIcons = trackedIcons.filter( function ( item ) {
			return item.svg && item.svg.isConnected && item.pupil;
		} );
		for ( var i = 0; i < trackedIcons.length; i++ ) {
			var item = trackedIcons[ i ];
			var rect = item.svg.getBoundingClientRect();
			if ( ! rect.width || ! rect.height ) continue;
			var cx = rect.left + rect.width / 2;
			var cy = rect.top + rect.height / 2;
			var nx = Math.max( -1, Math.min( 1, ( pointer.x - cx ) / Math.max( 1, rect.width / 2 ) ) );
			var ny = Math.max( -1, Math.min( 1, ( pointer.y - cy ) / Math.max( 1, rect.height / 2 ) ) );
			var dx = ( nx * 5.2 ).toFixed( 2 );
			var dy = ( ny * 4.2 ).toFixed( 2 );
			item.pupil.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
		}
	}

	function scheduleTrackedEyeUpdate() {
		if ( destroyed ) return;
		if ( trackingRaf ) return;
		trackingRaf = window.requestAnimationFrame( updateTrackedEyes );
	}

	function initPointerTracking() {
		if ( destroyed || pointerHandler ) return;
		replaceOddEyeImages();
		pointerHandler = function ( e ) {
			pointer.x = e.clientX;
			pointer.y = e.clientY;
			scheduleTrackedEyeUpdate();
		};
		document.addEventListener( 'pointermove', pointerHandler, { passive: true } );

		if ( typeof MutationObserver === 'function' ) {
			observer = new MutationObserver( function () {
				if ( scanTimer ) clearTrackedTimer( scanTimer );
				scanTimer = later( replaceOddEyeImages, 80 );
			} );
			observer.observe( document.documentElement, { childList: true, subtree: true } );
		} else {
			scanInterval = setInterval( replaceOddEyeImages, 1200 );
		}
	}

	function onEvent( name, cb ) {
		var evt = window.__odd && window.__odd.events;
		if ( ! evt || typeof evt.on !== 'function' ) return;
		var off = evt.on( name, cb );
		if ( typeof off === 'function' ) eventOffs.push( off );
	}

	function destroy() {
		if ( destroyed ) return;
		destroyed = true;
		if ( hideTimer ) {
			clearTrackedTimer( hideTimer );
			hideTimer = 0;
		}
		if ( scanTimer ) {
			clearTrackedTimer( scanTimer );
			scanTimer = 0;
		}
		while ( timers.length ) {
			clearTimeout( timers.pop() );
		}
		if ( trackingRaf ) {
			window.cancelAnimationFrame( trackingRaf );
			trackingRaf = 0;
		}
		if ( pointerHandler ) {
			document.removeEventListener( 'pointermove', pointerHandler );
			pointerHandler = null;
		}
		if ( domReadyHandler ) {
			document.removeEventListener( 'DOMContentLoaded', domReadyHandler );
			domReadyHandler = null;
		}
		if ( observer ) {
			try { observer.disconnect(); } catch ( e ) {}
			observer = null;
		}
		if ( scanInterval ) {
			clearInterval( scanInterval );
			scanInterval = 0;
		}
		while ( eventOffs.length ) {
			try { eventOffs.pop()(); } catch ( e2 ) {}
		}
		trackedIcons = [];
		if ( root && root.parentNode ) root.parentNode.removeChild( root );
		root = null;
		lid = null;
		pupil = null;
		state = 'hidden';
	}

	var evt = window.__odd.events;
	if ( evt && typeof evt.on === 'function' ) {
		onEvent( 'odd.motion.blink', function () {
			state = 'blinking';
			if ( reducedMotion() ) { show( 800 ); return; }
			show();
			pulseLid( 1 );
		} );
		onEvent( 'odd.motion.wink', function () {
			state = 'winking';
			if ( reducedMotion() ) { show( 800 ); return; }
			show();
			pulseLid( 1, 200 );
		} );
		onEvent( 'odd.motion.glance', function ( opts ) {
			state = 'glancing';
			if ( reducedMotion() ) { show( 800 ); return; }
			show();
			if ( opts && opts.nod ) { glancePupil( 0, 1.5 ); return; }
			var dx = opts && opts.x ? Math.max( -3, Math.min( 3, ( opts.x / window.innerWidth  - 0.5 ) * 6 ) ) : 0;
			var dy = opts && opts.y ? Math.max( -2, Math.min( 2, ( opts.y / window.innerHeight - 0.5 ) * 4 ) ) : 0;
			glancePupil( dx, dy );
		} );
		onEvent( 'odd.motion.glitch', function ( opts ) {
			state = 'glitching';
			show();
			if ( ! reducedMotion() ) jitterRoot( ( opts && opts.ms ) || 220 );
		} );
		onEvent( 'odd.ritual.festival', function () {
			state = 'festival';
			show( 2800 );
			if ( ! reducedMotion() ) {
				pulseLid( 6, 220 );
				jitterRoot( 900 );
			}
		} );
		onEvent( 'odd.ritual.seven', function () {
			state = 'seven';
			show( 2400 );
			pulseLid( 7, 180 );
		} );
		onEvent( 'odd.ritual.dream', function ( opts ) {
			if ( opts && opts.state === 'enter' ) {
				state = 'dreaming';
				show( 3200 );
				pulseLid( 2, 600 );
			}
		} );
		onEvent( 'odd.teardown', destroy );
	}

	// Lightweight test handle — matches the original Iris plan's
	// window.__odd.iris.test surface so automated tests can trip
	// individual moments deterministically.
	window.__odd.iris.eye = {
		show:    show,
		blink:   function () { state = 'blinking';  show(); pulseLid( 1 ); },
		wink:    function () { state = 'winking';   show(); pulseLid( 1, 200 ); },
		glance:  function ( x, y ) { state = 'glancing'; show(); glancePupil( x || 0, y || 0 ); },
		glitch:  function ( ms ) { state = 'glitching'; show(); jitterRoot( ms || 220 ); },
		rescanIcons: replaceOddEyeImages,
		destroy: destroy,
	};

	if ( document.readyState === 'loading' ) {
		domReadyHandler = initPointerTracking;
		document.addEventListener( 'DOMContentLoaded', domReadyHandler, { once: true } );
	} else {
		initPointerTracking();
	}
} )();
