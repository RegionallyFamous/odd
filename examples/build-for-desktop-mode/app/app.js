( function () {
	'use strict';
	var out = document.getElementById( 'status' );
	if ( ! out ) return;
	out.textContent = 'Ready';
	try {
		if ( window.__oddAppDiagnostics && typeof window.__oddAppDiagnostics.push === 'function' ) {
			window.__oddAppDiagnostics.push( 'ready', { message: 'Desktop Mode Hello app rendered.' } );
		}
	} catch ( _ ) {}
} )();
