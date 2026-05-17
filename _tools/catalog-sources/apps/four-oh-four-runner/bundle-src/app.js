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
	var overlay = document.getElementById( 'overlay' );
	var overlayTitle = document.getElementById( 'overlay-title' );
	var overlayLine = document.getElementById( 'overlay-line' );
	var resetButton = document.getElementById( 'reset-button' );
	var overlayReset = document.getElementById( 'overlay-reset' );
	var sprites = new Image();
	sprites.src = './assets/sprites.webp';

	var state = {};
	var last = 0;
	var ground = 380;
	var lines = [
		'Temporary redirect detected.',
		'Permalink structure is getting dramatic.',
		'Canonical tag acquired.',
		'Broken embed on the horizon.',
		'Query string debris ahead.',
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
			player: { x: 92, y: ground - 70, w: 54, h: 70, vy: 0, duck: false },
			obstacles: [],
			collectibles: [],
			speed: 280,
			distance: 0,
			canonical: 0,
			nextSpawn: 0.75,
			nextCollectible: 1.25,
			paused: false,
			over: false,
			routeIndex: 0,
		};
		overlay.classList.remove( 'is-visible' );
		overlay.setAttribute( 'aria-hidden', 'true' );
		setStatus( 'Run the permalink gauntlet. Find a route home.' );
		routeEl.textContent = lines[ 0 ];
		updateHud();
	}

	function setStatus( text ) {
		statusEl.textContent = text;
	}

	function updateHud() {
		scoreEl.textContent = Math.floor( state.distance ) + 'm';
		levelEl.textContent = String( state.canonical );
		bestEl.textContent = Math.max( readBest(), Math.floor( state.distance ) ) + 'm';
	}

	function jump() {
		if ( state.over || state.paused ) {
			return;
		}
		var p = state.player;
		if ( p.y + p.h >= ground - 1 ) {
			p.vy = -690;
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
	}

	function spawnObstacle() {
		var type = Math.random();
		var obstacle;
		if ( type < 0.36 ) {
			obstacle = { x: canvas.width + 20, y: ground - 48, w: 58, h: 48, kind: 'rubble' };
		} else if ( type < 0.7 ) {
			obstacle = { x: canvas.width + 20, y: ground - 86, w: 48, h: 86, kind: 'link' };
		} else {
			obstacle = { x: canvas.width + 20, y: ground - 160, w: 74, h: 62, kind: 'redirect' };
		}
		state.obstacles.push( obstacle );
		state.routeIndex = ( state.routeIndex + 1 ) % lines.length;
		routeEl.textContent = lines[ state.routeIndex ];
	}

	function spawnCollectible() {
		state.collectibles.push( {
			x: canvas.width + 20,
			y: ground - 140 - Math.random() * 120,
			w: 30,
			h: 30,
			spin: 0,
		} );
	}

	function rectsHit( a, b ) {
		return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
	}

	function playerRect() {
		var p = state.player;
		if ( p.duck && p.y + p.h >= ground - 1 ) {
			return { x: p.x + 4, y: ground - 42, w: p.w - 8, h: 42 };
		}
		return { x: p.x + 5, y: p.y + 8, w: p.w - 10, h: p.h - 12 };
	}

	function endGame() {
		state.over = true;
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
			return;
		}
		state.speed = Math.min( 620, 280 + state.distance * 0.08 );
		state.distance += state.speed * dt * 0.035;
		var p = state.player;
		if ( p.duck && p.y + p.h >= ground - 1 ) {
			p.h = 44;
			p.y = ground - p.h;
		} else if ( p.h !== 70 ) {
			p.h = 70;
			p.y = ground - p.h;
		}
		p.vy += 1650 * dt;
		p.y += p.vy * dt;
		if ( p.y + p.h > ground ) {
			p.y = ground - p.h;
			p.vy = 0;
		}
		state.nextSpawn -= dt;
		state.nextCollectible -= dt;
		if ( state.nextSpawn <= 0 ) {
			spawnObstacle();
			state.nextSpawn = Math.max( 0.58, 1.22 - state.speed / 850 ) + Math.random() * 0.42;
		}
		if ( state.nextCollectible <= 0 ) {
			spawnCollectible();
			state.nextCollectible = 2.1 + Math.random() * 1.5;
		}
		state.obstacles.forEach( function ( obstacle ) {
			obstacle.x -= state.speed * dt;
		} );
		state.collectibles.forEach( function ( token ) {
			token.x -= state.speed * dt;
			token.spin += dt * 7;
		} );
		state.obstacles = state.obstacles.filter( function ( obstacle ) {
			return obstacle.x + obstacle.w > -40;
		} );
		state.collectibles = state.collectibles.filter( function ( token ) {
			if ( rectsHit( playerRect(), token ) ) {
				state.canonical++;
				state.distance += 18;
				setStatus( 'Canonical signal collected.' );
				return false;
			}
			return token.x + token.w > -40;
		} );
		if ( state.obstacles.some( function ( obstacle ) {
			return rectsHit( playerRect(), obstacle );
		} ) ) {
			endGame();
		}
		updateHud();
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

	function drawPlayer() {
		var p = state.player;
		if ( drawSpriteCell( 0, 0, p.x - 16, p.y - 18, p.w + 40, p.h + 36 ) ) {
			return;
		}
		ctx.fillStyle = '#fff4dc';
		ctx.fillRect( p.x, p.y, p.w, p.h );
		ctx.fillStyle = '#12051f';
		ctx.fillRect( p.x + 14, p.y + 18, 8, 8 );
		ctx.fillRect( p.x + 34, p.y + 18, 8, 8 );
	}

	function drawObstacle( obstacle ) {
		var map = obstacle.kind === 'link' ? [ 1, 0 ] : obstacle.kind === 'redirect' ? [ 0, 1 ] : [ 1, 1 ];
		if ( drawSpriteCell( map[ 0 ], map[ 1 ], obstacle.x - 16, obstacle.y - 20, obstacle.w + 44, obstacle.h + 44 ) ) {
			return;
		}
		ctx.fillStyle = obstacle.kind === 'redirect' ? '#ff3d9a' : '#ffd23f';
		ctx.fillRect( obstacle.x, obstacle.y, obstacle.w, obstacle.h );
	}

	function draw() {
		ctx.clearRect( 0, 0, canvas.width, canvas.height );
		var grad = ctx.createLinearGradient( 0, 0, canvas.width, canvas.height );
		grad.addColorStop( 0, '#12051f' );
		grad.addColorStop( 1, '#05040a' );
		ctx.fillStyle = grad;
		ctx.fillRect( 0, 0, canvas.width, canvas.height );
		ctx.fillStyle = 'rgba(100,244,255,.1)';
		for ( var i = 0; i < 18; i++ ) {
			var x = ( i * 93 - state.distance * 2 ) % ( canvas.width + 120 );
			ctx.fillRect( x, 80 + ( i % 5 ) * 42, 44, 2 );
		}
		ctx.fillStyle = 'rgba(255,244,220,.16)';
		ctx.fillRect( 0, ground, canvas.width, 3 );
		ctx.fillStyle = 'rgba(255,244,220,.06)';
		ctx.fillRect( 0, ground + 3, canvas.width, canvas.height - ground );
		state.collectibles.forEach( function ( token ) {
			ctx.save();
			ctx.translate( token.x + token.w / 2, token.y + token.h / 2 );
			ctx.rotate( token.spin );
			ctx.fillStyle = '#b6ff6a';
			ctx.strokeStyle = '#fff4dc';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo( 0, -16 );
			ctx.lineTo( 14, 0 );
			ctx.lineTo( 0, 16 );
			ctx.lineTo( -14, 0 );
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		} );
		state.obstacles.forEach( drawObstacle );
		drawPlayer();
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

	window.addEventListener( 'keydown', function ( event ) {
		if ( event.key === ' ' || event.key === 'ArrowUp' ) { event.preventDefault(); action( 'jump' ); }
		if ( event.key === 'ArrowDown' ) { event.preventDefault(); action( 'duck', true ); }
		if ( event.key === 'p' || event.key === 'P' ) { action( 'pause' ); }
	} );
	window.addEventListener( 'keyup', function ( event ) {
		if ( event.key === 'ArrowDown' ) { action( 'duck', false ); }
	} );
	document.querySelectorAll( '[data-action]' ).forEach( function ( button ) {
		button.addEventListener( 'click', function () {
			if ( button.dataset.action !== 'duck' ) {
				action( button.dataset.action );
			}
		} );
		button.addEventListener( 'pointerdown', function () {
			if ( button.dataset.action === 'duck' ) {
				action( 'duck', true );
			}
		} );
		button.addEventListener( 'pointerup', function () {
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
