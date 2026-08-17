import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(
	resolve( '_tools/catalog-sources/apps/workbench/bundle-src/index.html' ),
	'utf8',
);
const source = readFileSync(
	resolve( '_tools/catalog-sources/apps/workbench/bundle-src/assets/app.js' ),
	'utf8',
);

function input( selector, value ) {
	const element = document.querySelector( selector );
	element.value = value;
	element.dispatchEvent( new Event( 'input', { bubbles: true } ) );
	return element;
}

function openTool( name ) {
	document.querySelector( `[data-tool="${ name }"]` ).click();
}

describe( 'ODD Workbench tools', () => {
	beforeEach( () => {
		vi.useRealTimers();
		localStorage.clear();
		document.documentElement.innerHTML = html
			.replace( /^.*?<html[^>]*>/s, '' )
			.replace( /<\/html>.*$/s, '' );
		window.eval( source );
	} );

	it( 'cleans pasted text', () => {
		input( '#clean-input', '  Messy\u00a0text   \n\n\n\n' );
		document.querySelector( '[data-clean-action="smart"]' ).click();
		expect( document.querySelector( '#clean-output' ).value ).toBe( 'Messy text' );
	} );

	it( 'renders Markdown while keeping raw HTML inert', () => {
		openTool( 'markdown' );
		input( '#markdown-input', '# Hello **ODD**\n\n<script>alert(1)</script>' );
		expect( document.querySelector( '#markdown-preview h1' ).textContent ).toBe( 'Hello ODD' );
		expect( document.querySelector( '#markdown-preview script' ) ).toBeNull();
		expect( document.querySelector( '#markdown-preview' ).textContent ).toContain( '<script>alert(1)</script>' );
	} );

	it( 'creates normalized slugs', () => {
		openTool( 'slug' );
		input( '#slug-input', 'Crème brûlée & ODD Tools' );
		expect( document.querySelector( '#slug-output' ).textContent ).toBe( 'creme-brulee-odd-tools' );
	} );

	it( 'validates and sorts JSON', () => {
		openTool( 'json' );
		input( '#json-input', '{"b":2,"a":1}' );
		document.querySelector( '#json-sort' ).click();
		expect( document.querySelector( '#json-status' ).textContent ).toBe( 'Valid JSON' );
		expect( document.querySelector( '#json-output' ).value ).toBe( '{\n  "a": 1,\n  "b": 2\n}' );
	} );

	it( 'compares line changes', async () => {
		openTool( 'diff' );
		input( '#diff-left', 'same\nold' );
		input( '#diff-right', 'same\nnew' );
		await vi.waitFor( () => {
			expect( document.querySelector( '#diff-summary' ).textContent ).toBe( '1 added · 1 removed' );
		} );
		expect( document.querySelector( '#diff-output .is-added' ).textContent ).toContain( 'new' );
		expect( document.querySelector( '#diff-output .is-removed' ).textContent ).toContain( 'old' );
	} );

	it( 'encodes UTF-8 text', () => {
		openTool( 'convert' );
		input( '#convert-input', 'ODD ✓' );
		document.querySelector( '#convert-run' ).click();
		expect( document.querySelector( '#convert-output' ).value ).toBe( 'T0REIOKckw==' );
	} );

	it( 'uses only inline monochrome tool icons', () => {
		expect( document.querySelectorAll( '.tool-tab img' ) ).toHaveLength( 0 );
		expect( document.querySelectorAll( '.tool-tab .ui-icon' ) ).toHaveLength( 6 );
	} );
} );
