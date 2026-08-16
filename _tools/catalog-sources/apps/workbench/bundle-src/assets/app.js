( function () {
	'use strict';

	const STORAGE_KEY = 'odd.workbench.state.v1';
	const MAX_SAVED_CHARS = 500000;
	const TOOL_ORDER = [ 'clean', 'markdown', 'slug', 'json', 'diff', 'convert' ];
	const TOOL_META = {
		clean: {
			number: 'Bench 01',
			title: 'Clean',
			description: 'Sweep away copy-paste grime without sanding off the meaning.',
		},
		markdown: {
			number: 'Bench 02',
			title: 'Markdown',
			description: 'Write, preview, and carry clean HTML to the next window.',
		},
		slug: {
			number: 'Bench 03',
			title: 'Slug',
			description: 'Turn unruly titles into tidy, portable URL paths.',
		},
		json: {
			number: 'Bench 04',
			title: 'JSON',
			description: 'Format, minify, sort, and spot the exact place data went sideways.',
		},
		diff: {
			number: 'Bench 05',
			title: 'Diff',
			description: 'Compare two drafts line by line and copy a compact patch.',
		},
		convert: {
			number: 'Bench 06',
			title: 'Convert',
			description: 'Encode and decode everyday web formats without sending them anywhere.',
		},
	};

	const DEFAULT_STATE = {
		activeTool: 'clean',
		clean: { input: '', action: 'smart' },
		markdown: { input: '' },
		slug: { input: '', separator: '-', maxLength: '80', lowercase: true },
		json: { input: '' },
		diff: { left: '', right: '' },
		convert: { input: '', mode: 'base64-encode' },
	};

	const $ = ( selector, root = document ) => root.querySelector( selector );
	const $$ = ( selector, root = document ) => Array.from( root.querySelectorAll( selector ) );
	const cloneDefaults = () => JSON.parse( JSON.stringify( DEFAULT_STATE ) );

	function limitedString( value ) {
		return typeof value === 'string' ? value.slice( 0, MAX_SAVED_CHARS ) : '';
	}

	function loadState() {
		const base = cloneDefaults();
		try {
			const raw = localStorage.getItem( STORAGE_KEY );
			if ( ! raw ) {
				return base;
			}
			const saved = JSON.parse( raw );
			if ( TOOL_ORDER.includes( saved.activeTool ) ) {
				base.activeTool = saved.activeTool;
			}
			base.clean.input = limitedString( saved.clean?.input );
			if ( [ 'smart', 'html', 'dedent', 'one-line', 'title', 'sentence', 'upper', 'lower' ].includes( saved.clean?.action ) ) {
				base.clean.action = saved.clean.action;
			}
			base.markdown.input = limitedString( saved.markdown?.input );
			base.slug.input = limitedString( saved.slug?.input );
			base.slug.separator = saved.slug?.separator === '_' ? '_' : '-';
			base.slug.maxLength = [ '40', '60', '80', '120' ].includes( saved.slug?.maxLength ) ? saved.slug.maxLength : '80';
			base.slug.lowercase = saved.slug?.lowercase !== false;
			base.json.input = limitedString( saved.json?.input );
			base.diff.left = limitedString( saved.diff?.left );
			base.diff.right = limitedString( saved.diff?.right );
			base.convert.input = limitedString( saved.convert?.input );
			if ( [
				'base64-encode', 'base64-decode', 'url-encode', 'url-decode',
				'html-encode', 'html-decode', 'hex-encode', 'hex-decode',
			].includes( saved.convert?.mode ) ) {
				base.convert.mode = saved.convert.mode;
			}
		} catch ( _error ) {
			return base;
		}
		return base;
	}

	let state = loadState();
	let saveTimer = null;
	let statusTimer = null;
	let resetTimer = null;
	let diffTimer = null;
	let markdownHtml = '';
	let diffPatch = '';

	const statusElement = $( '#app-status' );
	const statusReadout = $( '.topbar__readout' );

	function showStatus( message, tone = 'ok', sticky = false ) {
		statusElement.textContent = message;
		statusReadout.classList.toggle( 'is-error', tone === 'error' );
		statusReadout.classList.toggle( 'is-busy', tone === 'busy' );
		window.clearTimeout( statusTimer );
		if ( ! sticky ) {
			statusTimer = window.setTimeout( () => {
				statusElement.textContent = 'Local · Ready';
				statusReadout.classList.remove( 'is-error', 'is-busy' );
			}, 1800 );
		}
	}

	function persistSoon() {
		window.clearTimeout( saveTimer );
		saveTimer = window.setTimeout( () => {
			try {
				localStorage.setItem( STORAGE_KEY, JSON.stringify( state ) );
			} catch ( _error ) {
				showStatus( 'Draft storage is full', 'error' );
			}
		}, 180 );
	}

	function activateTool( tool, focusTab = false ) {
		if ( ! TOOL_ORDER.includes( tool ) ) {
			return;
		}
		state.activeTool = tool;
		$$ ( '[data-tool]' ).forEach( ( button ) => {
			const active = button.dataset.tool === tool;
			button.classList.toggle( 'is-active', active );
			button.setAttribute( 'aria-selected', String( active ) );
			button.tabIndex = active ? 0 : -1;
			if ( active && focusTab ) {
				button.focus();
			}
		} );
		$$ ( '[data-panel]' ).forEach( ( panel ) => {
			const active = panel.dataset.panel === tool;
			panel.hidden = ! active;
			panel.classList.toggle( 'is-active', active );
		} );
		const meta = TOOL_META[ tool ];
		$( '#tool-number' ).textContent = meta.number;
		$( '#tool-title' ).textContent = meta.title;
		$( '#tool-description' ).textContent = meta.description;
		persistSoon();
	}

	$$ ( '[data-tool]' ).forEach( ( button, index ) => {
		button.addEventListener( 'click', () => activateTool( button.dataset.tool ) );
		button.addEventListener( 'keydown', ( event ) => {
			let next = index;
			if ( event.key === 'ArrowDown' || event.key === 'ArrowRight' ) {
				next = ( index + 1 ) % TOOL_ORDER.length;
			} else if ( event.key === 'ArrowUp' || event.key === 'ArrowLeft' ) {
				next = ( index - 1 + TOOL_ORDER.length ) % TOOL_ORDER.length;
			} else if ( event.key === 'Home' ) {
				next = 0;
			} else if ( event.key === 'End' ) {
				next = TOOL_ORDER.length - 1;
			} else {
				return;
			}
			event.preventDefault();
			activateTool( TOOL_ORDER[ next ], true );
		} );
	} );

	function normalLines( value ) {
		return value.replace( /\r\n?/g, '\n' );
	}

	function smartClean( value ) {
		return normalLines( value )
			.replace( /[\u200B-\u200D\uFEFF]/g, '' )
			.replace( /\u00a0/g, ' ' )
			.split( '\n' )
			.map( ( line ) => line.replace( /[ \t]+$/g, '' ) )
			.join( '\n' )
			.replace( /\n{4,}/g, '\n\n\n' )
			.trim();
	}

	function stripHtml( value ) {
		const doc = new DOMParser().parseFromString( value, 'text/html' );
		return smartClean( doc.body.textContent || '' );
	}

	function dedent( value ) {
		const lines = normalLines( value ).split( '\n' );
		const meaningful = lines.filter( ( line ) => line.trim() );
		const indent = meaningful.length ? Math.min( ...meaningful.map( ( line ) => ( line.match( /^[ \t]*/ ) || [ '' ] )[ 0 ].length ) ) : 0;
		return lines.map( ( line ) => line.slice( Math.min( indent, line.length ) ) ).join( '\n' ).trim();
	}

	function titleCase( value ) {
		const minor = new Set( [ 'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'up', 'via', 'with' ] );
		return value.toLocaleLowerCase().replace( /\b[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu, ( word, offset ) => {
			if ( offset > 0 && minor.has( word ) ) {
				return word;
			}
			return word.charAt( 0 ).toLocaleUpperCase() + word.slice( 1 );
		} );
	}

	function sentenceCase( value ) {
		const lower = value.toLocaleLowerCase();
		return lower.replace( /(^|[.!?]\s+)([\p{L}])/gu, ( match, prefix, letter ) => prefix + letter.toLocaleUpperCase() );
	}

	function cleanTransform( value, action ) {
		switch ( action ) {
			case 'html':
				return stripHtml( value );
			case 'dedent':
				return dedent( value );
			case 'one-line':
				return smartClean( value ).replace( /\s+/g, ' ' );
			case 'title':
				return titleCase( smartClean( value ) );
			case 'sentence':
				return sentenceCase( smartClean( value ) );
			case 'upper':
				return smartClean( value ).toLocaleUpperCase();
			case 'lower':
				return smartClean( value ).toLocaleLowerCase();
			default:
				return smartClean( value );
		}
	}

	const cleanInput = $( '#clean-input' );
	const cleanOutput = $( '#clean-output' );

	function updateClean( action = state.clean.action ) {
		state.clean.action = action;
		state.clean.input = cleanInput.value;
		cleanOutput.value = cleanTransform( cleanInput.value, action );
		$( '#clean-input-count' ).textContent = `${ cleanInput.value.length.toLocaleString() } chars`;
		$$ ( '[data-clean-action]' ).forEach( ( button ) => {
			button.classList.toggle( 'is-primary', button.dataset.cleanAction === action );
		} );
		persistSoon();
	}

	cleanInput.addEventListener( 'input', () => updateClean() );
	$$ ( '[data-clean-action]' ).forEach( ( button ) => {
		button.addEventListener( 'click', () => {
			updateClean( button.dataset.cleanAction );
			showStatus( `${ button.textContent.trim() } applied` );
		} );
	} );

	function escapeHtml( value ) {
		return String( value ).replace( /[&<>"']/g, ( character ) => ( {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#039;',
		} )[ character ] );
	}

	function decodeHtml( value ) {
		const textarea = document.createElement( 'textarea' );
		textarea.innerHTML = value;
		return textarea.value;
	}

	function safeLink( value ) {
		const decoded = decodeHtml( value ).trim();
		if ( /^(https?:\/\/|mailto:|\/|#)/i.test( decoded ) ) {
			return escapeHtml( decoded );
		}
		return '#';
	}

	function inlineMarkdown( source ) {
		const code = [];
		let value = source.replace( /`([^`]+)`/g, ( _match, inner ) => {
			const token = `ODDCODETOKEN${ code.length }X`;
			code.push( `<code>${ escapeHtml( inner ) }</code>` );
			return token;
		} );
		value = escapeHtml( value );
		value = value.replace( /\[([^\]]+)\]\(([^)\s]+)\)/g, ( _match, label, href ) => `<a href="${ safeLink( href ) }" target="_blank" rel="noreferrer">${ label }</a>` );
		value = value.replace( /\*\*([^*]+)\*\*/g, '<strong>$1</strong>' );
		value = value.replace( /__([^_]+)__/g, '<strong>$1</strong>' );
		value = value.replace( /~~([^~]+)~~/g, '<del>$1</del>' );
		value = value.replace( /(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>' );
		value = value.replace( /(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>' );
		code.forEach( ( snippet, index ) => {
			value = value.replace( `ODDCODETOKEN${ index }X`, snippet );
		} );
		return value;
	}

	function renderMarkdown( source ) {
		const lines = normalLines( source ).split( '\n' );
		const html = [];
		let inCode = false;
		let codeBuffer = [];
		let listType = '';

		const closeList = () => {
			if ( listType ) {
				html.push( `</${ listType }>` );
				listType = '';
			}
		};

		lines.forEach( ( line ) => {
			if ( /^\s*```/.test( line ) ) {
				closeList();
				if ( inCode ) {
					html.push( `<pre><code>${ escapeHtml( codeBuffer.join( '\n' ) ) }</code></pre>` );
					codeBuffer = [];
					inCode = false;
				} else {
					inCode = true;
				}
				return;
			}
			if ( inCode ) {
				codeBuffer.push( line );
				return;
			}

			const heading = line.match( /^(#{1,6})\s+(.+)$/ );
			const unordered = line.match( /^\s*[-*+]\s+(.+)$/ );
			const ordered = line.match( /^\s*\d+[.)]\s+(.+)$/ );
			if ( heading ) {
				closeList();
				const level = heading[ 1 ].length;
				html.push( `<h${ level }>${ inlineMarkdown( heading[ 2 ] ) }</h${ level }>` );
			} else if ( unordered || ordered ) {
				const nextType = unordered ? 'ul' : 'ol';
				if ( listType && listType !== nextType ) {
					closeList();
				}
				if ( ! listType ) {
					listType = nextType;
					html.push( `<${ listType }>` );
				}
				html.push( `<li>${ inlineMarkdown( ( unordered || ordered )[ 1 ] ) }</li>` );
			} else if ( /^\s*>\s?/.test( line ) ) {
				closeList();
				html.push( `<blockquote>${ inlineMarkdown( line.replace( /^\s*>\s?/, '' ) ) }</blockquote>` );
			} else if ( /^\s*(---+|___+|\*\*\*+)\s*$/.test( line ) ) {
				closeList();
				html.push( '<hr>' );
			} else if ( line.trim() === '' ) {
				closeList();
			} else {
				closeList();
				html.push( `<p>${ inlineMarkdown( line ) }</p>` );
			}
		} );

		if ( inCode ) {
			html.push( `<pre><code>${ escapeHtml( codeBuffer.join( '\n' ) ) }</code></pre>` );
		}
		closeList();
		return html.join( '\n' );
	}

	const markdownInput = $( '#markdown-input' );
	const markdownPreview = $( '#markdown-preview' );

	function updateMarkdown() {
		state.markdown.input = markdownInput.value;
		markdownHtml = renderMarkdown( markdownInput.value );
		if ( markdownInput.value.trim() ) {
			markdownPreview.innerHTML = markdownHtml;
			markdownPreview.classList.remove( 'empty-state' );
		} else {
			markdownPreview.textContent = 'Your rendered Markdown will appear here.';
			markdownPreview.classList.add( 'empty-state' );
		}
		const words = markdownInput.value.trim() ? markdownInput.value.trim().split( /\s+/ ).length : 0;
		$( '#markdown-count' ).textContent = `${ words.toLocaleString() } ${ words === 1 ? 'word' : 'words' }`;
		persistSoon();
	}

	markdownInput.addEventListener( 'input', updateMarkdown );

	function makeStandaloneHtml( body ) {
		return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Workbench export</title>\n</head>\n<body>\n${ body }\n</body>\n</html>\n`;
	}

	function makeSlug() {
		const separator = state.slug.separator;
		let value = normalLines( $( '#slug-input' ).value ).trim().normalize( 'NFKD' ).replace( /\p{Mark}+/gu, '' );
		value = value.replace( /['’]/g, '' ).replace( /[^\p{Letter}\p{Number}]+/gu, separator );
		if ( state.slug.lowercase ) {
			value = value.toLocaleLowerCase();
		}
		const escaped = separator === '-' ? '\\-' : '_';
		value = value.replace( new RegExp( `${ escaped }+`, 'g' ), separator );
		value = value.replace( new RegExp( `^${ escaped }|${ escaped }$`, 'g' ), '' );
		value = value.slice( 0, Number( state.slug.maxLength ) );
		value = value.replace( new RegExp( `${ escaped }$` ), '' );
		$( '#slug-output' ).textContent = value || '—';
		return value;
	}

	function updateSlug() {
		state.slug.input = $( '#slug-input' ).value;
		state.slug.separator = $( '#slug-separator' ).value;
		state.slug.maxLength = $( '#slug-length' ).value;
		state.slug.lowercase = $( '#slug-lowercase' ).checked;
		makeSlug();
		persistSoon();
	}

	[ '#slug-input', '#slug-separator', '#slug-length', '#slug-lowercase' ].forEach( ( selector ) => {
		$( selector ).addEventListener( 'input', updateSlug );
		$( selector ).addEventListener( 'change', updateSlug );
	} );

	const jsonInput = $( '#json-input' );
	const jsonOutput = $( '#json-output' );

	function jsonStatus( message, kind = 'idle' ) {
		const element = $( '#json-status' );
		element.textContent = message;
		element.classList.remove( 'is-idle', 'is-valid', 'is-invalid' );
		element.classList.add( `is-${ kind }` );
	}

	function parseJson() {
		const source = jsonInput.value.trim();
		if ( ! source ) {
			jsonStatus( 'Waiting for JSON', 'idle' );
			return { ok: false, empty: true };
		}
		try {
			const value = JSON.parse( source );
			jsonStatus( 'Valid JSON', 'valid' );
			return { ok: true, value };
		} catch ( error ) {
			const message = String( error.message || 'Invalid JSON' ).replace( /^JSON\.parse:\s*/i, '' );
			jsonStatus( message.length > 58 ? `${ message.slice( 0, 55 ) }…` : message, 'invalid' );
			return { ok: false, error };
		}
	}

	function sortJson( value ) {
		if ( Array.isArray( value ) ) {
			return value.map( sortJson );
		}
		if ( value && typeof value === 'object' ) {
			return Object.keys( value ).sort( ( a, b ) => a.localeCompare( b ) ).reduce( ( result, key ) => {
				result[ key ] = sortJson( value[ key ] );
				return result;
			}, {} );
		}
		return value;
	}

	function runJson( mode ) {
		const parsed = parseJson();
		if ( ! parsed.ok ) {
			if ( ! parsed.empty ) {
				showStatus( 'JSON needs repair', 'error' );
			}
			return false;
		}
		const value = mode === 'sort' ? sortJson( parsed.value ) : parsed.value;
		jsonOutput.value = JSON.stringify( value, null, mode === 'minify' ? 0 : 2 );
		showStatus( mode === 'minify' ? 'JSON minified' : mode === 'sort' ? 'Keys sorted' : 'JSON formatted' );
		return true;
	}

	jsonInput.addEventListener( 'input', () => {
		state.json.input = jsonInput.value;
		parseJson();
		persistSoon();
	} );
	$( '#json-format' ).addEventListener( 'click', () => runJson( 'format' ) );
	$( '#json-minify' ).addEventListener( 'click', () => runJson( 'minify' ) );
	$( '#json-sort' ).addEventListener( 'click', () => runJson( 'sort' ) );
	$( '#json-use-sample' ).addEventListener( 'click', () => {
		jsonInput.value = '{"name":"ODD Workbench","tools":["clean","markdown","slug","json","diff","convert"],"local":true}';
		state.json.input = jsonInput.value;
		runJson( 'format' );
		persistSoon();
	} );

	function diffLines( leftText, rightText ) {
		const left = leftText === '' ? [] : normalLines( leftText ).split( '\n' );
		const right = rightText === '' ? [] : normalLines( rightText ).split( '\n' );
		if ( left.length > 350 || right.length > 350 ) {
			return { tooLarge: true, left, right, operations: [] };
		}
		const rows = left.length + 1;
		const columns = right.length + 1;
		const table = Array.from( { length: rows }, () => new Uint16Array( columns ) );
		for ( let i = left.length - 1; i >= 0; i-- ) {
			for ( let j = right.length - 1; j >= 0; j-- ) {
				table[ i ][ j ] = left[ i ] === right[ j ] ? table[ i + 1 ][ j + 1 ] + 1 : Math.max( table[ i + 1 ][ j ], table[ i ][ j + 1 ] );
			}
		}
		const operations = [];
		let i = 0;
		let j = 0;
		while ( i < left.length && j < right.length ) {
			if ( left[ i ] === right[ j ] ) {
				operations.push( { type: 'same', text: left[ i ] } );
				i++;
				j++;
			} else if ( table[ i + 1 ][ j ] >= table[ i ][ j + 1 ] ) {
				operations.push( { type: 'removed', text: left[ i++ ] } );
			} else {
				operations.push( { type: 'added', text: right[ j++ ] } );
			}
		}
		while ( i < left.length ) {
			operations.push( { type: 'removed', text: left[ i++ ] } );
		}
		while ( j < right.length ) {
			operations.push( { type: 'added', text: right[ j++ ] } );
		}
		return { tooLarge: false, left, right, operations };
	}

	function renderDiff() {
		state.diff.left = $( '#diff-left' ).value;
		state.diff.right = $( '#diff-right' ).value;
		const output = $( '#diff-output' );
		const result = diffLines( state.diff.left, state.diff.right );
		output.replaceChildren();

		if ( result.tooLarge ) {
			output.classList.add( 'empty-state' );
			output.textContent = 'This quick comparator handles up to 350 lines on each side.';
			$( '#diff-summary' ).textContent = 'Comparison is too large';
			diffPatch = '';
			persistSoon();
			return;
		}
		if ( ! state.diff.left && ! state.diff.right ) {
			output.classList.add( 'empty-state' );
			output.textContent = 'Add two drafts to see exactly what changed.';
			$( '#diff-summary' ).textContent = 'Nothing to compare yet';
			diffPatch = '';
			persistSoon();
			return;
		}

		output.classList.remove( 'empty-state' );
		const fragment = document.createDocumentFragment();
		let oldLine = 1;
		let newLine = 1;
		let added = 0;
		let removed = 0;
		const patch = [ '--- original', '+++ revised' ];
		result.operations.forEach( ( operation ) => {
			const row = document.createElement( 'div' );
			row.className = `diff-line is-${ operation.type }`;
			const oldNumber = operation.type === 'added' ? '' : oldLine++;
			const newNumber = operation.type === 'removed' ? '' : newLine++;
			const marker = operation.type === 'added' ? '+' : operation.type === 'removed' ? '−' : ' ';
			if ( operation.type === 'added' ) {
				added++;
				patch.push( `+${ operation.text }` );
			} else if ( operation.type === 'removed' ) {
				removed++;
				patch.push( `-${ operation.text }` );
			} else {
				patch.push( ` ${ operation.text }` );
			}
			[ oldNumber, newNumber ].forEach( ( number ) => {
				const span = document.createElement( 'span' );
				span.className = 'diff-line__number';
				span.textContent = number;
				row.appendChild( span );
			} );
			const mark = document.createElement( 'span' );
			mark.className = 'diff-line__mark';
			mark.textContent = marker;
			row.appendChild( mark );
			const text = document.createElement( 'span' );
			text.className = 'diff-line__text';
			text.textContent = operation.text || ' ';
			row.appendChild( text );
			fragment.appendChild( row );
		} );
		output.appendChild( fragment );
		diffPatch = patch.join( '\n' );
		$( '#diff-summary' ).textContent = added || removed ? `${ added } added · ${ removed } removed` : `No changes · ${ result.operations.length } lines`;
		persistSoon();
	}

	function scheduleDiff() {
		window.clearTimeout( diffTimer );
		diffTimer = window.setTimeout( renderDiff, 120 );
	}

	[ '#diff-left', '#diff-right' ].forEach( ( selector ) => $( selector ).addEventListener( 'input', scheduleDiff ) );
	$( '#diff-swap' ).addEventListener( 'click', () => {
		const left = $( '#diff-left' ).value;
		$( '#diff-left' ).value = $( '#diff-right' ).value;
		$( '#diff-right' ).value = left;
		renderDiff();
		showStatus( 'Drafts swapped' );
	} );

	function bytesToBase64( bytes ) {
		let binary = '';
		for ( let index = 0; index < bytes.length; index += 8192 ) {
			binary += String.fromCharCode( ...bytes.subarray( index, index + 8192 ) );
		}
		return btoa( binary );
	}

	function base64ToText( value ) {
		const compact = value.replace( /\s+/g, '' );
		if ( ! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test( compact ) ) {
			throw new Error( 'That is not valid Base64.' );
		}
		const binary = atob( compact );
		const bytes = Uint8Array.from( binary, ( character ) => character.charCodeAt( 0 ) );
		return new TextDecoder( 'utf-8', { fatal: true } ).decode( bytes );
	}

	function textToHex( value ) {
		return Array.from( new TextEncoder().encode( value ) ).map( ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	}

	function hexToText( value ) {
		const compact = value.replace( /\s+/g, '' );
		if ( compact.length % 2 || ! /^[0-9a-f]*$/i.test( compact ) ) {
			throw new Error( 'Hex needs complete two-character bytes.' );
		}
		const bytes = new Uint8Array( compact.match( /.{2}/g )?.map( ( pair ) => Number.parseInt( pair, 16 ) ) || [] );
		return new TextDecoder( 'utf-8', { fatal: true } ).decode( bytes );
	}

	const convertLabels = {
		'base64-encode': 'Plain text',
		'base64-decode': 'Base64',
		'url-encode': 'Plain text',
		'url-decode': 'URL component',
		'html-encode': 'Plain text',
		'html-decode': 'HTML entities',
		'hex-encode': 'Plain text',
		'hex-decode': 'UTF-8 hex',
	};

	function runConvert( quiet = false ) {
		state.convert.input = $( '#convert-input' ).value;
		state.convert.mode = $( '#convert-mode' ).value;
		$( '#convert-input-label' ).textContent = convertLabels[ state.convert.mode ];
		const input = state.convert.input;
		if ( input === '' ) {
			$( '#convert-output' ).value = '';
			persistSoon();
			return true;
		}
		try {
			let output = '';
			switch ( state.convert.mode ) {
				case 'base64-encode':
					output = bytesToBase64( new TextEncoder().encode( input ) );
					break;
				case 'base64-decode':
					output = base64ToText( input );
					break;
				case 'url-encode':
					output = encodeURIComponent( input );
					break;
				case 'url-decode':
					output = decodeURIComponent( input );
					break;
				case 'html-encode':
					output = escapeHtml( input );
					break;
				case 'html-decode':
					output = decodeHtml( input );
					break;
				case 'hex-encode':
					output = textToHex( input );
					break;
				case 'hex-decode':
					output = hexToText( input );
					break;
			}
			$( '#convert-output' ).value = output;
			if ( ! quiet ) {
				showStatus( 'Conversion complete' );
			}
			persistSoon();
			return true;
		} catch ( error ) {
			$( '#convert-output' ).value = '';
			showStatus( String( error.message || 'Could not convert that value' ), 'error' );
			persistSoon();
			return false;
		}
	}

	$( '#convert-run' ).addEventListener( 'click', () => runConvert() );
	$( '#convert-input' ).addEventListener( 'input', () => runConvert( true ) );
	$( '#convert-mode' ).addEventListener( 'change', () => runConvert( true ) );

	async function copyText( value, label = 'Copied' ) {
		if ( ! value || value === '—' ) {
			showStatus( 'Nothing to copy yet', 'busy' );
			return false;
		}
		try {
			if ( navigator.clipboard?.writeText ) {
				await navigator.clipboard.writeText( value );
			} else {
				throw new Error( 'fallback' );
			}
			showStatus( label );
			return true;
		} catch ( _error ) {
			const textarea = document.createElement( 'textarea' );
			textarea.value = value;
			textarea.setAttribute( 'readonly', '' );
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.appendChild( textarea );
			textarea.select();
			const copied = document.execCommand( 'copy' );
			textarea.remove();
			showStatus( copied ? label : 'Copy is unavailable', copied ? 'ok' : 'error' );
			return copied;
		}
	}

	function targetValue( id ) {
		const element = document.getElementById( id );
		return 'value' in element ? element.value : element.textContent;
	}

	function downloadFile( value, filename, mime = 'text/plain' ) {
		if ( ! value ) {
			showStatus( 'Nothing to save yet', 'busy' );
			return;
		}
		const url = URL.createObjectURL( new Blob( [ value ], { type: `${ mime };charset=utf-8` } ) );
		const link = document.createElement( 'a' );
		link.href = url;
		link.download = filename;
		link.click();
		window.setTimeout( () => URL.revokeObjectURL( url ), 0 );
		showStatus( `${ filename } saved` );
	}

	$$ ( '[data-copy-target]' ).forEach( ( button ) => {
		button.addEventListener( 'click', () => copyText( targetValue( button.dataset.copyTarget ) ) );
	} );
	$$ ( '[data-download-target]' ).forEach( ( button ) => {
		button.addEventListener( 'click', () => downloadFile( targetValue( button.dataset.downloadTarget ), button.dataset.filename ) );
	} );
	$( '#copy-markdown-html' ).addEventListener( 'click', () => copyText( markdownHtml, 'HTML copied' ) );
	$( '#download-markdown-html' ).addEventListener( 'click', () => downloadFile( makeStandaloneHtml( markdownHtml ), 'workbench-markdown.html', 'text/html' ) );
	$( '#download-json' ).addEventListener( 'click', () => {
		if ( jsonOutput.value || runJson( 'format' ) ) {
			downloadFile( jsonOutput.value, 'workbench-data.json', 'application/json' );
		}
	} );
	$( '#copy-diff' ).addEventListener( 'click', () => copyText( diffPatch, 'Patch copied' ) );

	const resetButton = $( '#reset-drafts' );
	const resetIcon = resetButton.innerHTML;
	function disarmReset() {
		window.clearTimeout( resetTimer );
		resetButton.classList.remove( 'is-armed' );
		resetButton.innerHTML = resetIcon;
		resetButton.setAttribute( 'aria-label', 'Clear every Workbench draft' );
	}

	function restoreInputs() {
		cleanInput.value = state.clean.input;
		markdownInput.value = state.markdown.input;
		$( '#slug-input' ).value = state.slug.input;
		$( '#slug-separator' ).value = state.slug.separator;
		$( '#slug-length' ).value = state.slug.maxLength;
		$( '#slug-lowercase' ).checked = state.slug.lowercase;
		jsonInput.value = state.json.input;
		$( '#diff-left' ).value = state.diff.left;
		$( '#diff-right' ).value = state.diff.right;
		$( '#convert-input' ).value = state.convert.input;
		$( '#convert-mode' ).value = state.convert.mode;
		jsonOutput.value = '';
		updateClean();
		updateMarkdown();
		updateSlug();
		parseJson();
		renderDiff();
		runConvert( true );
		activateTool( state.activeTool );
	}

	resetButton.addEventListener( 'click', () => {
		if ( ! resetButton.classList.contains( 'is-armed' ) ) {
			resetButton.classList.add( 'is-armed' );
			resetButton.textContent = 'Clear drafts?';
			resetButton.setAttribute( 'aria-label', 'Click again to clear every Workbench draft' );
			showStatus( 'Click again to clear drafts', 'busy' );
			resetTimer = window.setTimeout( disarmReset, 2400 );
			return;
		}
		localStorage.removeItem( STORAGE_KEY );
		state = cloneDefaults();
		disarmReset();
		restoreInputs();
		showStatus( 'Workbench cleared' );
	} );

	document.addEventListener( 'keydown', ( event ) => {
		const modifier = event.metaKey || event.ctrlKey;
		if ( modifier && event.key === 'Enter' ) {
			event.preventDefault();
			if ( state.activeTool === 'clean' ) {
				updateClean();
				showStatus( 'Text cleaned' );
			} else if ( state.activeTool === 'json' ) {
				runJson( 'format' );
			} else if ( state.activeTool === 'convert' ) {
				runConvert();
			}
		}
		if ( modifier && event.shiftKey && event.key.toLocaleLowerCase() === 'c' ) {
			event.preventDefault();
			const outputs = {
				clean: cleanOutput.value,
				markdown: markdownHtml,
				slug: makeSlug(),
				json: jsonOutput.value,
				diff: diffPatch,
				convert: $( '#convert-output' ).value,
			};
			copyText( outputs[ state.activeTool ] );
		}
	} );

	window.addEventListener( 'beforeunload', () => {
		window.clearTimeout( saveTimer );
		window.clearTimeout( statusTimer );
		window.clearTimeout( resetTimer );
		window.clearTimeout( diffTimer );
		try {
			localStorage.setItem( STORAGE_KEY, JSON.stringify( state ) );
		} catch ( _error ) {
			// The current in-memory draft remains usable until the window closes.
		}
	} );

	restoreInputs();
}() );
