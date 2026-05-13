<?php
/**
 * Adversarial corpus for {@see oddout_iconset_svg_scrub()}. Each case must
 * either return WP_Error (rejected) or a string with no live script
 * surface (script tags / on*= removed).
 */
class Test_Odd_Svg_Scrub_Fuzz extends WP_UnitTestCase {

	/**
	 * @return array<string, array{0: string}>
	 */
	public static function adversarial_svg_corpus() {
		$base = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
		$rows = array(
			$base,
			'<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>',
			'<svg viewBox="0 0 1 1"><script src="//evil"/></svg>',
			'<svg onload=alert(1) viewBox="0 0 1 1"/>',
			'<svg viewBox="0 0 1 1" onclick="alert(1)"><circle r="1"/></svg>',
			'<svg viewBox="0 0 1 1" ONCLICK="XSS"><path d="M0,0"/></svg>',
			'<svg viewBox="0 0 1 1"><a xlink:href="http://evil.com">x</a></svg>',
			'<svg viewBox="0 0 1 1"><a href="https://bad.test">x</a></svg>',
			'<svg viewBox="0 0 1 1"><use href="#i"/></svg>',
			'<svg viewBox="0 0 1 1"><use xlink:href="#icon"/></svg>',
			$base . "\x0b",
			$base . "\x1e",
			str_repeat( '<!--', 5 ) . $base,
			'<svg viewBox="0 0 1 1"><script>import("data:text/javascript,1")</script></svg>',
			'<svg viewBox="0 0 1 1" onload="eval(atob(\'Y==\'))"/>',
			'<svg viewBox="0 0 1 1" onmouseover=alert(1)><text>hi</text></svg>',
			'<svg viewBox="0 0 1 1" style="behavior:url(xss.htc)"/>',
			'<svg viewBox="0 0 1 1"><foreignObject>' . $base . '</foreignObject></svg>',
			'<svg viewBox="0 0 1 1"><image href="data:image/svg+xml,PHN2Zz4"/></svg>',
			'<svg viewBox="0 0 1 1" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="http://x"/></image></svg>',
			'not svg at all',
			'',
			'<?xml version="1.0"?><svg viewBox="0 0 1 1"/><!-- tail -->',
			$base,
			'<svg viewBox="0 0 1 1" onload=alert`1`><rect width="1" height="1"/></svg>',
			'<svg viewBox="0 0 1 1" OnLoad="1"><rect/></svg>',
			'<svg viewBox="0 0 1 1" data-onload="1"><rect/></svg>',
			// Nested script-like text (not real tags).
			'<svg viewBox="0 0 1 1"><text>&lt;script&gt;</text></svg>',
		);
		$out  = array();
		foreach ( $rows as $i => $svg ) {
			$out[ 'case_' . $i ] = array( $svg );
		}
		return $out;
	}

	/**
	 * @dataProvider adversarial_svg_corpus
	 */
	public function test_scrub_never_allows_script_or_on_handlers( $svg ) {
		require_once ODDOUT_DIR . 'includes/content/iconsets.php';
		$result = oddout_iconset_svg_scrub( $svg );
		if ( is_wp_error( $result ) ) {
			$this->assertInstanceOf( WP_Error::class, $result );
			return;
		}
		$out = (string) $result;
		$this->assertStringNotContainsString( '<script', strtolower( $out ) );
		$this->assertFalse( (bool) preg_match( '/\son[a-zA-Z-]+\s*=/', $out ), 'on*= handlers must be stripped' );
		$this->assertStringNotContainsString( '://evil', $out );
		$this->assertStringNotContainsString( 'bad.test', $out );
	}

	public function test_corpus_has_at_least_25_samples() {
		$c = self::adversarial_svg_corpus();
		$this->assertGreaterThanOrEqual( 25, count( $c ) );
	}

	/**
	 * @return array<string, array{0: string}>
	 */
	public static function rejected_svg_payloads() {
		return array(
			'script'          => array( '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>' ),
			'foreign_object'  => array( '<svg viewBox="0 0 1 1"><foreignObject><p>x</p></foreignObject></svg>' ),
			'embedded_image'  => array( '<svg viewBox="0 0 1 1"><image href="data:image/svg+xml,PHN2Zz4"/></svg>' ),
			'external_href'   => array( '<svg viewBox="0 0 1 1"><use href="https://bad.test/icon.svg#x"/></svg>' ),
			'event_handler'   => array( '<svg viewBox="0 0 1 1" onclick="alert(1)"><rect width="1" height="1"/></svg>' ),
			'style_attribute' => array( '<svg viewBox="0 0 1 1" style="behavior:url(xss.htc)"/>' ),
		);
	}

	/**
	 * @dataProvider rejected_svg_payloads
	 */
	public function test_active_svg_surfaces_are_rejected( $svg ) {
		require_once ODDOUT_DIR . 'includes/content/iconsets.php';
		$result = oddout_iconset_svg_scrub( $svg );
		$this->assertWPError( $result );
	}
}
