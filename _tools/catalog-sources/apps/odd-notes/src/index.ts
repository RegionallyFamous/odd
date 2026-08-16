import {
	NotesApiError,
	WINDOW_ID,
	config,
	createNote,
	deleteNote,
	desktop,
	fetchLibrary,
	fetchRevisions,
	restoreRevision,
	updateNote,
} from './api';
import {
	applyDraft,
	countWords,
	draftMatchesNote,
	moveDraft,
	readJournal,
	removeDraft,
	resolveJournalScope,
	setDraft,
	writeJournal,
} from './drafts';
import {
	buildTagIndex,
	filterNotes,
	isLocalId,
	noteCounts,
	removeNote,
	replaceNoteStable,
	updateNoteLocally,
	upsertNote,
} from './state';
import type {
	DraftEntry,
	NativeRenderContext,
	Note,
	NoteFilter,
	NoteId,
	NoteMutation,
	NoteRevision,
	NotesDraftJournal,
	OsTagInputElement,
} from './types';

const SAVE_DELAY = 650;
const JOURNAL_DELAY = 120;
const PAPER_COLORS: Record< string, string > = {
	butter: '#fff3a6',
	blush: '#ffd9e0',
	sky: '#cde9ff',
	mint: '#d4f5dc',
	lilac: '#e6ddff',
	peach: '#ffe1c4',
};
const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat( undefined, {
	numeric: 'auto',
} );
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat( undefined, {
	month: 'short',
	day: 'numeric',
} );
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat( undefined, {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
} );

function __( text: string ): string {
	// eslint-disable-next-line @wordpress/i18n-no-variables, @wordpress/i18n-text-domain
	return window.wp?.i18n?.__( text, 'odd-outlandish-desktop-decorator' ) ?? text;
}

function sprintf( format: string, ...values: Array< string | number > ): string {
	return window.wp?.i18n?.sprintf( format, ...values ) ??
		format.replace( /%[sd]/g, () => String( values.shift() ?? '' ) );
}

function query< T extends Element >( root: ParentNode, selector: string ): T {
	const element = root.querySelector< T >( selector );
	if ( ! element ) {
		throw new Error( `Notes template is missing ${ selector }.` );
	}
	return element;
}

function setCustomValue( element: HTMLElement, value: string ): void {
	( element as HTMLElement & { value: string } ).value = value;
	element.setAttribute( 'value', value );
}

function eventValue( event: Event ): string {
	return String( ( event as CustomEvent< { value?: string } > ).detail?.value ?? '' );
}

function checkboxValue( event: Event ): boolean {
	return Boolean(
		( event as CustomEvent< { checked?: boolean } > ).detail?.checked,
	);
}

function setCheckbox( element: HTMLElement, checked: boolean, disabled: boolean ): void {
	element.toggleAttribute( 'checked', checked );
	element.toggleAttribute( 'disabled', disabled );
	const input = element.shadowRoot?.querySelector< HTMLInputElement >(
		'input[type="checkbox"]',
	);
	if ( input ) {
		input.checked = checked;
		input.disabled = disabled;
	}
}

function createLocalNote( userId: number, color: string ): Note {
	const now = new Date().toISOString();
	return {
		id: `local-${ Date.now() }-${ Math.random().toString( 36 ).slice( 2, 7 ) }`,
		title: __( 'Untitled note' ),
		body: '',
		excerpt: '',
		color,
		tags: [],
		favorite: false,
		archived: false,
		onDesktop: false,
		public: false,
		ownerId: userId,
		ownerName: __( 'You' ),
		ownerAvatar: '',
		canEdit: true,
		createdAt: now,
		updatedAt: now,
		updatedAtMs: Date.now(),
		version: 0,
		wordCount: 0,
	};
}

function mutationFromNote( note: Note ): NoteMutation {
	return {
		title: note.title,
		body: note.body,
		color: note.color,
		tags: [ ...note.tags ],
		favorite: note.favorite,
		archived: note.archived,
		onDesktop: note.onDesktop,
		public: note.public,
		...( note.version > 0 ? { version: note.version } : {} ),
		...( note.updatedAtMs > 0 ? { updatedAtMs: note.updatedAtMs } : {} ),
	};
}

function mergeEditable( server: Note, local: Note ): Note {
	return {
		...server,
		title: local.title,
		body: local.body,
		excerpt: local.body.trim().replace( /\s+/g, ' ' ).slice( 0, 150 ),
		color: local.color,
		tags: [ ...local.tags ],
		favorite: local.favorite,
		archived: local.archived,
		onDesktop: local.onDesktop,
		public: local.public,
		wordCount: countWords( local.body ),
	};
}

function noteFromDraft( draft: DraftEntry, userId: number ): Note {
	const now = new Date( draft.clientUpdatedAt ).toISOString();
	return {
		id: draft.id,
		title: draft.title,
		body: draft.body,
		excerpt: draft.body.trim().replace( /\s+/g, ' ' ).slice( 0, 150 ),
		color: draft.color,
		tags: [ ...draft.tags ],
		favorite: draft.favorite,
		archived: draft.archived,
		onDesktop: draft.onDesktop,
		public: draft.public,
		ownerId: userId,
		ownerName: __( 'You' ),
		ownerAvatar: '',
		canEdit: true,
		createdAt: now,
		updatedAt: now,
		updatedAtMs: draft.updatedAtMs ?? draft.clientUpdatedAt,
		version: draft.version ?? 0,
		wordCount: countWords( draft.body ),
	};
}

function relativeDate( iso: string ): string {
	const date = Date.parse( iso );
	if ( Number.isNaN( date ) ) {
		return '';
	}
	const delta = date - Date.now();
	const abs = Math.abs( delta );
	if ( abs < 60_000 ) {
		return __( 'just now' );
	}
	if ( abs < 3_600_000 ) {
		return RELATIVE_TIME_FORMATTER.format( Math.round( delta / 60_000 ), 'minute' );
	}
	if ( abs < 86_400_000 ) {
		return RELATIVE_TIME_FORMATTER.format( Math.round( delta / 3_600_000 ), 'hour' );
	}
	if ( abs < 2_592_000_000 ) {
		return RELATIVE_TIME_FORMATTER.format( Math.round( delta / 86_400_000 ), 'day' );
	}
	const parsed = new Date( iso );
	return ( parsed.getFullYear() === new Date().getFullYear()
		? SHORT_DATE_FORMATTER
		: LONG_DATE_FORMATTER ).format( parsed );
}

async function mount(
	container: HTMLElement,
	context: NativeRenderContext,
): Promise< () => void > {
	const cfg = config();
	const root = query< HTMLElement >( container, '[data-notes-app]' );
	const list = query< HTMLElement >( root, '[data-notes-list]' );
	const loading = query< HTMLElement >( root, '[data-notes-loading]' );
	const empty = query< HTMLElement >( root, '[data-notes-empty]' );
	const editor = query< HTMLElement >( root, '[data-notes-editor]' );
	const writing = query< HTMLElement >( root, '.os-notes-app__writing' );
	const titleField = query< HTMLElement >( root, '[data-notes-title]' );
	const bodyField = query< HTMLElement >( root, '[data-notes-body]' );
	const tagsField = query< OsTagInputElement >( root, '[data-notes-tags]' );
	const desktopField = query< HTMLElement >( root, '[data-notes-desktop]' );
	const publicField = query< HTMLElement >( root, '[data-notes-public]' );
	const saveStatus = query< HTMLElement >( root, '[data-notes-save-status]' );
	const stats = query< HTMLElement >( root, '[data-notes-stats]' );
	const owner = query< HTMLElement >( root, '[data-notes-owner]' );
	const toast = query< HTMLElement >( root, '[data-notes-toast]' );
	const historyPanel = query< HTMLElement >( root, '[data-notes-history-panel]' );
	const historyList = query< HTMLElement >( root, '[data-notes-history-list]' );
	const listTitle = query< HTMLElement >( root, '[data-notes-list-title]' );
	const listSummary = query< HTMLElement >( root, '[data-notes-list-summary]' );
	const tagList = query< HTMLElement >( root, '[data-notes-tag-list]' );
	const favoriteButton = query< HTMLElement >( root, '[data-notes-favorite]' );
	const archiveButton = query< HTMLElement >( root, '[data-notes-archive]' );
	const historyButton = query< HTMLElement >( root, '[data-notes-history]' );
	const deleteButton = query< HTMLElement >( root, '[data-notes-delete]' );
	const onlineDot = query< HTMLElement >( root, '[data-notes-online-dot]' );
	const onlineLabel = query< HTMLElement >( root, '[data-notes-online-label]' );
	const journalScope = resolveJournalScope( cfg );

	let notes: Note[] = [];
	let selectedId: NoteId | null = null;
	let activeFilter: NoteFilter = 'all';
	let activeTag: string | null = null;
	let search = '';
	let journal: NotesDraftJournal = readJournal( journalScope, cfg.userId );
	let destroyed = false;
	let toastTimer: number | null = null;
	let listRenderTimer: number | null = null;
	let journalTimer: number | null = null;
	const saveTimers = new Map< string, number >();
	const saving = new Set< string >();
	const dirty = new Set< string >();
	const revisions = new Map< string, number >();

	await Promise.all( [
		customElements.whenDefined( 'os-tag-input' ),
		customElements.whenDefined( 'os-swatch' ),
	] );

	function findNote( id: NoteId | null ): Note | undefined {
		return id === null ? undefined : notes.find( ( note ) => note.id === id );
	}

	function selected(): Note | undefined {
		return findNote( selectedId );
	}

	function setStatus(
		phase: 'idle' | 'pending' | 'saving' | 'saved' | 'failed',
		error = '',
	): void {
		saveStatus.setAttribute( 'phase', phase );
		if ( error ) {
			saveStatus.setAttribute( 'error', error );
		} else {
			saveStatus.removeAttribute( 'error' );
		}
	}

	function showToast( message: string, error = false ): void {
		toast.textContent = message;
		toast.hidden = false;
		toast.toggleAttribute( 'data-error', error );
		if ( toastTimer !== null ) {
			window.clearTimeout( toastTimer );
		}
		toastTimer = window.setTimeout( () => {
			toast.hidden = true;
		}, 4200 );
	}

	function flushJournal(): void {
		if ( journalTimer !== null ) {
			window.clearTimeout( journalTimer );
			journalTimer = null;
		}
		writeJournal( journalScope, cfg.userId, journal );
	}

	function persistJournal( immediate = true ): void {
		if ( immediate ) {
			flushJournal();
			return;
		}
		if ( journalTimer !== null ) {
			window.clearTimeout( journalTimer );
		}
		journalTimer = window.setTimeout( flushJournal, JOURNAL_DELAY );
	}

	function renderNetworkState(): void {
		const online = window.navigator.onLine;
		onlineDot.toggleAttribute( 'data-offline', ! online );
		onlineLabel.textContent = online
			? __( 'WordPress connected' )
			: __( 'Offline — drafts safe here' );
	}

	function renderNavigation(): void {
		const counts = noteCounts( notes );
		for ( const [ key, count ] of Object.entries( counts ) ) {
			const countEl = root.querySelector< HTMLElement >(
				`[data-notes-count="${ key }"]`,
			);
			if ( countEl ) {
				countEl.textContent = String( count );
			}
		}

		root.querySelectorAll< HTMLElement >( '[data-notes-filter]' ).forEach( ( item ) => {
			item.classList.toggle(
				'is-active',
				item.dataset.notesFilter === activeFilter && activeTag === null,
			);
		} );

		tagList.replaceChildren();
		for ( const tag of buildTagIndex( notes ) ) {
			const button = document.createElement( 'button' );
			button.type = 'button';
			button.dataset.notesTag = tag.label;
			button.classList.toggle(
				'is-active',
				activeTag?.toLocaleLowerCase() === tag.label.toLocaleLowerCase(),
			);
			const hash = document.createElement( 'span' );
			hash.textContent = '#';
			const label = document.createElement( 'span' );
			label.textContent = tag.label;
			const count = document.createElement( 'small' );
			count.textContent = String( tag.count );
			button.append( hash, label, count );
			tagList.appendChild( button );
		}
	}

	function renderList(): void {
		const visible = filterNotes( notes, activeFilter, search, activeTag );
		const titles: Record< NoteFilter, string > = {
			all: __( 'All notes' ),
			favorite: __( 'Favorites' ),
			desktop: __( 'On desktop' ),
			shared: __( 'Shared notes' ),
			archive: __( 'Archive' ),
		};
		listTitle.textContent = activeTag ? `#${ activeTag }` : titles[ activeFilter ];
		listSummary.textContent = search
			? sprintf(
				/* translators: %d: number of notes matching the current search. */
				__( '%d matching notes' ),
				visible.length,
			)
			: sprintf(
				/* translators: %d: number of notes in the current smart list. */
				__( '%d notes' ),
				visible.length,
			);

		list.replaceChildren();
		if ( visible.length === 0 ) {
			const noResults = document.createElement( 'div' );
			noResults.className = 'os-notes-app__no-results';
			const icon = document.createElement( 'span' );
			icon.className = 'dashicons dashicons-search';
			icon.setAttribute( 'aria-hidden', 'true' );
			const message = document.createElement( 'p' );
			message.textContent = search || activeTag
				? __( 'No notes match this view.' )
				: __( 'Nothing here yet.' );
			noResults.append( icon, message );
			list.appendChild( noResults );
			return;
		}

		for ( const note of visible ) {
			const button = document.createElement( 'button' );
			button.type = 'button';
			button.className = 'os-notes-app__note-card';
			button.dataset.noteId = String( note.id );
			button.dataset.noteColor = note.color;
			button.classList.toggle( 'is-selected', note.id === selectedId );
			button.classList.toggle( 'is-local', isLocalId( note.id ) );
			button.setAttribute( 'aria-pressed', note.id === selectedId ? 'true' : 'false' );

			const marker = document.createElement( 'span' );
			marker.className = 'os-notes-app__note-marker';
			marker.setAttribute( 'aria-hidden', 'true' );

			const cardBody = document.createElement( 'span' );
			cardBody.className = 'os-notes-app__note-card-body';
			const top = document.createElement( 'span' );
			top.className = 'os-notes-app__note-card-top';
			const title = document.createElement( 'strong' );
			title.textContent = note.title || __( 'Untitled note' );
			top.appendChild( title );
			if ( note.favorite ) {
				const star = document.createElement( 'span' );
				star.className = 'dashicons dashicons-star-filled';
				star.setAttribute( 'aria-label', __( 'Favorite' ) );
				top.appendChild( star );
			}

			const excerpt = document.createElement( 'span' );
			excerpt.className = 'os-notes-app__note-excerpt';
			excerpt.textContent = note.excerpt || __( 'A new note, waiting for words.' );

			const meta = document.createElement( 'span' );
			meta.className = 'os-notes-app__note-meta';
			const date = document.createElement( 'span' );
			date.textContent = relativeDate( note.updatedAt );
			meta.appendChild( date );
			if ( ! note.canEdit ) {
				const shared = document.createElement( 'span' );
				shared.className = 'os-notes-app__shared-pill';
				shared.textContent = note.ownerName;
				meta.appendChild( shared );
			} else if ( note.onDesktop ) {
				const pinned = document.createElement( 'span' );
				pinned.className = 'os-notes-app__desktop-pill';
				pinned.textContent = note.public ? __( 'Public' ) : __( 'Desktop' );
				meta.appendChild( pinned );
			}
			for ( const tag of note.tags.slice( 0, 2 ) ) {
				const tagEl = document.createElement( 'span' );
				tagEl.className = 'os-notes-app__tag-pill';
				tagEl.textContent = `#${ tag }`;
				meta.appendChild( tagEl );
			}

			cardBody.append( top, excerpt, meta );
			button.append( marker, cardBody );
			list.appendChild( button );
		}
	}

	function renderEditor(): void {
		const note = selected();
		if ( ! note ) {
			empty.hidden = false;
			editor.hidden = true;
			historyPanel.hidden = true;
			return;
		}

		empty.hidden = true;
		editor.hidden = false;
		editor.toggleAttribute( 'data-readonly', ! note.canEdit );
		writing.dataset.notesPaperColor = note.color;
		setCustomValue( titleField, note.title );
		setCustomValue( bodyField, note.body );
		titleField.toggleAttribute( 'readonly', ! note.canEdit );
		bodyField.toggleAttribute( 'readonly', ! note.canEdit );
		tagsField.value = note.tags.map( ( label ) => ( { id: label, label } ) );
		tagsField.toggleAttribute( 'readonly', ! note.canEdit );
		setCheckbox( desktopField, note.onDesktop, ! note.canEdit );
		setCheckbox( publicField, note.public, ! note.canEdit || ! note.onDesktop );
		favoriteButton.toggleAttribute( 'disabled', ! note.canEdit );
		archiveButton.toggleAttribute( 'disabled', ! note.canEdit );
		historyButton.toggleAttribute( 'disabled', ! note.canEdit || isLocalId( note.id ) );
		deleteButton.toggleAttribute( 'disabled', ! note.canEdit );
		favoriteButton.setAttribute(
			'title',
			note.favorite ? __( 'Remove from favorites' ) : __( 'Add to favorites' ),
		);
		const favoriteIcon = favoriteButton.querySelector< HTMLElement >( '.dashicons' );
		if ( favoriteIcon ) {
			favoriteIcon.className = note.favorite
				? 'dashicons dashicons-star-filled'
				: 'dashicons dashicons-star-empty';
		}
		archiveButton.setAttribute(
			'title',
			note.archived ? __( 'Return to notes' ) : __( 'Archive' ),
		);

		owner.replaceChildren();
		if ( ! note.canEdit ) {
			if ( note.ownerAvatar ) {
				const avatar = document.createElement( 'img' );
				avatar.src = note.ownerAvatar;
				avatar.alt = '';
				owner.appendChild( avatar );
			}
			const copy = document.createElement( 'span' );
			copy.textContent = sprintf(
				/* translators: %s: note owner's display name. */
				__( 'Shared by %s' ),
				note.ownerName,
			);
			owner.appendChild( copy );
		} else {
			const cloud = document.createElement( 'span' );
			cloud.className = 'dashicons dashicons-cloud-saved';
			cloud.setAttribute( 'aria-hidden', 'true' );
			const copy = document.createElement( 'span' );
			copy.textContent = isLocalId( note.id )
				? __( 'Local draft' )
				: sprintf(
					/* translators: %s: human-readable relative edit time. */
					__( 'Edited %s' ),
					relativeDate( note.updatedAt ),
				);
			owner.append( cloud, copy );
		}

		stats.textContent = sprintf(
			/* translators: 1: word count, 2: character count. */
			__( '%d words · %d characters' ),
			note.wordCount,
			note.body.length,
		);
		root.querySelectorAll< HTMLElement >( '[data-notes-colors] os-swatch' ).forEach(
			( swatch ) => {
				swatch.toggleAttribute( 'selected', swatch.getAttribute( 'value' ) === note.color );
			},
		);
		if ( ! dirty.has( String( note.id ) ) && ! saving.has( String( note.id ) ) ) {
			setStatus( isLocalId( note.id ) ? 'pending' : 'idle' );
		}
	}

	function scheduleListRender(): void {
		if ( listRenderTimer !== null ) {
			window.clearTimeout( listRenderTimer );
		}
		listRenderTimer = window.setTimeout( () => {
			renderNavigation();
			renderList();
		}, 120 );
	}

	function replaceNote( note: Note, render = true ): void {
		notes = upsertNote( notes, note );
		if ( render ) {
			renderNavigation();
			renderList();
			renderEditor();
		}
	}

	function touchSelected( patch: Partial< Note >, render = false ): void {
		const note = selected();
		if ( ! note?.canEdit ) {
			return;
		}
		// Keep the server-issued version and modified time until a save succeeds.
		// They are optimistic-concurrency tokens, not client display timestamps.
		const next = updateNoteLocally( note, patch );
		notes = replaceNoteStable( notes, next );
		if ( render ) {
			renderNavigation();
			renderList();
			renderEditor();
		}
		const key = String( next.id );
		revisions.set( key, ( revisions.get( key ) ?? 0 ) + 1 );
		dirty.add( key );
		journal = setDraft( journal, next );
		persistJournal( false );
		setStatus( 'pending' );
		stats.textContent = sprintf(
			/* translators: 1: word count, 2: character count. */
			__( '%d words · %d characters' ),
			next.wordCount,
			next.body.length,
		);
		scheduleListRender();
		scheduleSave( next.id );
	}

	function scheduleSave( id: NoteId, delay = SAVE_DELAY ): void {
		const key = String( id );
		const existing = saveTimers.get( key );
		if ( existing !== undefined ) {
			window.clearTimeout( existing );
		}
		saveTimers.set(
			key,
			window.setTimeout( () => {
				saveTimers.delete( key );
				void saveNote( id );
			}, delay ),
		);
	}

	async function resolveConflict( id: number, local: Note, current: Note ): Promise< void > {
		const keepLocal = await desktop().confirm( {
			title: __( 'This note changed elsewhere' ),
			message: __( 'Keep the words from this window? Choose “Use WordPress copy” to discard this local draft.' ),
			confirmLabel: __( 'Keep this draft' ),
			cancelLabel: __( 'Use WordPress copy' ),
		} );
		if ( destroyed ) {
			return;
		}
		if ( keepLocal ) {
			const rebased = mergeEditable( current, local );
			replaceNote( rebased );
			dirty.add( String( id ) );
			journal = setDraft( journal, rebased );
			persistJournal();
			scheduleSave( id, 0 );
			return;
		}
		replaceNote( current );
		dirty.delete( String( id ) );
		journal = removeDraft( journal, id );
		persistJournal();
		setStatus( 'saved' );
	}

	async function saveNote( requestedId: NoteId ): Promise< void > {
		const requestedKey = String( requestedId );
		if ( saving.has( requestedKey ) || ! dirty.has( requestedKey ) ) {
			return;
		}
		const note = findNote( requestedId );
		if ( ! note?.canEdit ) {
			return;
		}
		if ( ! window.navigator.onLine ) {
			if ( selectedId === requestedId ) {
				setStatus( 'pending' );
			}
			return;
		}

		saving.add( requestedKey );
		dirty.delete( requestedKey );
		const capturedRevision = revisions.get( requestedKey ) ?? 0;
		if ( selectedId === requestedId ) {
			setStatus( 'saving' );
		}

		try {
			const saved = isLocalId( requestedId )
				? await createNote( mutationFromNote( note ), context.signal )
				: await updateNote( requestedId, mutationFromNote( note ), context.signal );
			if ( destroyed ) {
				return;
			}

			const latest = findNote( requestedId );
			const changedDuringSave =
				( revisions.get( requestedKey ) ?? 0 ) !== capturedRevision;

			if ( isLocalId( requestedId ) ) {
				notes = removeNote( notes, requestedId );
				selectedId = selectedId === requestedId ? saved.id : selectedId;
				journal = moveDraft( journal, requestedId, saved.id );
				dirty.delete( requestedKey );
				revisions.set( String( saved.id ), revisions.get( requestedKey ) ?? 0 );
				revisions.delete( requestedKey );
				const next = changedDuringSave && latest ? mergeEditable( saved, latest ) : saved;
				replaceNote( next, false );
				if ( changedDuringSave ) {
					dirty.add( String( saved.id ) );
					journal = setDraft( journal, next );
				} else {
					journal = removeDraft( journal, saved.id );
				}
			} else if ( changedDuringSave && latest ) {
				const next = mergeEditable( saved, latest );
				replaceNote( next, false );
				dirty.add( requestedKey );
				journal = setDraft( journal, next );
			} else {
				replaceNote( saved, false );
				journal = removeDraft( journal, requestedId );
			}
			persistJournal();
			renderNavigation();
			renderList();
			renderEditor();
			if ( ! changedDuringSave && selectedId === saved.id ) {
				setStatus( 'saved' );
			}
		} catch ( error ) {
			if ( destroyed || ( error instanceof DOMException && error.name === 'AbortError' ) ) {
				return;
			}
			dirty.add( requestedKey );
			if (
				error instanceof NotesApiError &&
				error.status === 409 &&
				error.data.current &&
				! isLocalId( requestedId )
			) {
				await resolveConflict( requestedId, note, error.data.current );
			} else {
				if ( selectedId === requestedId ) {
					setStatus( 'failed', error instanceof Error ? error.message : __( 'Save failed' ) );
				}
				showToast(
					error instanceof Error ? error.message : __( 'The note could not be saved.' ),
					true,
				);
			}
		} finally {
			saving.delete( requestedKey );
			const nextId = isLocalId( requestedId ) && selectedId !== requestedId
				? selectedId
				: requestedId;
			if ( nextId !== null && dirty.has( String( nextId ) ) ) {
				scheduleSave( nextId, 160 );
			}
		}
	}

	function selectNote( id: NoteId ): void {
		selectedId = id;
		historyPanel.hidden = true;
		renderList();
		renderEditor();
		window.setTimeout( () => {
			( titleField as HTMLElement & { focusInput?: () => void } ).focusInput?.();
		}, 0 );
	}

	function newNote( source?: Note ): void {
		const note = createLocalNote( cfg.userId, source?.color ?? cfg.colors[ 0 ] ?? 'butter' );
		if ( source ) {
			note.title = sprintf(
				/* translators: %s: title of the note being duplicated. */
				__( 'Copy of %s' ),
				source.title,
			);
			note.body = source.body;
			note.tags = [ ...source.tags ];
			note.favorite = false;
			note.wordCount = countWords( note.body );
			note.excerpt = source.excerpt;
		}
		notes = upsertNote( notes, note );
		selectedId = note.id;
		dirty.add( String( note.id ) );
		journal = setDraft( journal, note );
		persistJournal();
		renderNavigation();
		renderList();
		renderEditor();
		scheduleSave( note.id, 120 );
		window.setTimeout( () => {
			( titleField as HTMLElement & { focusInput?: () => void } ).focusInput?.();
		}, 0 );
	}

	async function loadLibrary( announce = false ): Promise< void > {
		context.markLoading();
		loading.hidden = false;
		try {
			const library = await fetchLibrary( context.signal );
			if ( destroyed ) {
				return;
			}
			const serverById = new Map( library.notes.map( ( note ) => [ String( note.id ), note ] ) );
			let journalChanged = false;
			const merged = library.notes.map( ( note ) => {
				const key = String( note.id );
				const draft = journal.entries[ String( note.id ) ];
				if ( draft ) {
					if ( draftMatchesNote( draft, note ) ) {
						journal = removeDraft( journal, note.id );
						dirty.delete( key );
						journalChanged = true;
						return note;
					}
					dirty.add( key );
					return applyDraft( note, draft );
				}
				dirty.delete( key );
				return note;
			} );
			for ( const draft of Object.values( journal.entries ) ) {
				if ( isLocalId( draft.id ) && ! serverById.has( String( draft.id ) ) ) {
					merged.push( noteFromDraft( draft, cfg.userId ) );
					dirty.add( String( draft.id ) );
				} else if ( ! serverById.has( String( draft.id ) ) ) {
					journal = removeDraft( journal, draft.id );
					dirty.delete( String( draft.id ) );
					journalChanged = true;
				}
			}
			if ( journalChanged ) {
				persistJournal();
			}
			notes = merged;
			if ( selectedId !== null && ! findNote( selectedId ) ) {
				selectedId = null;
			}
			if ( selectedId === null ) {
				selectedId = notes.find( ( note ) => note.canEdit && ! note.archived )?.id ?? null;
			}
			renderNavigation();
			renderList();
			renderEditor();
			for ( const key of dirty ) {
				const note = notes.find( ( item ) => String( item.id ) === key );
				if ( note ) {
					scheduleSave( note.id, 220 );
				}
			}
			if ( announce ) {
				showToast( __( 'Notes refreshed from WordPress.' ) );
			}
		} catch ( error ) {
			if ( error instanceof DOMException && error.name === 'AbortError' ) {
				return;
			}
			showToast(
				error instanceof Error ? error.message : __( 'Could not load notes.' ),
				true,
			);
			if ( notes.length === 0 ) {
				for ( const draft of Object.values( journal.entries ) ) {
					notes.push( noteFromDraft( draft, cfg.userId ) );
				}
				renderNavigation();
				renderList();
			}
		} finally {
			loading.hidden = true;
			context.markReady();
		}
	}

	function renderColors(): void {
		const colors = query< HTMLElement >( root, '[data-notes-colors]' );
		colors.replaceChildren();
		for ( const color of cfg.colors ) {
			const swatch = document.createElement( 'os-swatch' );
			swatch.setAttribute( 'value', color );
			swatch.setAttribute( 'label', color );
			swatch.setAttribute( 'size', 'small' );
			swatch.setAttribute(
				'preview',
				PAPER_COLORS[ color ] ?? PAPER_COLORS.butter,
			);
			colors.appendChild( swatch );
		}
	}

	async function openHistory(): Promise< void > {
		const note = selected();
		if ( ! note?.canEdit || isLocalId( note.id ) ) {
			return;
		}
		historyPanel.hidden = false;
		historyList.replaceChildren();
		const wait = document.createElement( 'div' );
		wait.className = 'os-notes-app__history-loading';
		wait.textContent = __( 'Reading WordPress revisions…' );
		historyList.appendChild( wait );
		try {
			const items = await fetchRevisions( note.id, context.signal );
			if ( destroyed || selectedId !== note.id ) {
				return;
			}
			renderHistoryItems( note, items );
		} catch ( error ) {
			historyList.textContent = error instanceof Error
				? error.message
				: __( 'Could not load revision history.' );
		}
	}

	function renderHistoryItems( note: Note, items: NoteRevision[] ): void {
		historyList.replaceChildren();
		if ( items.length === 0 ) {
			const emptyHistory = document.createElement( 'p' );
			emptyHistory.className = 'os-notes-app__history-empty';
			emptyHistory.textContent = __( 'No earlier versions yet. Keep writing—WordPress will remember them.' );
			historyList.appendChild( emptyHistory );
			return;
		}

		for ( const revision of items ) {
			const card = document.createElement( 'article' );
			card.className = 'os-notes-app__revision';
			const header = document.createElement( 'div' );
			const title = document.createElement( 'strong' );
			title.textContent = revision.title || __( 'Untitled note' );
			const time = document.createElement( 'time' );
			time.dateTime = revision.createdAt;
			time.textContent = relativeDate( revision.createdAt );
			header.append( title, time );
			const preview = document.createElement( 'p' );
			preview.textContent = revision.body.trim().replace( /\s+/g, ' ' ).slice( 0, 220 ) || __( 'Empty note' );
			const restore = document.createElement( 'os-button' );
			restore.setAttribute( 'variant', 'secondary' );
			restore.dataset.revisionId = String( revision.id );
			restore.textContent = __( 'Restore this version' );
			card.append( header, preview, restore );
			historyList.appendChild( card );
		}

		historyList.onclick = ( event ) => {
			const target = ( event.target as Element ).closest< HTMLElement >(
				'[data-revision-id]',
			);
			if ( ! target ) {
				return;
			}
			void restoreHistoryItem( note.id as number, Number( target.dataset.revisionId ) );
		};
	}

	async function restoreHistoryItem( noteId: number, revisionId: number ): Promise< void > {
		const confirmed = await desktop().confirm( {
			title: __( 'Restore this version?' ),
			message: __( 'Your current words will remain available as another WordPress revision.' ),
			confirmLabel: __( 'Restore version' ),
		} );
		if ( ! confirmed ) {
			return;
		}
		try {
			const note = await restoreRevision( noteId, revisionId, context.signal );
			replaceNote( note );
			journal = removeDraft( journal, noteId );
			persistJournal();
			historyPanel.hidden = true;
			showToast( __( 'Earlier version restored.' ) );
		} catch ( error ) {
			showToast( error instanceof Error ? error.message : __( 'Restore failed.' ), true );
		}
	}

	async function trashSelected(): Promise< void > {
		const note = selected();
		if ( ! note?.canEdit ) {
			return;
		}
		const confirmed = await desktop().confirm( {
			title: __( 'Move note to Trash?' ),
			message: __( 'You can restore it later from OpenStation Trash.' ),
			confirmLabel: __( 'Move to Trash' ),
			cancelLabel: __( 'Keep note' ),
			danger: true,
		} );
		if ( ! confirmed ) {
			return;
		}
		try {
			if ( ! isLocalId( note.id ) ) {
				await deleteNote( note.id, context.signal );
			}
			notes = removeNote( notes, note.id );
			journal = removeDraft( journal, note.id );
			persistJournal();
			selectedId = filterNotes( notes, activeFilter, search, activeTag )[ 0 ]?.id ?? null;
			renderNavigation();
			renderList();
			renderEditor();
			showToast( __( 'Note moved to Trash.' ) );
		} catch ( error ) {
			showToast( error instanceof Error ? error.message : __( 'Delete failed.' ), true );
		}
	}

	function initializeEvents(): void {
		root.querySelectorAll< HTMLElement >( '[data-notes-new], [data-notes-empty-new]' ).forEach(
			( button ) => button.addEventListener( 'click', () => newNote() ),
		);
		query< HTMLElement >( root, '[data-notes-refresh]' ).addEventListener(
			'click',
			() => void loadLibrary( true ),
		);
		query< HTMLElement >( root, '[data-notes-search]' ).addEventListener(
			'os-input-change',
			( event ) => {
				search = eventValue( event );
				scheduleListRender();
			},
		);

		root.querySelectorAll< HTMLElement >( '[data-notes-filter]' ).forEach( ( button ) => {
			button.addEventListener( 'click', () => {
				activeFilter = ( button.dataset.notesFilter ?? 'all' ) as NoteFilter;
				activeTag = null;
				renderNavigation();
				renderList();
			} );
		} );
		tagList.addEventListener( 'click', ( event ) => {
			const button = ( event.target as Element ).closest< HTMLElement >(
				'[data-notes-tag]',
			);
			if ( ! button ) {
				return;
			}
			activeTag = activeTag === button.dataset.notesTag ? null : button.dataset.notesTag ?? null;
			activeFilter = 'all';
			renderNavigation();
			renderList();
		} );
		list.addEventListener( 'click', ( event ) => {
			const button = ( event.target as Element ).closest< HTMLElement >( '[data-note-id]' );
			const note = notes.find( ( item ) => String( item.id ) === button?.dataset.noteId );
			if ( note ) {
				selectNote( note.id );
			}
		} );

		titleField.addEventListener( 'os-input-change', ( event ) => {
			touchSelected( { title: eventValue( event ) || __( 'Untitled note' ) } );
		} );
		bodyField.addEventListener( 'os-input-change', ( event ) => {
			touchSelected( { body: eventValue( event ) } );
		} );

		tagsField.addEventListener( 'os-tag-suggest', ( event ) => {
			const value = String(
				( event as CustomEvent< { query?: string } > ).detail?.query ?? '',
			).toLocaleLowerCase();
			const current = new Set( selected()?.tags.map( ( tag ) => tag.toLocaleLowerCase() ) );
			tagsField.suggestions = buildTagIndex( notes )
				.filter(
					( tag ) =>
						! current.has( tag.label.toLocaleLowerCase() ) &&
						tag.label.toLocaleLowerCase().includes( value ),
				)
				.slice( 0, 8 )
				.map( ( tag ) => ( { id: tag.label, label: tag.label } ) );
		} );
		tagsField.addEventListener( 'os-tag-add', ( event ) => {
			const label = String(
				( event as CustomEvent< { tag?: { label?: string } } > ).detail?.tag?.label ?? '',
			).trim();
			const note = selected();
			if ( ! note || ! label ) {
				return;
			}
			if ( note.tags.some( ( tag ) => tag.toLocaleLowerCase() === label.toLocaleLowerCase() ) ) {
				return;
			}
			touchSelected( { tags: [ ...note.tags, label ].slice( 0, 12 ) }, true );
		} );
		tagsField.addEventListener( 'os-tag-remove', ( event ) => {
			const label = String(
				( event as CustomEvent< { tag?: { label?: string } } > ).detail?.tag?.label ?? '',
			);
			const note = selected();
			if ( note ) {
				touchSelected(
					{ tags: note.tags.filter( ( tag ) => tag !== label ) },
					true,
				);
			}
		} );

		query< HTMLElement >( root, '[data-notes-colors]' ).addEventListener(
			'os-pick',
			( event ) => {
				const color = String(
					( event as CustomEvent< { value?: string } > ).detail?.value ?? 'butter',
				);
				touchSelected( { color }, true );
			},
		);
		desktopField.addEventListener( 'os-checkbox-change', ( event ) => {
			const onDesktop = checkboxValue( event );
			touchSelected( { onDesktop, public: onDesktop ? selected()?.public ?? false : false }, true );
		} );
		publicField.addEventListener( 'os-checkbox-change', ( event ) => {
			const isPublic = checkboxValue( event );
			touchSelected( { public: isPublic, onDesktop: isPublic || selected()?.onDesktop === true }, true );
		} );

		favoriteButton.addEventListener( 'click', () => {
			const note = selected();
			if ( note?.canEdit ) {
				touchSelected( { favorite: ! note.favorite }, true );
			}
		} );
		query< HTMLElement >( root, '[data-notes-duplicate]' ).addEventListener( 'click', () => {
			const note = selected();
			if ( note ) {
				newNote( note );
			}
		} );
		archiveButton.addEventListener( 'click', () => {
			const note = selected();
			if ( note?.canEdit ) {
				touchSelected(
					{
						archived: ! note.archived,
						onDesktop: note.archived ? note.onDesktop : false,
						public: note.archived ? note.public : false,
					},
					true,
				);
			}
		} );
		deleteButton.addEventListener( 'click', () => void trashSelected() );
		historyButton.addEventListener( 'click', () => void openHistory() );
		query< HTMLElement >( root, '[data-notes-history-close]' ).addEventListener(
			'click',
			() => {
				historyPanel.hidden = true;
			},
		);

		root.addEventListener( 'keydown', ( event ) => {
			const key = event as KeyboardEvent;
			if ( ( key.metaKey || key.ctrlKey ) && key.key.toLocaleLowerCase() === 's' ) {
				key.preventDefault();
				const note = selected();
				if ( note ) {
					void saveNote( note.id );
				}
			}
			if ( ( key.metaKey || key.ctrlKey ) && key.key.toLocaleLowerCase() === 'n' ) {
				key.preventDefault();
				newNote();
			}
			if (
				( key.metaKey || key.ctrlKey ) &&
				key.shiftKey &&
				key.key.toLocaleLowerCase() === 'f'
			) {
				key.preventDefault();
				const searchField = query< HTMLElement >( root, '[data-notes-search]' ) as HTMLElement & {
					focusInput?: () => void;
				};
				const input = searchField.shadowRoot?.querySelector< HTMLInputElement >( 'input' );
				if ( input ) {
					input.focus();
				} else {
					searchField.focusInput?.();
				}
			}
			key.stopPropagation();
		} );
	}

	function onOnline(): void {
		renderNetworkState();
		for ( const key of dirty ) {
			const note = notes.find( ( item ) => String( item.id ) === key );
			if ( note ) {
				scheduleSave( note.id, 0 );
			}
		}
	}
	function onOffline(): void {
		renderNetworkState();
		setStatus( 'pending' );
	}
	function onPageHide(): void {
		flushJournal();
	}

	renderColors();
	initializeEvents();
	renderNetworkState();
	window.addEventListener( 'online', onOnline );
	window.addEventListener( 'offline', onOffline );
	window.addEventListener( 'pagehide', onPageHide );
	await loadLibrary();

	return () => {
		flushJournal();
		destroyed = true;
		for ( const timer of saveTimers.values() ) {
			window.clearTimeout( timer );
		}
		if ( toastTimer !== null ) {
			window.clearTimeout( toastTimer );
		}
		if ( listRenderTimer !== null ) {
			window.clearTimeout( listRenderTimer );
		}
		window.removeEventListener( 'online', onOnline );
		window.removeEventListener( 'offline', onOffline );
		window.removeEventListener( 'pagehide', onPageHide );
	};
}

window.openStationNativeWindows = window.openStationNativeWindows ?? {};
window.openStationNativeWindows[ WINDOW_ID ] = mount;
