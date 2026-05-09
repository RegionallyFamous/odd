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
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"]{grid-template-rows:auto minmax(0,1fr)!important;grid-template-columns:64px minmax(0,1fr)!important;width:100%;max-width:100%;max-inline-size:100vw;inline-size:min(100%,100vw);min-width:0;overflow:hidden;overflow-x:hidden;overflow:clip}' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="compact"]{grid-template-columns:64px minmax(0,1fr)!important}' );
		expect( css ).toContain( '`data-odd-pointer` owns touch ergonomics. The host window owns' );
	} );

	it( 'prevents fixed desktop widths from leaking into mobile content', () => {
		const css = readFileSync( STYLES_CSS, 'utf8' );

		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__topbar{grid-column:1/-1;grid-row:1;grid-template-columns:minmax(0,1fr)' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__command{justify-self:stretch;width:100%;min-width:0' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__rail{grid-column:1;grid-row:2;display:flex;flex-direction:column;gap:6px;min-width:0;overflow-x:hidden;overflow-y:auto' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__rail-label{display:none}' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__rail-item{width:auto;grid-template-columns:1fr;justify-items:center;min-width:0;min-height:44px' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__content{grid-column:2;grid-row:2;width:100%;max-width:100%;min-width:0' );
		expect( css ).toContain( 'padding:16px 14px max(18px,env(safe-area-inset-bottom)) 14px;overflow-x:hidden;overflow-y:auto' );
	} );

	it( 'keeps every shop rail vertical behind accessible overflow controls', () => {
		const css = readFileSync( STYLES_CSS, 'utf8' );

		expect( css ).toContain( '.odd-panel.odd-shop{color:var(--odd-shop-ink);position:relative;overflow:hidden;overflow:clip;min-width:0;max-width:100%}' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__content{padding:32px 40px 0;overflow-x:hidden;overflow-y:auto;min-width:0;background:var(--odd-shop-bg);contain:layout paint}' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__rail{background:var(--odd-shop-rail-bg);border-right:1px solid var(--odd-shop-border);padding:18px 12px 14px;display:flex;flex-direction:column;gap:4px;overflow-x:hidden;overflow-y:auto;scrollbar-width:none;overscroll-behavior:contain' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__rail::-webkit-scrollbar{display:none}' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__shelf-track{display:flex;gap:14px;min-width:0;max-width:100%;overflow-x:auto;overflow-y:visible' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__slider{position:relative;min-width:0;max-width:100%;overflow:hidden;contain:paint}' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__rail-scroll:not([hidden]){opacity:.96;pointer-events:auto}' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__rail-fade{position:absolute;z-index:5;height:54px;pointer-events:none' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-size="xs"] .odd-shop__rail,.odd-panel.odd-shop[data-odd-size="s"] .odd-shop__rail{grid-column:1;grid-row:2;display:flex;flex-direction:column;gap:6px;overflow-x:hidden;overflow-y:auto' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__rail{grid-column:1;grid-row:2;display:flex;flex-direction:column;gap:6px;min-width:0;overflow-x:hidden;overflow-y:auto' );
		expect( css ).not.toMatch( /odd-shop__rail\{[^}]*flex-direction:row/ );
		expect( css ).not.toMatch( /odd-shop__rail\{[^}]*overflow-x:auto/ );
	} );

	it( 'keeps mobile sticky chrome from overlapping', () => {
		const css = readFileSync( STYLES_CSS, 'utf8' );

		expect( css ).toContain( '--odd-shop-mobile-topbar-h:104px' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__topbar{grid-column:1/-1;grid-row:1' );
		expect( css ).toContain( 'padding-top:max(10px,env(safe-area-inset-top))' );
		expect( css ).toContain( '.odd-panel.odd-shop[data-odd-layout="mobile"] .odd-shop__rail{grid-column:1;grid-row:2' );
		expect( css ).toContain( 'position:relative;top:auto;z-index:3' );
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
