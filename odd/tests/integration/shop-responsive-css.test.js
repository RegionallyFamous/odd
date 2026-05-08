import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const STYLES_CSS = resolve( __dirname, '../../src/panel/styles.css' );

describe( 'ODD Shop responsive CSS contract', () => {
	it( 'uses data-odd-layout as the structural responsive contract', () => {
		const css = readFileSync( STYLES_CSS, 'utf8' );

		expect( css ).toContain( '.odd-panel.odd-shop,.odd-panel.odd-shop *,.odd-panel.odd-shop *::before,.odd-panel.odd-shop *::after{box-sizing:border-box}' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"]{grid-template-rows:auto auto minmax(0,1fr)!important;grid-template-columns:minmax(0,1fr)!important;width:100%;max-width:100%;max-inline-size:100vw;inline-size:min(100%,100vw);min-width:0;overflow:hidden;overflow-x:hidden}' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="compact"]{grid-template-columns:64px minmax(0,1fr)!important}' );
		expect( css ).toContain( '`data-odd-pointer` owns touch ergonomics. The host window owns' );
	} );

	it( 'prevents fixed desktop widths from leaking into mobile content', () => {
		const css = readFileSync( STYLES_CSS, 'utf8' );

		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__topbar{grid-column:1;grid-row:1;grid-template-columns:minmax(0,1fr)' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__command{justify-self:stretch;width:100%;min-width:0' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__rail{grid-column:1;grid-row:2;display:flex;flex-direction:row;gap:8px;min-width:0' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__content{grid-column:1;grid-row:3;width:100%;max-width:100%;min-width:0' );
		expect( css ).toContain( 'padding:16px 14px max(18px,env(safe-area-inset-bottom)) 14px;overflow-x:hidden;overflow-y:auto' );
	} );

	it( 'hides the native shop rail scrollbar behind accessible overflow controls', () => {
		const css = readFileSync( STYLES_CSS, 'utf8' );

		expect( css ).toContain( '.odd-panel.odd-shop{color:var(--odd-shop-ink);position:relative}' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__rail{background:var(--odd-shop-rail-bg);border-right:1px solid var(--odd-shop-border);padding:18px 12px 14px;display:flex;flex-direction:column;gap:4px;overflow-x:hidden;overflow-y:auto;scrollbar-width:none;overscroll-behavior:contain' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__rail::-webkit-scrollbar{display:none}' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__rail-scroll:not([hidden]){opacity:.96;pointer-events:auto}' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__rail-fade{position:absolute;z-index:5;height:54px;pointer-events:none' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__rail-scroll,.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__rail-fade{display:none!important}' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-size="xs"] .odd-shop__rail-scroll,.odd-panel.odd-shop[data-odd-size="xs"] .odd-shop__rail-fade,.odd-panel.odd-shop[data-odd-size="s"] .odd-shop__rail-scroll,.odd-panel.odd-shop[data-odd-size="s"] .odd-shop__rail-fade{display:none!important}' );
	} );

	it( 'keeps mobile sticky chrome from overlapping', () => {
		const css = readFileSync( STYLES_CSS, 'utf8' );

		expect( css ).toContain( '--odd-shop-mobile-topbar-h:104px' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__topbar{grid-column:1;grid-row:1' );
		expect( css ).toContain( 'padding-top:max(10px,env(safe-area-inset-top))' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__rail{grid-column:1;grid-row:2' );
		expect( css ).toContain( 'top:var(--odd-shop-mobile-topbar-h)' );
	} );

	it( 'stacks shelves and catalog rows in mobile layout', () => {
		const css = readFileSync( STYLES_CSS, 'utf8' );

		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__shelf-track{display:grid;grid-template-columns:1fr;gap:12px;overflow:visible;scroll-snap-type:none;padding:0;margin:0}' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__shelf-track--tiles{grid-template-columns:repeat(auto-fill,minmax(min(100%,168px),1fr))}' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__shelf-track--list > .odd-catalog-row,.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-catalog-row{display:grid;grid-template-columns:72px minmax(0,1fr)' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-catalog-row__actions{grid-column:1/-1' );
	} );

	it( 'does not ship the deleted local mobile escape hatch', () => {
		const css = readFileSync( STYLES_CSS, 'utf8' );

		expect( css ).not.toContain( [ 'data-odd', 'mobile' ].join( '-' ) );
		expect( css ).not.toContain( [ 'odd-shop-mobile', 'escape' ].join( '-' ) );
		expect( css ).not.toContain( [ 'odd-shop__mobile', 'close' ].join( '-' ) );
		expect( css ).not.toContain( 'position:fixed!important;inset:0!important' );
		// Coarse-pointer ergonomics — no hover lift, no scroll
		// arrows, taller tap targets for rail items + buttons.
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-pointer="coarse"] .odd-shop__slider-btn{display:none!important}' );
		expect( css ).toMatch( /data-odd-pointer="coarse"\][^{]*odd-shop__rail-item\{min-height:48px/ );
	} );
} );
