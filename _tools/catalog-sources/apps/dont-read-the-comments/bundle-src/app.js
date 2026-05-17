( function () {
	'use strict';

	var STORAGE_PREFIX = 'odd.dont-read-the-comments';
	var PREFS_KEY = STORAGE_PREFIX + '.prefs';
	var SCORES_KEY = STORAGE_PREFIX + '.scores';

	var LEVELS = {
		cozy: {
			label: 'Cozy',
			rows: 9,
			cols: 9,
			comments: 10,
		},
		spicy: {
			label: 'Spicy',
			rows: 12,
			cols: 16,
			comments: 30,
		},
		chaos: {
			label: 'Chaos',
			rows: 16,
			cols: 24,
			comments: 76,
		},
	};

	var COMMENT_LINES = [
		'I skimmed the headline and arrived fully confident.',
		'This tile has strong feelings about your margin choices.',
		'Actually, my blog from 2009 covers this.',
		'I found a typo in the vibe.',
		'Can you make it pop, but quieter?',
		'The moderation queue says hi.',
		'Flagged for excessive confidence.',
		'I brought a hot take and no context.',
		'This grid was better before the redesign.',
		'Respectfully, I will not be reading.',
		'My cousin tried this once and invented a framework.',
		'Three question marks, zero sources.',
		'I love this except for the part where it exists.',
		'The comments have requested a meeting.',
		'First, somehow.',
		'This square has notes and a tiny clipboard.',
	];

	var boardEl = document.getElementById( 'game-board' );
	var statusEl = document.getElementById( 'status-line' );
	var commentsLeftEl = document.getElementById( 'comments-left' );
	var timerEl = document.getElementById( 'timer' );
	var bestEl = document.getElementById( 'best-time' );
	var commentPanel = document.getElementById( 'comment-panel' );
	var commentLineEl = document.getElementById( 'comment-line' );
	var resetButton = document.getElementById( 'reset-button' );
	var revealLayer = document.getElementById( 'reveal-layer' );
	var revealTitle = document.getElementById( 'reveal-title' );
	var revealLine = document.getElementById( 'reveal-line' );
	var revealAvatar = document.getElementById( 'reveal-avatar' );
	var revealReset = document.getElementById( 'reveal-reset' );
	var tabs = Array.prototype.slice.call( document.querySelectorAll( '.difficulty-tab' ) );

	var state = {
		levelKey: readPrefs().levelKey || 'cozy',
		level: LEVELS.cozy,
		cells: [],
		firstMove: true,
		startedAt: 0,
		elapsed: 0,
		timerId: 0,
		moves: 0,
		status: 'ready',
		lastComment: 0,
	};

	function readJSON( key, fallback ) {
		try {
			var raw = window.localStorage.getItem( key );
			return raw ? JSON.parse( raw ) : fallback;
		} catch ( error ) {
			return fallback;
		}
	}

	function writeJSON( key, value ) {
		try {
			window.localStorage.setItem( key, JSON.stringify( value ) );
		} catch ( error ) {
			// Local storage is optional for the game.
		}
	}

	function readPrefs() {
		var prefs = readJSON( PREFS_KEY, {} );
		return prefs && typeof prefs === 'object' ? prefs : {};
	}

	function savePrefs() {
		writeJSON( PREFS_KEY, { levelKey: state.levelKey } );
	}

	function readScores() {
		var scores = readJSON( SCORES_KEY, {} );
		return scores && typeof scores === 'object' ? scores : {};
	}

	function saveScore() {
		var scores = readScores();
		var previous = scores[ state.levelKey ];
		if ( ! previous || state.elapsed < previous.seconds ) {
			scores[ state.levelKey ] = {
				seconds: state.elapsed,
				moves: state.moves,
				date: new Date().toISOString(),
			};
			writeJSON( SCORES_KEY, scores );
		}
	}

	function formatTime( seconds ) {
		if ( typeof seconds !== 'number' || ! isFinite( seconds ) ) {
			return '--';
		}
		return String( Math.max( 0, Math.min( 999, seconds ) ) ).padStart( 3, '0' );
	}

	function cellIndex( row, col ) {
		return row * state.level.cols + col;
	}

	function rowOf( index ) {
		return Math.floor( index / state.level.cols );
	}

	function colOf( index ) {
		return index % state.level.cols;
	}

	function neighborsOf( index ) {
		var row = rowOf( index );
		var col = colOf( index );
		var neighbors = [];
		for ( var dr = -1; dr <= 1; dr++ ) {
			for ( var dc = -1; dc <= 1; dc++ ) {
				if ( dr === 0 && dc === 0 ) {
					continue;
				}
				var nr = row + dr;
				var nc = col + dc;
				if ( nr >= 0 && nc >= 0 && nr < state.level.rows && nc < state.level.cols ) {
					neighbors.push( cellIndex( nr, nc ) );
				}
			}
		}
		return neighbors;
	}

	function createBlankCells() {
		var total = state.level.rows * state.level.cols;
		state.cells = [];
		for ( var index = 0; index < total; index++ ) {
			state.cells.push( {
				comment: false,
				revealed: false,
				flagged: false,
				adjacent: 0,
			} );
		}
	}

	function generateComments( firstIndex ) {
		var safe = new Set( neighborsOf( firstIndex ) );
		safe.add( firstIndex );
		var candidates = [];
		for ( var index = 0; index < state.cells.length; index++ ) {
			if ( ! safe.has( index ) ) {
				candidates.push( index );
			}
		}
		for ( var i = candidates.length - 1; i > 0; i-- ) {
			var swap = Math.floor( Math.random() * ( i + 1 ) );
			var temp = candidates[ i ];
			candidates[ i ] = candidates[ swap ];
			candidates[ swap ] = temp;
		}
		candidates.slice( 0, state.level.comments ).forEach( function ( index ) {
			state.cells[ index ].comment = true;
		} );
		state.cells.forEach( function ( cell, index ) {
			cell.adjacent = neighborsOf( index ).filter( function ( neighborIndex ) {
				return state.cells[ neighborIndex ].comment;
			} ).length;
		} );
	}

	function startTimer() {
		if ( state.timerId ) {
			return;
		}
		state.startedAt = Date.now() - state.elapsed * 1000;
		state.timerId = window.setInterval( function () {
			state.elapsed = Math.floor( ( Date.now() - state.startedAt ) / 1000 );
			timerEl.textContent = formatTime( state.elapsed );
		}, 250 );
	}

	function stopTimer() {
		if ( state.timerId ) {
			window.clearInterval( state.timerId );
			state.timerId = 0;
		}
	}

	function setStatus( text ) {
		statusEl.textContent = text;
	}

	function flaggedCount() {
		return state.cells.filter( function ( cell ) {
			return cell.flagged;
		} ).length;
	}

	function revealedSafeCount() {
		return state.cells.filter( function ( cell ) {
			return cell.revealed && ! cell.comment;
		} ).length;
	}

	function updateCounters() {
		commentsLeftEl.textContent = String( Math.max( 0, state.level.comments - flaggedCount() ) ).padStart( 2, '0' );
		timerEl.textContent = formatTime( state.elapsed );
		var best = readScores()[ state.levelKey ];
		bestEl.textContent = best ? formatTime( best.seconds ) : '--';
	}

	function updateTabs() {
		tabs.forEach( function ( tab ) {
			var selected = tab.dataset.level === state.levelKey;
			tab.setAttribute( 'aria-selected', selected ? 'true' : 'false' );
			tab.tabIndex = selected ? 0 : -1;
		} );
	}

	function revealFlood( startIndex ) {
		var queue = [ startIndex ];
		var touched = new Set();
		while ( queue.length ) {
			var index = queue.shift();
			if ( touched.has( index ) ) {
				continue;
			}
			touched.add( index );
			var cell = state.cells[ index ];
			if ( cell.flagged || cell.revealed ) {
				continue;
			}
			cell.revealed = true;
			if ( cell.adjacent === 0 && ! cell.comment ) {
				neighborsOf( index ).forEach( function ( neighborIndex ) {
					var neighbor = state.cells[ neighborIndex ];
					if ( ! neighbor.revealed && ! neighbor.flagged && ! neighbor.comment ) {
						queue.push( neighborIndex );
					}
				} );
			}
		}
	}

	function chooseCommentLine( index ) {
		state.lastComment = ( index + state.moves + state.level.comments ) % COMMENT_LINES.length;
		return COMMENT_LINES[ state.lastComment ];
	}

	function showPanelComment( line ) {
		var avatar = state.lastComment % 4;
		commentPanel.querySelector( '.comment-avatar' ).className = 'comment-avatar avatar-' + avatar;
		commentLineEl.textContent = line;
	}

	function showReveal( line ) {
		var avatar = state.lastComment % 4;
		revealAvatar.className = 'comment-avatar avatar-' + avatar;
		revealLine.textContent = line;
		revealTitle.textContent = 'Thread derailed';
		revealLayer.classList.add( 'is-visible' );
		revealLayer.setAttribute( 'aria-hidden', 'false' );
		revealReset.focus();
	}

	function hideReveal() {
		revealLayer.classList.remove( 'is-visible' );
		revealLayer.setAttribute( 'aria-hidden', 'true' );
	}

	function loseGame( index ) {
		state.status = 'lost';
		stopTimer();
		state.cells.forEach( function ( cell ) {
			if ( cell.comment ) {
				cell.revealed = true;
			}
		} );
		var line = chooseCommentLine( index );
		showPanelComment( line );
		setStatus( 'A comment got through. The thread needs a reset.' );
		renderBoard();
		showReveal( line );
	}

	function winGame() {
		state.status = 'won';
		stopTimer();
		state.cells.forEach( function ( cell ) {
			if ( cell.comment ) {
				cell.flagged = true;
			}
		} );
		saveScore();
		setStatus( 'Comments closed. Clean thread, clean board.' );
		showPanelComment( 'Clean sweep. The moderation queue is empty.' );
		renderBoard();
		updateCounters();
	}

	function checkWin() {
		if ( state.status !== 'playing' ) {
			return;
		}
		var safeCells = state.cells.length - state.level.comments;
		if ( revealedSafeCount() === safeCells ) {
			winGame();
		}
	}

	function revealCell( index ) {
		if ( state.status === 'lost' || state.status === 'won' ) {
			return;
		}
		var cell = state.cells[ index ];
		if ( ! cell || cell.flagged ) {
			return;
		}
		if ( cell.revealed ) {
			chordCell( index );
			return;
		}
		if ( state.firstMove ) {
			generateComments( index );
			state.firstMove = false;
			state.status = 'playing';
			startTimer();
		}
		state.moves++;
		if ( cell.comment ) {
			cell.revealed = true;
			loseGame( index );
			return;
		}
		revealFlood( index );
		setStatus( cell.adjacent ? 'A clue surfaced.' : 'A quiet patch opened up.' );
		renderBoard();
		updateCounters();
		checkWin();
	}

	function toggleFlag( index ) {
		if ( state.status === 'lost' || state.status === 'won' ) {
			return;
		}
		var cell = state.cells[ index ];
		if ( ! cell || cell.revealed ) {
			return;
		}
		cell.flagged = ! cell.flagged;
		if ( state.status === 'ready' ) {
			setStatus( 'Comment marked for review.' );
		} else {
			setStatus( cell.flagged ? 'Marked for review.' : 'Back in the thread.' );
		}
		renderBoard();
		updateCounters();
	}

	function chordCell( index ) {
		var cell = state.cells[ index ];
		if ( ! cell || ! cell.revealed || cell.adjacent === 0 || state.status !== 'playing' ) {
			return;
		}
		var neighbors = neighborsOf( index );
		var flags = neighbors.filter( function ( neighborIndex ) {
			return state.cells[ neighborIndex ].flagged;
		} ).length;
		if ( flags !== cell.adjacent ) {
			setStatus( 'The clue wants a cleaner count.' );
			return;
		}
		for ( var i = 0; i < neighbors.length; i++ ) {
			var neighborIndex = neighbors[ i ];
			var neighbor = state.cells[ neighborIndex ];
			if ( ! neighbor.flagged && ! neighbor.revealed && neighbor.comment ) {
				neighbor.revealed = true;
				loseGame( neighborIndex );
				return;
			}
		}
		neighbors.forEach( function ( neighborIndex ) {
			var neighbor = state.cells[ neighborIndex ];
			if ( ! neighbor.flagged && ! neighbor.revealed ) {
				revealFlood( neighborIndex );
			}
		} );
		state.moves++;
		renderBoard();
		updateCounters();
		checkWin();
	}

	function renderCell( cell, index ) {
		var button = document.createElement( 'button' );
		button.type = 'button';
		button.className = 'cell';
		button.dataset.index = String( index );
		button.setAttribute( 'role', 'gridcell' );
		button.setAttribute( 'aria-label', cellLabel( cell, index ) );
		if ( cell.revealed ) {
			button.classList.add( 'is-revealed' );
		}
		if ( cell.flagged ) {
			button.classList.add( 'is-flagged' );
		}
		if ( cell.revealed && cell.comment ) {
			button.classList.add( 'is-comment' );
		}
		if ( cell.revealed && cell.comment ) {
			var mean = document.createElement( 'span' );
			mean.className = 'mean-mark';
			mean.setAttribute( 'aria-hidden', 'true' );
			button.appendChild( mean );
		} else if ( cell.flagged ) {
			var flag = document.createElement( 'span' );
			flag.className = 'flag-mark';
			flag.setAttribute( 'aria-hidden', 'true' );
			button.appendChild( flag );
		} else if ( cell.revealed && cell.adjacent ) {
			button.textContent = String( cell.adjacent );
			button.dataset.count = String( cell.adjacent );
		}
		button.addEventListener( 'click', function ( event ) {
			if ( event.shiftKey || event.altKey ) {
				toggleFlag( index );
			} else {
				revealCell( index );
			}
		} );
		button.addEventListener( 'contextmenu', function ( event ) {
			event.preventDefault();
			toggleFlag( index );
		} );
		button.addEventListener( 'keydown', function ( event ) {
			if ( event.key === 'f' || event.key === 'F' ) {
				event.preventDefault();
				toggleFlag( index );
			}
		} );
		return button;
	}

	function cellLabel( cell, index ) {
		var row = rowOf( index ) + 1;
		var col = colOf( index ) + 1;
		if ( cell.flagged && ! cell.revealed ) {
			return 'Row ' + row + ', column ' + col + ', marked for review';
		}
		if ( ! cell.revealed ) {
			return 'Row ' + row + ', column ' + col + ', hidden';
		}
		if ( cell.comment ) {
			return 'Row ' + row + ', column ' + col + ', comment';
		}
		if ( cell.adjacent ) {
			return 'Row ' + row + ', column ' + col + ', ' + cell.adjacent + ' nearby comments';
		}
		return 'Row ' + row + ', column ' + col + ', clear';
	}

	function renderBoard() {
		boardEl.innerHTML = '';
		boardEl.style.setProperty( '--cols', String( state.level.cols ) );
		state.cells.forEach( function ( cell, index ) {
			boardEl.appendChild( renderCell( cell, index ) );
		} );
		sizeBoard();
	}

	function sizeBoard() {
		var wrap = boardEl.parentElement;
		if ( ! wrap ) {
			return;
		}
		var narrow = window.matchMedia( '(max-width: 560px)' ).matches;
		var gap = narrow ? 3 : 4;
		var minSize = narrow ? 16 : 20;
		var maxWidth = Math.max( 260, wrap.clientWidth - 40 );
		var maxHeight = Math.max( 260, wrap.clientHeight - 40 );
		if ( window.matchMedia( '(max-width: 760px)' ).matches ) {
			maxHeight = Math.max( 260, window.innerHeight - 330 );
		}
		var byWidth = Math.floor( ( maxWidth - gap * ( state.level.cols - 1 ) - 16 ) / state.level.cols );
		var byHeight = Math.floor( ( maxHeight - gap * ( state.level.rows - 1 ) - 16 ) / state.level.rows );
		var size = Math.max( minSize, Math.min( 36, byWidth, byHeight ) );
		boardEl.style.setProperty( '--tile-gap', gap + 'px' );
		boardEl.style.setProperty( '--tile-size', size + 'px' );
	}

	function resetGame( levelKey ) {
		hideReveal();
		stopTimer();
		if ( levelKey && LEVELS[ levelKey ] ) {
			state.levelKey = levelKey;
			savePrefs();
		}
		state.level = LEVELS[ state.levelKey ] || LEVELS.cozy;
		state.firstMove = true;
		state.startedAt = 0;
		state.elapsed = 0;
		state.moves = 0;
		state.status = 'ready';
		state.lastComment = 0;
		createBlankCells();
		updateTabs();
		updateCounters();
		setStatus( 'Choose a tile. The thread is waiting.' );
		commentPanel.querySelector( '.comment-avatar' ).className = 'comment-avatar avatar-0';
		commentLineEl.textContent = 'No comments opened yet.';
		renderBoard();
	}

	tabs.forEach( function ( tab ) {
		tab.addEventListener( 'click', function () {
			resetGame( tab.dataset.level );
		} );
		tab.addEventListener( 'keydown', function ( event ) {
			var index = tabs.indexOf( tab );
			if ( event.key === 'ArrowRight' || event.key === 'ArrowDown' ) {
				event.preventDefault();
				tabs[ ( index + 1 ) % tabs.length ].focus();
			}
			if ( event.key === 'ArrowLeft' || event.key === 'ArrowUp' ) {
				event.preventDefault();
				tabs[ ( index + tabs.length - 1 ) % tabs.length ].focus();
			}
		} );
	} );

	resetButton.addEventListener( 'click', function () {
		resetGame();
	} );

	revealReset.addEventListener( 'click', function () {
		resetGame();
	} );

	window.addEventListener( 'resize', sizeBoard );
	window.addEventListener( 'keydown', function ( event ) {
		if ( event.key === 'Escape' && revealLayer.classList.contains( 'is-visible' ) ) {
			hideReveal();
			resetButton.focus();
		}
	} );

	resetGame( state.levelKey );
}() );
