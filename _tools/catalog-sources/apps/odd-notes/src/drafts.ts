import type {
	DraftEntry,
	Note,
	NoteId,
	NotesConfig,
	NotesDraftJournal,
} from './types';

const STORAGE_PREFIX = 'odd-app-odd-notes/drafts/v2';

export function resolveJournalScope( config: NotesConfig ): string | null {
	const declared = String( config.draftScope ?? '' ).trim();
	if ( declared ) {
		return `site:${ declared }`;
	}

	try {
		const restUrl = new URL( config.restBase );
		if ( restUrl.hostname === 'playground.wordpress.net' ) {
			// Without a server-provided installation id, every temporary Playground
			// shares this origin. Disabling recovery is safer than leaking a draft
			// into an unrelated temporary site.
			return null;
		}
		return `url:${ restUrl.origin }${ restUrl.pathname }`;
	} catch {
		return null;
	}
}

export function storageKey( scope: string | null, userId: number ): string | null {
	return scope
		? `${ STORAGE_PREFIX }/${ encodeURIComponent( scope ) }/${ userId }`
		: null;
}

function emptyJournal(): NotesDraftJournal {
	return { entries: {} };
}

function isDraftEntry( value: unknown ): value is DraftEntry {
	if ( ! value || typeof value !== 'object' ) {
		return false;
	}
	const draft = value as Partial< DraftEntry >;
	const validId = typeof draft.id === 'number' ||
		( typeof draft.id === 'string' && draft.id.startsWith( 'local-' ) );
	return validId &&
		typeof draft.title === 'string' &&
		typeof draft.body === 'string' &&
		typeof draft.color === 'string' &&
		Array.isArray( draft.tags ) &&
		draft.tags.every( ( tag ) => typeof tag === 'string' ) &&
		typeof draft.favorite === 'boolean' &&
		typeof draft.archived === 'boolean' &&
		typeof draft.onDesktop === 'boolean' &&
		typeof draft.public === 'boolean' &&
		typeof draft.clientUpdatedAt === 'number' &&
		Number.isFinite( draft.clientUpdatedAt );
}

export function readJournal(
	scope: string | null,
	userId: number,
): NotesDraftJournal {
	try {
		const key = storageKey( scope, userId );
		if ( ! key ) {
			return emptyJournal();
		}
		const raw = window.localStorage.getItem( key );
		if ( ! raw ) {
			return emptyJournal();
		}
		const parsed = JSON.parse( raw ) as Partial< NotesDraftJournal >;
		if ( ! parsed || typeof parsed.entries !== 'object' || ! parsed.entries ) {
			return emptyJournal();
		}
		const entries: Record< string, DraftEntry > = {};
		for ( const value of Object.values( parsed.entries ) ) {
			if ( isDraftEntry( value ) ) {
				entries[ String( value.id ) ] = value;
			}
		}
		return { entries };
	} catch {
		return emptyJournal();
	}
}

export function writeJournal(
	scope: string | null,
	userId: number,
	journal: NotesDraftJournal,
): void {
	try {
		const key = storageKey( scope, userId );
		if ( ! key ) {
			return;
		}
		if ( Object.keys( journal.entries ).length === 0 ) {
			window.localStorage.removeItem( key );
			return;
		}
		window.localStorage.setItem( key, JSON.stringify( journal ) );
	} catch {
		// WordPress remains the primary store; private-mode storage may be unavailable.
	}
}

export function draftFromNote( note: Note ): DraftEntry {
	return {
		id: note.id,
		title: note.title,
		body: note.body,
		color: note.color,
		tags: [ ...note.tags ],
		favorite: note.favorite,
		archived: note.archived,
		onDesktop: note.onDesktop,
		public: note.public,
		version: note.version,
		updatedAtMs: note.updatedAtMs,
		clientUpdatedAt: Date.now(),
	};
}

export function setDraft(
	journal: NotesDraftJournal,
	note: Note,
): NotesDraftJournal {
	return {
		entries: {
			...journal.entries,
			[ String( note.id ) ]: draftFromNote( note ),
		},
	};
}

export function removeDraft(
	journal: NotesDraftJournal,
	id: NoteId,
): NotesDraftJournal {
	const entries = { ...journal.entries };
	delete entries[ String( id ) ];
	return { entries };
}

export function moveDraft(
	journal: NotesDraftJournal,
	from: NoteId,
	to: NoteId,
): NotesDraftJournal {
	const entry = journal.entries[ String( from ) ];
	if ( ! entry ) {
		return journal;
	}
	const entries = { ...journal.entries };
	delete entries[ String( from ) ];
	entries[ String( to ) ] = { ...entry, id: to };
	return { entries };
}

export function applyDraft( note: Note, draft: DraftEntry ): Note {
	return {
		...note,
		title: draft.title,
		body: draft.body,
		excerpt: draft.body.trim().replace( /\s+/g, ' ' ).slice( 0, 150 ),
		color: draft.color,
		tags: [ ...draft.tags ],
		favorite: draft.favorite,
		archived: draft.archived,
		onDesktop: draft.onDesktop,
		public: draft.public,
		updatedAt: new Date( draft.clientUpdatedAt ).toISOString(),
		updatedAtMs: draft.updatedAtMs ?? note.updatedAtMs,
		version: draft.version ?? note.version,
		wordCount: countWords( draft.body ),
	};
}

export function draftMatchesNote( draft: DraftEntry, note: Note ): boolean {
	return draft.title === note.title &&
		draft.body === note.body &&
		draft.color === note.color &&
		draft.favorite === note.favorite &&
		draft.archived === note.archived &&
		draft.onDesktop === note.onDesktop &&
		draft.public === note.public &&
		draft.tags.length === note.tags.length &&
		draft.tags.every( ( tag, index ) => tag === note.tags[ index ] );
}

export function countWords( value: string ): number {
	const words = value.trim().match( /\S+/g );
	return words ? words.length : 0;
}
