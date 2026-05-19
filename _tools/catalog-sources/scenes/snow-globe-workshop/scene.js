/**
 * ODD scene: Snow Globe Workshop - v1.0.0
 * ---------------------------------------------------------------
 * Painted backdrop (wallpaper.webp) with lightweight Pixi overlays:
 * ambient snow motes, floating snow tokens, and a
 * rare right-side accent pulse. The lower-left icon zone stays quiet.
 */
( function () {
	'use strict';
	window.__odd = window.__odd || {};
	window.__odd.scenes = window.__odd.scenes || {};
	var h = window.__odd.helpers || {};
	var scriptUrl = document.currentScript && document.currentScript.src;
	var SLUG = 'snow-globe-workshop';
	var TOKEN_KIND = 'snow';
	var AMBIENT_KIND = 'snow';
	var TOKEN_COUNT = 8;
	var TOKEN_LOW = 4;
	var MOTE_COUNT = 72;
	var MOTE_LOW = 34;
	var PALETTE = [ 0xffffff, 0xa9d8ff, 0xffd28a, 0xd8f3ff ];
	var ACCENT = 0xa9d8ff;

	function rand( min, max ) {
		if ( h.rand ) return h.rand( min, max );
		return min + Math.random() * ( max - min );
	}

	function choose( list ) {
		if ( h.choose ) return h.choose( list );
		return list[ ( Math.random() * list.length ) | 0 ];
	}

	function backdropUrl() {
		var cfg = window.odd || {};
		var sm = cfg.sceneMap || {};
		var desc = sm[ SLUG ] || {};
		if ( desc.wallpaperUrl ) return desc.wallpaperUrl;
		return scriptUrl ? new URL( 'wallpaper.webp', scriptUrl ).toString() : '';
	}

	function inIconZone( x, y, w, hh ) {
		return x < w * 0.36 && y > hh * 0.58;
	}

	function spawnMote( w, hh ) {
		var p = {
			x: rand( 0, w ),
			y: rand( hh * 0.08, hh * 0.92 ),
			vx: rand( -0.08, 0.16 ),
			vy: rand( -0.08, 0.08 ),
			r: rand( 1.2, 4.8 ),
			len: rand( 10, 36 ),
			color: choose( PALETTE ),
			alpha: rand( 0.045, 0.18 ),
			phase: rand( 0, Math.PI * 2 ),
			phaseSpeed: rand( 0.006, 0.02 ),
		};
		if ( inIconZone( p.x, p.y, w, hh ) ) {
			p.alpha *= 0.38;
			p.r = Math.min( p.r, 2.2 );
		}
		return p;
	}

	function spawnToken( w, hh, fromEdge ) {
		var p = {
			x: fromEdge ? rand( w + 20, w + 180 ) : rand( w * 0.38, w + 120 ),
			y: rand( hh * 0.12, hh * 0.72 ),
			vx: rand( -0.22, -0.06 ),
			vy: rand( -0.035, 0.04 ),
			size: rand( 12, 34 ),
			color: choose( PALETTE ),
			alpha: rand( 0.12, 0.34 ),
			phase: rand( 0, Math.PI * 2 ),
			phaseSpeed: rand( 0.006, 0.018 ),
			spin: rand( -0.018, 0.018 ),
			rot: rand( -0.4, 0.4 ),
		};
		return p;
	}

	function fitBackdrop( app, tex, backdrop ) {
		var s = Math.max(
			app.renderer.width / tex.width,
			app.renderer.height / tex.height
		);
		backdrop.scale.set( s );
		backdrop.x = ( app.renderer.width - tex.width * s ) / 2;
		backdrop.y = ( app.renderer.height - tex.height * s ) / 2;
	}

	function drawMote( g, p, x, y, t, perfLow ) {
		var pulse = 0.72 + Math.sin( t + p.phase ) * 0.28;
		var a = p.alpha * pulse;
		if ( AMBIENT_KIND === 'bubble' ) {
			g.circle( x, y, p.r * 2.2 ).stroke( { color: p.color, alpha: a, width: 1 } );
			g.circle( x - p.r * 0.8, y - p.r * 0.8, p.r * 0.45 ).fill( { color: 0xffffff, alpha: a * 0.7 } );
		} else if ( AMBIENT_KIND === 'steam' || AMBIENT_KIND === 'fog' ) {
			g.ellipse( x, y, p.r * 5, p.r * 1.5 ).fill( { color: p.color, alpha: a * 0.36 } );
		} else if ( AMBIENT_KIND === 'snow' || AMBIENT_KIND === 'ash' || AMBIENT_KIND === 'flour' ) {
			g.circle( x, y, p.r ).fill( { color: p.color, alpha: a } );
		} else if ( AMBIENT_KIND === 'firefly' || AMBIENT_KIND === 'glint' || AMBIENT_KIND === 'spark' ) {
			g.circle( x, y, p.r ).fill( { color: p.color, alpha: a * 1.2 } );
			if ( ! perfLow ) g.circle( x, y, p.r * 3.8 ).fill( { color: p.color, alpha: a * 0.16 } );
		} else {
			g.circle( x, y, p.r ).fill( { color: p.color, alpha: a } );
		}
	}

	function drawToken( g, p, x, y, t ) {
		var s = p.size;
		var a = p.alpha * ( 0.84 + Math.sin( t + p.phase ) * 0.16 );
		if ( TOKEN_KIND === 'card' ) {
			g.roundRect( x - s * 1.6, y - s, s * 3.2, s * 2, 6 ).fill( { color: p.color, alpha: a * 0.52 } );
			g.rect( x - s * 1.1, y - s * 0.24, s * 2.2, 1.2 ).fill( { color: 0xffffff, alpha: a * 0.25 } );
		} else if ( TOKEN_KIND === 'bubble' ) {
			g.circle( x, y, s ).stroke( { color: p.color, alpha: a, width: 1.4 } );
			g.circle( x - s * 0.34, y - s * 0.34, s * 0.18 ).fill( { color: 0xffffff, alpha: a * 0.75 } );
		} else if ( TOKEN_KIND === 'ring' ) {
			g.circle( x, y, s ).stroke( { color: p.color, alpha: a, width: 1.2 } );
			g.circle( x, y, s * 0.45 ).stroke( { color: p.color, alpha: a * 0.55, width: 1 } );
		} else if ( TOKEN_KIND === 'planet' ) {
			g.circle( x, y, s * 0.55 ).fill( { color: p.color, alpha: a } );
			g.ellipse( x, y, s * 1.2, s * 0.36 ).stroke( { color: 0xffffff, alpha: a * 0.42, width: 1 } );
		} else if ( TOKEN_KIND === 'comet' ) {
			g.moveTo( x + s * 1.4, y - s * 0.5 ).lineTo( x - s * 0.4, y + s * 0.18 ).stroke( { color: p.color, alpha: a * 0.42, width: 2 } );
			g.circle( x - s * 0.54, y + s * 0.24, s * 0.32 ).fill( { color: p.color, alpha: a } );
		} else if ( TOKEN_KIND === 'crystal' || TOKEN_KIND === 'prism' ) {
			g.poly( [ x, y - s, x + s * 0.72, y, x, y + s, x - s * 0.72, y ] ).fill( { color: p.color, alpha: a * 0.62 } );
			g.moveTo( x, y - s ).lineTo( x, y + s ).stroke( { color: 0xffffff, alpha: a * 0.32, width: 1 } );
		} else if ( TOKEN_KIND === 'leaf' ) {
			g.ellipse( x, y, s * 0.5, s * 1.05 ).fill( { color: p.color, alpha: a * 0.72 } );
			g.moveTo( x, y - s * 0.7 ).lineTo( x, y + s * 0.7 ).stroke( { color: 0x2b1b0f, alpha: a * 0.22, width: 1 } );
		} else if ( TOKEN_KIND === 'shell' ) {
			g.ellipse( x, y, s, s * 0.62 ).fill( { color: p.color, alpha: a * 0.56 } );
			g.moveTo( x - s * 0.65, y ).lineTo( x + s * 0.65, y ).stroke( { color: 0xffffff, alpha: a * 0.22, width: 1 } );
		} else if ( TOKEN_KIND === 'lantern' ) {
			g.roundRect( x - s * 0.44, y - s * 0.7, s * 0.88, s * 1.4, 5 ).fill( { color: p.color, alpha: a * 0.6 } );
			g.circle( x, y, s * 1.15 ).fill( { color: p.color, alpha: a * 0.08 } );
		} else if ( TOKEN_KIND === 'peel' ) {
			g.roundRect( x - s, y - s * 0.68, s * 2, s * 1.36, 4 ).fill( { color: p.color, alpha: a * 0.46 } );
			g.poly( [ x + s * 0.35, y - s * 0.68, x + s, y - s * 0.68, x + s, y - s * 0.05 ] ).fill( { color: 0xffffff, alpha: a * 0.18 } );
		} else if ( TOKEN_KIND === 'cloud' ) {
			g.circle( x - s * 0.45, y, s * 0.48 ).fill( { color: p.color, alpha: a * 0.34 } );
			g.circle( x, y - s * 0.15, s * 0.62 ).fill( { color: p.color, alpha: a * 0.34 } );
			g.circle( x + s * 0.5, y, s * 0.45 ).fill( { color: p.color, alpha: a * 0.34 } );
		} else if ( TOKEN_KIND === 'ember' || TOKEN_KIND === 'snow' ) {
			g.circle( x, y, s * 0.28 ).fill( { color: p.color, alpha: a } );
			g.circle( x, y, s ).fill( { color: p.color, alpha: a * 0.08 } );
		} else if ( TOKEN_KIND === 'data' ) {
			g.rect( x - s * 0.5, y - s * 0.5, s, s ).fill( { color: p.color, alpha: a * 0.48 } );
			g.circle( x, y, s * 0.18 ).fill( { color: 0xffffff, alpha: a * 0.5 } );
		} else if ( TOKEN_KIND === 'steam' ) {
			g.ellipse( x, y, s * 0.82, s * 1.5 ).fill( { color: p.color, alpha: a * 0.18 } );
		} else if ( TOKEN_KIND === 'crane' ) {
			g.poly( [ x - s, y, x, y - s * 0.46, x + s, y, x, y + s * 0.24 ] ).fill( { color: p.color, alpha: a * 0.5 } );
			g.moveTo( x, y - s * 0.42 ).lineTo( x + s * 0.68, y - s * 0.78 ).stroke( { color: p.color, alpha: a * 0.6, width: 1 } );
		} else if ( TOKEN_KIND === 'storm' ) {
			g.circle( x - s * 0.35, y, s * 0.42 ).fill( { color: p.color, alpha: a * 0.32 } );
			g.circle( x + s * 0.16, y - s * 0.14, s * 0.52 ).fill( { color: p.color, alpha: a * 0.32 } );
			g.moveTo( x, y + s * 0.4 ).lineTo( x - s * 0.2, y + s ).lineTo( x + s * 0.32, y + s * 0.72 ).stroke( { color: 0xffe36b, alpha: a * 0.6, width: 1.4 } );
		} else if ( TOKEN_KIND === 'fossil' ) {
			g.ellipse( x, y, s * 0.9, s * 0.5 ).stroke( { color: p.color, alpha: a, width: 1.2 } );
			g.moveTo( x - s * 0.65, y ).lineTo( x + s * 0.65, y ).stroke( { color: p.color, alpha: a * 0.55, width: 1 } );
		} else {
			g.circle( x, y, s * 0.5 ).fill( { color: p.color, alpha: a } );
		}
	}

	function drawAccent( g, state, env ) {
		var app = env.app;
		var w = app.renderer.width;
		var hh = app.renderer.height;
		if ( state.accent <= 0 ) {
			g.clear();
			return;
		}
		var x = w * 0.68;
		var y = hh * 0.34;
		var a = state.accent;
		g.clear()
			.circle( x, y, 42 + ( 1 - a ) * 80 )
			.stroke( { color: ACCENT, alpha: a * 0.24, width: 2 } )
			.circle( x, y, 7 + ( 1 - a ) * 16 )
			.fill( { color: ACCENT, alpha: a * 0.12 } );
	}

	window.__odd.scenes[ SLUG ] = {
		setup: async function ( env ) {
			var PIXI = env.PIXI;
			var app = env.app;
			var tex = await PIXI.Assets.load( backdropUrl() );
			var backdrop = new PIXI.Sprite( tex );
			app.stage.addChild( backdrop );
			fitBackdrop( app, tex, backdrop );

			var ambientLayer = new PIXI.Graphics();
			var tokenLayer = new PIXI.Graphics();
			var accentLayer = new PIXI.Graphics();
			app.stage.addChild( ambientLayer );
			app.stage.addChild( tokenLayer );
			app.stage.addChild( accentLayer );

			var w = app.renderer.width;
			var hh = app.renderer.height;
			var motes = [];
			var tokens = [];
			for ( var i = 0; i < MOTE_COUNT; i++ ) motes.push( spawnMote( w, hh ) );
			for ( var j = 0; j < TOKEN_COUNT; j++ ) tokens.push( spawnToken( w, hh, false ) );

			return {
				backdrop: backdrop,
				tex: tex,
				ambientLayer: ambientLayer,
				tokenLayer: tokenLayer,
				accentLayer: accentLayer,
				motes: motes,
				tokens: tokens,
				time: 0,
				accent: 0,
				nextAccent: rand( 8, 18 ),
			};
		},

		onResize: function ( state, env ) {
			fitBackdrop( env.app, state.tex, state.backdrop );
		},

		tick: function ( state, env ) {
			var app = env.app;
			var dt = env.dt;
			var w = app.renderer.width;
			var hh = app.renderer.height;
			var perfLow = env.perfTier === 'low';
			var audio = ( env.audio && env.audio.enabled ) ? env.audio : null;
			var speed = env.reducedMotion ? 0 : 1 + ( audio ? audio.bass * 0.55 : 0 );
			var px = env.parallax ? env.parallax.x : 0;
			var py = env.parallax ? env.parallax.y : 0;
			state.time += dt / 60;

			var moteTarget = perfLow ? MOTE_LOW : MOTE_COUNT;
			while ( state.motes.length > moteTarget ) state.motes.pop();
			while ( state.motes.length < moteTarget ) state.motes.push( spawnMote( w, hh ) );

			var tokenTarget = perfLow ? TOKEN_LOW : TOKEN_COUNT;
			while ( state.tokens.length > tokenTarget ) state.tokens.pop();
			while ( state.tokens.length < tokenTarget ) state.tokens.push( spawnToken( w, hh, true ) );

			state.ambientLayer.clear();
			for ( var i = 0; i < state.motes.length; i++ ) {
				var m = state.motes[ i ];
				m.phase += m.phaseSpeed * dt * Math.max( speed, 0.18 );
				m.x += m.vx * dt * speed;
				m.y += ( m.vy * dt * speed ) + Math.sin( m.phase ) * 0.08;
				if ( m.x < -40 ) m.x = w + 40;
				if ( m.x > w + 40 ) m.x = -40;
				if ( m.y < -40 ) m.y = hh + 40;
				if ( m.y > hh + 40 ) m.y = -40;
				var mx = m.x + px * 8;
				var my = m.y + py * 5;
				drawMote( state.ambientLayer, m, mx, my, state.time, perfLow );
			}

			state.tokenLayer.clear();
			for ( var j = 0; j < state.tokens.length; j++ ) {
				var p = state.tokens[ j ];
				p.phase += p.phaseSpeed * dt * Math.max( speed, 0.18 );
				p.rot += p.spin * dt * speed;
				p.x += p.vx * dt * speed;
				p.y += p.vy * dt * speed + Math.sin( p.phase ) * 0.12;
				if ( p.x < -120 || inIconZone( p.x, p.y, w, hh ) ) {
					var next = spawnToken( w, hh, true );
					p.x = next.x;
					p.y = next.y;
					p.size = next.size;
					p.color = next.color;
					p.alpha = next.alpha;
				}
				drawToken( state.tokenLayer, p, p.x + px * 16, p.y + py * 9, state.time );
			}

			if ( ! env.reducedMotion && ! perfLow ) {
				state.nextAccent -= dt / 60;
				if ( state.nextAccent <= 0 ) {
					state.accent = 1;
					state.nextAccent = rand( 10, 22 );
				}
			}
			if ( audio && audio.high > 0.62 ) state.accent = Math.max( state.accent, 0.55 );
			state.accent = Math.max( 0, state.accent - dt * 0.018 );
			drawAccent( state.accentLayer, state, env );
		},

		onAudio: function ( state, env ) {
			if ( ! env.audio || ! env.audio.enabled ) return;
			if ( env.audio.high > 0.66 ) state.accent = Math.max( state.accent, 0.75 );
		},

		onRipple: function ( opts, state ) {
			var intensity = ( opts && opts.intensity ) || 0.5;
			state.accent = Math.min( 1, state.accent + intensity * 0.45 );
		},

		stillFrame: function ( state, env ) {
			var saveDt = env.dt;
			var saveReduced = env.reducedMotion;
			env.dt = 1;
			env.reducedMotion = false;
			for ( var i = 0; i < 80; i++ ) this.tick( state, env );
			env.reducedMotion = saveReduced;
			env.dt = saveDt;
		},

		cleanup: function ( state ) {
			state.motes = [];
			state.tokens = [];
		},
	};
} )();
