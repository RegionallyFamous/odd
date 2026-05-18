( function () {
	'use strict';

	var STORAGE = 'odd.plugin-panic.scores';
	var canvas = document.getElementById( 'game-canvas' );
	var ctx = canvas.getContext( '2d' );
	var nextCanvas = document.getElementById( 'next-canvas' );
	var nextCtx = nextCanvas.getContext( '2d' );
	var holdCanvas = document.getElementById( 'hold-canvas' );
	var holdCtx = holdCanvas.getContext( '2d' );
	var scoreEl = document.getElementById( 'score' );
	var levelEl = document.getElementById( 'level' );
	var bestEl = document.getElementById( 'best' );
	var statusEl = document.getElementById( 'status-line' );
	var queueEl = document.getElementById( 'queue-line' );
	var queueMeter = document.getElementById( 'queue-meter' );
	var overlay = document.getElementById( 'overlay' );
	var overlayTitle = document.getElementById( 'overlay-title' );
	var overlayLine = document.getElementById( 'overlay-line' );
	var resetButton = document.getElementById( 'reset-button' );
	var overlayReset = document.getElementById( 'overlay-reset' );
	var backdrop = new Image();
	var cols = 10;
	var rows = 20;
	var size = 25;
	var ox = 55;
	var oy = 106;
	var last = 0;
	var acc = 0;

	backdrop.src = './assets/plugin-update-bay.webp';
	backdrop.addEventListener( 'load', draw );

	var shapes = {
		I: [ [ 0, 1 ], [ 1, 1 ], [ 2, 1 ], [ 3, 1 ] ],
		O: [ [ 1, 0 ], [ 2, 0 ], [ 1, 1 ], [ 2, 1 ] ],
		T: [ [ 1, 0 ], [ 0, 1 ], [ 1, 1 ], [ 2, 1 ] ],
		L: [ [ 0, 0 ], [ 0, 1 ], [ 1, 1 ], [ 2, 1 ] ],
		J: [ [ 2, 0 ], [ 0, 1 ], [ 1, 1 ], [ 2, 1 ] ],
		S: [ [ 1, 0 ], [ 2, 0 ], [ 0, 1 ], [ 1, 1 ] ],
		Z: [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 2, 1 ] ],
	};
	var colors = {
		I: '#64f4ff',
		O: '#ffd23f',
		T: '#ff3d9a',
		L: '#ffb86b',
		J: '#8f7bff',
		S: '#b6ff6a',
		Z: '#ff6d72',
	};
	var names = Object.keys( shapes );

	var state = {};

	function bestScore() {
		try {
			var raw = window.localStorage.getItem( STORAGE );
			var parsed = raw ? JSON.parse( raw ) : {};
			return parsed.best || 0;
		} catch ( error ) {
			return 0;
		}
	}

	function saveBest() {
		if ( state.score <= bestScore() ) {
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

	function emptyBoard() {
		var board = [];
		for ( var y = 0; y < rows; y++ ) {
			board.push( Array( cols ).fill( '' ) );
		}
		return board;
	}

	function createPiece( type ) {
		return {
			type: type || names[ Math.floor( Math.random() * names.length ) ],
			x: 3,
			y: -1,
			rot: 0,
		};
	}

	function rotatePoint( point, rot ) {
		var x = point[ 0 ];
		var y = point[ 1 ];
		for ( var i = 0; i < rot; i++ ) {
			var nx = 3 - y;
			y = x;
			x = nx;
		}
		return [ x, y ];
	}

	function cellsFor( piece ) {
		return shapes[ piece.type ].map( function ( point ) {
			var p = rotatePoint( point, piece.rot );
			return [ piece.x + p[ 0 ], piece.y + p[ 1 ] ];
		} );
	}

	function valid( piece, dx, dy, drot ) {
		var test = {
			type: piece.type,
			x: piece.x + ( dx || 0 ),
			y: piece.y + ( dy || 0 ),
			rot: ( piece.rot + ( drot || 0 ) + 4 ) % 4,
		};
		return cellsFor( test ).every( function ( cell ) {
			var x = cell[ 0 ];
			var y = cell[ 1 ];
			return x >= 0 && x < cols && y < rows && ( y < 0 || ! state.board[ y ][ x ] );
		} );
	}

	function spawn() {
		state.current = createPiece( state.next );
		state.next = names[ Math.floor( Math.random() * names.length ) ];
		state.canHold = true;
		if ( ! valid( state.current, 0, 0, 0 ) ) {
			endGame();
		}
		drawMini( nextCtx, state.next );
		drawMini( holdCtx, state.hold );
	}

	function lockPiece() {
		cellsFor( state.current ).forEach( function ( cell ) {
			var x = cell[ 0 ];
			var y = cell[ 1 ];
			if ( y >= 0 ) {
				state.board[ y ][ x ] = state.current.type;
			}
		} );
		clearLines();
		spawn();
	}

	function clearLines() {
		var cleared = 0;
		for ( var y = rows - 1; y >= 0; y-- ) {
			if ( state.board[ y ].every( Boolean ) ) {
				state.board.splice( y, 1 );
				state.board.unshift( Array( cols ).fill( '' ) );
				cleared++;
				y++;
			}
		}
		if ( cleared ) {
			state.lines += cleared;
			state.score += [ 0, 100, 300, 500, 800 ][ cleared ] * state.level;
			state.level = Math.floor( state.lines / 6 ) + 1;
			setStatus( cleared === 1 ? 'One dependency resolved.' : cleared + ' dependencies resolved at once.' );
			updateHud();
		}
	}

	function softDrop() {
		if ( state.over || state.paused ) {
			return;
		}
		if ( valid( state.current, 0, 1, 0 ) ) {
			state.current.y++;
			state.score++;
		} else {
			lockPiece();
		}
		updateHud();
	}

	function hardDrop() {
		if ( state.over || state.paused ) {
			return;
		}
		while ( valid( state.current, 0, 1, 0 ) ) {
			state.current.y++;
			state.score += 2;
		}
		lockPiece();
		updateHud();
	}

	function move( dir ) {
		if ( ! state.over && ! state.paused && valid( state.current, dir, 0, 0 ) ) {
			state.current.x += dir;
		}
	}

	function rotate() {
		if ( ! state.over && ! state.paused && valid( state.current, 0, 0, 1 ) ) {
			state.current.rot = ( state.current.rot + 1 ) % 4;
		}
	}

	function hold() {
		if ( state.over || state.paused || ! state.canHold ) {
			return;
		}
		var current = state.current.type;
		if ( state.hold ) {
			state.current = createPiece( state.hold );
			state.hold = current;
		} else {
			state.hold = current;
			spawn();
		}
		state.canHold = false;
		setStatus( 'Update held for later review.' );
		drawMini( holdCtx, state.hold );
	}

	function togglePause() {
		if ( state.over ) {
			return;
		}
		state.paused = ! state.paused;
		setStatus( state.paused ? 'Paused before the next deploy.' : 'Back to the update queue.' );
	}

	function endGame() {
		state.over = true;
		saveBest();
		setStatus( 'Dependency conflict reached the admin bar.' );
		updateHud();
		overlayTitle.textContent = 'Plugin stack crashed';
		overlayLine.textContent = 'A dependency conflict reached the admin bar.';
		overlay.classList.add( 'is-visible' );
		overlay.setAttribute( 'aria-hidden', 'false' );
		overlayReset.focus();
	}

	function queueSummary( text ) {
		if ( text.indexOf( 'Stack updates' ) === 0 ) {
			return 'Updates waiting.';
		}
		if ( text.indexOf( 'dependencies resolved' ) !== -1 ) {
			return text.replace( ' at once', '' );
		}
		if ( text.indexOf( 'One dependency' ) === 0 ) {
			return text;
		}
		if ( text.indexOf( 'held' ) !== -1 ) {
			return 'Held for review.';
		}
		if ( text.indexOf( 'Paused' ) === 0 ) {
			return 'Paused.';
		}
		if ( text.indexOf( 'Back' ) === 0 ) {
			return 'Queue resumed.';
		}
		if ( text.indexOf( 'Dependency conflict' ) === 0 ) {
			return 'Conflict found.';
		}
		return text;
	}

	function setStatus( text ) {
		statusEl.textContent = text;
		if ( queueEl ) {
			queueEl.textContent = queueSummary( text );
		}
	}

	function updateHud() {
		scoreEl.textContent = String( state.score );
		levelEl.textContent = String( state.level );
		bestEl.textContent = String( Math.max( bestScore(), state.score ) );
		if ( queueMeter ) {
			queueMeter.style.width = String( Math.min( 100, ( state.lines % 6 ) / 6 * 100 ) ) + '%';
		}
	}

	function roundedRect( context, x, y, width, height, radius ) {
		context.beginPath();
		context.moveTo( x + radius, y );
		context.lineTo( x + width - radius, y );
		context.quadraticCurveTo( x + width, y, x + width, y + radius );
		context.lineTo( x + width, y + height - radius );
		context.quadraticCurveTo( x + width, y + height, x + width - radius, y + height );
		context.lineTo( x + radius, y + height );
		context.quadraticCurveTo( x, y + height, x, y + height - radius );
		context.lineTo( x, y + radius );
		context.quadraticCurveTo( x, y, x + radius, y );
		context.closePath();
	}

	function drawBlock( context, x, y, blockSize, type ) {
		var color = colors[ type ] || '#fff4dc';
		var inset = Math.max( 3, blockSize * 0.11 );
		var body = blockSize - inset * 2;
		context.save();
		context.shadowColor = color;
		context.shadowBlur = blockSize * 0.42;
		roundedRect( context, x + inset, y + inset, body, body, Math.max( 4, blockSize * 0.14 ) );
		context.fillStyle = 'rgba(7, 2, 12, 0.82)';
		context.fill();
		context.shadowBlur = 0;
		roundedRect( context, x + inset + 1, y + inset + 1, body - 2, body - 2, Math.max( 4, blockSize * 0.12 ) );
		context.fillStyle = color;
		context.fill();
		context.fillStyle = 'rgba(255,244,220,.34)';
		roundedRect( context, x + inset + 4, y + inset + 4, body - 8, Math.max( 3, blockSize * 0.13 ), 2 );
		context.fill();
		context.fillStyle = 'rgba(7,2,12,.58)';
		context.fillRect( x + blockSize * 0.38, y + blockSize * 0.42, blockSize * 0.08, blockSize * 0.17 );
		context.fillRect( x + blockSize * 0.54, y + blockSize * 0.42, blockSize * 0.08, blockSize * 0.17 );
		context.strokeStyle = 'rgba(255,244,220,.52)';
		context.lineWidth = 2;
		roundedRect( context, x + inset + 1, y + inset + 1, body - 2, body - 2, Math.max( 4, blockSize * 0.12 ) );
		context.stroke();
		context.restore();
	}

	function drawMini( context, type ) {
		context.clearRect( 0, 0, 96, 96 );
		context.save();
		roundedRect( context, 4, 4, 88, 88, 10 );
		context.fillStyle = 'rgba(9,3,15,.7)';
		context.fill();
		context.restore();
		if ( ! type ) {
			return;
		}
		shapes[ type ].forEach( function ( point ) {
			drawBlock( context, 13 + point[ 0 ] * 18, 21 + point[ 1 ] * 18, 18, type );
		} );
	}

	function draw() {
		if ( ! state.board ) {
			return;
		}
		ctx.clearRect( 0, 0, canvas.width, canvas.height );
		if ( backdrop.complete && backdrop.naturalWidth ) {
			ctx.drawImage( backdrop, 0, 0, canvas.width, canvas.height );
		} else {
			var grad = ctx.createLinearGradient( 0, 0, canvas.width, canvas.height );
			grad.addColorStop( 0, '#211231' );
			grad.addColorStop( 1, '#05040a' );
			ctx.fillStyle = grad;
			ctx.fillRect( 0, 0, canvas.width, canvas.height );
		}
		ctx.save();
		ctx.fillStyle = 'rgba(7,2,12,.42)';
		roundedRect( ctx, ox - 5, oy - 5, cols * size + 10, rows * size + 10, 10 );
		ctx.fill();
		ctx.strokeStyle = 'rgba(255,244,220,.16)';
		ctx.lineWidth = 1;
		for ( var gy = 0; gy < rows; gy++ ) {
			for ( var gx = 0; gx < cols; gx++ ) {
				ctx.strokeRect( ox + gx * size + 0.5, oy + gy * size + 0.5, size - 1, size - 1 );
			}
		}
		ctx.restore();
		for ( var y = 0; y < rows; y++ ) {
			for ( var x = 0; x < cols; x++ ) {
				if ( state.board[ y ][ x ] ) {
					drawBlock( ctx, ox + x * size, oy + y * size, size, state.board[ y ][ x ] );
				}
			}
		}
		if ( state.current ) {
			cellsFor( state.current ).forEach( function ( cell ) {
				if ( cell[ 1 ] >= 0 ) {
					drawBlock( ctx, ox + cell[ 0 ] * size, oy + cell[ 1 ] * size, size, state.current.type );
				}
			} );
		}
		if ( state.paused ) {
			ctx.save();
			ctx.fillStyle = 'rgba(7,2,12,.68)';
			roundedRect( ctx, ox + 24, oy + rows * size * 0.42, cols * size - 48, 54, 8 );
			ctx.fill();
			ctx.strokeStyle = 'rgba(255,244,220,.22)';
			ctx.stroke();
			ctx.fillStyle = '#fff4dc';
			ctx.font = '900 20px Inter, system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.fillText( 'Paused', ox + cols * size / 2, oy + rows * size * 0.42 + 34 );
			ctx.restore();
		}
	}

	function frame( time ) {
		var delta = time - last;
		last = time;
		if ( ! state.over && ! state.paused ) {
			acc += delta;
			var speed = Math.max( 130, 820 - state.level * 58 );
			if ( acc > speed ) {
				acc = 0;
				softDrop();
			}
		}
		draw();
		window.requestAnimationFrame( frame );
	}

	function newGame() {
		state = {
			board: emptyBoard(),
			score: 0,
			lines: 0,
			level: 1,
			next: names[ Math.floor( Math.random() * names.length ) ],
			hold: '',
			current: null,
			canHold: true,
			paused: false,
			over: false,
		};
		overlay.classList.remove( 'is-visible' );
		overlay.setAttribute( 'aria-hidden', 'true' );
		setStatus( 'Stack updates. Resolve dependencies. Do not panic.' );
		spawn();
		updateHud();
	}

	function action( name ) {
		if ( name === 'left' ) { move( -1 ); }
		if ( name === 'right' ) { move( 1 ); }
		if ( name === 'rotate' ) { rotate(); }
		if ( name === 'drop' ) { hardDrop(); }
		if ( name === 'hold' ) { hold(); }
		if ( name === 'pause' ) { togglePause(); }
	}

	window.addEventListener( 'keydown', function ( event ) {
		if ( event.key === 'ArrowLeft' ) { event.preventDefault(); action( 'left' ); }
		if ( event.key === 'ArrowRight' ) { event.preventDefault(); action( 'right' ); }
		if ( event.key === 'ArrowDown' ) { event.preventDefault(); softDrop(); }
		if ( event.key === 'ArrowUp' ) { event.preventDefault(); action( 'rotate' ); }
		if ( event.key === ' ' ) { event.preventDefault(); action( 'drop' ); }
		if ( event.key === 'c' || event.key === 'C' ) { action( 'hold' ); }
		if ( event.key === 'p' || event.key === 'P' ) { action( 'pause' ); }
	} );

	document.querySelectorAll( '[data-action]' ).forEach( function ( button ) {
		button.addEventListener( 'click', function () {
			action( button.dataset.action );
		} );
	} );
	resetButton.addEventListener( 'click', newGame );
	overlayReset.addEventListener( 'click', newGame );

	newGame();
	window.requestAnimationFrame( frame );
}() );
