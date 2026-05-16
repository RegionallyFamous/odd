/**
 * {{name}} widget.
 */
( function () {
	'use strict';

	function mount( root, ctx ) {
		var el = document.createElement( 'div' );
		el.className = 'odd-{{slug}}';
		el.textContent = 'Hello from {{name}}';
		root.appendChild( el );
		if ( ctx && ctx.storage && typeof ctx.storage.set === 'function' ) {
			ctx.storage.set( 'lastMountedAt', new Date().toISOString() );
		}
		return function unmount() { root.removeChild( el ); };
	}

	window.desktopModeWidgets = window.desktopModeWidgets || {};
	window.desktopModeWidgets[ 'odd/{{slug}}' ] = mount;
} )();
