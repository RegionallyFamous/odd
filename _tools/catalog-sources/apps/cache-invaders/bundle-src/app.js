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
	var purgeMeterEl = document.getElementById( 'purge-meter' );
	var overlay = document.getElementById( 'overlay' );
	var overlayTitle = document.getElementById( 'overlay-title' );
	var overlayLine = document.getElementById( 'overlay-line' );
	var resetButton = document.getElementById( 'reset-button' );
	var overlayReset = document.getElementById( 'overlay-reset' );
	var pauseButton = document.querySelector( '[data-action="pause"]' );
	var pauseIcon = pauseButton ? pauseButton.querySelector( 'span' ) : null;
	var cacheBg = new Image();
	cacheBg.src = './assets/cache-purge-bay.webp';

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
		var progress = 0;
		scoreEl.textContent = String( state.score );
		waveEl.textContent = String( state.wave );
		bestEl.textContent = String( Math.max( readBest(), state.score ) );
		livesEl.textContent = '●'.repeat( Math.max( 0, state.lives ) );
		if ( state.boss ) {
			progress = 1 - state.boss.hp / state.boss.maxHp;
		} else if ( state.waveTotal ) {
			progress = 1 - state.enemies.length / state.waveTotal;
		}
		if ( purgeMeterEl ) {
			purgeMeterEl.style.width = Math.max( 4, Math.min( 100, progress * 100 ) ) + '%';
		}
		if ( pauseButton ) {
			pauseButton.setAttribute( 'aria-pressed', state.paused ? 'true' : 'false' );
			pauseButton.setAttribute( 'aria-label', state.paused ? 'Resume' : 'Pause' );
			pauseButton.setAttribute( 'title', state.paused ? 'Resume' : 'Pause' );
		}
		if ( pauseIcon ) {
			pauseIcon.innerHTML = state.paused ? '&#9654;' : '&#10074;&#10074;';
		}
	}

	function newGame() {
		state = {
			player: { x: canvas.width / 2 - 34, y: canvas.height - 78, w: 68, h: 48, rapid: 0 },
			bullets: [],
			enemyShots: [],
			enemies: [],
			powerUps: [],
			bursts: [],
			boss: null,
			score: 0,
			wave: 1,
			waveTotal: 0,
			lives: 3,
			dir: 1,
			fireDelay: 0,
			enemyFire: 0.8,
			invuln: 0,
			paused: false,
			over: false,
			pulse: 0,
			shake: 0,
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
		state.powerUps = [];
		state.boss = null;
		state.dir = 1;
		if ( state.wave % 4 === 0 ) {
			state.boss = {
				x: canvas.width / 2 - 104,
				y: 70,
				w: 208,
				h: 126,
				hp: 22 + state.wave * 4,
				maxHp: 22 + state.wave * 4,
				dir: 1,
				wobble: 0,
			};
			state.waveTotal = state.boss.maxHp;
			setStatus( 'Boss wave: Aggressive Browser Cache.' );
			return;
		}
		var cols = 8;
		var rows = 4;
		var gapX = 78;
		var startX = ( canvas.width - ( cols - 1 ) * gapX - 50 ) / 2;
		for ( var row = 0; row < rows; row++ ) {
			for ( var col = 0; col < cols; col++ ) {
				state.enemies.push( {
					x: startX + col * gapX,
					y: 72 + row * 58,
					w: row === 1 ? 50 : 46,
					h: row === 1 ? 40 : 38,
					row: row,
					col: col,
					kind: row === 0 ? 'ghost' : row === 1 ? 'layer' : row === 2 ? 'blob' : 'ghost',
					wobble: Math.random() * Math.PI * 2,
				} );
			}
		}
		state.waveTotal = state.enemies.length;
		setStatus( 'Wave ' + state.wave + ': stale cache drifting in.' );
	}

	function fire() {
		if ( state.over || state.paused || state.fireDelay > 0 ) {
			return;
		}
		state.bullets.push( {
			x: state.player.x + state.player.w / 2 - 4,
			y: state.player.y - 16,
			w: 8,
			h: 24,
			speed: state.player.rapid > 0 ? 650 : 560,
		} );
		state.fireDelay = state.player.rapid > 0 ? 0.12 : 0.26;
		state.pulse = 1;
	}

	function togglePause() {
		if ( state.over ) {
			return;
		}
		state.paused = ! state.paused;
		setStatus( state.paused ? 'Paused with cache headers intact.' : 'Purge queue resumed.' );
		updateHud();
	}

	function rectsHit( a, b ) {
		return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
	}

	function damagePlayer() {
		if ( state.invuln > 0 || state.over ) {
			return;
		}
		state.lives--;
		state.invuln = 1.1;
		state.shake = 1;
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
				x: enemy.x + enemy.w / 2 - 14,
				y: enemy.y,
				w: 28,
				h: 28,
				spin: 0,
			} );
		}
	}

	function burst( x, y, color ) {
		state.bursts.push( { x: x, y: y, age: 0, color: color || '#b6ff6a' } );
	}

	function update( dt ) {
		state.pulse = Math.max( 0, state.pulse - dt * 2.5 );
		state.shake = Math.max( 0, state.shake - dt * 3.2 );
		state.bursts.forEach( function ( item ) {
			item.age += dt;
		} );
		state.bursts = state.bursts.filter( function ( item ) {
			return item.age < 0.42;
		} );
		if ( state.over || state.paused ) {
			return;
		}
		state.fireDelay = Math.max( 0, state.fireDelay - dt );
		state.invuln = Math.max( 0, state.invuln - dt );
		state.player.rapid = Math.max( 0, state.player.rapid - dt );
		if ( keys.left ) {
			state.player.x -= 390 * dt;
		}
		if ( keys.right ) {
			state.player.x += 390 * dt;
		}
		state.player.x = Math.max( 24, Math.min( canvas.width - state.player.w - 24, state.player.x ) );
		state.bullets.forEach( function ( bullet ) {
			bullet.y -= bullet.speed * dt;
		} );
		state.enemyShots.forEach( function ( shot ) {
			shot.y += 300 * dt;
		} );
		state.powerUps.forEach( function ( power ) {
			power.y += 195 * dt;
			power.spin += dt * 5;
		} );
		updateEnemies( dt );
		updateBoss( dt );
		handleCollisions();
		state.bullets = state.bullets.filter( function ( bullet ) {
			return bullet.y + bullet.h > -24;
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
			state.enemyFire = Math.max( 0.26, 0.82 - state.wave * 0.035 );
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
		var speed = 38 + state.wave * 7;
		var edge = false;
		state.enemies.forEach( function ( enemy ) {
			enemy.x += state.dir * speed * dt;
			enemy.wobble += dt * 2.3;
			if ( enemy.x < 34 || enemy.x + enemy.w > canvas.width - 34 ) {
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
		boss.x += boss.dir * ( 92 + state.wave * 5 ) * dt;
		boss.wobble += dt * 2.1;
		if ( boss.x < 44 || boss.x + boss.w > canvas.width - 44 ) {
			boss.dir *= -1;
		}
	}

	function enemyFire() {
		if ( state.boss ) {
			state.enemyShots.push( {
				x: state.boss.x + 40 + Math.random() * ( state.boss.w - 80 ),
				y: state.boss.y + state.boss.h - 8,
				w: 11,
				h: 20,
			} );
			return;
		}
		if ( ! state.enemies.length ) {
			return;
		}
		var enemy = state.enemies[ Math.floor( Math.random() * state.enemies.length ) ];
		state.enemyShots.push( {
			x: enemy.x + enemy.w / 2 - 5,
			y: enemy.y + enemy.h,
			w: 10,
			h: 18,
		} );
	}

	function handleCollisions() {
		var player = state.player;
		state.enemyShots.forEach( function ( shot ) {
			if ( rectsHit( shot, player ) ) {
				shot.dead = true;
				burst( shot.x, shot.y, '#ff6d72' );
				damagePlayer();
			}
		} );
		state.powerUps.forEach( function ( power ) {
			if ( rectsHit( power, player ) ) {
				power.dead = true;
				state.player.rapid = 8;
				state.score += 150;
				state.pulse = 1;
				setStatus( 'Purge burst armed.' );
				updateHud();
			}
		} );
		state.bullets.forEach( function ( bullet ) {
			if ( state.boss && rectsHit( bullet, state.boss ) ) {
				bullet.dead = true;
				state.boss.hp--;
				state.score += 25;
				burst( bullet.x, bullet.y, '#64f4ff' );
				if ( state.boss.hp <= 0 ) {
					state.score += 1200;
					burst( state.boss.x + state.boss.w / 2, state.boss.y + state.boss.h / 2, '#ff3d9a' );
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
					state.score += 90 + enemy.row * 25;
					burst( enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, enemy.kind === 'layer' ? '#ffd23f' : '#64f4ff' );
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

	function roundRect( x, y, w, h, r ) {
		ctx.beginPath();
		ctx.moveTo( x + r, y );
		ctx.arcTo( x + w, y, x + w, y + h, r );
		ctx.arcTo( x + w, y + h, x, y + h, r );
		ctx.arcTo( x, y + h, x, y, r );
		ctx.arcTo( x, y, x + w, y, r );
		ctx.closePath();
	}

	function drawCoverImage( image ) {
		if ( ! image.complete || ! image.naturalWidth ) {
			var fallback = ctx.createLinearGradient( 0, 0, 0, canvas.height );
			fallback.addColorStop( 0, '#160522' );
			fallback.addColorStop( 1, '#05030a' );
			ctx.fillStyle = fallback;
			ctx.fillRect( 0, 0, canvas.width, canvas.height );
			return;
		}
		var scale = Math.max( canvas.width / image.naturalWidth, canvas.height / image.naturalHeight );
		var w = image.naturalWidth * scale;
		var h = image.naturalHeight * scale;
		ctx.drawImage( image, ( canvas.width - w ) / 2, ( canvas.height - h ) / 2, w, h );
	}

	function drawStageOverlay() {
		ctx.save();
		ctx.globalCompositeOperation = 'screen';
		for ( var i = 0; i < 34; i++ ) {
			var x = ( i * 67 + state.wave * 11 + state.score * 0.013 ) % canvas.width;
			var y = 54 + ( i % 9 ) * 48;
			ctx.fillStyle = i % 3 === 0 ? 'rgba(182,255,106,.22)' : 'rgba(100,244,255,.18)';
			roundRect( x, y, 3 + ( i % 2 ) * 7, 3, 2 );
			ctx.fill();
		}
		ctx.strokeStyle = 'rgba(182,255,106,.18)';
		ctx.lineWidth = 1;
		for ( var lane = 0; lane < 7; lane++ ) {
			var lx = 130 + lane * 108;
			ctx.beginPath();
			ctx.moveTo( lx, 60 );
			ctx.lineTo( lx - 42, canvas.height - 70 );
			ctx.stroke();
		}
		ctx.restore();
	}

	function drawGhost( enemy ) {
		var wobble = Math.sin( enemy.wobble ) * 2.5;
		ctx.save();
		ctx.translate( enemy.x + enemy.w / 2, enemy.y + enemy.h / 2 + wobble );
		ctx.shadowColor = 'rgba(100,244,255,.68)';
		ctx.shadowBlur = 14;
		var body = ctx.createRadialGradient( -8, -12, 6, 0, 0, 36 );
		body.addColorStop( 0, '#bdfcff' );
		body.addColorStop( 0.35, '#42dff0' );
		body.addColorStop( 1, '#1391b7' );
		ctx.fillStyle = body;
		ctx.strokeStyle = '#fff4dc';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo( -22, 12 );
		ctx.bezierCurveTo( -22, -18, -12, -30, 0, -30 );
		ctx.bezierCurveTo( 15, -30, 23, -16, 23, 12 );
		ctx.lineTo( 17, 20 );
		ctx.lineTo( 9, 13 );
		ctx.lineTo( 0, 22 );
		ctx.lineTo( -9, 13 );
		ctx.lineTo( -17, 20 );
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = '#09030f';
		ctx.beginPath();
		ctx.arc( -8, -9, 4, 0, Math.PI * 2 );
		ctx.arc( 8, -9, 4, 0, Math.PI * 2 );
		ctx.fill();
		ctx.restore();
	}

	function drawLayer( enemy ) {
		ctx.save();
		ctx.translate( enemy.x + enemy.w / 2, enemy.y + enemy.h / 2 );
		ctx.shadowColor = 'rgba(255,61,154,.55)';
		ctx.shadowBlur = 12;
		var colors = [ '#64f4ff', '#ff3d9a', '#ffd23f' ];
		for ( var i = 0; i < 3; i++ ) {
			ctx.fillStyle = colors[ i ];
			ctx.strokeStyle = '#fff4dc';
			ctx.lineWidth = 2;
			roundRect( -24 + i * 2, -15 + i * 10, 48, 13, 5 );
			ctx.fill();
			ctx.stroke();
		}
		ctx.restore();
	}

	function drawBlob( enemy ) {
		var wobble = Math.sin( enemy.wobble ) * 3;
		ctx.save();
		ctx.translate( enemy.x + enemy.w / 2, enemy.y + enemy.h / 2 + wobble );
		ctx.shadowColor = 'rgba(182,255,106,.55)';
		ctx.shadowBlur = 14;
		ctx.fillStyle = '#43c875';
		ctx.strokeStyle = '#fff4dc';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo( -22, 10 );
		ctx.bezierCurveTo( -26, -18, -10, -28, 6, -24 );
		ctx.bezierCurveTo( 28, -18, 26, 12, 14, 22 );
		ctx.bezierCurveTo( 1, 16, -8, 28, -20, 18 );
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = '#ffd23f';
		ctx.beginPath();
		ctx.arc( -6, -7, 4, 0, Math.PI * 2 );
		ctx.arc( 9, -6, 4, 0, Math.PI * 2 );
		ctx.fill();
		ctx.restore();
	}

	function drawEnemy( enemy ) {
		if ( enemy.kind === 'layer' ) {
			drawLayer( enemy );
		} else if ( enemy.kind === 'blob' ) {
			drawBlob( enemy );
		} else {
			drawGhost( enemy );
		}
	}

	function drawBoss() {
		var boss = state.boss;
		if ( ! boss ) {
			return;
		}
		ctx.save();
		ctx.translate( boss.x + boss.w / 2, boss.y + boss.h / 2 + Math.sin( boss.wobble ) * 6 );
		ctx.shadowColor = 'rgba(255,61,154,.72)';
		ctx.shadowBlur = 22;
		ctx.fillStyle = '#3fc36f';
		ctx.strokeStyle = '#fff4dc';
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.moveTo( -86, 34 );
		ctx.bezierCurveTo( -100, -36, -54, -70, 0, -64 );
		ctx.bezierCurveTo( 68, -58, 102, -12, 82, 40 );
		ctx.bezierCurveTo( 44, 30, 26, 62, 0, 42 );
		ctx.bezierCurveTo( -28, 62, -48, 28, -86, 34 );
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = '#ffd23f';
		ctx.beginPath();
		ctx.arc( -22, -18, 9, 0, Math.PI * 2 );
		ctx.arc( 26, -18, 9, 0, Math.PI * 2 );
		ctx.fill();
		ctx.strokeStyle = '#ff3d9a';
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.arc( 0, -58, 18, Math.PI, 0 );
		ctx.moveTo( 0, -58 );
		ctx.lineTo( 0, -82 );
		ctx.stroke();
		ctx.restore();

		ctx.fillStyle = 'rgba(255,244,220,.18)';
		roundRect( boss.x, boss.y - 18, boss.w, 8, 4 );
		ctx.fill();
		ctx.fillStyle = '#ff3d9a';
		roundRect( boss.x, boss.y - 18, boss.w * ( boss.hp / boss.maxHp ), 8, 4 );
		ctx.fill();
	}

	function drawBullet( bullet ) {
		ctx.save();
		ctx.shadowColor = '#b6ff6a';
		ctx.shadowBlur = 14;
		var grad = ctx.createLinearGradient( bullet.x, bullet.y, bullet.x, bullet.y + bullet.h );
		grad.addColorStop( 0, '#fff4dc' );
		grad.addColorStop( 0.45, '#b6ff6a' );
		grad.addColorStop( 1, '#64f4ff' );
		ctx.fillStyle = grad;
		roundRect( bullet.x, bullet.y, bullet.w, bullet.h, 4 );
		ctx.fill();
		ctx.restore();
	}

	function drawEnemyShot( shot ) {
		ctx.save();
		ctx.shadowColor = '#ff6d72';
		ctx.shadowBlur = 10;
		ctx.fillStyle = '#ff6d72';
		roundRect( shot.x, shot.y, shot.w, shot.h, 4 );
		ctx.fill();
		ctx.restore();
	}

	function drawPower( power ) {
		ctx.save();
		ctx.translate( power.x + power.w / 2, power.y + power.h / 2 );
		ctx.rotate( power.spin );
		ctx.shadowColor = 'rgba(255,210,63,.65)';
		ctx.shadowBlur = 14;
		ctx.fillStyle = '#ffd23f';
		ctx.strokeStyle = '#fff4dc';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo( 0, -16 );
		ctx.lineTo( 15, 0 );
		ctx.lineTo( 0, 16 );
		ctx.lineTo( -15, 0 );
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.restore();
	}

	function drawCannon() {
		var p = state.player;
		var cx = p.x + p.w / 2;
		var cy = p.y + p.h / 2;
		ctx.save();
		if ( state.invuln > 0 ) {
			ctx.globalAlpha = 0.62 + Math.sin( state.invuln * 24 ) * 0.2;
		}
		ctx.translate( cx, cy );
		ctx.shadowColor = 'rgba(100,244,255,.65)';
		ctx.shadowBlur = 20;
		ctx.fillStyle = '#20102f';
		ctx.strokeStyle = '#fff4dc';
		ctx.lineWidth = 4;
		roundRect( -34, -10, 68, 32, 12 );
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = '#64f4ff';
		roundRect( -16, -28, 32, 28, 10 );
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = '#ff3d9a';
		ctx.beginPath();
		ctx.arc( -17, 6, 10, 0, Math.PI * 2 );
		ctx.arc( 17, 6, 10, 0, Math.PI * 2 );
		ctx.fill();
		ctx.stroke();
		ctx.fillStyle = '#b6ff6a';
		roundRect( 10, -34, 18, 28, 6 );
		ctx.fill();
		ctx.stroke();
		if ( state.pulse > 0 ) {
			ctx.globalCompositeOperation = 'screen';
			ctx.strokeStyle = 'rgba(182,255,106,' + state.pulse * 0.55 + ')';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.arc( 0, -8, 48 + state.pulse * 28, 0, Math.PI * 2 );
			ctx.stroke();
		}
		ctx.restore();
		ctx.globalAlpha = 1;
	}

	function drawBursts() {
		state.bursts.forEach( function ( item ) {
			var t = item.age / 0.42;
			ctx.save();
			ctx.globalCompositeOperation = 'screen';
			ctx.globalAlpha = 1 - t;
			ctx.strokeStyle = item.color;
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.arc( item.x, item.y, 8 + t * 34, 0, Math.PI * 2 );
			ctx.stroke();
			ctx.restore();
		} );
	}

	function draw() {
		ctx.save();
		if ( state.shake > 0 ) {
			ctx.translate( ( Math.random() - 0.5 ) * state.shake * 8, ( Math.random() - 0.5 ) * state.shake * 6 );
		}
		ctx.clearRect( 0, 0, canvas.width, canvas.height );
		drawCoverImage( cacheBg );
		ctx.fillStyle = 'rgba(5,2,10,.2)';
		ctx.fillRect( 0, 0, canvas.width, canvas.height );
		drawStageOverlay();
		state.enemies.forEach( drawEnemy );
		drawBoss();
		state.bullets.forEach( drawBullet );
		state.enemyShots.forEach( drawEnemyShot );
		state.powerUps.forEach( drawPower );
		drawCannon();
		drawBursts();
		ctx.restore();
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

	function releaseMoveControls() {
		keys.left = false;
		keys.right = false;
	}

	window.addEventListener( 'keydown', function ( event ) {
		if ( event.key === 'ArrowLeft' ) { event.preventDefault(); action( 'left', true ); }
		if ( event.key === 'ArrowRight' ) { event.preventDefault(); action( 'right', true ); }
		if ( event.key === ' ' ) { event.preventDefault(); action( 'fire', true ); }
		if ( event.key === 'p' || event.key === 'P' ) { action( 'pause', true ); }
		if ( event.key === 'r' || event.key === 'R' ) { newGame(); }
	} );
	window.addEventListener( 'keyup', function ( event ) {
		if ( event.key === 'ArrowLeft' ) { action( 'left', false ); }
		if ( event.key === 'ArrowRight' ) { action( 'right', false ); }
	} );
	document.querySelectorAll( '[data-action]' ).forEach( function ( button ) {
		button.addEventListener( 'click', function ( event ) {
			if ( event.detail === 0 ) {
				action( button.dataset.action, true );
				window.setTimeout( function () {
					if ( button.dataset.action === 'left' || button.dataset.action === 'right' ) {
						action( button.dataset.action, false );
					}
				}, 90 );
			}
		} );
		button.addEventListener( 'pointerdown', function ( event ) {
			event.preventDefault();
			action( button.dataset.action, true );
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
		button.addEventListener( 'pointercancel', function () {
			if ( button.dataset.action === 'left' || button.dataset.action === 'right' ) {
				action( button.dataset.action, false );
			}
		} );
		button.addEventListener( 'blur', releaseMoveControls );
		button.addEventListener( 'contextmenu', function ( event ) {
			event.preventDefault();
		} );
	} );
	resetButton.addEventListener( 'click', newGame );
	overlayReset.addEventListener( 'click', newGame );

	newGame();
	window.requestAnimationFrame( frame );
}() );
