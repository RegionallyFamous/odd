( function () {
	'use strict';

	var STORAGE = 'odd.four-oh-four-runner.scores';
	var canvas = document.getElementById( 'game-canvas' );
	var ctx = canvas.getContext( '2d' );
	var scoreEl = document.getElementById( 'score' );
	var levelEl = document.getElementById( 'level' );
	var bestEl = document.getElementById( 'best' );
	var statusEl = document.getElementById( 'status-line' );
	var routeEl = document.getElementById( 'route-line' );
	var routeMeterEl = document.getElementById( 'route-meter' );
	var overlay = document.getElementById( 'overlay' );
	var overlayTitle = document.getElementById( 'overlay-title' );
	var overlayLine = document.getElementById( 'overlay-line' );
	var resetButton = document.getElementById( 'reset-button' );
	var overlayReset = document.getElementById( 'overlay-reset' );
	var routeBg = new Image();
	var runner = new Image();
	routeBg.src = './assets/route-arcade-backdrop.webp';
	runner.src = './assets/runner-sticker.webp';

	var state = {};
	var last = 0;
	var ground = 430;
	var lines = [
		'Temporary redirect detected.',
		'Rewrite rules are humming.',
		'Canonical tag acquired.',
		'Broken embed on the horizon.',
		'Query string debris ahead.',
		'Route cache looks suspicious.',
	];

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
		if ( state.distance <= readBest() ) {
			return;
		}
		try {
			window.localStorage.setItem( STORAGE, JSON.stringify( {
				best: Math.floor( state.distance ),
				date: new Date().toISOString(),
			} ) );
		} catch ( error ) {
			// Scores are optional.
		}
	}

	function newGame() {
		state = {
			player: { x: 98, y: ground - 88, w: 68, h: 88, vy: 0, duck: false },
			obstacles: [],
			collectibles: [],
			speed: 310,
			distance: 0,
			canonical: 0,
			nextSpawn: 0.75,
			nextCollectible: 1.05,
			paused: false,
			over: false,
			routeIndex: 0,
			pulse: 0,
			shake: 0,
		};
		overlay.classList.remove( 'is-visible' );
		overlay.setAttribute( 'aria-hidden', 'true' );
		setStatus( 'Run the permalink gauntlet. Find a route home.' );
		routeEl.textContent = lines[ 0 ];
		updateHud();
		syncControlState();
	}

	function setStatus( text ) {
		statusEl.textContent = text;
	}

	function updateHud() {
		var distance = Math.floor( state.distance );
		scoreEl.textContent = distance + 'm';
		levelEl.textContent = String( state.canonical );
		bestEl.textContent = Math.max( readBest(), distance ) + 'm';
		if ( routeMeterEl ) {
			routeMeterEl.style.width = Math.min( 100, ( distance % 120 ) / 120 * 100 + state.canonical * 4 ) + '%';
		}
	}

	function jump() {
		if ( state.over || state.paused ) {
			return;
		}
		var p = state.player;
		if ( p.y + p.h >= ground - 1 ) {
			p.vy = -720;
			state.pulse = 1;
			setStatus( 'Leaped over a broken route.' );
		}
	}

	function duck( on ) {
		if ( state.over || state.paused ) {
			return;
		}
		state.player.duck = on;
	}

	function togglePause() {
		if ( state.over ) {
			return;
		}
		state.paused = ! state.paused;
		setStatus( state.paused ? 'Paused at the rewrite rules.' : 'Back on the route.' );
		syncControlState();
	}

	function syncControlState() {
		document.querySelectorAll( '[data-action="pause"]' ).forEach( function ( button ) {
			button.setAttribute( 'aria-pressed', state.paused ? 'true' : 'false' );
		} );
	}

	function spawnObstacle() {
		var type = Math.random();
		var obstacle;
		if ( type < 0.34 ) {
			obstacle = { x: canvas.width + 32, y: ground - 54, w: 72, h: 54, kind: 'rubble', spin: 0 };
		} else if ( type < 0.68 ) {
			obstacle = { x: canvas.width + 32, y: ground - 94, w: 62, h: 94, kind: 'link', spin: 0 };
		} else {
			obstacle = { x: canvas.width + 32, y: ground - 168, w: 88, h: 62, kind: 'redirect', spin: 0 };
		}
		state.obstacles.push( obstacle );
		state.routeIndex = ( state.routeIndex + 1 ) % lines.length;
		routeEl.textContent = lines[ state.routeIndex ];
	}

	function spawnCollectible() {
		state.collectibles.push( {
			x: canvas.width + 32,
			y: ground - 150 - Math.random() * 118,
			w: 32,
			h: 32,
			spin: 0,
		} );
	}

	function rectsHit( a, b ) {
		return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
	}

	function playerRect() {
		var p = state.player;
		if ( p.duck && p.y + p.h >= ground - 1 ) {
			return { x: p.x + 9, y: ground - 48, w: p.w - 18, h: 48 };
		}
		return { x: p.x + 10, y: p.y + 14, w: p.w - 20, h: p.h - 22 };
	}

	function endGame() {
		state.over = true;
		state.shake = 1;
		saveBest();
		updateHud();
		overlayTitle.textContent = 'Route lost';
		overlayLine.textContent = 'A broken link caught the missing page at ' + Math.floor( state.distance ) + 'm.';
		overlay.classList.add( 'is-visible' );
		overlay.setAttribute( 'aria-hidden', 'false' );
		overlayReset.focus();
	}

	function update( dt ) {
		if ( state.over || state.paused ) {
			state.pulse = Math.max( 0, state.pulse - dt * 2 );
			return;
		}
		state.speed = Math.min( 680, 310 + state.distance * 0.085 );
		state.distance += state.speed * dt * 0.035;
		state.pulse = Math.max( 0, state.pulse - dt * 2.4 );
		state.shake = Math.max( 0, state.shake - dt * 3 );

		var p = state.player;
		if ( p.duck && p.y + p.h >= ground - 1 ) {
			p.h = 48;
			p.y = ground - p.h;
		} else if ( p.h !== 88 ) {
			p.h = 88;
			p.y = ground - p.h;
		}
		p.vy += 1680 * dt;
		p.y += p.vy * dt;
		if ( p.y + p.h > ground ) {
			p.y = ground - p.h;
			p.vy = 0;
		}

		state.nextSpawn -= dt;
		state.nextCollectible -= dt;
		if ( state.nextSpawn <= 0 ) {
			spawnObstacle();
			state.nextSpawn = Math.max( 0.54, 1.18 - state.speed / 880 ) + Math.random() * 0.36;
		}
		if ( state.nextCollectible <= 0 ) {
			spawnCollectible();
			state.nextCollectible = 1.8 + Math.random() * 1.35;
		}

		state.obstacles.forEach( function ( obstacle ) {
			obstacle.x -= state.speed * dt;
			obstacle.spin += dt * ( obstacle.kind === 'redirect' ? 2.2 : 1.1 );
		} );
		state.collectibles.forEach( function ( token ) {
			token.x -= state.speed * dt;
			token.spin += dt * 7;
		} );

		state.obstacles = state.obstacles.filter( function ( obstacle ) {
			return obstacle.x + obstacle.w > -80;
		} );
		state.collectibles = state.collectibles.filter( function ( token ) {
			if ( rectsHit( playerRect(), token ) ) {
				state.canonical++;
				state.distance += 20;
				state.pulse = 1;
				setStatus( 'Canonical signal collected.' );
				return false;
			}
			return token.x + token.w > -60;
		} );
		if ( state.obstacles.some( function ( obstacle ) {
			return rectsHit( playerRect(), obstacle );
		} ) ) {
			endGame();
		}
		updateHud();
	}

	function drawCoverImage( image ) {
		if ( ! image.complete || ! image.naturalWidth ) {
			var fallback = ctx.createLinearGradient( 0, 0, canvas.width, canvas.height );
			fallback.addColorStop( 0, '#160522' );
			fallback.addColorStop( 1, '#06030b' );
			ctx.fillStyle = fallback;
			ctx.fillRect( 0, 0, canvas.width, canvas.height );
			return;
		}
		var scale = Math.max( canvas.width / image.naturalWidth, canvas.height / image.naturalHeight );
		var w = image.naturalWidth * scale;
		var h = image.naturalHeight * scale;
		ctx.drawImage( image, ( canvas.width - w ) / 2, ( canvas.height - h ) / 2, w, h );
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

	function drawTunnelOverlay() {
		var offset = ( state.distance * 9 ) % 160;
		ctx.save();
		ctx.globalCompositeOperation = 'screen';
		for ( var i = -1; i < 8; i++ ) {
			var y = ground - 12 + i * 26 + offset * 0.16;
			var alpha = Math.max( 0, 0.28 - i * 0.027 );
			ctx.strokeStyle = 'rgba(100,244,255,' + alpha + ')';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo( canvas.width * 0.48 - i * 72, y );
			ctx.lineTo( canvas.width * 0.54 + i * 92, y - 146 - i * 4 );
			ctx.stroke();
			ctx.strokeStyle = 'rgba(255,61,154,' + alpha + ')';
			ctx.beginPath();
			ctx.moveTo( canvas.width * 0.54 + i * 70, y );
			ctx.lineTo( canvas.width * 0.48 - i * 88, y - 146 - i * 4 );
			ctx.stroke();
		}
		ctx.globalAlpha = 0.45;
		for ( var s = 0; s < 22; s++ ) {
			var x = ( s * 83 - state.distance * 3.8 ) % ( canvas.width + 180 ) - 90;
			var y2 = 72 + ( s % 7 ) * 42;
			ctx.fillStyle = s % 3 === 0 ? 'rgba(255,61,154,.22)' : 'rgba(100,244,255,.2)';
			roundRect( x, y2, 44 + ( s % 4 ) * 12, 3, 2 );
			ctx.fill();
		}
		ctx.restore();
	}

	function drawGround() {
		ctx.save();
		ctx.fillStyle = 'rgba(4,2,8,.56)';
		ctx.beginPath();
		ctx.moveTo( 0, ground + 8 );
		ctx.lineTo( canvas.width, ground + 8 );
		ctx.lineTo( canvas.width, canvas.height );
		ctx.lineTo( 0, canvas.height );
		ctx.closePath();
		ctx.fill();
		ctx.strokeStyle = 'rgba(255,244,220,.28)';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo( 0, ground );
		ctx.lineTo( canvas.width, ground );
		ctx.stroke();
		ctx.globalCompositeOperation = 'screen';
		ctx.strokeStyle = 'rgba(100,244,255,.42)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo( 0, ground + 2 );
		ctx.lineTo( canvas.width, ground + 2 );
		ctx.stroke();
		ctx.restore();
	}

	function drawCollectible( token ) {
		ctx.save();
		ctx.translate( token.x + token.w / 2, token.y + token.h / 2 );
		ctx.rotate( token.spin );
		ctx.shadowColor = 'rgba(182,255,106,.75)';
		ctx.shadowBlur = 16;
		ctx.fillStyle = '#b6ff6a';
		ctx.strokeStyle = '#fff4dc';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo( 0, -17 );
		ctx.lineTo( 15, 0 );
		ctx.lineTo( 0, 17 );
		ctx.lineTo( -15, 0 );
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.restore();
	}

	function drawLinkObstacle( obstacle ) {
		ctx.save();
		ctx.translate( obstacle.x + obstacle.w / 2, obstacle.y + obstacle.h / 2 );
		ctx.rotate( Math.sin( obstacle.spin ) * 0.08 );
		ctx.lineWidth = 9;
		ctx.strokeStyle = '#fff4dc';
		ctx.shadowColor = 'rgba(255,61,154,.72)';
		ctx.shadowBlur = 18;
		ctx.beginPath();
		ctx.ellipse( -16, 0, 24, 13, -0.55, 0, Math.PI * 2 );
		ctx.stroke();
		ctx.strokeStyle = '#ff3d9a';
		ctx.lineWidth = 6;
		ctx.beginPath();
		ctx.ellipse( 16, 0, 24, 13, -0.55, 0, Math.PI * 2 );
		ctx.stroke();
		ctx.fillStyle = '#64f4ff';
		ctx.fillRect( -3, -5, 6, 10 );
		ctx.restore();
	}

	function drawRubbleObstacle( obstacle ) {
		ctx.save();
		ctx.translate( obstacle.x, obstacle.y );
		ctx.shadowColor = 'rgba(255,61,154,.5)';
		ctx.shadowBlur = 12;
		ctx.fillStyle = 'rgba(18,5,31,.86)';
		ctx.strokeStyle = 'rgba(255,244,220,.4)';
		ctx.lineWidth = 2;
		roundRect( 8, 8, obstacle.w - 18, obstacle.h - 12, 8 );
		ctx.fill();
		ctx.stroke();
		var colors = [ '#ff3d9a', '#64f4ff', '#ffd23f', '#8d65ff' ];
		for ( var i = 0; i < 8; i++ ) {
			ctx.save();
			ctx.translate( 12 + i * 8, 13 + ( i % 3 ) * 11 );
			ctx.rotate( ( i - 3 ) * 0.16 );
			ctx.fillStyle = colors[ i % colors.length ];
			ctx.fillRect( 0, 0, 12, 9 );
			ctx.restore();
		}
		ctx.restore();
	}

	function drawRedirectObstacle( obstacle ) {
		ctx.save();
		ctx.translate( obstacle.x + obstacle.w / 2, obstacle.y + obstacle.h / 2 );
		ctx.rotate( obstacle.spin * 0.18 );
		ctx.shadowColor = 'rgba(100,244,255,.65)';
		ctx.shadowBlur = 18;
		ctx.strokeStyle = '#fff4dc';
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.arc( 0, 0, 29, Math.PI * 0.14, Math.PI * 1.66 );
		ctx.stroke();
		ctx.strokeStyle = '#64f4ff';
		ctx.lineWidth = 8;
		ctx.beginPath();
		ctx.arc( 0, 0, 22, Math.PI * 0.12, Math.PI * 1.44 );
		ctx.stroke();
		ctx.fillStyle = '#b6ff6a';
		ctx.beginPath();
		ctx.moveTo( 24, -2 );
		ctx.lineTo( 44, 9 );
		ctx.lineTo( 24, 20 );
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}

	function drawObstacle( obstacle ) {
		if ( obstacle.kind === 'link' ) {
			drawLinkObstacle( obstacle );
		} else if ( obstacle.kind === 'redirect' ) {
			drawRedirectObstacle( obstacle );
		} else {
			drawRubbleObstacle( obstacle );
		}
	}

	function drawPlayer() {
		var p = state.player;
		var bob = Math.sin( state.distance * 0.22 ) * 3;
		ctx.save();
		if ( runner.complete && runner.naturalWidth ) {
			var drawW = p.duck ? 102 : 124;
			var drawH = p.duck ? 92 : 124;
			ctx.drawImage( runner, p.x - 30, p.y - 28 + bob, drawW, drawH );
		} else {
			ctx.fillStyle = '#fff4dc';
			roundRect( p.x, p.y, p.w, p.h, 8 );
			ctx.fill();
		}
		if ( state.pulse > 0 ) {
			ctx.globalCompositeOperation = 'screen';
			ctx.strokeStyle = 'rgba(182,255,106,' + state.pulse * 0.48 + ')';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.arc( p.x + p.w / 2, p.y + p.h / 2, 54 + state.pulse * 28, 0, Math.PI * 2 );
			ctx.stroke();
		}
		ctx.restore();
	}

	function draw() {
		ctx.save();
		if ( state.shake > 0 ) {
			ctx.translate( ( Math.random() - 0.5 ) * state.shake * 8, ( Math.random() - 0.5 ) * state.shake * 5 );
		}
		ctx.clearRect( 0, 0, canvas.width, canvas.height );
		drawCoverImage( routeBg );
		ctx.fillStyle = 'rgba(5,2,10,.18)';
		ctx.fillRect( 0, 0, canvas.width, canvas.height );
		drawTunnelOverlay();
		drawGround();
		state.collectibles.forEach( drawCollectible );
		state.obstacles.forEach( drawObstacle );
		drawPlayer();
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

	function action( name, on ) {
		if ( name === 'jump' ) { jump(); }
		if ( name === 'duck' ) { duck( on !== false ); }
		if ( name === 'pause' ) { togglePause(); }
	}

	function quickDuck() {
		action( 'duck', true );
		window.setTimeout( function () {
			action( 'duck', false );
		}, 220 );
	}

	window.addEventListener( 'keydown', function ( event ) {
		if ( event.key === ' ' || event.key === 'ArrowUp' ) { event.preventDefault(); action( 'jump' ); }
		if ( event.key === 'ArrowDown' ) { event.preventDefault(); action( 'duck', true ); }
		if ( event.key === 'p' || event.key === 'P' ) { action( 'pause' ); }
		if ( event.key === 'r' || event.key === 'R' ) { newGame(); }
	} );
	window.addEventListener( 'keyup', function ( event ) {
		if ( event.key === 'ArrowDown' ) { action( 'duck', false ); }
	} );
	document.querySelectorAll( '[data-action]' ).forEach( function ( button ) {
		button.addEventListener( 'click', function ( event ) {
			if ( button.dataset.action === 'duck' && event.detail === 0 ) {
				quickDuck();
				return;
			}
			if ( button.dataset.action === 'duck' ) {
				return;
			}
			action( button.dataset.action );
		} );
		button.addEventListener( 'pointerdown', function ( event ) {
			if ( button.dataset.action === 'duck' ) {
				event.preventDefault();
				action( 'duck', true );
			}
		} );
		button.addEventListener( 'pointerup', function () {
			if ( button.dataset.action === 'duck' ) {
				action( 'duck', false );
			}
		} );
		button.addEventListener( 'pointercancel', function () {
			if ( button.dataset.action === 'duck' ) {
				action( 'duck', false );
			}
		} );
		button.addEventListener( 'pointerleave', function () {
			if ( button.dataset.action === 'duck' ) {
				action( 'duck', false );
			}
		} );
	} );
	resetButton.addEventListener( 'click', newGame );
	overlayReset.addEventListener( 'click', newGame );

	newGame();
	window.requestAnimationFrame( frame );
}() );
