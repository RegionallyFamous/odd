( () => {
	'use strict';

	const APP_SLUG = 'pantry';
	const WINDOW_ID = 'odd-app-pantry';
	const LOCAL_PREFS_KEY = 'odd.pantry.preferences';
	const LAYOUT_BLOCKS = new Set( [
		'core/buttons',
		'core/columns',
		'core/cover',
		'core/group',
		'core/media-text',
		'core/query',
		'core/row',
		'core/stack',
	] );
	const BLOCK_LABELS = {
		'core/button': 'Button',
		'core/buttons': 'Buttons',
		'core/column': 'Column',
		'core/columns': 'Columns',
		'core/cover': 'Cover',
		'core/gallery': 'Gallery',
		'core/group': 'Group',
		'core/heading': 'Heading',
		'core/image': 'Image',
		'core/list': 'List',
		'core/media-text': 'Media & text',
		'core/paragraph': 'Paragraph',
		'core/pullquote': 'Pullquote',
		'core/query': 'Query',
		'core/quote': 'Quote',
		'core/row': 'Row',
		'core/separator': 'Separator',
		'core/social-links': 'Social links',
		'core/spacer': 'Spacer',
		'core/stack': 'Stack',
	};
	const ACCENTS = [ '#26dcc7', '#ff4aa2', '#a777ff', '#ffc857', '#5bbcff' ];
	const RECIPES = {
		blank: `<!-- wp:paragraph -->
<p>Add your reusable content here.</p>
<!-- /wp:paragraph -->`,
		cta: `<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group"><!-- wp:heading {"textAlign":"center","level":3} -->
<h3 class="wp-block-heading has-text-align-center">A clear, useful heading</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center"} -->
<p class="has-text-align-center">Add one short sentence that explains what happens next.</p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons"><!-- wp:button -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button">Take the next step</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:group -->`,
		quote: `<!-- wp:quote -->
<blockquote class="wp-block-quote"><!-- wp:paragraph -->
<p>Add a memorable quotation here.</p>
<!-- /wp:paragraph --><cite>Source name</cite></blockquote>
<!-- /wp:quote -->`,
		columns: `<!-- wp:columns -->
<div class="wp-block-columns"><!-- wp:column -->
<div class="wp-block-column"><!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">First idea</h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Explain the first half of the story.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column"><!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">Second idea</h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Give the second half room to breathe.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:column --></div>
<!-- /wp:columns -->`,
	};

	const state = {
		patterns: [],
		favorites: new Set(),
		filter: 'all',
		query: '',
		sort: 'modified',
		selectedId: null,
		loading: false,
	};

	const dom = {};
	let runtime;
	let toastTimer = 0;

	class PantryApiError extends Error {
		constructor( message, status, code = '' ) {
			super( message );
			this.name = 'PantryApiError';
			this.status = status;
			this.code = code;
		}
	}

	function cacheDom() {
		[
			'app-main', 'pattern-search', 'pattern-sort', 'refresh-patterns', 'new-pattern',
			'pattern-total', 'count-all', 'count-favorites', 'count-single', 'count-layout',
			'result-count', 'pattern-grid', 'empty-state', 'empty-title', 'empty-copy',
			'empty-create', 'error-state', 'error-copy', 'error-retry', 'pattern-inspector',
			'favorite-pattern', 'close-inspector', 'pattern-title', 'pattern-updated',
			'title-view', 'title-editor', 'rename-input', 'rename-pattern', 'cancel-rename',
			'preview-kind', 'pattern-preview', 'block-total', 'block-chips', 'copy-pattern',
			'duplicate-pattern', 'open-pattern', 'trash-pattern', 'create-dialog', 'create-form',
			'new-pattern-title', 'create-submit', 'trash-dialog', 'trash-form',
			'trash-pattern-name', 'toast',
		].forEach( ( id ) => {
			dom[ id ] = document.getElementById( id );
		} );
		dom.appMain = document.querySelector( '.app-main' );
		dom.filterButtons = [ ...document.querySelectorAll( '.filter-button' ) ];
	}

	function getHostApi() {
		try {
			if ( window.parent && window.parent !== window ) {
				return window.parent.wp?.os || null;
			}
		} catch ( _error ) {
			// Same-origin access is expected, but the URL fallback still works.
		}
		return null;
	}

	function detectRuntime() {
		const host = getHostApi();
		const nonce = new URLSearchParams( window.location.search ).get( '_wpnonce' ) ||
			host?.config?.restNonce || '';
		let adminBase;
		let restBase;

		if ( host?.config?.adminUrl ) {
			adminBase = new URL( host.config.adminUrl, window.location.origin );
			restBase = new URL( '../wp-json/', adminBase );
		} else {
			const marker = '/odd-app/';
			const markerIndex = window.location.pathname.indexOf( marker );
			const sitePath = markerIndex >= 0 ? window.location.pathname.slice( 0, markerIndex ) : '';
			const normalizedPath = sitePath.endsWith( '/' ) ? sitePath : `${ sitePath }/`;
			adminBase = new URL( `${ normalizedPath }wp-admin/`, window.location.origin );
			restBase = new URL( `${ normalizedPath }wp-json/`, window.location.origin );
		}

		return { host, nonce, adminBase, restBase };
	}

	async function apiRequest( path, options = {} ) {
		const url = new URL( path.replace( /^\//, '' ), runtime.restBase );
		const headers = new Headers( options.headers || {} );
		headers.set( 'Accept', 'application/json' );
		if ( runtime.nonce ) {
			headers.set( 'X-WP-Nonce', runtime.nonce );
		}
		let body = options.body;
		if ( body !== undefined && typeof body !== 'string' && ! ( body instanceof FormData ) ) {
			headers.set( 'Content-Type', 'application/json' );
			body = JSON.stringify( body );
		}

		const requestOptions = {
			...options,
			body,
			headers,
			credentials: 'same-origin',
		};
		const response = typeof runtime.host?.fetch === 'function'
			? await runtime.host.fetch( url, requestOptions, {
				windowId: WINDOW_ID,
				source: 'odd-app/pantry',
				silent: true,
			} )
			: await fetch( url, requestOptions );

		if ( ! response.ok ) {
			let message = `${ response.status } ${ response.statusText || 'Request failed' }`;
			let code = '';
			try {
				const error = await response.json();
				message = error.message || message;
				code = error.code || '';
			} catch ( _error ) {
				// Keep the HTTP fallback message.
			}
			throw new PantryApiError( message, response.status, code );
		}

		return response;
	}

	async function apiJson( path, options = {} ) {
		const response = await apiRequest( path, options );
		if ( response.status === 204 ) {
			return null;
		}
		return response.json();
	}

	async function loadAllPatterns() {
		const patterns = [];
		let page = 1;
		let totalPages = 1;
		do {
			const query = new URLSearchParams( {
				context: 'edit',
				per_page: '100',
				page: String( page ),
				orderby: 'modified',
				order: 'desc',
			} );
			[ 'publish', 'draft', 'private' ].forEach( ( status ) => query.append( 'status[]', status ) );
			const response = await apiRequest( `wp/v2/blocks?${ query }` );
			const batch = await response.json();
			if ( ! Array.isArray( batch ) ) {
				throw new PantryApiError( 'WordPress returned an unexpected patterns response.', 500 );
			}
			patterns.push( ...batch );
			totalPages = Math.min( 20, Math.max( 1, Number( response.headers.get( 'X-WP-TotalPages' ) ) || 1 ) );
			page++;
		} while ( page <= totalPages );
		return patterns.map( normalizePattern );
	}

	function rawTitle( pattern ) {
		return String( pattern?.title?.raw || pattern?.title?.rendered || 'Untitled pattern' )
			.replace( /<[^>]+>/g, '' )
			.trim() || 'Untitled pattern';
	}

	function rawContent( pattern ) {
		return String( pattern?.content?.raw || pattern?.content?.rendered || '' );
	}

	function renderedContent( pattern ) {
		return String( pattern?.content?.rendered || pattern?.content?.raw || '' );
	}

	function parseBlockTypes( content ) {
		const types = [];
		const pattern = /<!--\s+wp:([a-z0-9-]+(?:\/[a-z0-9-]+)?)\b/gi;
		let match;
		while ( ( match = pattern.exec( content ) ) ) {
			const name = match[ 1 ].includes( '/' ) ? match[ 1 ].toLowerCase() : `core/${ match[ 1 ].toLowerCase() }`;
			types.push( name );
		}
		return types;
	}

	function plainText( html ) {
		const withoutComments = String( html )
			.replace( /<!--([\s\S]*?)-->/g, ' ' )
			.replace( /<\/(?:p|h[1-6]|li|blockquote|div|section|article|figure|figcaption)>/gi, '$& ' );
		const doc = new DOMParser().parseFromString( withoutComments, 'text/html' );
		return ( doc.body.textContent || '' ).replace( /\s+/g, ' ' ).trim();
	}

	function normalizePattern( pattern ) {
		const content = rawContent( pattern );
		const types = parseBlockTypes( content );
		const counts = new Map();
		types.forEach( ( type ) => counts.set( type, ( counts.get( type ) || 0 ) + 1 ) );
		const uniqueTypes = [ ...counts.keys() ];
		const kind = types.length <= 1 ? 'single' : uniqueTypes.some( ( type ) => LAYOUT_BLOCKS.has( type ) ) ? 'layout' : 'section';
		const text = plainText( renderedContent( pattern ) || content );
		return {
			...pattern,
			id: Number( pattern.id ),
			pantryTitle: rawTitle( pattern ),
			pantryRaw: content,
			pantryRendered: renderedContent( pattern ),
			pantryTypes: types,
			pantryCounts: counts,
			pantryUniqueTypes: uniqueTypes,
			pantryKind: kind,
			pantrySnippet: text || 'No visible text in this pattern yet.',
		};
	}

	function blockLabel( type ) {
		if ( BLOCK_LABELS[ type ] ) {
			return BLOCK_LABELS[ type ];
		}
		const leaf = type.split( '/' ).pop() || type;
		return leaf.split( '-' ).map( ( part ) => part.charAt( 0 ).toUpperCase() + part.slice( 1 ) ).join( ' ' );
	}

	function kindLabel( kind ) {
		return kind === 'single' ? 'Single block' : kind === 'layout' ? 'Layout' : 'Section';
	}

	function formatRelativeDate( value ) {
		const date = new Date( value );
		if ( Number.isNaN( date.getTime() ) ) {
			return 'Updated recently';
		}
		const seconds = Math.round( ( date.getTime() - Date.now() ) / 1000 );
		const formatter = new Intl.RelativeTimeFormat( undefined, { numeric: 'auto' } );
		const ranges = [
			[ 60, 'second' ],
			[ 60, 'minute' ],
			[ 24, 'hour' ],
			[ 30, 'day' ],
			[ 12, 'month' ],
			[ Infinity, 'year' ],
		];
		let amount = seconds;
		for ( const [ range, unit ] of ranges ) {
			if ( Math.abs( amount ) < range ) {
				return `Updated ${ formatter.format( Math.round( amount ), unit ) }`;
			}
			amount /= range;
		}
		return 'Updated recently';
	}

	function selectedPattern() {
		return state.patterns.find( ( pattern ) => pattern.id === state.selectedId ) || null;
	}

	function visiblePatterns() {
		const terms = state.query.toLocaleLowerCase().split( /\s+/ ).filter( Boolean );
		const filtered = state.patterns.filter( ( pattern ) => {
			if ( state.filter === 'favorites' && ! state.favorites.has( pattern.id ) ) {
				return false;
			}
			if ( state.filter === 'single' && pattern.pantryKind !== 'single' ) {
				return false;
			}
			if ( state.filter === 'layout' && pattern.pantryKind !== 'layout' ) {
				return false;
			}
			if ( ! terms.length ) {
				return true;
			}
			const haystack = [
				pattern.pantryTitle,
				pattern.pantrySnippet,
				...pattern.pantryUniqueTypes,
				...pattern.pantryUniqueTypes.map( blockLabel ),
			].join( ' ' ).toLocaleLowerCase();
			return terms.every( ( term ) => haystack.includes( term ) );
		} );

		return filtered.sort( ( left, right ) => {
			if ( state.sort === 'title' ) {
				return left.pantryTitle.localeCompare( right.pantryTitle );
			}
			if ( state.sort === 'blocks' ) {
				return right.pantryTypes.length - left.pantryTypes.length || left.pantryTitle.localeCompare( right.pantryTitle );
			}
			return Date.parse( right.modified || right.date || 0 ) - Date.parse( left.modified || left.date || 0 );
		} );
	}

	function iconSvg( kind ) {
		if ( kind === 'layout' ) {
			return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18M10 10v10"></path></svg>';
		}
		if ( kind === 'single' ) {
			return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M8 10h8M8 14h5"></path></svg>';
		}
		return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"></path></svg>';
	}

	function starSvg() {
		return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"></path></svg>';
	}

	function createPatternCard( pattern, index ) {
		const card = document.createElement( 'article' );
		card.className = `pattern-card${ pattern.id === state.selectedId ? ' is-selected' : '' }`;
		card.role = 'listitem';
		card.tabIndex = 0;
		card.dataset.patternId = String( pattern.id );
		card.style.setProperty( '--card-accent', ACCENTS[ index % ACCENTS.length ] );
		card.setAttribute( 'aria-label', `Open ${ pattern.pantryTitle }` );

		const top = document.createElement( 'div' );
		top.className = 'pattern-card__top';
		const glyph = document.createElement( 'span' );
		glyph.className = 'pattern-glyph';
		glyph.innerHTML = iconSvg( pattern.pantryKind );
		const favorite = document.createElement( 'button' );
		favorite.type = 'button';
		favorite.className = `card-favorite${ state.favorites.has( pattern.id ) ? ' is-active' : '' }`;
		favorite.innerHTML = starSvg();
		favorite.title = state.favorites.has( pattern.id ) ? 'Remove from favorites' : 'Add to favorites';
		favorite.setAttribute( 'aria-label', favorite.title );
		favorite.addEventListener( 'click', ( event ) => {
			event.stopPropagation();
			toggleFavorite( pattern.id );
		} );
		top.append( glyph, favorite );

		const body = document.createElement( 'div' );
		body.className = 'pattern-card__body';
		const title = document.createElement( 'h2' );
		title.textContent = pattern.pantryTitle;
		const snippet = document.createElement( 'p' );
		snippet.textContent = pattern.pantrySnippet;
		body.append( title, snippet );

		const miniBlocks = document.createElement( 'div' );
		miniBlocks.className = 'mini-blocks';
		const names = pattern.pantryUniqueTypes.slice( 0, 2 ).map( blockLabel );
		if ( ! names.length ) {
			names.push( 'Classic content' );
		}
		names.forEach( ( name ) => {
			const chip = document.createElement( 'span' );
			chip.textContent = name;
			miniBlocks.appendChild( chip );
		} );
		if ( pattern.pantryUniqueTypes.length > 2 ) {
			const more = document.createElement( 'span' );
			more.textContent = `+${ pattern.pantryUniqueTypes.length - 2 }`;
			miniBlocks.appendChild( more );
		}

		const footer = document.createElement( 'footer' );
		footer.className = 'pattern-card__footer';
		const kind = document.createElement( 'span' );
		kind.textContent = kindLabel( pattern.pantryKind );
		const blockCount = document.createElement( 'span' );
		blockCount.textContent = `${ pattern.pantryTypes.length } ${ pattern.pantryTypes.length === 1 ? 'block' : 'blocks' }`;
		footer.append( kind, blockCount );

		const open = () => selectPattern( pattern.id );
		card.addEventListener( 'click', open );
		card.addEventListener( 'keydown', ( event ) => {
			if ( event.key === 'Enter' || event.key === ' ' ) {
				event.preventDefault();
				open();
			}
		} );
		card.append( top, body, miniBlocks, footer );
		return card;
	}

	function renderLibrary() {
		const visible = visiblePatterns();
		dom[ 'pattern-grid' ].replaceChildren( ...visible.map( createPatternCard ) );
		dom[ 'pattern-grid' ].setAttribute( 'aria-busy', 'false' );
		dom[ 'result-count' ].textContent = state.loading
			? 'Loading the shelf…'
			: `${ visible.length } ${ visible.length === 1 ? 'pattern' : 'patterns' } shown`;

		const hasAny = state.patterns.length > 0;
		const hasVisible = visible.length > 0;
		dom[ 'empty-state' ].hidden = hasVisible;
		if ( ! hasVisible ) {
			if ( hasAny ) {
				dom[ 'empty-title' ].textContent = 'Nothing matches this shelf';
				dom[ 'empty-copy' ].textContent = 'Try another search or filter to bring your patterns back into view.';
				dom[ 'empty-create' ].hidden = true;
			} else {
				dom[ 'empty-title' ].textContent = 'The shelf is empty';
				dom[ 'empty-copy' ].textContent = 'Create a synced pattern and reuse it anywhere in WordPress.';
				dom[ 'empty-create' ].hidden = false;
			}
		}
	}

	function updateCounts() {
		const favoriteCount = state.patterns.filter( ( pattern ) => state.favorites.has( pattern.id ) ).length;
		const singleCount = state.patterns.filter( ( pattern ) => pattern.pantryKind === 'single' ).length;
		const layoutCount = state.patterns.filter( ( pattern ) => pattern.pantryKind === 'layout' ).length;
		dom[ 'pattern-total' ].textContent = String( state.patterns.length );
		dom[ 'count-all' ].textContent = String( state.patterns.length );
		dom[ 'count-favorites' ].textContent = String( favoriteCount );
		dom[ 'count-single' ].textContent = String( singleCount );
		dom[ 'count-layout' ].textContent = String( layoutCount );
	}

	function sanitizePreview( html ) {
		const doc = new DOMParser().parseFromString( String( html ), 'text/html' );
		doc.querySelectorAll( 'script, style, link, meta, iframe, object, embed, form, input, textarea, select, button, video, audio, source, canvas' )
			.forEach( ( node ) => node.remove() );
		doc.querySelectorAll( '*' ).forEach( ( node ) => {
			[ ...node.attributes ].forEach( ( attribute ) => {
				const name = attribute.name.toLowerCase();
				const value = attribute.value.trim();
				if ( name.startsWith( 'on' ) || [ 'style', 'srcdoc', 'srcset', 'formaction' ].includes( name ) ) {
					node.removeAttribute( attribute.name );
					return;
				}
				if ( [ 'href', 'src', 'poster', 'action' ].includes( name ) ) {
					if ( /^(?:javascript|vbscript|data:(?!image\/))/i.test( value ) ) {
						node.removeAttribute( attribute.name );
					}
				}
			} );
			if ( node.tagName === 'A' ) {
				node.setAttribute( 'target', '_blank' );
				node.setAttribute( 'rel', 'noopener noreferrer nofollow' );
			}
		} );
		return doc.body.innerHTML;
	}

	function renderInspector() {
		const pattern = selectedPattern();
		const open = Boolean( pattern );
		dom[ 'pattern-inspector' ].setAttribute( 'aria-hidden', open ? 'false' : 'true' );
		dom.appMain.classList.toggle( 'inspector-is-closed', ! open );
		if ( ! pattern ) {
			return;
		}

		dom[ 'pattern-title' ].textContent = pattern.pantryTitle;
		dom[ 'pattern-updated' ].textContent = formatRelativeDate( pattern.modified || pattern.date );
		dom[ 'preview-kind' ].textContent = kindLabel( pattern.pantryKind );
		const preview = sanitizePreview( pattern.pantryRendered || pattern.pantryRaw );
		dom[ 'pattern-preview' ].innerHTML = preview || '<div class="preview-placeholder">This pattern has no visible preview yet.</div>';

		const count = pattern.pantryTypes.length;
		dom[ 'block-total' ].textContent = `${ count } ${ count === 1 ? 'block' : 'blocks' }`;
		dom[ 'block-chips' ].replaceChildren();
		if ( pattern.pantryCounts.size ) {
			pattern.pantryCounts.forEach( ( amount, type ) => {
				const chip = document.createElement( 'span' );
				chip.className = 'block-chip';
				const label = document.createTextNode( blockLabel( type ) );
				chip.appendChild( label );
				if ( amount > 1 ) {
					const quantity = document.createElement( 'b' );
					quantity.textContent = ` ×${ amount }`;
					chip.appendChild( quantity );
				}
				dom[ 'block-chips' ].appendChild( chip );
			} );
		} else {
			const chip = document.createElement( 'span' );
			chip.className = 'block-chip';
			chip.textContent = 'Classic content';
			dom[ 'block-chips' ].appendChild( chip );
		}

		const isFavorite = state.favorites.has( pattern.id );
		dom[ 'favorite-pattern' ].classList.toggle( 'is-active', isFavorite );
		dom[ 'favorite-pattern' ].title = isFavorite ? 'Remove from favorites' : 'Add to favorites';
		dom[ 'favorite-pattern' ].setAttribute( 'aria-label', dom[ 'favorite-pattern' ].title );
		dom[ 'title-view' ].hidden = false;
		dom[ 'title-editor' ].hidden = true;
	}

	function render() {
		updateCounts();
		renderLibrary();
		renderInspector();
	}

	function selectPattern( id ) {
		state.selectedId = Number( id );
		render();
		if ( window.matchMedia( '(max-width: 920px)' ).matches ) {
			dom[ 'pattern-inspector' ].scrollTop = 0;
		}
	}

	function closeInspector() {
		state.selectedId = null;
		render();
	}

	function readLocalPreferences() {
		try {
			const value = JSON.parse( window.localStorage.getItem( LOCAL_PREFS_KEY ) || '{}' );
			return value && Array.isArray( value.favorites ) ? value : { favorites: [] };
		} catch ( _error ) {
			return { favorites: [] };
		}
	}

	function writeLocalPreferences( value ) {
		try {
			window.localStorage.setItem( LOCAL_PREFS_KEY, JSON.stringify( value ) );
		} catch ( _error ) {
			// Preferences can remain memory-only when storage is blocked.
		}
	}

	async function loadPreferences() {
		let preferences = readLocalPreferences();
		try {
			const response = await apiJson( `odd/v1/apps/store/${ APP_SLUG }/preferences` );
			if ( response?.value && Array.isArray( response.value.favorites ) ) {
				preferences = response.value;
				writeLocalPreferences( preferences );
			}
		} catch ( _error ) {
			// The local copy keeps favorites useful if the user is offline.
		}
		state.favorites = new Set( preferences.favorites.map( Number ).filter( Number.isFinite ) );
	}

	async function savePreferences() {
		const preferences = { favorites: [ ...state.favorites ] };
		writeLocalPreferences( preferences );
		try {
			await apiJson( `odd/v1/apps/store/${ APP_SLUG }/preferences`, {
				method: 'POST',
				body: { value: preferences },
			} );
		} catch ( _error ) {
			// Local persistence already succeeded; sync can retry next session.
		}
	}

	function toggleFavorite( id ) {
		id = Number( id );
		if ( state.favorites.has( id ) ) {
			state.favorites.delete( id );
			showToast( 'Removed from favorites.' );
		} else {
			state.favorites.add( id );
			showToast( 'Saved to favorites.' );
		}
		render();
		void savePreferences();
	}

	function replacePattern( value ) {
		const normalized = normalizePattern( value );
		const index = state.patterns.findIndex( ( pattern ) => pattern.id === normalized.id );
		if ( index >= 0 ) {
			state.patterns.splice( index, 1, normalized );
		} else {
			state.patterns.unshift( normalized );
		}
		return normalized;
	}

	async function loadPatterns( { preserveSelection = true } = {} ) {
		if ( state.loading ) {
			return;
		}
		state.loading = true;
		dom[ 'error-state' ].hidden = true;
		dom[ 'empty-state' ].hidden = true;
		dom[ 'pattern-grid' ].setAttribute( 'aria-busy', 'true' );
		dom[ 'result-count' ].textContent = 'Loading the shelf…';
		dom[ 'refresh-patterns' ].classList.add( 'is-busy' );

		try {
			const previous = preserveSelection ? state.selectedId : null;
			state.patterns = await loadAllPatterns();
			state.selectedId = previous && state.patterns.some( ( pattern ) => pattern.id === previous ) ? previous : null;
			if ( ! state.selectedId && state.patterns.length && window.matchMedia( '(min-width: 921px)' ).matches ) {
				state.selectedId = state.patterns[ 0 ].id;
			}
			state.loading = false;
			render();
		} catch ( error ) {
			state.loading = false;
			state.patterns = [];
			state.selectedId = null;
			dom[ 'pattern-grid' ].replaceChildren();
			dom[ 'pattern-grid' ].setAttribute( 'aria-busy', 'false' );
			dom[ 'empty-state' ].hidden = true;
			dom[ 'error-state' ].hidden = false;
			dom[ 'error-copy' ].textContent = friendlyError( error );
			dom[ 'result-count' ].textContent = 'Shelf unavailable';
			updateCounts();
			renderInspector();
		} finally {
			state.loading = false;
			dom[ 'refresh-patterns' ].classList.remove( 'is-busy' );
		}
	}

	function friendlyError( error ) {
		if ( error?.code === 'rest_cookie_invalid_nonce' ) {
			return 'Your WordPress session needs a refresh. Reload OpenStation, then open Pantry again.';
		}
		if ( error?.status === 401 || error?.status === 403 ) {
			return 'Your account cannot manage synced patterns, or the WordPress session has expired.';
		}
		if ( error?.status === 404 ) {
			return 'This WordPress installation does not expose the synced-pattern endpoint.';
		}
		return error?.message || 'Reload the shelf to try again.';
	}

	async function createPattern( title, recipe ) {
		setBusy( dom[ 'create-submit' ], true, 'Creating…' );
		try {
			const created = await apiJson( 'wp/v2/blocks', {
				method: 'POST',
				body: {
					title,
					content: RECIPES[ recipe ] || RECIPES.blank,
					status: 'publish',
				},
			} );
			const pattern = replacePattern( created );
			state.selectedId = pattern.id;
			dom[ 'create-dialog' ].close();
			dom[ 'create-form' ].reset();
			render();
			showToast( `${ pattern.pantryTitle } is stocked and ready.` );
		} catch ( error ) {
			showToast( friendlyError( error ), true );
		} finally {
			setBusy( dom[ 'create-submit' ], false, 'Create pattern' );
		}
	}

	async function renameSelected( title ) {
		const pattern = selectedPattern();
		if ( ! pattern ) {
			return;
		}
		const submit = dom[ 'title-editor' ].querySelector( '[type="submit"]' );
		setBusy( submit, true, 'Saving…' );
		try {
			const updated = await apiJson( `wp/v2/blocks/${ pattern.id }`, {
				method: 'POST',
				body: { title },
			} );
			replacePattern( updated );
			render();
			showToast( 'Pattern renamed.' );
		} catch ( error ) {
			showToast( friendlyError( error ), true );
		} finally {
			setBusy( submit, false, 'Save' );
		}
	}

	async function duplicateSelected() {
		const pattern = selectedPattern();
		if ( ! pattern ) {
			return;
		}
		setBusy( dom[ 'duplicate-pattern' ], true );
		try {
			const created = await apiJson( 'wp/v2/blocks', {
				method: 'POST',
				body: {
					title: `${ pattern.pantryTitle } copy`,
					content: pattern.pantryRaw,
					status: pattern.status === 'draft' || pattern.status === 'private' ? pattern.status : 'publish',
				},
			} );
			const duplicate = replacePattern( created );
			state.selectedId = duplicate.id;
			render();
			showToast( 'Fresh copy added to the shelf.' );
		} catch ( error ) {
			showToast( friendlyError( error ), true );
		} finally {
			setBusy( dom[ 'duplicate-pattern' ], false );
		}
	}

	async function trashSelected() {
		const pattern = selectedPattern();
		if ( ! pattern ) {
			return;
		}
		const submit = dom[ 'trash-form' ].querySelector( '[value="trash"]' );
		setBusy( submit, true, 'Moving…' );
		try {
			await apiJson( `wp/v2/blocks/${ pattern.id }?force=false`, { method: 'DELETE' } );
			state.patterns = state.patterns.filter( ( item ) => item.id !== pattern.id );
			state.favorites.delete( pattern.id );
			state.selectedId = state.patterns.length && window.matchMedia( '(min-width: 921px)' ).matches ? state.patterns[ 0 ].id : null;
			dom[ 'trash-dialog' ].close();
			render();
			void savePreferences();
			showToast( `${ pattern.pantryTitle } moved to trash.` );
		} catch ( error ) {
			showToast( friendlyError( error ), true );
		} finally {
			setBusy( submit, false, 'Move to trash' );
		}
	}

	async function copySelected() {
		const pattern = selectedPattern();
		if ( ! pattern ) {
			return;
		}
		try {
			if ( navigator.clipboard?.writeText ) {
				await navigator.clipboard.writeText( pattern.pantryRaw );
			} else {
				const textarea = document.createElement( 'textarea' );
				textarea.value = pattern.pantryRaw;
				textarea.style.position = 'fixed';
				textarea.style.opacity = '0';
				document.body.appendChild( textarea );
				textarea.select();
				document.execCommand( 'copy' );
				textarea.remove();
			}
			showToast( 'Block markup copied. Paste it into the WordPress editor.' );
		} catch ( _error ) {
			showToast( 'Clipboard access was blocked by the browser.', true );
		}
	}

	function openSelectedInWordPress() {
		const pattern = selectedPattern();
		if ( ! pattern ) {
			return;
		}
		const url = new URL( 'post.php', runtime.adminBase );
		url.searchParams.set( 'post', String( pattern.id ) );
		url.searchParams.set( 'action', 'edit' );
		const popup = window.open( url.toString(), '_blank', 'noopener,noreferrer' );
		if ( ! popup ) {
			showToast( 'Allow popups to open this pattern in WordPress.', true );
		}
	}

	function setBusy( element, busy, label = '' ) {
		if ( ! element ) {
			return;
		}
		element.classList.toggle( 'is-busy', busy );
		element.disabled = busy;
		if ( label ) {
			element.textContent = label;
		}
	}

	function showToast( message, isError = false ) {
		window.clearTimeout( toastTimer );
		dom.toast.textContent = message;
		dom.toast.classList.toggle( 'is-error', isError );
		dom.toast.classList.add( 'is-visible' );
		toastTimer = window.setTimeout( () => dom.toast.classList.remove( 'is-visible' ), 3200 );
	}

	function openCreateDialog() {
		dom[ 'new-pattern-title' ].value = '';
		dom[ 'create-dialog' ].showModal();
		window.setTimeout( () => dom[ 'new-pattern-title' ].focus(), 0 );
	}

	function bindEvents() {
		dom[ 'pattern-search' ].addEventListener( 'input', ( event ) => {
			state.query = event.target.value;
			renderLibrary();
		} );
		dom[ 'pattern-sort' ].addEventListener( 'change', ( event ) => {
			state.sort = event.target.value;
			renderLibrary();
		} );
		dom.filterButtons.forEach( ( button ) => {
			button.addEventListener( 'click', () => {
				state.filter = button.dataset.filter || 'all';
				dom.filterButtons.forEach( ( item ) => {
					const active = item === button;
					item.classList.toggle( 'is-active', active );
					item.setAttribute( 'aria-pressed', active ? 'true' : 'false' );
				} );
				renderLibrary();
			} );
		} );

		dom[ 'refresh-patterns' ].addEventListener( 'click', () => void loadPatterns() );
		dom[ 'error-retry' ].addEventListener( 'click', () => void loadPatterns( { preserveSelection: false } ) );
		[ dom[ 'new-pattern' ], dom[ 'empty-create' ] ].forEach( ( button ) => button.addEventListener( 'click', openCreateDialog ) );
		dom[ 'close-inspector' ].addEventListener( 'click', closeInspector );
		dom[ 'favorite-pattern' ].addEventListener( 'click', () => {
			const pattern = selectedPattern();
			if ( pattern ) {
				toggleFavorite( pattern.id );
			}
		} );

		dom[ 'rename-pattern' ].addEventListener( 'click', () => {
			const pattern = selectedPattern();
			if ( ! pattern ) {
				return;
			}
			dom[ 'rename-input' ].value = pattern.pantryTitle;
			dom[ 'title-view' ].hidden = true;
			dom[ 'title-editor' ].hidden = false;
			dom[ 'rename-input' ].focus();
			dom[ 'rename-input' ].select();
		} );
		dom[ 'cancel-rename' ].addEventListener( 'click', () => {
			dom[ 'title-view' ].hidden = false;
			dom[ 'title-editor' ].hidden = true;
		} );
		dom[ 'title-editor' ].addEventListener( 'submit', ( event ) => {
			event.preventDefault();
			const title = dom[ 'rename-input' ].value.trim();
			if ( title ) {
				void renameSelected( title );
			}
		} );

		dom[ 'copy-pattern' ].addEventListener( 'click', () => void copySelected() );
		dom[ 'duplicate-pattern' ].addEventListener( 'click', () => void duplicateSelected() );
		dom[ 'open-pattern' ].addEventListener( 'click', openSelectedInWordPress );
		dom[ 'trash-pattern' ].addEventListener( 'click', () => {
			const pattern = selectedPattern();
			if ( ! pattern ) {
				return;
			}
			dom[ 'trash-pattern-name' ].textContent = pattern.pantryTitle;
			dom[ 'trash-dialog' ].showModal();
		} );

		dom[ 'create-form' ].addEventListener( 'submit', ( event ) => {
			event.preventDefault();
			if ( event.submitter?.value !== 'create' ) {
				dom[ 'create-dialog' ].close();
				return;
			}
			const title = dom[ 'new-pattern-title' ].value.trim();
			const recipe = new FormData( dom[ 'create-form' ] ).get( 'recipe' ) || 'blank';
			if ( title ) {
				void createPattern( title, String( recipe ) );
			}
		} );
		dom[ 'trash-form' ].addEventListener( 'submit', ( event ) => {
			event.preventDefault();
			if ( event.submitter?.value === 'trash' ) {
				void trashSelected();
			} else {
				dom[ 'trash-dialog' ].close();
			}
		} );

		document.addEventListener( 'keydown', ( event ) => {
			const typing = /^(INPUT|TEXTAREA|SELECT)$/.test( document.activeElement?.tagName || '' );
			if ( event.key === '/' && ! typing && ! dom[ 'create-dialog' ].open && ! dom[ 'trash-dialog' ].open ) {
				event.preventDefault();
				dom[ 'pattern-search' ].focus();
			}
			if ( event.key === 'Escape' && window.matchMedia( '(max-width: 920px)' ).matches && state.selectedId ) {
				closeInspector();
			}
		} );
	}

	async function boot() {
		cacheDom();
		runtime = detectRuntime();
		bindEvents();
		dom.appMain.classList.add( 'inspector-is-closed' );
		await Promise.all( [ loadPreferences(), loadPatterns( { preserveSelection: false } ) ] );
		render();
	}

	document.addEventListener( 'DOMContentLoaded', () => {
		void boot();
	}, { once: true } );
} )();
