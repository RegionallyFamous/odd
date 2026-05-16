/**
 * ODD icon effects.
 *
 * Adds runtime hover/focus decoration around raster icon-set images while
 * preserving the real image as the readable glyph.
 */
( function () {
	'use strict';

	if ( typeof window === 'undefined' || typeof document === 'undefined' ) {
		return;
	}

	var OWNER = 'odd-icon-effects';
	var IMG_SELECTOR = [
		'img.desktop-mode-dock__item-img',
		'img.wp-desktop-dock__item-img',
		'.desktop-mode-icon__image img',
		'.wp-desktop-icon img',
		'.wp-desktop-icon__image img',
		'.odd-dock-rail-mount__tile img',
		'.odd-panel .odd-shop__card-quartet img',
		'.odd-panel .odd-iconset-mini img',
	].join( ',' );

	var observer = null;

	function cfg() {
		return window.oddout || window.odd || {};
	}

	function normalizeUrl( url ) {
		if ( ! url ) {
			return '';
		}
		try {
			return new URL( url, window.location && window.location.href ? window.location.href : document.baseURI ).href;
		} catch ( _ ) {
			return String( url );
		}
	}

	function imageSrc( img ) {
		if ( ! img ) {
			return '';
		}
		return img.currentSrc || img.getAttribute( 'src' ) || img.src || '';
	}

	function iconUrlMap() {
		var c = cfg();
		var list = [];
		var out = {};

		if ( Array.isArray( c.iconSets ) ) {
			list = list.concat( c.iconSets );
		}
		if ( c.bundleCatalog && Array.isArray( c.bundleCatalog.iconSet ) ) {
			list = list.concat( c.bundleCatalog.iconSet );
		}

		list.forEach( function ( set ) {
			if ( ! set || ! set.icons || typeof set.icons !== 'object' ) {
				return;
			}
			Object.keys( set.icons ).forEach( function ( key ) {
				var raw = set.icons[ key ];
				if ( typeof raw !== 'string' || ! raw ) {
					return;
				}
				out[ raw ] = true;
				out[ normalizeUrl( raw ) ] = true;
			} );
		} );

		return out;
	}

	function isKnownIconUrl( src ) {
		if ( ! src ) {
			return false;
		}
		var raw = String( src );
		var normalized = normalizeUrl( raw );
		var map = iconUrlMap();
		if ( map[ raw ] || map[ normalized ] ) {
			return true;
		}
		return normalized.indexOf( '/odd/icon-sets/' ) !== -1 ||
			normalized.indexOf( '/uploads/odd/icon-sets/' ) !== -1 ||
			normalized.indexOf( '/assets/icons/' ) !== -1;
	}

	function isIconSurface( img ) {
		if ( ! img || ! img.closest ) {
			return false;
		}
		return !! (
			img.closest( '.desktop-mode-dock__item' ) ||
			img.closest( '.wp-desktop-dock__item' ) ||
			img.closest( '.desktop-mode-icon' ) ||
			img.closest( '.wp-desktop-icon' ) ||
			img.closest( '.odd-dock-rail-mount__tile' ) ||
			img.closest( '.odd-shop__card-quartet' ) ||
			img.closest( '.odd-iconset-mini' )
		);
	}

	function shouldEnhanceImage( img ) {
		if ( ! img || ! img.matches || ! img.matches( IMG_SELECTOR ) ) {
			return false;
		}
		if ( img.closest( 'picture' ) ) {
			return false;
		}
		if ( img.closest( '.odd-shop__card-quartet' ) || img.closest( '.odd-iconset-mini' ) ) {
			return true;
		}
		if ( img.hasAttribute( 'data-odd-skinned-system-icon' ) ) {
			return true;
		}
		return isIconSurface( img ) && isKnownIconUrl( imageSrc( img ) );
	}

	function cssUrl( src ) {
		return 'url("' + String( src ).replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' ).replace( /[\n\r\f]/g, '' ) + '")';
	}

	function updateWrapperSource( wrapper, src ) {
		if ( ! wrapper || ! src ) {
			return;
		}
		wrapper.style.setProperty( '--odd-icon-fx-src', cssUrl( src ) );
		wrapper.setAttribute( 'data-odd-icon-fx-src', src );
	}

	function unwrapImage( img ) {
		var wrapper = img && img.closest ? img.closest( '.odd-icon-fx' ) : null;
		if ( ! wrapper || ! wrapper.parentNode ) {
			return false;
		}
		wrapper.parentNode.insertBefore( img, wrapper );
		wrapper.parentNode.removeChild( wrapper );
		try {
			delete img.dataset.oddIconFx;
		} catch ( _ ) {
			img.removeAttribute( 'data-odd-icon-fx' );
		}
		return true;
	}

	function enhanceImage( img ) {
		var src = imageSrc( img );
		var wrapper = img && img.closest ? img.closest( '.odd-icon-fx' ) : null;

		if ( ! shouldEnhanceImage( img ) ) {
			if ( wrapper ) {
				unwrapImage( img );
			}
			return false;
		}
		if ( ! src ) {
			return false;
		}
		if ( wrapper ) {
			updateWrapperSource( wrapper, src );
			return true;
		}
		if ( ! img.parentNode ) {
			return false;
		}

		wrapper = document.createElement( 'span' );
		wrapper.className = 'odd-icon-fx';
		updateWrapperSource( wrapper, src );

		img.parentNode.insertBefore( wrapper, img );
		wrapper.appendChild( img );
		img.setAttribute( 'data-odd-icon-fx', 'image' );
		return true;
	}

	function scan( root ) {
		var count = 0;
		var scope = root && ( root.nodeType === 1 || root.nodeType === 9 || root.nodeType === 11 ) ? root : document;
		var images = [];

		if ( scope.matches && scope.matches( IMG_SELECTOR ) ) {
			images.push( scope );
		}
		if ( scope.querySelectorAll ) {
			images = images.concat( Array.prototype.slice.call( scope.querySelectorAll( IMG_SELECTOR ) ) );
		}

		images.forEach( function ( img ) {
			if ( enhanceImage( img ) ) {
				count++;
			}
		} );

		return count;
	}

	function bindHooks() {
		var hooks = window.wp && window.wp.hooks;
		if ( hooks && typeof hooks.addAction === 'function' ) {
			try {
				hooks.addAction( 'odd.pickIconSet', OWNER + '/scan', function () {
					window.setTimeout( function () { scan( document ); }, 0 );
				} );
			} catch ( _ ) {}
		}
		if ( window.__odd && window.__odd.events && typeof window.__odd.events.on === 'function' ) {
			try {
				window.__odd.events.on( 'odd.icon-set-changed', function () {
					window.setTimeout( function () { scan( document ); }, 0 );
				} );
			} catch ( __ ) {}
		}
	}

	function observe() {
		if ( observer || typeof MutationObserver === 'undefined' || ! document.documentElement ) {
			return;
		}
		observer = new MutationObserver( function ( mutations ) {
			mutations.forEach( function ( mutation ) {
				if ( mutation.type === 'attributes' ) {
					if ( mutation.target && mutation.target.matches && mutation.target.matches( IMG_SELECTOR ) ) {
						enhanceImage( mutation.target );
					}
					return;
				}
				Array.prototype.forEach.call( mutation.addedNodes || [], function ( node ) {
					scan( node );
				} );
			} );
		} );
		observer.observe( document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: [ 'src', 'class', 'data-odd-skinned-system-icon' ],
		} );
	}

	function boot() {
		window.__odd = window.__odd || {};
		window.__odd.iconEffects = {
			scan: scan,
			enhanceImage: enhanceImage,
			shouldEnhanceImage: shouldEnhanceImage,
		};
		scan( document );
		observe();
		bindHooks();
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', boot, { once: true } );
	} else {
		boot();
	}
} )();
