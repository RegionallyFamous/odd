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
	let railMedia;

	beforeEach( () => {
		vi.useRealTimers();
		localStorage.clear();
		railMedia = {
			matches: false,
			listeners: new Set(),
			addEventListener( _name, listener ) {
				this.listeners.add( listener );
			},
		};
		window.matchMedia = vi.fn( () => railMedia );
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
		input(
			'#markdown-input',
			'# Hello **ODD**\n\n<script>alert(1)</script>\n<img src=x onerror=alert(2)>\n<svg><script>alert(3)</script></svg>\n[unsafe](javascript&#58;alert(4))',
		);
		expect( document.querySelector( '#markdown-preview h1' ).textContent ).toBe( 'Hello ODD' );
		expect( document.querySelector( '#markdown-preview script' ) ).toBeNull();
		expect( document.querySelector( '#markdown-preview img' ) ).toBeNull();
		expect( document.querySelector( '#markdown-preview svg' ) ).toBeNull();
		expect( document.querySelector( '#markdown-preview' ).textContent ).toContain( '<script>alert(1)</script>' );
		expect( document.querySelector( '#markdown-preview a' ).getAttribute( 'href' ) ).toBe( '#' );
	} );

	it( 'gives icon-only tabs stable accessible names', () => {
		const tabs = [ ...document.querySelectorAll( '[role="tab"]' ) ];
		expect( tabs ).toHaveLength( 6 );
		tabs.forEach( ( tab ) => {
			expect( tab.getAttribute( 'aria-label' ) ).toBeTruthy();
			expect( tab.getAttribute( 'title' ) ).toBe( tab.getAttribute( 'aria-label' ) );
		} );
	} );

	it( 'uses axis-correct arrow keys as the rail changes orientation', () => {
		const rail = document.querySelector( '.tool-rail' );
		const clean = document.querySelector( '[data-tool="clean"]' );
		expect( rail.getAttribute( 'aria-orientation' ) ).toBe( 'vertical' );

		clean.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'ArrowRight', bubbles: true } ) );
		expect( document.querySelector( '[aria-selected="true"]' ).dataset.tool ).toBe( 'clean' );
		clean.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'ArrowDown', bubbles: true } ) );
		expect( document.querySelector( '[aria-selected="true"]' ).dataset.tool ).toBe( 'markdown' );

		railMedia.matches = true;
		railMedia.listeners.forEach( ( listener ) => listener( railMedia ) );
		expect( rail.getAttribute( 'aria-orientation' ) ).toBe( 'horizontal' );
		const markdown = document.querySelector( '[data-tool="markdown"]' );
		markdown.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'ArrowDown', bubbles: true } ) );
		expect( document.querySelector( '[aria-selected="true"]' ).dataset.tool ).toBe( 'markdown' );
		markdown.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'ArrowRight', bubbles: true } ) );
		expect( document.querySelector( '[aria-selected="true"]' ).dataset.tool ).toBe( 'slug' );
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
