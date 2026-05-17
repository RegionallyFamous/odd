( function () {
	'use strict';

	var STORAGE = 'odd.cache-invaders.scores';
	var canvas = document.getElementById( 'game-canvas' );
	var ctx = canvas.getContext( '2d' );
	var scoreEl = document.getElementById( 'score' );
	var waveEl = document.getElementById( 'level' );
	var bestEl = document.getElementById( 'best' );
	var livesEl = document.getElementById( 'lives' );
	var statusEl = document.getElementById( 'status-line' );
	var overlay = document.getElementById( 'overlay' );
	var overlayTitle = document.getElementById( 'overlay-title' );
	var overlayLine = document.getElementById( 'overlay-line' );
	var resetButton = document.getElementById( 'reset-button' );
	var overlayReset = document.getElementById( 'overlay-reset' );
	var sprites = new Image();
	sprites.src = './assets/sprites.webp';
	var keys = { left: false, right: false };
	var state = {};
	var last = 0;

	function readBest() {
		try {
			var raw = window.localStorage.getItem( STORAGE );
			var parsed = raw ? JSON.parse( raw ) : {};
			return parsed.best || 0;
		} catch ( error ) {
			return 0;
		}
	}

	function saveBest() {
		if ( state.score <= readBest() ) {
			return;
		}
		try {
			window.localStorage.setItem( STORAGE, JSON.stringify( {
				best: state.score,
				date: new Date().toISOString(),
			} ) );
		} catch ( error ) {
			// Scores are optional.
		}
	}

	function setStatus( text ) {
		statusEl.textContent = text;
	}

	function updateHud() {
		scoreEl.textContent = String( state.score );
		waveEl.textContent = String( state.wave );
		bestEl.textContent = String( Math.max( readBest(), state.score ) );
		livesEl.textContent = '●'.repeat( Math.max( 0, state.lives ) );
	}

	function newGame() {
		state = {
			player: { x: canvas.width / 2 - 26, y: canvas.height - 72, w: 52, h: 42, rapid: 0 },
			bullets: [],
			enemyShots: [],
			enemies: [],
			powerUps: [],
			boss: null,
			score: 0,
			wave: 1,
			lives: 3,
			dir: 1,
			fireDelay: 0,
			enemyFire: 0.8,
			invuln: 0,
			paused: false,
			over: false,
		};
		overlay.classList.remove( 'is-visible' );
		overlay.setAttribute( 'aria-hidden', 'true' );
		setStatus( 'Purge the stale layers before they hit production.' );
		spawnWave();
		updateHud();
	}

	function spawnWave() {
		state.enemies = [];
		state.enemyShots = [];
		state.boss = null;
		state.dir = 1;
		if ( state.wave % 4 === 0 ) {
			state.boss = {
				x: canvas.width / 2 - 90,
				y: 70,
				w: 180,
				h: 112,
				hp: 20 + state.wave * 4,
				maxHp: 20 + state.wave * 4,
				dir: 1,
			};
			setStatus( 'Boss wave: Aggressive Browser Cache.' );
			return;
		}
		for ( var row = 0; row < 4; row++ ) {
			for ( var col = 0; col < 8; col++ ) {
				state.enemies.push( {
					x: 96 + col * 72,
					y: 64 + row * 52,
					w: 42,
					h: 34,
					row: row,
				} );
			}
		}
		setStatus( 'Wave ' + state.wave + ': stale cache drifting in.' );
	}

	function fire() {
		if ( state.over || state.paused || state.fireDelay > 0 ) {
			return;
		}
		state.bullets.push( {
			x: state.player.x + state.player.w / 2 - 3,
			y: state.player.y - 10,
			w: 6,
			h: 18,
		} );
		state.fireDelay = state.player.rapid > 0 ? 0.13 : 0.28;
	}

	function togglePause() {
		if ( state.over ) {
			return;
		}
		state.paused = ! state.paused;
		setStatus( state.paused ? 'Paused with cache headers intact.' : 'Purge queue resumed.' );
	}

	function rectsHit( a, b ) {
		return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
	}

	function damagePlayer() {
		if ( state.invuln > 0 ) {
			return;
		}
		state.lives--;
		state.invuln = 1.1;
		state.enemyShots = [];
		state.player.x = canvas.width / 2 - state.player.w / 2;
		setStatus( state.lives > 0 ? 'A stale layer slipped through.' : 'Production cache is crunchy.' );
		updateHud();
		if ( state.lives <= 0 ) {
			endGame();
		}
	}

	function endGame() {
		state.over = true;
		saveBest();
		overlayTitle.textContent = 'Stale layer landed';
		overlayLine.textContent = 'The purge cannon cleared ' + state.score + ' points before the cache stampede.';
		overlay.classList.add( 'is-visible' );
		overlay.setAttribute( 'aria-hidden', 'false' );
		overlayReset.focus();
	}

	function maybeDropPower( enemy ) {
		if ( Math.random() < 0.09 ) {
			state.powerUps.push( {
				x: enemy.x + enemy.w / 2 - 12,
				y: enemy.y,
				w: 24,
				h: 24,
			} );
		}
	}

	function update( dt ) {
		if ( state.over || state.paused ) {
			return;
		}
		state.fireDelay = Math.max( 0, state.fireDelay - dt );
		state.invuln = Math.max( 0, state.invuln - dt );
		state.player.rapid = Math.max( 0, state.player.rapid - dt );
		if ( keys.left ) {
			state.player.x -= 360 * dt;
		}
		if ( keys.right ) {
			state.player.x += 360 * dt;
		}
		state.player.x = Math.max( 18, Math.min( canvas.width - state.player.w - 18, state.player.x ) );
		state.bullets.forEach( function ( bullet ) {
			bullet.y -= 520 * dt;
		} );
		state.enemyShots.forEach( function ( shot ) {
			shot.y += 280 * dt;
		} );
		state.powerUps.forEach( function ( power ) {
			power.y += 190 * dt;
		} );
		updateEnemies( dt );
		updateBoss( dt );
		handleCollisions();
		state.bullets = state.bullets.filter( function ( bullet ) {
			return bullet.y + bullet.h > -20;
		} );
		state.enemyShots = state.enemyShots.filter( function ( shot ) {
			return shot.y < canvas.height + 30;
		} );
		state.powerUps = state.powerUps.filter( function ( power ) {
			return power.y < canvas.height + 30;
		} );
		state.enemyFire -= dt;
		if ( state.enemyFire <= 0 ) {
			enemyFire();
			state.enemyFire = Math.max( 0.28, 0.85 - state.wave * 0.035 );
		}
		if ( ! state.boss && state.enemies.length === 0 ) {
			state.wave++;
			spawnWave();
			updateHud();
		}
	}

	function updateEnemies( dt ) {
		if ( ! state.enemies.length ) {
			return;
		}
		var speed = 34 + state.wave * 7;
		var edge = false;
		state.enemies.forEach( function ( enemy ) {
			enemy.x += state.dir * speed * dt;
			if ( enemy.x < 24 || enemy.x + enemy.w > canvas.width - 24 ) {
				edge = true;
			}
		} );
		if ( edge ) {
			state.dir *= -1;
			state.enemies.forEach( function ( enemy ) {
				enemy.y += 18;
				if ( enemy.y + enemy.h > state.player.y - 16 ) {
					damagePlayer();
				}
			} );
		}
	}

	function updateBoss( dt ) {
		if ( ! state.boss ) {
			return;
		}
		var boss = state.boss;
		boss.x += boss.dir * ( 90 + state.wave * 5 ) * dt;
		if ( boss.x < 36 || boss.x + boss.w > canvas.width - 36 ) {
			boss.dir *= -1;
		}
	}

	function enemyFire() {
		if ( state.boss ) {
			state.enemyShots.push( {
				x: state.boss.x + 36 + Math.random() * ( state.boss.w - 72 ),
				y: state.boss.y + state.boss.h - 8,
				w: 10,
				h: 18,
			} );
			return;
		}
		if ( ! state.enemies.length ) {
			return;
		}
		var enemy = state.enemies[ Math.floor( Math.random() * state.enemies.length ) ];
		state.enemyShots.push( {
			x: enemy.x + enemy.w / 2 - 4,
			y: enemy.y + enemy.h,
			w: 8,
			h: 15,
		} );
	}

	function handleCollisions() {
		var player = state.player;
		state.enemyShots.forEach( function ( shot ) {
			if ( rectsHit( shot, player ) ) {
				shot.dead = true;
				damagePlayer();
			}
		} );
		state.powerUps.forEach( function ( power ) {
			if ( rectsHit( power, player ) ) {
				power.dead = true;
				state.player.rapid = 8;
				state.score += 150;
				setStatus( 'Purge burst armed.' );
				updateHud();
			}
		} );
		state.bullets.forEach( function ( bullet ) {
			if ( state.boss && rectsHit( bullet, state.boss ) ) {
				bullet.dead = true;
				state.boss.hp--;
				state.score += 25;
				if ( state.boss.hp <= 0 ) {
					state.score += 1200;
					state.boss = null;
					state.wave++;
					setStatus( 'Aggressive Browser Cache purged.' );
					spawnWave();
				}
				updateHud();
			}
			state.enemies.forEach( function ( enemy ) {
				if ( ! enemy.dead && rectsHit( bullet, enemy ) ) {
					bullet.dead = true;
					enemy.dead = true;
					state.score += 80 + enemy.row * 20;
					maybeDropPower( enemy );
					updateHud();
				}
			} );
		} );
		state.bullets = state.bullets.filter( function ( bullet ) {
			return ! bullet.dead;
		} );
		state.enemies = state.enemies.filter( function ( enemy ) {
			return ! enemy.dead;
		} );
		state.enemyShots = state.enemyShots.filter( function ( shot ) {
			return ! shot.dead;
		} );
		state.powerUps = state.powerUps.filter( function ( power ) {
			return ! power.dead;
		} );
	}

	function drawSpriteCell( sx, sy, x, y, w, h ) {
		if ( sprites.complete && sprites.naturalWidth ) {
			var sw = sprites.naturalWidth / 2;
			var sh = sprites.naturalHeight / 2;
			ctx.drawImage( sprites, sx * sw, sy * sh, sw, sh, x, y, w, h );
			return true;
		}
		return false;
	}

	function draw() {
		ctx.clearRect( 0, 0, canvas.width, canvas.height );
		var grad = ctx.createLinearGradient( 0, 0, 0, canvas.height );
		grad.addColorStop( 0, '#12051f' );
		grad.addColorStop( 1, '#05040a' );
		ctx.fillStyle = grad;
		ctx.fillRect( 0, 0, canvas.width, canvas.height );
		ctx.fillStyle = 'rgba(100,244,255,.1)';
		for ( var i = 0; i < 28; i++ ) {
			ctx.fillRect( ( i * 71 + state.wave * 9 ) % canvas.width, 38 + ( i % 7 ) * 50, 3, 3 );
		}
		state.enemies.forEach( function ( enemy ) {
			if ( ! drawSpriteCell( 0, 0, enemy.x - 11, enemy.y - 12, enemy.w + 22, enemy.h + 26 ) ) {
				ctx.fillStyle = '#64f4ff';
				ctx.fillRect( enemy.x, enemy.y, enemy.w, enemy.h );
			}
		} );
		if ( state.boss ) {
			drawSpriteCell( 1, 1, state.boss.x - 18, state.boss.y - 20, state.boss.w + 36, state.boss.h + 40 );
			ctx.fillStyle = 'rgba(255,244,220,.18)';
			ctx.fillRect( state.boss.x, state.boss.y - 14, state.boss.w, 8 );
			ctx.fillStyle = '#ff3d9a';
			ctx.fillRect( state.boss.x, state.boss.y - 14, state.boss.w * ( state.boss.hp / state.boss.maxHp ), 8 );
		}
		state.bullets.forEach( function ( bullet ) {
			ctx.fillStyle = '#b6ff6a';
			ctx.shadowColor = '#b6ff6a';
			ctx.shadowBlur = 10;
			ctx.fillRect( bullet.x, bullet.y, bullet.w, bullet.h );
			ctx.shadowBlur = 0;
		} );
		state.enemyShots.forEach( function ( shot ) {
			ctx.fillStyle = '#ff6d72';
			ctx.fillRect( shot.x, shot.y, shot.w, shot.h );
		} );
		state.powerUps.forEach( function ( power ) {
			if ( ! drawSpriteCell( 0, 1, power.x - 10, power.y - 10, power.w + 20, power.h + 20 ) ) {
				ctx.fillStyle = '#ffd23f';
				ctx.fillRect( power.x, power.y, power.w, power.h );
			}
		} );
		if ( state.invuln > 0 ) {
			ctx.globalAlpha = 0.52 + Math.sin( state.invuln * 24 ) * 0.18;
		}
		if ( ! drawSpriteCell( 1, 0, state.player.x - 18, state.player.y - 30, state.player.w + 36, state.player.h + 42 ) ) {
			ctx.fillStyle = '#64f4ff';
			ctx.fillRect( state.player.x, state.player.y, state.player.w, state.player.h );
		}
		ctx.globalAlpha = 1;
		if ( state.paused ) {
			ctx.fillStyle = 'rgba(9,3,15,.72)';
			ctx.fillRect( 0, 0, canvas.width, canvas.height );
			ctx.fillStyle = '#fff4dc';
			ctx.font = '900 34px Inter, system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText( 'Paused', canvas.width / 2, canvas.height / 2 );
			ctx.textAlign = 'left';
		}
	}

	function frame( time ) {
		var dt = Math.min( 0.04, ( time - last ) / 1000 || 0 );
		last = time;
		update( dt );
		draw();
		window.requestAnimationFrame( frame );
	}

	function action( name, active ) {
		if ( name === 'left' ) { keys.left = active !== false; }
		if ( name === 'right' ) { keys.right = active !== false; }
		if ( name === 'fire' && active !== false ) { fire(); }
		if ( name === 'pause' && active !== false ) { togglePause(); }
	}

	window.addEventListener( 'keydown', function ( event ) {
		if ( event.key === 'ArrowLeft' ) { event.preventDefault(); action( 'left', true ); }
		if ( event.key === 'ArrowRight' ) { event.preventDefault(); action( 'right', true ); }
		if ( event.key === ' ' ) { event.preventDefault(); action( 'fire', true ); }
		if ( event.key === 'p' || event.key === 'P' ) { action( 'pause', true ); }
	} );
	window.addEventListener( 'keyup', function ( event ) {
		if ( event.key === 'ArrowLeft' ) { action( 'left', false ); }
		if ( event.key === 'ArrowRight' ) { action( 'right', false ); }
	} );
	document.querySelectorAll( '[data-action]' ).forEach( function ( button ) {
		button.addEventListener( 'click', function () {
			if ( button.dataset.action === 'fire' || button.dataset.action === 'pause' ) {
				action( button.dataset.action, true );
			}
		} );
		button.addEventListener( 'pointerdown', function () {
			if ( button.dataset.action === 'left' || button.dataset.action === 'right' ) {
				action( button.dataset.action, true );
			}
		} );
		button.addEventListener( 'pointerup', function () {
			if ( button.dataset.action === 'left' || button.dataset.action === 'right' ) {
				action( button.dataset.action, false );
			}
		} );
		button.addEventListener( 'pointerleave', function () {
			if ( button.dataset.action === 'left' || button.dataset.action === 'right' ) {
				action( button.dataset.action, false );
			}
		} );
	} );
	resetButton.addEventListener( 'click', newGame );
	overlayReset.addEventListener( 'click', newGame );

	newGame();
	window.requestAnimationFrame( frame );
}() );
