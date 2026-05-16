( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	function ready( cb ) {
		if ( window.wp && window.wp.desktop && typeof window.wp.desktop.ready === 'function' ) {
			window.wp.desktop.ready( cb );
		} else if ( document.readyState === 'loading' ) {
			document.addEventListener( 'DOMContentLoaded', cb, { once: true } );
		} else {
			cb();
		}
	}

	function el( tag, attrs, text ) {
		var node = document.createElement( tag );
		attrs = attrs || {};
		Object.keys( attrs ).forEach( function ( key ) {
			if ( key === 'class' ) node.className = attrs[ key ];
			else node.setAttribute( key, attrs[ key ] );
		} );
		if ( text != null ) node.textContent = String( text );
		return node;
	}

	function mount( container ) {
		var sdk = window.__odd && window.__odd.sdk;
		var health = sdk && typeof sdk.health === 'function' ? sdk.health() : null;
		var status = health && health.status ? health.status : 'unknown';

		container.style.cssText = [
			'box-sizing:border-box',
			'height:100%',
			'padding:14px',
			'border-radius:18px',
			'background:linear-gradient(180deg,#151821,#0b0d13)',
			'color:#f7f7fb',
			'font:13px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
			'box-shadow:0 18px 40px -26px rgba(0,0,0,.7)',
		].join( ';' );

		var title = el( 'strong', {}, 'ODD health' );
		title.style.display = 'block';
		title.style.marginBottom = '8px';
		var pill = el( 'span', { 'aria-live': 'polite' }, status );
		pill.style.cssText = 'display:inline-flex;padding:4px 8px;border-radius:999px;background:#2c3344;color:#c5f6d5;font-weight:800;text-transform:uppercase;font-size:11px;letter-spacing:.05em';
		var note = el( 'p', {}, 'This widget uses the SDK and lets Desktop Mode own movement, sizing, and teardown.' );
		note.style.margin = '12px 0 0';
		note.style.color = '#c9ced8';

		container.appendChild( title );
		container.appendChild( pill );
		container.appendChild( note );

		return function () {
			container.replaceChildren();
			container.removeAttribute( 'style' );
		};
	}

	ready( function () {
		if ( ! window.wp || ! window.wp.desktop || typeof window.wp.desktop.registerWidget !== 'function' ) return;
		window.wp.desktop.registerWidget( {
			id: 'odd/build-for-desktop-mode-widget',
			label: 'Desktop Mode Status',
			description: 'Example ODD widget that reads health through the SDK.',
			icon: 'dashicons-desktop',
			movable: true,
			resizable: true,
			minWidth: 220,
			minHeight: 150,
			defaultWidth: 260,
			defaultHeight: 180,
			mount: mount,
		} );
	} );
} )();
