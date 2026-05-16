import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const EFFECTS_JS = resolve( __dirname, '../../odd/src/icons/effects.js' );
const EFFECTS_CSS = resolve( __dirname, '../../odd/src/icons/effects.css' );

function execEffects() {
	const src = readFileSync( EFFECTS_JS, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=icons/effects.js` );
	fn.call( globalThis );
	if ( ! ( window.__odd && window.__odd.iconEffects ) ) {
		document.dispatchEvent( new Event( 'DOMContentLoaded' ) );
	}
}

function seedOdd() {
	window.oddout = window.odd = {
		iconSet:  'odd-default-icons',
		iconSets: [
			{
				slug:  'odd-default-icons',
				icons: {
					dashboard: 'https://example.test/wp-content/plugins/odd/assets/icons/odd-default-icons/dashboard.webp',
					posts:     'https://example.test/wp-content/plugins/odd/assets/icons/odd-default-icons/posts.webp',
				},
			},
		],
		bundleCatalog: { iconSet: [] },
	};
}

describe( 'ODD icon effects', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
		delete window.__odd;
		seedOdd();
	} );

	it( 'wraps active Desktop Mode icon-set images without replacing the img', () => {
		document.body.innerHTML = [
			'<button class="desktop-mode-dock__item">',
			'<span class="desktop-mode-dock__item-primary">',
			'<img class="desktop-mode-dock__item-img" src="https://example.test/wp-content/plugins/odd/assets/icons/odd-default-icons/dashboard.webp" alt="">',
			'</span>',
			'</button>',
		].join( '' );

		execEffects();

		const img = document.querySelector( 'img.desktop-mode-dock__item-img' );
		const wrapper = img.closest( '.odd-icon-fx' );
		expect( wrapper ).toBeTruthy();
		expect( wrapper.parentElement.className ).toBe( 'desktop-mode-dock__item-primary' );
		expect( wrapper.querySelector( 'img.desktop-mode-dock__item-img' ) ).toBe( img );
		expect( wrapper.style.getPropertyValue( '--odd-icon-fx-src' ) ).toContain( 'dashboard.webp' );
		expect( img.getAttribute( 'data-odd-icon-fx' ) ).toBe( 'image' );
	} );

	it( 'enhances icon-set quartets but leaves scene card artwork alone', () => {
		document.body.innerHTML = [
			'<div class="odd-panel">',
			'<button class="odd-shop__card odd-shop__card--scene">',
			'<div class="odd-shop__card-art"><img class="odd-shop__card-art-fill" src="https://example.test/scene.webp" alt=""></div>',
			'</button>',
			'<button class="odd-shop__card odd-shop__card--icon-set">',
			'<div class="odd-shop__card-art odd-shop__card-art--quartet">',
			'<div class="odd-shop__card-quartet">',
			'<img src="https://example.test/wp-content/plugins/odd/assets/icons/odd-default-icons/posts.webp" alt="">',
			'</div>',
			'</div>',
			'</button>',
			'</div>',
		].join( '' );

		execEffects();

		const scene = document.querySelector( '.odd-shop__card--scene img' );
		const quartet = document.querySelector( '.odd-shop__card-quartet img' );
		expect( scene.closest( '.odd-icon-fx' ) ).toBeNull();
		expect( quartet.closest( '.odd-icon-fx' ) ).toBeTruthy();
	} );

	it( 'keeps the glitch layer motion-safe and sized for rails/cards', () => {
		const css = readFileSync( EFFECTS_CSS, 'utf8' );

		expect( css ).toContain( '@keyframes odd-icon-fx-slice-a' );
		expect( css ).toContain( '@keyframes odd-icon-fx-slice-b' );
		expect( css ).toContain( '@media (prefers-reduced-motion: reduce)' );
		expect( css ).toContain( '.odd-dock-rail-mount__tile .odd-icon-fx > img' );
		expect( css ).toContain( '.odd-panel .odd-shop__card-quartet > .odd-icon-fx' );
		expect( css ).toContain( 'background-image: var(--odd-icon-fx-src);' );
	} );
} );
