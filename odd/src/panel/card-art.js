/**
 * ODD Shop card artwork renderer.
 *
 * Kept out of the main panel renderer so the Shop shell can stay small enough
 * to reason about while every tile still uses one shared art path.
 */
( function () {
	'use strict';

	if ( typeof window === 'undefined' ) {
		return;
	}

	window.__odd = window.__odd || {};

	function fallbackEl( tag, attrs ) {
		var node = document.createElement( tag );
		attrs = attrs || {};
		Object.keys( attrs ).forEach( function ( key ) {
			if ( key === 'class' ) {
				node.className = attrs[ key ];
			} else if ( key === 'text' ) {
				node.textContent = attrs[ key ];
			} else {
				node.setAttribute( key, attrs[ key ] );
			}
		} );
		return node;
	}

	function artImage( createEl, src, className ) {
		var img = createEl( 'img', {
			src: src,
			alt: '',
			loading: 'lazy',
			decoding: 'async',
			width: '512',
			height: '512',
		} );
		if ( className ) {
			img.classList.add( className );
		}
		return img;
	}

	function shortLabel( row ) {
		return String( row.name || row.label || row.slug || '' ).slice( 0, 2 ).toUpperCase();
	}

	function monoPlate( createEl, row, text ) {
		var mono = createEl( 'div', { class: 'odd-shop__card-mono' } );
		mono.textContent = text || shortLabel( row );
		return mono;
	}

	function isBundledAppIcon( src ) {
		src = String( src || '' );
		return src && src.indexOf( 'data:' ) !== 0 && src.indexOf( 'http' ) !== 0;
	}

	function bundledAppIconUrl( row, restUrl ) {
		return String( restUrl || '' ).replace( /\/prefs\/?$/, '' ) + '/apps/icon/' + row.slug;
	}

	function render( row, opts ) {
		opts = opts || {};
		row = row || {};

		var createEl = opts.el || fallbackEl;
		var art = createEl( 'div', {
			class: 'odd-shop__card-art odd-shop__card-art--' + row.type,
			'aria-hidden': 'true',
		} );

		if ( row.type === 'scene' ) {
			art.style.backgroundColor = row.fallbackColor || '#1d1d22';
			var sceneUrl = row.previewUrl || row.iconUrl || row.cardUrl || '';
			if ( sceneUrl ) {
				art.appendChild( artImage( createEl, sceneUrl, 'odd-shop__card-art-fill' ) );
			} else {
				art.appendChild( monoPlate( createEl, row ) );
			}
			return art;
		}

		if ( row.type === 'icon-set' ) {
			if ( row.icons ) {
				var iconGrid = createEl( 'div', { class: 'odd-shop__card-icon-grid' } );
				var keys = [ 'odd', 'my-wordpress', 'content-graph', 'recycle-bin', 'fallback' ].filter( function ( key ) {
					return row.icons[ key ];
				} );
				if ( ! keys.length ) {
					keys = Object.keys( row.icons ).slice( 0, 5 );
				}
				keys.slice( 0, 5 ).forEach( function ( key ) {
					iconGrid.appendChild( artImage( createEl, row.icons[ key ] ) );
				} );
				if ( iconGrid.children.length ) {
					art.classList.add( 'odd-shop__card-art--icon-grid' );
					art.appendChild( iconGrid );
					return art;
				}
			}

			var iconSetUrl = row.cardUrl || row.iconUrl || row.preview;
			if ( iconSetUrl ) {
				art.appendChild( artImage( createEl, iconSetUrl, 'odd-shop__card-art-fill' ) );
				return art;
			}
			art.appendChild( monoPlate( createEl, row ) );
			return art;
		}

		if ( row.cardUrl ) {
			art.appendChild( artImage( createEl, row.cardUrl, 'odd-shop__card-art-fill' ) );
			return art;
		}

		if ( row.type === 'cursor-set' ) {
			art.style.background = row.accent || '#38e8ff';
			var cursorUrl = row.preview || row.iconUrl;
			if ( cursorUrl ) {
				art.appendChild( artImage( createEl, cursorUrl, 'odd-shop__card-art-fill' ) );
				return art;
			}
			art.appendChild( monoPlate( createEl, row, '\u27b9' ) );
			return art;
		}

		if ( row.type === 'widget' ) {
			art.style.background = 'linear-gradient(135deg,#3b3b52 0%,#6d6d8a 55%,#b5b5cc 100%)';
			if ( row.iconUrl ) {
				art.appendChild( artImage( createEl, row.iconUrl, 'odd-shop__card-art-fill' ) );
			} else {
				art.appendChild( monoPlate( createEl, row ) );
			}
			art.appendChild( createEl( 'span', { class: 'odd-shop__card-shine' } ) );
			return art;
		}

		if ( row.type === 'app' ) {
			if ( row.iconUrl ) {
				var src = row.iconUrl;
				if ( isBundledAppIcon( src ) ) {
					src = bundledAppIconUrl( row, opts.restUrl );
				}
				art.appendChild( artImage( createEl, src ) );
			} else {
				art.appendChild( monoPlate( createEl, row ) );
			}
		}

		return art;
	}

	window.__odd.panelCardArt = {
		render: render,
	};
}() );
