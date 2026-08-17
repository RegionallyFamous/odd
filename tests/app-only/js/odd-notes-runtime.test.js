import { beforeEach, describe, expect, it } from 'vitest';

import {
	applyDraft,
	draftMatchesNote,
	readJournal,
	resolveJournalScope,
	storageKey,
	writeJournal,
} from '../../../_tools/catalog-sources/apps/odd-notes/src/drafts.ts';
import {
	noteCounts,
	replaceNoteStable,
	updateNoteLocally,
} from '../../../_tools/catalog-sources/apps/odd-notes/src/state.ts';

const note = {
	id: 42,
	title: 'Quiet thought',
	body: 'Words saved in WordPress.',
	excerpt: 'Words saved in WordPress.',
	color: 'butter',
	tags: [ 'odd', 'notes' ],
	favorite: false,
	archived: false,
	onDesktop: false,
	public: false,
	ownerId: 1,
	ownerName: 'You',
	ownerAvatar: '',
	canEdit: true,
	createdAt: '2026-08-15T00:00:00Z',
	updatedAt: '2026-08-15T00:01:00Z',
	updatedAtMs: 1_786_752_060_000,
	version: 3,
	wordCount: 4,
};

const draft = {
	id: note.id,
	title: note.title,
	body: note.body,
	color: note.color,
	tags: [ ...note.tags ],
	favorite: note.favorite,
	archived: note.archived,
	onDesktop: note.onDesktop,
	public: note.public,
	updatedAtMs: note.updatedAtMs,
	version: note.version,
	clientUpdatedAt: note.updatedAtMs + 50_000,
};

describe( 'ODD Notes recovery and state helpers', () => {
	beforeEach( () => window.localStorage.clear() );

	it( 'isolates journals by installation as well as user', () => {
		const first = resolveJournalScope( {
			restBase: 'https://example.com/wp-json/odd-notes/v1/',
			restNonce: 'nonce',
			userId: 1,
			draftScope: 'site-one',
			colors: [],
		} );
		const second = resolveJournalScope( {
			restBase: 'https://example.com/wp-json/odd-notes/v1/',
			restNonce: 'nonce',
			userId: 1,
			draftScope: 'site-two',
			colors: [],
		} );

		expect( storageKey( first, 1 ) ).not.toBe( storageKey( second, 1 ) );
		writeJournal( first, 1, { entries: { 42: draft } } );
		expect( readJournal( first, 1 ).entries[ 42 ] ).toMatchObject( draft );
		expect( readJournal( second, 1 ).entries ).toEqual( {} );
	} );

	it( 'does not use shared Playground storage without a server scope', () => {
		const scope = resolveJournalScope( {
			restBase: 'https://playground.wordpress.net/wp-json/odd-notes/v1/',
			restNonce: 'nonce',
			userId: 1,
			colors: [],
		} );
		expect( scope ).toBeNull();
		expect( storageKey( scope, 1 ) ).toBeNull();
	} );

	it( 'ignores malformed local-storage entries instead of breaking startup', () => {
		const scope = 'site:reliable-site';
		const key = storageKey( scope, 1 );
		window.localStorage.setItem( key, JSON.stringify( {
			entries: {
				broken: { id: 42, tags: 'not-an-array' },
				42: draft,
			},
		} ) );

		expect( readJournal( scope, 1 ).entries ).toEqual( { 42: draft } );
	} );

	it( 'discards a recovery draft whose editable content already matches WordPress', () => {
		expect( draftMatchesNote( { ...draft, version: 1 }, note ) ).toBe( true );
		expect( draftMatchesNote( { ...draft, body: 'Actually changed.' }, note ) ).toBe( false );
	} );

	it( 'preserves the WordPress concurrency token when applying a draft', () => {
		const applied = applyDraft( note, {
			...draft,
			body: 'A local edit.',
			clientUpdatedAt: note.updatedAtMs + 100_000,
		} );
		expect( applied.body ).toBe( 'A local edit.' );
		expect( applied.updatedAtMs ).toBe( note.updatedAtMs );
		expect( applied.version ).toBe( note.version );
	} );

	it( 'preserves the WordPress concurrency token while typing', () => {
		const changed = updateNoteLocally(
			note,
			{
				body: 'Typing should not replace the server lock.',
				updatedAtMs: note.updatedAtMs + 999_999,
				version: note.version + 10,
			},
			note.updatedAtMs + 500_000,
		);
		expect( changed.body ).toBe( 'Typing should not replace the server lock.' );
		expect( changed.updatedAtMs ).toBe( note.updatedAtMs );
		expect( changed.version ).toBe( note.version );
	} );

	it( 'updates a typing note without sorting the entire library', () => {
		const other = { ...note, id: 7, title: 'First' };
		const changed = { ...note, title: 'Typed' };
		const result = replaceNoteStable( [ other, note ], changed );
		expect( result.map( ( item ) => item.id ) ).toEqual( [ 7, 42 ] );
		expect( result[ 1 ].title ).toBe( 'Typed' );
	} );

	it( 'counts navigation groups in one consistent pass', () => {
		expect( noteCounts( [
			note,
			{ ...note, id: 2, favorite: true, onDesktop: true },
			{ ...note, id: 3, archived: true },
			{ ...note, id: 4, canEdit: false },
		] ) ).toEqual( {
			all: 2,
			favorite: 1,
			desktop: 1,
			shared: 1,
			archive: 1,
		} );
	} );
} );
