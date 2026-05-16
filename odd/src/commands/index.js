/**
 * ODD — slash-command integration for WP Desktop Mode's palette
 * ---------------------------------------------------------------
 * Registers ODD slash commands on the host-native command surface:
 *
 *   /odd [scene]        swap to a scene (autocomplete from the
 *                       registered catalog; no-arg = random).
 *   /odd-icons [set]    swap to an icon set (autocomplete; 'none'
 *                       is valid and reverts to WP defaults).
 *   /shuffle            pick a random non-current scene.
 *   /odd-panel          open the ODD Shop native window.
 *
 * All commands route through window.__odd.api so they share the live
 * swap + REST persistence path with the widgets and the panel.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	var desktopAdapter = window.__odd && window.__odd.desktop || null;

	function desktop() {
		return desktopAdapter && typeof desktopAdapter.host === 'function'
			? desktopAdapter.host()
			: ( window.wp && window.wp.desktop ) || null;
	}

	function ready( cb ) {
		if ( desktopAdapter && typeof desktopAdapter.ready === 'function' ) {
			desktopAdapter.ready( cb );
			return;
		}
		var d = desktop();
		if ( d && typeof d.ready === 'function' ) {
			d.ready( cb );
		} else if ( document.readyState === 'loading' ) {
			document.addEventListener( 'DOMContentLoaded', cb, { once: true } );
		} else {
			cb();
		}
	}

	function api() { return window.__odd && window.__odd.api; }
	function norm( s ) { return String( s || '' ).trim().toLowerCase(); }

	// Wrap a command run handler so a throw in one command doesn't poison
	// the rest of the palette. Reported as `odd.error` on the bus with the
	// command slug in the `source` so the debug inspector can show which
	// command misbehaved.
	function safeRun( fn, source ) {
		return function ( args, ctx ) {
			try {
				return fn( args, ctx );
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
					} catch ( e ) {}
				}
				if ( window.console ) { try { window.console.error( '[ODD ' + source + ']', err ); } catch ( e ) {} }
				return 'ODD hit a snag running that command. Reload and try again.';
			}
		};
	}
	function safeSuggest( fn, source ) {
		return function ( args ) {
			try { return fn( args ); } catch ( err ) {
				if ( window.__odd && window.__odd.events ) {
					try {
						window.__odd.events.emit( 'odd.error', {
							source:   source,
							err:      err,
							severity: 'warning',
							message:  err && err.message,
							stack:    err && err.stack,
						} );
					} catch ( e ) {}
				}
				return [];
			}
		};
	}

	// Fuzzy-ish substring match on slug + label. Low ceremony; the palette
	// already narrows by the /slug prefix, so this only filters the args.
	function matches( needle, candidates ) {
		var n = norm( needle );
		if ( ! n ) return candidates.slice();
		return candidates.filter( function ( c ) {
			return norm( c.value ).indexOf( n ) >= 0 || norm( c.label ).indexOf( n ) >= 0;
		} );
	}

	function sceneSuggestions( args ) {
		if ( ! api() ) return [];
		return matches( args, api().scenes().map( function ( s ) {
			return {
				value:       s.slug,
				label:       s.label || s.slug,
				description: s.category || '',
				icon:        'dashicons-art',
			};
		} ) );
	}

	function iconSetSuggestions( args ) {
		var list = [];
		if ( api() ) {
			list = api().iconSets().map( function ( s ) {
				return {
					value:       s.slug,
					label:       s.label || s.slug,
					description: s.category || '',
					icon:        'dashicons-grid-view',
				};
			} );
		}
		list.unshift( {
			value:       'none',
			label:       'Default',
			description: 'WP Desktop Mode stock icons',
			icon:        'dashicons-no-alt',
		} );
		return matches( args, list );
	}

	function run_odd( args ) {
		var a = api();
		if ( ! a ) return 'ODD is not ready yet.';
		var slug = norm( args );
		if ( ! slug ) {
			var ok = a.shuffle();
			return ok
				? 'Shuffled to a random scene.'
				: 'No scenes registered yet.';
		}
		var scene = a.sceneBySlug( slug );
		if ( ! scene ) return 'Unknown scene "' + slug + '". Try /odd with Tab for a list.';
		if ( slug === a.currentScene() ) return scene.label + ' is already playing.';
		a.setScene( slug );
		return 'Now playing: ' + ( scene.label || slug ) + '.';
	}

	function run_oddIcons( args ) {
		var a = api();
		if ( ! a ) return 'ODD is not ready yet.';
		var slug = norm( args );
		if ( ! slug ) return 'Usage: /odd-icons [set]. Tab to see available sets.';
		var set = slug === 'none' ? { label: 'Default' } : a.iconSetBySlug( slug );
		if ( ! set ) return 'Unknown icon set "' + slug + '". Try /odd-icons with Tab for a list.';
		var cur = a.currentIconSet() || 'none';
		if ( slug === cur ) return ( set.label || slug ) + ' is already active.';
		a.setIconSet( slug );
		return 'Applying ' + ( set.label || slug ) + '… reloading.';
	}

	function run_shuffle() {
		var a = api();
		if ( ! a ) return 'ODD is not ready yet.';
		var ok = a.shuffle();
		if ( ! ok ) return 'No scenes registered yet.';
		var s = a.sceneBySlug( a.currentScene() );
		return 'Shuffled to ' + ( ( s && s.label ) ? s.label : 'a random scene' ) + '.';
	}

	function run_panel( args, ctx ) {
		var a = api();
		if ( a && a.openPanel() ) {
			if ( ctx && ctx.close ) ctx.close();
			return;
		}
		return 'ODD Shop is unavailable — WP Desktop Mode may not be ready yet.';
	}

	function run_tidyWidgets() {
		var a = api();
		if ( ! a || typeof a.tidyWidgets !== 'function' ) return 'ODD widgets are not ready yet.';
		return a.tidyWidgets() ? 'Gathered ODD widgets.' : 'No installed ODD widgets to gather yet.';
	}

	function run_resetDecorations() {
		var a = api();
		if ( ! a || typeof a.resetDecorations !== 'function' ) return 'ODD decorations are not ready yet.';
		return a.resetDecorations() ? 'Reset ODD decorations.' : 'ODD decorations were already reset.';
	}

	function run_settings() {
		var a = api();
		if ( ! a || typeof a.openOsSettings !== 'function' ) return 'Desktop Mode settings are not ready yet.';
		return a.openOsSettings() ? undefined : 'Desktop Mode settings are unavailable.';
	}

	function run_diagnostics() {
		var d = window.__odd && window.__odd.diagnostics;
		if ( d && typeof d.copy === 'function' ) {
			d.copy();
			return 'Copied ODD diagnostics.';
		}
		return 'ODD diagnostics are not ready yet.';
	}

	var palette = {
		el: null,
		input: null,
		list: null,
		open: false,
		actions: [],
		filtered: [],
		active: 0,
		unregister: null,
	};

	function esc( s ) {
		return String( s || '' )
			.replace( /&/g, '&amp;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' )
			.replace( /"/g, '&quot;' );
	}

	function installPaletteStyle() {
		if ( document.getElementById( 'odd-command-palette-style' ) ) return;
		var style = document.createElement( 'style' );
		style.id = 'odd-command-palette-style';
		style.textContent = [
			'.odd-command-palette{position:fixed;inset:0;z-index:100000;display:grid;place-items:start center;padding:clamp(18px,10vh,92px) 18px;background:rgba(8,4,18,.52);backdrop-filter:blur(10px);}',
			'.odd-command-palette[hidden]{display:none;}',
			'.odd-command-palette__panel{width:min(760px,calc(100vw - 32px));max-height:min(76vh,720px);overflow:hidden;border:1px solid rgba(255,255,255,.18);border-radius:18px;background:linear-gradient(180deg,rgba(23,18,37,.98),rgba(8,9,20,.98));box-shadow:0 24px 80px rgba(0,0,0,.48);color:#f8fafc;}',
			'.odd-command-palette__head{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1);}',
			'.odd-command-palette__mark{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#f472d0,#6ee7f9);color:#0b1020;font-weight:800;}',
			'.odd-command-palette__input{flex:1;min-width:0;background:transparent;border:0;outline:0;color:inherit;font:600 18px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
			'.odd-command-palette__input::placeholder{color:rgba(248,250,252,.55);}',
			'.odd-command-palette__hint{font-size:12px;color:rgba(248,250,252,.62);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:4px 8px;}',
			'.odd-command-palette__list{max-height:calc(min(76vh,720px) - 64px);overflow:auto;padding:8px;}',
			'.odd-command-palette__item{width:100%;display:grid;grid-template-columns:36px 1fr auto;align-items:center;gap:12px;text-align:left;padding:10px 12px;border:0;border-radius:12px;background:transparent;color:inherit;cursor:pointer;}',
			'.odd-command-palette__item:hover,.odd-command-palette__item.is-active{background:rgba(255,255,255,.1);}',
			'.odd-command-palette__icon{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.08);font:normal 18px/1 dashicons;}',
			'.odd-command-palette__title{font-weight:700;font-size:14px;}',
			'.odd-command-palette__desc{margin-top:2px;color:rgba(248,250,252,.62);font-size:12px;}',
			'.odd-command-palette__kind{color:rgba(248,250,252,.52);font-size:11px;text-transform:uppercase;letter-spacing:.08em;}',
			'.odd-command-palette__empty{padding:26px 18px;color:rgba(248,250,252,.66);}',
			'@media (max-width:560px){.odd-command-palette{place-items:start stretch;padding:10px}.odd-command-palette__panel{width:auto;border-radius:14px}.odd-command-palette__hint{display:none}.odd-command-palette__item{grid-template-columns:32px 1fr}.odd-command-palette__kind{display:none}}',
		].join( '\n' );
		document.head.appendChild( style );
	}

	function action( kind, icon, title, description, run ) {
		return {
			kind: kind,
			icon: icon || 'dashicons-star-filled',
			title: title,
			description: description || '',
			run: run,
		};
	}

	function collectPaletteActions() {
		var a = api();
		if ( ! a ) return [];
		var out = [
			action( 'Shop', 'dashicons-cart', 'Open ODD Shop', 'Browse wallpapers, icons, cursors, widgets, and apps.', function () { a.openPanel(); } ),
			action( 'Wallpaper', 'dashicons-controls-forward', 'Shuffle ODD wallpaper', 'Jump to another installed scene.', function () { a.shuffle(); } ),
		];

		if ( typeof a.scenes === 'function' ) {
			a.scenes().forEach( function ( scene ) {
				if ( ! scene || ! scene.slug ) return;
				out.push( action(
					'Wallpaper',
					'dashicons-art',
					'Use ' + ( scene.label || scene.slug ),
					scene.category || 'ODD scene',
					function () { a.setScene( scene.slug ); }
				) );
			} );
		}

		if ( typeof a.iconSets === 'function' ) {
			out.push( action( 'Icons', 'dashicons-no-alt', 'Use default icons', 'Return Desktop Mode icons to their original set.', function () { a.setIconSet( 'none' ); } ) );
			a.iconSets().forEach( function ( set ) {
				if ( ! set || ! set.slug ) return;
				out.push( action( 'Icons', 'dashicons-grid-view', 'Use ' + ( set.label || set.slug ), set.category || 'Icon set', function () { a.setIconSet( set.slug ); } ) );
			} );
		}

		if ( typeof a.cursorSets === 'function' ) {
			out.push( action( 'Cursors', 'dashicons-marker', 'Use default cursors', 'Return to browser and Desktop Mode cursors.', function () { a.setCursorSet( 'none' ); } ) );
			a.cursorSets().forEach( function ( set ) {
				if ( ! set || ! set.slug ) return;
				out.push( action( 'Cursors', 'dashicons-marker', 'Use ' + ( set.label || set.slug ), set.category || 'Cursor set', function () { a.setCursorSet( set.slug ); } ) );
			} );
		}

		if ( typeof a.installedWidgets === 'function' ) {
			a.installedWidgets().forEach( function ( widget ) {
				if ( ! widget || ! widget.id ) return;
				out.push( action( 'Widgets', 'dashicons-screenoptions', 'Add ' + ( widget.label || widget.slug || widget.id ), widget.category || widget.description || 'Desktop widget', function () { a.mountWidget( widget.id ); } ) );
			} );
		}

		if ( typeof a.apps === 'function' ) {
			a.apps().forEach( function ( app ) {
				if ( ! app || ! app.slug ) return;
				out.push( action( 'Apps', 'dashicons-admin-plugins', 'Open ' + ( app.name || app.label || app.slug ), app.description || 'Installed ODD app', function () { a.openApp( app.slug ); } ) );
			} );
		}

		out.push( action( 'Desktop', 'dashicons-admin-settings', 'Open ODD settings', 'Jump to Desktop Mode settings.', function () { a.openOsSettings(); } ) );
		out.push( action( 'Desktop', 'dashicons-image-rotate', 'Reset ODD decorations', 'Reset active icon and cursor decorations.', function () { a.resetDecorations(); } ) );
		return out;
	}

	function filterPaletteActions() {
		var query = palette.input ? norm( palette.input.value ) : '';
		var parts = query ? query.split( /\s+/ ).filter( Boolean ) : [];
		palette.filtered = palette.actions.filter( function ( item ) {
			if ( ! parts.length ) return true;
			var hay = norm( [ item.kind, item.title, item.description ].join( ' ' ) );
			return parts.every( function ( p ) { return hay.indexOf( p ) !== -1; } );
		} ).slice( 0, 40 );
		if ( palette.active >= palette.filtered.length ) palette.active = 0;
	}

	function renderPaletteList() {
		if ( ! palette.list ) return;
		filterPaletteActions();
		if ( ! palette.filtered.length ) {
			palette.list.innerHTML = '<div class="odd-command-palette__empty">No ODD actions match that search.</div>';
			return;
		}
		palette.list.innerHTML = palette.filtered.map( function ( item, i ) {
			return '<button type="button" class="odd-command-palette__item' + ( i === palette.active ? ' is-active' : '' ) + '" data-odd-palette-index="' + i + '">'
				+ '<span class="odd-command-palette__icon dashicons ' + esc( item.icon ) + '" aria-hidden="true"></span>'
				+ '<span><span class="odd-command-palette__title">' + esc( item.title ) + '</span><span class="odd-command-palette__desc">' + esc( item.description ) + '</span></span>'
				+ '<span class="odd-command-palette__kind">' + esc( item.kind ) + '</span>'
				+ '</button>';
		} ).join( '' );
	}

	function runPaletteAction( index ) {
		var item = palette.filtered[ index ];
		if ( ! item || typeof item.run !== 'function' ) return;
		try { item.run(); } catch ( e ) {
			if ( window.console ) { try { window.console.error( '[ODD palette]', e ); } catch ( _ ) {} }
		}
		closePalette();
	}

	function ensurePalette() {
		if ( palette.el ) return palette.el;
		installPaletteStyle();
		var el = document.createElement( 'div' );
		el.className = 'odd-command-palette';
		el.hidden = true;
		el.innerHTML = [
			'<div class="odd-command-palette__panel" role="dialog" aria-modal="true" aria-label="ODD palette">',
			'<div class="odd-command-palette__head">',
			'<span class="odd-command-palette__mark" aria-hidden="true">O</span>',
			'<input class="odd-command-palette__input" type="search" autocomplete="off" spellcheck="false" placeholder="Search ODD" aria-label="Search ODD actions">',
			'<span class="odd-command-palette__hint">Esc</span>',
			'</div>',
			'<div class="odd-command-palette__list" role="listbox"></div>',
			'</div>',
		].join( '' );
		palette.el = el;
		palette.input = el.querySelector( '.odd-command-palette__input' );
		palette.list = el.querySelector( '.odd-command-palette__list' );
		palette.input.addEventListener( 'input', renderPaletteList );
		palette.input.addEventListener( 'keydown', function ( ev ) {
			if ( ev.key === 'Escape' ) {
				ev.preventDefault();
				closePalette();
			} else if ( ev.key === 'ArrowDown' ) {
				ev.preventDefault();
				palette.active = palette.filtered.length ? ( palette.active + 1 ) % palette.filtered.length : 0;
				renderPaletteList();
			} else if ( ev.key === 'ArrowUp' ) {
				ev.preventDefault();
				palette.active = palette.filtered.length ? ( palette.active - 1 + palette.filtered.length ) % palette.filtered.length : 0;
				renderPaletteList();
			} else if ( ev.key === 'Enter' ) {
				ev.preventDefault();
				runPaletteAction( palette.active );
			}
		} );
		palette.list.addEventListener( 'click', function ( ev ) {
			var btn = ev.target && ev.target.closest ? ev.target.closest( '[data-odd-palette-index]' ) : null;
			if ( ! btn ) return;
			runPaletteAction( parseInt( btn.getAttribute( 'data-odd-palette-index' ), 10 ) || 0 );
		} );
		el.addEventListener( 'click', function ( ev ) {
			if ( ev.target === el ) closePalette();
		} );
		document.body.appendChild( el );
		return el;
	}

	function openPalette() {
		var el = ensurePalette();
		palette.actions = collectPaletteActions();
		palette.active = 0;
		palette.open = true;
		el.hidden = false;
		if ( palette.input ) {
			palette.input.value = '';
			renderPaletteList();
			window.setTimeout( function () {
				try { palette.input.focus(); } catch ( e ) {}
			}, 0 );
		}
	}

	function closePalette() {
		if ( ! palette.el ) return;
		palette.open = false;
		palette.el.hidden = true;
	}

	function registerOddPalette() {
		if ( palette.unregister ) return;
		var def = {
			id: 'odd',
			label: 'ODD',
			open: openPalette,
			close: closePalette,
			isOpen: function () { return !! palette.open; },
		};
		if ( desktopAdapter && typeof desktopAdapter.registerPalette === 'function' ) {
			palette.unregister = desktopAdapter.registerPalette( def );
			return;
		}
		var d = desktop();
		if ( ! d || typeof d.registerPalette !== 'function' ) return;
		palette.unregister = d.registerPalette( def );
	}

	function registerCommand( def ) {
		if ( desktopAdapter && typeof desktopAdapter.registerCommand === 'function' ) {
			return desktopAdapter.registerCommand( def );
		}
		var d = desktop();
		if ( ! d || typeof d.registerCommand !== 'function' ) return false;
		d.registerCommand( def );
		return true;
	}

	ready( function () {
		if ( ! ( desktopAdapter && desktopAdapter.capabilities && desktopAdapter.capabilities().commands ) ) {
			var d = desktop();
			if ( ! d || typeof d.registerCommand !== 'function' ) return;
		}

		registerCommand( {
			slug:        'odd',
			label:       'ODD: pick a scene',
			description: 'Swap the live PixiJS wallpaper scene.',
			hint:        '[scene] · blank = random',
			icon:        'dashicons-art',
			owner:       'odd-commands',
			suggest:     safeSuggest( sceneSuggestions, 'command.odd.suggest' ),
			run:         safeRun( run_odd, 'command.odd' ),
		} );

		registerCommand( {
			slug:        'odd-icons',
			label:       'ODD: pick an icon set',
			description: 'Swap the Desktop Mode icon set.',
			hint:        '[set] · "none" to reset',
			icon:        'dashicons-grid-view',
			owner:       'odd-commands',
			suggest:     safeSuggest( iconSetSuggestions, 'command.odd-icons.suggest' ),
			run:         safeRun( run_oddIcons, 'command.odd-icons' ),
		} );

		registerCommand( {
			slug:        'shuffle',
			label:       'ODD: shuffle scene',
			description: 'Jump to a random scene right now.',
			icon:        'dashicons-controls-forward',
			owner:       'odd-commands',
			run:         safeRun( run_shuffle, 'command.shuffle' ),
		} );

		registerCommand( {
			slug:        'odd-panel',
			label:       'ODD: open Shop',
			description: 'Open (or focus) the ODD Shop window.',
			icon:        'dashicons-cart',
			owner:       'odd-commands',
			run:         safeRun( run_panel, 'command.odd-panel' ),
		} );

		registerCommand( {
			slug:        'odd-tidy-widgets',
			label:       'ODD: tidy widgets',
			description: 'Gather floating ODD widgets back into the Desktop Mode widget rail.',
			icon:        'dashicons-align-wide',
			owner:       'odd-commands',
			run:         safeRun( run_tidyWidgets, 'command.odd-tidy-widgets' ),
		} );

		registerCommand( {
			slug:        'odd-reset-decorations',
			label:       'ODD: reset decorations',
			description: 'Reset active ODD icon and cursor decorations.',
			icon:        'dashicons-image-rotate',
			owner:       'odd-commands',
			run:         safeRun( run_resetDecorations, 'command.odd-reset-decorations' ),
		} );

		registerCommand( {
			slug:        'odd-settings',
			label:       'ODD: open Desktop Mode settings',
			description: 'Open Desktop Mode settings with the ODD tab available.',
			icon:        'dashicons-admin-settings',
			owner:       'odd-commands',
			run:         safeRun( run_settings, 'command.odd-settings' ),
		} );

		registerCommand( {
			slug:        'odd-diagnostics',
			label:       'ODD: copy diagnostics',
			description: 'Copy local ODD and Desktop Mode integration diagnostics.',
			icon:        'dashicons-clipboard',
			owner:       'odd-commands',
			run:         safeRun( run_diagnostics, 'command.odd-diagnostics' ),
		} );

		registerOddPalette();
	} );
} )();
