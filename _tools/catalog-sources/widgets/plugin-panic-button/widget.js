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

	var CHECKLIST = [
		'Clear cache',
		'Check console',
		'Disable last plugin',
		'Inspect logs',
	];

	var STATES = [
		'Scanning update queue',
		'Checking cache sparks',
		'Reading console noise',
		'Calm path found',
	];

	function restoreChecked( ctx ) {
		var checked = storageGet( ctx, 'checked', [] );
		return Array.isArray( checked ) ? checked.slice( 0, CHECKLIST.length ).map( Boolean ) : [];
	}

	function mountPluginPanicButton( container, ctx ) {
		container.classList.add( 'odd-widget', 'odd-widget--plugin-panic-button' );
		container.textContent = '';

		var reduced = reducedMotion();
		if ( reduced ) container.classList.add( 'is-reduced' );

		var shell = el( 'div', { class: 'odd-panic', role: 'group', 'aria-label': __( 'Plugin Panic Button' ) } );
		var status = el( 'div', { class: 'odd-panic__status', role: 'status', 'aria-live': 'polite' }, __( 'Stand by' ) );
		var button = el( 'button', { type: 'button', class: 'odd-panic__button', 'aria-label': __( 'Start plugin panic checklist' ) }, [
			el( 'span', { class: 'odd-panic__button-ring', 'aria-hidden': 'true' } ),
			el( 'span', { class: 'odd-panic__button-label' }, __( 'PANIC' ) ),
		] );
		var list = el( 'div', { class: 'odd-panic__checklist', role: 'list' } );
		var reset = el( 'button', { type: 'button', class: 'odd-panic__reset' }, __( 'Reset' ) );

		shell.appendChild( status );
		shell.appendChild( button );
		shell.appendChild( list );
		shell.appendChild( reset );
		container.appendChild( shell );

		var checked = restoreChecked( ctx );
		var timers = [];
		var busy = false;
		var done = false;

		function persist() {
			storageSet( ctx, 'checked', checked.slice( 0, CHECKLIST.length ) );
		}

		function setPhase( phase ) {
			container.setAttribute( 'data-phase', phase );
			container.classList.toggle( 'is-calm', phase === 'calm' );
			container.classList.toggle( 'is-running', phase === 'running' );
		}

		function renderChecklist() {
			list.textContent = '';
			CHECKLIST.forEach( function ( item, index ) {
				var isChecked = !! checked[ index ];
				var row = el( 'button', {
					type:           'button',
					class:          isChecked ? 'odd-panic__item is-checked' : 'odd-panic__item',
					role:           'listitem',
					'aria-pressed': isChecked ? 'true' : 'false',
					'data-index':   String( index ),
				}, [
					el( 'span', { class: 'odd-panic__box', 'aria-hidden': 'true' }, isChecked ? 'OK' : '' ),
					el( 'span', { class: 'odd-panic__text' }, item ),
				] );
				list.appendChild( row );
			} );
		}

		function runPanic() {
			if ( busy || done ) return;
			busy = true;
			button.disabled = true;
			setPhase( 'running' );
			status.textContent = STATES[ 0 ];

			STATES.forEach( function ( state, index ) {
				var id = window.setTimeout( function () {
					if ( done ) return;
					status.textContent = state;
					if ( index === STATES.length - 1 ) {
						busy = false;
						button.disabled = false;
						setPhase( 'calm' );
					}
				}, reduced ? 80 * index : 420 * index );
				timers.push( id );
			} );
		}

		function onButton( ev ) {
			ev.preventDefault();
			runPanic();
		}

		function onListClick( ev ) {
			var item = ev.target.closest && ev.target.closest( '.odd-panic__item' );
			if ( ! item || ! list.contains( item ) ) return;
			var index = parseInt( item.getAttribute( 'data-index' ), 10 );
			if ( ! isFinite( index ) ) return;
			checked[ index ] = ! checked[ index ];
			persist();
			renderChecklist();
			if ( checked.filter( Boolean ).length === CHECKLIST.length ) {
				status.textContent = __( 'All calm. Save the tiny diff.' );
			}
		}

		function onReset( ev ) {
			ev.preventDefault();
			checked = [];
			persist();
			renderChecklist();
			status.textContent = __( 'Stand by' );
			setPhase( 'ready' );
		}

		button.addEventListener( 'click', onButton );
		list.addEventListener( 'click', onListClick );
		reset.addEventListener( 'click', onReset );
		renderChecklist();
		setPhase( 'ready' );

		return function () {
			if ( done ) return;
			done = true;
			timers.forEach( function ( id ) { window.clearTimeout( id ); } );
			button.removeEventListener( 'click', onButton );
			list.removeEventListener( 'click', onListClick );
			reset.removeEventListener( 'click', onReset );
			container.classList.remove(
				'odd-widget',
				'odd-widget--plugin-panic-button',
				'is-reduced',
				'is-calm',
				'is-running'
			);
			container.removeAttribute( 'data-phase' );
		};
	}

	window.desktopModeWidgets = window.desktopModeWidgets || {};
	window.desktopModeWidgets[ 'odd/plugin-panic-button' ] = safeMount( mountPluginPanicButton, 'widget.plugin-panic-button' );
} )();
