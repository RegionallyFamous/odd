<?php
/**
 * REST: /odd/v1/site-summary
 */

class Test_REST_Site_Summary extends ODDOUT_REST_Test_Case {

	public function test_get_requires_login() {
		$this->log_out();
		$res = $this->dispatch_json( 'GET', '/odd/v1/site-summary' );
		$this->assertSame( 401, $res->get_status(), 'Logged-out GET must 401.' );
	}

	public function test_get_returns_draft_comments_and_plugin_updates() {
		$this->login_as();

		$post_id = self::factory()->post->create(
			array(
				'post_status' => 'draft',
				'post_title'  => 'Widget draft',
				'post_author' => $this->admin_id,
			)
		);
		self::factory()->comment->create(
			array(
				'comment_post_ID'  => $post_id,
				'comment_approved' => '0',
			)
		);
		set_site_transient(
			'update_plugins',
			(object) array(
				'last_checked' => time() - MINUTE_IN_SECONDS,
				'response'     => array(
					'akismet/akismet.php' => (object) array(
						'new_version' => '99.0',
					),
				),
			)
		);

		$res = $this->dispatch_json( 'GET', '/odd/v1/site-summary' );
		$this->assertSame( 200, $res->get_status() );

		$data = $res->get_data();
		$this->assertArrayHasKey( 'generatedAt', $data );
		$this->assertSame( 1, $data['draft']['count'] );
		$this->assertSame( $post_id, $data['draft']['id'] );
		$this->assertSame( 'Widget draft', $data['draft']['title'] );
		$this->assertStringContainsString( 'post.php?post=' . $post_id, $data['draft']['editUrl'] );
		$this->assertSame( 1, $data['comments']['pending'] );
		$this->assertStringContainsString( 'comment_status=moderated', $data['comments']['moderateUrl'] );
		$this->assertSame( 1, $data['updates']['plugins'] );
		$this->assertStringContainsString( 'plugin_status=upgrade', $data['updates']['updatesUrl'] );
	}
}
