( () => {
	'use strict';

	const APP_SLUG = 'pantry';
	const RUNTIME_API_VERSION = 1;
	const MAX_PREVIEW_CHARS = 200000;
	const PREVIEW_TAGS = new Set( [
		'article', 'aside', 'blockquote', 'br', 'caption', 'cite', 'code', 'col',
		'colgroup', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
		'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'li', 'main', 'mark',
		'ol', 'p', 'pre', 'q', 's', 'section', 'small', 'span', 'strong', 'sub',
		'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
	] );
	const PREVIEW_BLOCKED_TAGS = new Set( [
		'audio', 'base', 'button', 'canvas', 'embed', 'form', 'iframe', 'input',
		'link', 'math', 'meta', 'noscript', 'object', 'script', 'select', 'source',
		'style', 'svg', 'template', 'textarea', 'video',
	] );
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
	let inspectorReturnTarget = null;
	let inspectorModalActive = false;
	let patternOperationQueue = Promise.resolve();
	let refreshQueued = false;
	let preferenceWriteQueue = Promise.resolve();
	let preferencesLoaded = false;
	let pendingPreferenceSave = false;
	const favoriteIntents = new Map();

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
		dom.topbar = document.querySelector( '.topbar' );
		dom.sidePanel = document.querySelector( '.side-panel' );
		dom.library = document.querySelector( '.library' );
		dom.filterButtons = [ ...document.querySelectorAll( '.filter-button' ) ];
	}

	function cardFocusTarget( element = document.activeElement ) {
		const card = element?.closest?.( '.pattern-card[data-pattern-id]' );
		if ( ! card ) {
			return null;
		}
		const patternId = Number( card.dataset.patternId );
		if ( ! Number.isFinite( patternId ) ) {
			return null;
		}
		return {
			patternId,
			control: element.closest( '.card-favorite' ) ? 'favorite' : 'open',
		};
	}

	function focusWithoutScroll( element ) {
		if ( ! element ) {
			return false;
		}
		try {
			element.focus( { preventScroll: true } );
		} catch ( _error ) {
			element.focus();
		}
		return document.activeElement === element;
	}

	function restoreCardFocus( target, fallbackToGrid = false ) {
		if ( ! target ) {
			return false;
		}
		const card = [ ...dom[ 'pattern-grid' ].querySelectorAll( '.pattern-card[data-pattern-id]' ) ]
			.find( ( item ) => Number( item.dataset.patternId ) === target.patternId );
		const control = target.control === 'favorite'
			? card?.querySelector( '.card-favorite' )
			: card?.querySelector( '.pattern-card__open' );
		if ( focusWithoutScroll( control ) ) {
			return true;
		}
		return fallbackToGrid ? focusWithoutScroll( dom[ 'pattern-grid' ] ) : false;
	}

	function mobileInspectorIsOverlay() {
		return window.matchMedia( '(max-width: 920px)' ).matches;
	}

	function syncInspectorModality( open = Boolean( selectedPattern() ) ) {
		const modal = open && mobileInspectorIsOverlay();
		const leavingModal = inspectorModalActive && ! modal && open;
		[ dom.topbar, dom.sidePanel, dom.library ].forEach( ( element ) => {
			element?.toggleAttribute( 'inert', modal );
		} );
		if ( modal ) {
			dom[ 'pattern-inspector' ].setAttribute( 'role', 'dialog' );
			dom[ 'pattern-inspector' ].setAttribute( 'aria-modal', 'true' );
			if ( ! inspectorModalActive ) {
				inspectorReturnTarget = inspectorReturnTarget || cardFocusTarget() || {
					patternId: state.selectedId,
					control: 'card',
				};
				dom[ 'pattern-inspector' ].scrollTop = 0;
				focusWithoutScroll( dom[ 'close-inspector' ] ) || focusWithoutScroll( dom[ 'pattern-title' ] );
			}
		} else {
			dom[ 'pattern-inspector' ].removeAttribute( 'role' );
			dom[ 'pattern-inspector' ].removeAttribute( 'aria-modal' );
		}
		if ( leavingModal ) {
			focusWithoutScroll( dom[ 'pattern-title' ] ) || focusWithoutScroll( dom[ 'favorite-pattern' ] );
		}
		inspectorModalActive = modal;
	}

	function requireRuntime() {
		const candidate = window.oddApp;
		const storage = candidate?.storage;
		let adminBase;
		try {
			adminBase = new URL( candidate?.adminUrl || '' );
		} catch ( _error ) {
			adminBase = null;
		}
		if (
			! candidate || candidate.apiVersion !== RUNTIME_API_VERSION || candidate.slug !== APP_SLUG ||
			typeof candidate.request !== 'function' || ! storage ||
			typeof storage.get !== 'function' || typeof storage.set !== 'function' ||
			! adminBase || adminBase.origin !== window.location.origin
		) {
			throw new PantryApiError(
				'ODD Pantry needs the ODD app runtime v1. Close this window, update ODD, and reopen Pantry.',
				500,
				'odd_app_runtime_unavailable'
			);
		}
		return candidate;
	}

	function enqueuePatternOperation( operation ) {
		const run = patternOperationQueue.then( operation, operation );
		patternOperationQueue = run.catch( () => undefined );
		return run;
	}

	async function apiJson( path, options = {} ) {
		try {
			return await runtime.request( path, options );
		} catch ( error ) {
			if ( error instanceof PantryApiError ) {
				throw error;
			}
			throw new PantryApiError(
				error?.message || 'WordPress request failed.',
				Number( error?.status ) || 500,
				error?.code || error?.payload?.code || ''
			);
		}
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
				_envelope: '1',
			} );
			[ 'publish', 'draft', 'private' ].forEach( ( status ) => query.append( 'status[]', status ) );
			const response = await apiJson( `wp/v2/blocks?${ query }` );
			const batch = response?.body;
			if ( ! Array.isArray( batch ) ) {
				throw new PantryApiError( 'WordPress returned an unexpected patterns response.', 500 );
			}
			patterns.push( ...batch );
			const headers = response.headers || {};
			totalPages = Math.min( 20, Math.max( 1, Number( headers[ 'X-WP-TotalPages' ] || headers[ 'x-wp-totalpages' ] ) || 1 ) );
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
		card.dataset.patternId = String( pattern.id );
		card.style.setProperty( '--card-accent', ACCENTS[ index % ACCENTS.length ] );

		const open = document.createElement( 'button' );
		open.type = 'button';
		open.className = 'pattern-card__open';
		open.setAttribute( 'aria-label', `Open details for ${ pattern.pantryTitle }` );
		open.title = `Open details for ${ pattern.pantryTitle }`;
		open.addEventListener( 'click', () => selectPattern( pattern.id ) );

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
		favorite.addEventListener( 'click', () => {
			toggleFavorite( pattern.id );
		} );
		top.append( glyph );

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

		card.append( open, top, body, miniBlocks, footer, favorite );
		return card;
	}

	function renderLibrary() {
		const focusTarget = cardFocusTarget();
		const visible = visiblePatterns();
		dom[ 'pattern-grid' ].replaceChildren( ...visible.map( createPatternCard ) );
		dom[ 'pattern-grid' ].setAttribute( 'aria-busy', 'false' );
		if ( ! dom[ 'error-state' ].hidden ) {
			dom[ 'empty-state' ].hidden = true;
			dom[ 'result-count' ].textContent = 'Shelf unavailable';
			return;
		}
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
		if ( focusTarget ) {
			restoreCardFocus( focusTarget, true );
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

	function safePreviewImage( value ) {
		const source = String( value || '' ).trim();
		if ( /^data:image\/(?:avif|gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]+$/i.test( source ) ) {
			return source;
		}
		try {
			const url = new URL( source, window.location.href );
			if ( [ 'http:', 'https:' ].includes( url.protocol ) && url.origin === window.location.origin ) {
				return url.href;
			}
		} catch ( _error ) {
			// Malformed and cross-origin image sources are omitted from the preview.
		}
		return '';
	}

	function sanitizePreview( html ) {
		const source = new DOMParser().parseFromString( String( html ).slice( 0, MAX_PREVIEW_CHARS ), 'text/html' );
		const output = document.implementation.createHTMLDocument( '' );
		const container = output.createElement( 'div' );

		const copyChildren = ( inputParent, outputParent ) => {
			[ ...inputParent.childNodes ].forEach( ( input ) => {
				if ( input.nodeType === Node.TEXT_NODE ) {
					outputParent.appendChild( output.createTextNode( input.textContent || '' ) );
					return;
				}
				if ( input.nodeType !== Node.ELEMENT_NODE ) {
					return;
				}
				const tag = input.localName.toLowerCase();
				if ( PREVIEW_BLOCKED_TAGS.has( tag ) ) {
					return;
				}
				if ( ! PREVIEW_TAGS.has( tag ) ) {
					copyChildren( input, outputParent );
					return;
				}
				const clean = output.createElement( tag );
				const className = String( input.getAttribute( 'class' ) || '' ).trim();
				if ( className && /^[a-z0-9 _-]{1,500}$/i.test( className ) ) {
					clean.setAttribute( 'class', className );
				}
				if ( tag === 'img' ) {
					const src = safePreviewImage( input.getAttribute( 'src' ) );
					if ( ! src ) {
						return;
					}
					clean.setAttribute( 'src', src );
					clean.setAttribute( 'alt', String( input.getAttribute( 'alt' ) || '' ).slice( 0, 300 ) );
					clean.setAttribute( 'loading', 'lazy' );
					[ 'width', 'height' ].forEach( ( name ) => {
						const size = Number.parseInt( input.getAttribute( name ) || '', 10 );
						if ( Number.isInteger( size ) && size > 0 && size <= 4096 ) {
							clean.setAttribute( name, String( size ) );
						}
					} );
				}
				if ( tag === 'td' || tag === 'th' ) {
					[ 'colspan', 'rowspan' ].forEach( ( name ) => {
						const span = Number.parseInt( input.getAttribute( name ) || '', 10 );
						if ( Number.isInteger( span ) && span > 0 && span <= 100 ) {
							clean.setAttribute( name, String( span ) );
						}
					} );
				}
				copyChildren( input, clean );
				outputParent.appendChild( clean );
			} );
		};

		copyChildren( source.body, container );
		return container.innerHTML;
	}

	function previewDocument( html ) {
		const origin = window.location.origin;
		return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: ${ origin }; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'"><style>html{color-scheme:light}body{margin:0;padding:19px;background:#fff;color:#17202a;font:12px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body>:first-child{margin-top:0!important}body>:last-child{margin-bottom:0!important}h1,h2,h3,h4{color:#101820;line-height:1.2}h1{font-size:24px}h2{font-size:20px}h3{font-size:17px}p{margin:.8em 0}img{max-width:100%;height:auto;border-radius:6px}blockquote{margin:1em 0;padding-left:1em;border-left:3px solid #1bb9a8;color:#48515c}.wp-block-columns{display:flex;gap:12px}.wp-block-column{min-width:0;flex:1}.wp-block-group{padding:12px;border-radius:8px;background:#f4f6f7}table{max-width:100%;border-collapse:collapse}td,th{padding:4px;border:1px solid #dce1e6;text-align:left}</style></head><body>${ html }</body></html>`;
	}

	function renderPreview( pattern ) {
		const container = dom[ 'pattern-preview' ];
		const preview = sanitizePreview( pattern.pantryRendered || pattern.pantryRaw );
		container.replaceChildren();
		if ( ! preview.replace( /<[^>]+>/g, '' ).trim() && ! /<img\b/i.test( preview ) ) {
			const placeholder = document.createElement( 'div' );
			placeholder.className = 'preview-placeholder';
			placeholder.textContent = 'This pattern has no visible preview yet.';
			container.appendChild( placeholder );
			return;
		}
		const frame = document.createElement( 'iframe' );
		frame.className = 'pattern-preview__frame';
		frame.title = `Preview of ${ pattern.pantryTitle }`;
		frame.setAttribute( 'sandbox', '' );
		frame.setAttribute( 'referrerpolicy', 'no-referrer' );
		frame.srcdoc = previewDocument( preview );
		container.appendChild( frame );
	}

	function renderInspector() {
		const pattern = selectedPattern();
		const open = Boolean( pattern );
		dom[ 'pattern-inspector' ].setAttribute( 'aria-hidden', open ? 'false' : 'true' );
		dom.appMain.classList.toggle( 'inspector-is-closed', ! open );
		syncInspectorModality( open );
		if ( ! pattern ) {
			return;
		}

		dom[ 'pattern-title' ].textContent = pattern.pantryTitle;
		dom[ 'pattern-updated' ].textContent = formatRelativeDate( pattern.modified || pattern.date );
		dom[ 'preview-kind' ].textContent = kindLabel( pattern.pantryKind );
		renderPreview( pattern );

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
		const mobile = mobileInspectorIsOverlay();
		if ( mobile ) {
			inspectorReturnTarget = cardFocusTarget() || {
				patternId: Number( id ),
				control: 'card',
			};
		}
		state.selectedId = Number( id );
		render();
	}

	function closeInspector() {
		const mobile = mobileInspectorIsOverlay();
		const returnTarget = inspectorReturnTarget || {
			patternId: state.selectedId,
			control: 'card',
		};
		state.selectedId = null;
		render();
		if ( mobile ) {
			restoreCardFocus( returnTarget, true );
		}
		inspectorReturnTarget = null;
	}

	async function loadPreferences() {
		let preferences = { favorites: [] };
		try {
			const stored = await runtime.storage.get( 'preferences' );
			if ( stored && Array.isArray( stored.favorites ) ) {
				preferences = stored;
			}
		} catch ( _error ) {
			showToast( 'Favorites are available for this session, but ODD could not load saved favorites.', true );
		}
		const merged = new Set( preferences.favorites.map( Number ).filter( Number.isFinite ) );
		favoriteIntents.forEach( ( favorite, id ) => {
			if ( favorite ) {
				merged.add( id );
			} else {
				merged.delete( id );
			}
		} );
		state.favorites = merged;
		favoriteIntents.clear();
		preferencesLoaded = true;
		if ( ! state.loading ) {
			render();
		}
		if ( pendingPreferenceSave ) {
			pendingPreferenceSave = false;
			void savePreferences();
		}
	}

	async function persistPreferences( preferences ) {
		try {
			await runtime.storage.set( 'preferences', preferences );
		} catch ( _error ) {
			showToast( 'Favorite changed for this session, but ODD could not save it.', true );
		}
	}

	function savePreferences() {
		if ( ! preferencesLoaded ) {
			pendingPreferenceSave = true;
			return preferenceWriteQueue;
		}
		const preferences = { favorites: [ ...state.favorites ] };
		preferenceWriteQueue = preferenceWriteQueue.then( () => persistPreferences( preferences ) );
		return preferenceWriteQueue;
	}

	function toggleFavorite( id ) {
		id = Number( id );
		if ( state.favorites.has( id ) ) {
			state.favorites.delete( id );
			if ( ! preferencesLoaded ) {
				favoriteIntents.set( id, false );
			}
			showToast( 'Removed from favorites.' );
		} else {
			state.favorites.add( id );
			if ( ! preferencesLoaded ) {
				favoriteIntents.set( id, true );
			}
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

	function loadPatterns( options = {} ) {
		if ( refreshQueued ) {
			return patternOperationQueue;
		}
		refreshQueued = true;
		return enqueuePatternOperation( async () => {
			try {
				return await loadPatternsNow( options );
			} finally {
				refreshQueued = false;
			}
		} );
	}

	async function loadPatternsNow( { preserveSelection = true } = {} ) {
		const recoveringFromError = ! dom[ 'error-state' ].hidden;
		state.loading = true;
		dom[ 'error-state' ].hidden = true;
		dom[ 'error-retry' ].hidden = false;
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
			if ( recoveringFromError ) {
				focusWithoutScroll( dom[ 'pattern-grid' ].querySelector( '.pattern-card__open' ) ) ||
					focusWithoutScroll( dom[ 'pattern-grid' ] );
			}
		} catch ( error ) {
			state.loading = false;
			state.patterns = [];
			state.selectedId = null;
			dom[ 'pattern-grid' ].replaceChildren();
			dom[ 'pattern-grid' ].setAttribute( 'aria-busy', 'false' );
			dom[ 'empty-state' ].hidden = true;
			dom[ 'error-state' ].hidden = false;
			dom[ 'error-retry' ].hidden = false;
			dom[ 'error-copy' ].textContent = friendlyError( error );
			dom[ 'result-count' ].textContent = 'Shelf unavailable';
			updateCounts();
			renderInspector();
		} finally {
			state.loading = false;
			dom[ 'refresh-patterns' ].classList.remove( 'is-busy' );
		}
	}

	function revealLibraryAfterMutation() {
		dom[ 'error-state' ].hidden = true;
		dom[ 'error-retry' ].hidden = false;
		dom[ 'empty-state' ].hidden = true;
	}

	function friendlyError( error ) {
		if ( error?.code === 'rest_cookie_invalid_nonce' ) {
			return 'Your WordPress session needs a refresh. Reload OpenStation, then open ODD Pantry again.';
		}
		if ( error?.status === 401 || error?.status === 403 ) {
			return 'Your account cannot manage synced patterns, or the WordPress session has expired.';
		}
		if ( error?.status === 404 ) {
			return 'This WordPress installation does not expose the synced-pattern endpoint.';
		}
		return error?.message || 'Reload the shelf to try again.';
	}

	function createPattern( title, recipe ) {
		setBusy( dom[ 'create-submit' ], true, 'Creating…' );
		return enqueuePatternOperation( async () => {
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
				revealLibraryAfterMutation();
				render();
				showToast( `${ pattern.pantryTitle } is stocked and ready.` );
			} catch ( error ) {
				showToast( friendlyError( error ), true );
			} finally {
				setBusy( dom[ 'create-submit' ], false, 'Create pattern' );
			}
		} );
	}

	function renameSelected( title ) {
		const pattern = selectedPattern();
		if ( ! pattern ) {
			return Promise.resolve();
		}
		const submit = dom[ 'title-editor' ].querySelector( '[type="submit"]' );
		setBusy( submit, true, 'Saving…' );
		return enqueuePatternOperation( async () => {
			try {
				const updated = await apiJson( `wp/v2/blocks/${ pattern.id }`, {
					method: 'POST',
					body: { title },
				} );
				replacePattern( updated );
				revealLibraryAfterMutation();
				render();
				showToast( 'Pattern renamed.' );
			} catch ( error ) {
				showToast( friendlyError( error ), true );
			} finally {
				setBusy( submit, false, 'Save' );
			}
		} );
	}

	function duplicateSelected() {
		const pattern = selectedPattern();
		if ( ! pattern ) {
			return Promise.resolve();
		}
		setBusy( dom[ 'duplicate-pattern' ], true );
		return enqueuePatternOperation( async () => {
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
				revealLibraryAfterMutation();
				render();
				showToast( 'Fresh copy added to the shelf.' );
			} catch ( error ) {
				showToast( friendlyError( error ), true );
			} finally {
				setBusy( dom[ 'duplicate-pattern' ], false );
			}
		} );
	}

	function trashSelected() {
		const pattern = selectedPattern();
		if ( ! pattern ) {
			return Promise.resolve();
		}
		const submit = dom[ 'trash-form' ].querySelector( '[value="trash"]' );
		setBusy( submit, true, 'Moving…' );
		return enqueuePatternOperation( async () => {
			try {
				await apiJson( `wp/v2/blocks/${ pattern.id }?force=false`, { method: 'DELETE' } );
				state.patterns = state.patterns.filter( ( item ) => item.id !== pattern.id );
				state.favorites.delete( pattern.id );
				if ( ! preferencesLoaded ) {
					favoriteIntents.set( pattern.id, false );
				}
				state.selectedId = state.patterns.length && window.matchMedia( '(min-width: 921px)' ).matches ? state.patterns[ 0 ].id : null;
				dom[ 'trash-dialog' ].close();
				revealLibraryAfterMutation();
				render();
				void savePreferences();
				showToast( `${ pattern.pantryTitle } moved to trash.` );
			} catch ( error ) {
				showToast( friendlyError( error ), true );
			} finally {
				setBusy( submit, false, 'Move to trash' );
			}
		} );
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
		const url = new URL( 'post.php', runtime.adminUrl );
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
		window.addEventListener( 'resize', () => syncInspectorModality() );
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
			if (
				event.key === 'Escape' && window.matchMedia( '(max-width: 920px)' ).matches && state.selectedId &&
				! dom[ 'create-dialog' ].open && ! dom[ 'trash-dialog' ].open
			) {
				closeInspector();
			}
		} );
	}

	async function boot() {
		cacheDom();
		try {
			runtime = requireRuntime();
		} catch ( error ) {
			dom[ 'pattern-grid' ].replaceChildren();
			dom[ 'pattern-grid' ].setAttribute( 'aria-busy', 'false' );
			dom[ 'empty-state' ].hidden = true;
			dom[ 'error-state' ].hidden = false;
			dom[ 'error-retry' ].hidden = true;
			dom[ 'error-copy' ].textContent = friendlyError( error );
			dom[ 'result-count' ].textContent = 'ODD update required';
			return;
		}
		bindEvents();
		dom.appMain.classList.add( 'inspector-is-closed' );
		await Promise.all( [ loadPreferences(), loadPatterns( { preserveSelection: false } ) ] );
		render();
	}

	document.addEventListener( 'DOMContentLoaded', () => {
		void boot();
	}, { once: true } );
} )();
