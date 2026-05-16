/**
 * ODD example widget — says hello.
 *
 * Reference implementation of a widget bundle. The host loads
 * widget.js + widget.css, then Desktop Mode reads the mount callback
 * from window.desktopModeWidgets[id].
 */
( function () {
	'use strict';

	function mount( root ) {
		var h = document.createElement( 'div' );
		h.className = 'odd-example-hello';
		h.textContent = 'Hello from example-hello.';
		root.appendChild( h );
		return function unmount() { root.removeChild( h ); };
	}

	window.desktopModeWidgets = window.desktopModeWidgets || {};
	window.desktopModeWidgets[ 'odd/example-hello' ] = mount;
} )();
