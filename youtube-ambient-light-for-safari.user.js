// ==UserScript==
// @name         YouTube Ambient Light For Safari
// @namespace    https://github.com/neul-lov/youtube-ambient-light-for-safari
// @version      2.6.0
// @description  Ambient light (ambilight) for YouTube in Safari: the colors of the video glow around the player.
// @author       neul-lov
// @license      MIT
// @homepageURL  https://github.com/neul-lov/youtube-ambient-light-for-safari
// @supportURL   https://github.com/neul-lov/youtube-ambient-light-for-safari/issues
// @updateURL    https://raw.githubusercontent.com/neul-lov/youtube-ambient-light-for-safari/main/youtube-ambient-light-for-safari.user.js
// @downloadURL  https://raw.githubusercontent.com/neul-lov/youtube-ambient-light-for-safari/main/youtube-ambient-light-for-safari.user.js
// @match        https://www.youtube.com/*
// @run-at       document-end
// @noframes
// @grant        none
// @inject-into  content
// ==/UserScript==

(function () {
  "use strict";

  // The ring projection, spread fade and default values are adapted from
  // "Ambient light for YouTube" by Wessel Kroos (MIT): https://github.com/WesselKroos/youtube-ambilight

  if (window.__amblLoaded) return;
  window.__amblLoaded = true;

  // ───────────────────────── Settings ─────────────────────────
  // Defaults match the original extension, except Spread, which is wider here.
  const STORE_KEY = "ambl-settings-v3";
  const DEFAULTS = {
    enabled: true,
    blur: 30, // "Blur"
    edge: 12, // "Edge size": how much of the video edge is projected per ring
    spread: 100, // "Spread" (the original extension defaults to 17)
    fadeStart: 15, // "Spread fade start"
    fadeCurve: 35, // "Spread fade curve"
    brightness: 100,
    contrast: 100,
    saturation: 100,
    smoothing: 0, // "Smooth motion" (frame blending), off by default
    fps: 30,
    barDetection: false, // remove black bars (letterboxing) from the glow
    forceDark: true, // switch YouTube to the dark theme on watch pages
    headerTransparent: true, // transparent header while scrolled to the top
    searchClear: true, // let the glow show through the search bar (restored on hover)
    readability: 60, // text/icon halos, darker translucent boxes, dimmed header glow (0 = off)
    webgl: true,
  };

  let S = loadSettings();

  function loadSettings() {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) return Object.assign({}, DEFAULTS, JSON.parse(saved));
      // Migrate v2 settings but drop the old (narrow) spread value
      const old = JSON.parse(localStorage.getItem("ambl-settings-v2") || "{}");
      delete old.spread;
      return Object.assign({}, DEFAULTS, old);
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(S));
    } catch (e) {}
  }

  // ───────────────────────── Styles ─────────────────────────
  // YouTube enforces Trusted Types, so only textContent / DOM APIs are used (no innerHTML).
  const style = document.createElement("style");
  style.id = "ambl-style";
  style.textContent = `
    /* The glow lives in a page-sized container and is positioned in document coordinates,
       so it scrolls with the page on the compositor without any JavaScript per scroll frame. */
    html.ambl-on #content.ytd-app { position: relative; z-index: 0; }
    #ambl-root {
      position: absolute; left: 0; top: 0; z-index: -1;
      width: 100%; height: 100%; min-height: 100vh;
      overflow: hidden; pointer-events: none; user-select: none;
      contain: strict;
    }
    /* The canvas stays tiny; it is only scaled up with a CSS transform. */
    #ambl-root canvas {
      position: absolute; left: 0; top: 0; display: block;
      transform-origin: 0 0; -webkit-transform-origin: 0 0;
      opacity: 0; transition: opacity .4s ease;
      will-change: transform;
    }
    #ambl-root.ambl-ready canvas { opacity: 1; }

    /* Page background: pure black in the dark theme */
    html.ambl-on[dark], html.ambl-on[dark] body, html.ambl-on[dark] ytd-app { background: #000 !important; }
    html.ambl-on:not([dark]), html.ambl-on:not([dark]) body, html.ambl-on:not([dark]) ytd-app { background: #fff !important; }

    /* Remove the backgrounds around the player */
    html.ambl-on ytd-watch-flexy #player-theater-container,
    html.ambl-on ytd-watch-flexy #player-wide-container,
    html.ambl-on ytd-watch-flexy #full-bleed-container,
    html.ambl-on ytd-watch-flexy #player-full-bleed-container,
    html.ambl-on ytd-watch-flexy #player,
    html.ambl-on ytd-watch-flexy #player-container,
    html.ambl-on ytd-watch-flexy #ytd-player,
    html.ambl-on ytd-watch-flexy ytd-player #container,
    html.ambl-on ytd-watch-flexy .html5-video-player,
    html.ambl-on ytd-watch-flexy .html5-main-video {
      background: none !important;
    }
    html.ambl-on ytd-watch-flexy #cinematics,
    html.ambl-on ytd-watch-flexy #cinematics-container,
    html.ambl-on #cinematics-full-bleed-container,
    html.ambl-on #frosted-glass {
      display: none !important;
    }

    /* Header: transparent while at the top, opaque once scrolled.
       The "at top" flag lives on <html> (ambl-top) because YouTube re-renders the header. */
    html.ambl-on.ambl-header-clear.ambl-top ytd-masthead,
    html.ambl-on.ambl-header-clear.ambl-top #background.ytd-masthead {
      background: none !important;
    }
    html.ambl-on.ambl-header-clear.ambl-top #voice-search-button { background: transparent !important; }
    html.ambl-on #masthead-container.ytd-app::after { display: none !important; }
    /* YouTube sometimes paints the header background on other layers. The script marks any
       header-wide layer that has a background with data-ambl-hdr, and clears it at the top. */
    html.ambl-on #masthead-container [data-ambl-hdr],
    html.ambl-on #masthead-container[data-ambl-hdr] {
      transition: background-color .3s ease !important;
    }
    html.ambl-on.ambl-header-clear.ambl-top #masthead-container [data-ambl-hdr],
    html.ambl-on.ambl-header-clear.ambl-top #masthead-container[data-ambl-hdr] {
      background-color: transparent !important;
      background-image: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    /* YouTube's frosted header (blur 48px) would be re-blurred every frame over the moving glow */
    html.ambl-on #background.ytd-masthead { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
    html.ambl-on[dark]:not(.ambl-top) ytd-masthead,
    html.ambl-on[dark]:not(.ambl-header-clear) ytd-masthead { background: rgb(15,15,15) !important; }
    html.ambl-on:not([dark]):not(.ambl-top) ytd-masthead,
    html.ambl-on:not([dark]):not(.ambl-header-clear) ytd-masthead { background: #fff !important; }

    /* Search bar: the script marks every element with a background (data-ambl-clear), so this
       works with whichever search bar design YouTube serves. At rest the glow shows through;
       on hover or while typing the original colors fade back in. */
    html.ambl-on #masthead-container [data-ambl-clear] {
      transition: background-color .6s ease, border-color .6s ease, box-shadow .6s ease !important;
    }
    /* The suggestion list must be readable immediately, so it skips the transition */
    html.ambl-on #masthead-container :is(yt-searchbox, ytd-searchbox):focus-within [data-ambl-clear][class*="Suggestion"] {
      transition: none !important;
    }
    html.ambl-on.ambl-search-clear #masthead-container :is(yt-searchbox, ytd-searchbox, #voice-search-button):not(:hover):not(:focus-within) [data-ambl-clear],
    html.ambl-on.ambl-search-clear #masthead-container :is(yt-searchbox, ytd-searchbox, #voice-search-button)[data-ambl-clear]:not(:hover):not(:focus-within) {
      background-color: var(--ambl-search-bg, transparent) !important;
      box-shadow: none !important;
    }
    html.ambl-on.ambl-search-clear[dark] #masthead-container :is(yt-searchbox, ytd-searchbox, #voice-search-button):not(:hover):not(:focus-within) [data-ambl-clear],
    html.ambl-on.ambl-search-clear[dark] #masthead-container :is(yt-searchbox, ytd-searchbox, #voice-search-button)[data-ambl-clear]:not(:hover):not(:focus-within) {
      border-color: rgba(255,255,255,.18) !important;
    }
    html.ambl-on.ambl-search-clear:not([dark]) #masthead-container :is(yt-searchbox, ytd-searchbox, #voice-search-button):not(:hover):not(:focus-within) [data-ambl-clear],
    html.ambl-on.ambl-search-clear:not([dark]) #masthead-container :is(yt-searchbox, ytd-searchbox, #voice-search-button)[data-ambl-clear]:not(:hover):not(:focus-within) {
      border-color: rgba(0,0,0,.15) !important;
    }

    /* ── Readability boost ──
       Bright glows wash out white text and icons. The --ambl-* values below are computed
       by the script from the "Readability boost" setting. */

    /* Buttons, description, chips and playlist boxes: dark translucent (glow still shows) */
    html.ambl-on ytd-watch-flexy #primary #description.ytd-watch-metadata,
    html.ambl-on ytd-watch-flexy :is(#below, #secondary, #panels) :is([class*="yt-spec-button-shape-next--tonal"], [class*="ytSpecButtonShapeNextTonal"]):not(:hover):not(:focus),
    html.ambl-on ytd-watch-flexy yt-chip-cloud-chip-renderer:not([selected]) .ytChipShapeChip,
    html.ambl-on ytd-watch-flexy ytd-engagement-panel-section-list-renderer,
    html.ambl-on ytd-watch-flexy .header.ytd-playlist-panel-renderer,
    html.ambl-on ytd-watch-flexy ytd-playlist-panel-video-renderer:is([selected], :hover:not(.dragging)),
    html.ambl-on.ambl-header-clear.ambl-top #masthead-container :is([class*="yt-spec-button-shape-next--tonal"], [class*="ytSpecButtonShapeNextTonal"]):not(:hover):not(:focus) {
      background: var(--ambl-box) !important;
    }
    html.ambl-on ytd-watch-flexy yt-chip-cloud-renderer,
    html.ambl-on ytd-watch-flexy ytd-playlist-panel-renderer:not([within-miniplayer])
      :is(#container.ytd-playlist-panel-renderer, #items.ytd-playlist-panel-renderer, .playlist-items.ytd-playlist-panel-renderer),
    html.ambl-on ytd-watch-flexy ytd-live-chat-frame {
      background: none !important;
    }

    /* Text: a dark halo. text-shadow is inherited, so it is set on large containers, plus on
       buttons and inputs where the browser's default style turns it off */
    html.ambl-on.ambl-read ytd-watch-flexy :is(#below, #secondary, #panels, #playlist, #chat-container),
    html.ambl-on.ambl-read ytd-watch-flexy :is(#below, #secondary, #panels, #playlist) :is(button, input, textarea),
    html.ambl-on.ambl-read #masthead-container,
    html.ambl-on.ambl-read #masthead-container :is(button, input) {
      text-shadow: var(--ambl-text-shadow) !important;
    }
    /* Icons: the same halo as a drop-shadow */
    html.ambl-on.ambl-read ytd-watch-flexy :is(#below, #secondary, #panels, #playlist) yt-icon,
    html.ambl-on.ambl-read #masthead-container yt-icon {
      filter: var(--ambl-icon-filter) !important;
    }
    /* Brighter secondary text (subscriber count, views, channel names, hashtags...).
       YouTube sets these colors through obfuscated variables, so the elements are targeted directly. */
    html.ambl-on.ambl-read[dark] ytd-watch-flexy :is(#below, #secondary, #panels, #playlist)
      :is(#owner-sub-count, #metadata-line, #byline-container, #channel-name, #video-info, #text.ytd-metadata-line-renderer,
          ytd-video-meta-block, ytd-watch-info-text, #info.ytd-watch-info-text, #publisher-container,
          [class*="etadataText"], [class*="etadata-text"], [class*="etadataRow"], [class*="etadata-row"]) {
      color: rgba(255,255,255,.88) !important;
    }
    html.ambl-on.ambl-read:not([dark]) ytd-watch-flexy :is(#below, #secondary, #panels, #playlist)
      :is(#owner-sub-count, #metadata-line, #byline-container, #channel-name, #video-info, #text.ytd-metadata-line-renderer,
          ytd-video-meta-block, ytd-watch-info-text, #info.ytd-watch-info-text, #publisher-container,
          [class*="etadataText"], [class*="etadata-text"], [class*="etadataRow"], [class*="etadata-row"]) {
      color: rgba(0,0,0,.82) !important;
    }
    html.ambl-on.ambl-read[dark] #masthead-container #country-code { color: rgba(255,255,255,.75) !important; }
    html.ambl-on.ambl-read[dark] #masthead-container input::placeholder { color: rgba(255,255,255,.8) !important; }
    html.ambl-on.ambl-read[dark] #masthead-container input::-webkit-input-placeholder { color: rgba(255,255,255,.8) !important; }
    html.ambl-on.ambl-read:not([dark]) #masthead-container input::placeholder { color: rgba(0,0,0,.7) !important; }
    html.ambl-on.ambl-read:not([dark]) #masthead-container input::-webkit-input-placeholder { color: rgba(0,0,0,.7) !important; }
    /* Header at the top: dim the glow behind it a little */
    html.ambl-on.ambl-read.ambl-header-clear.ambl-top #masthead-container::before {
      content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none;
      background: linear-gradient(to bottom, var(--ambl-head-dim), transparent);
    }

    #ambl-btn { display: inline-flex !important; align-items: center; justify-content: center; }
    #ambl-btn svg { width: 24px; height: 24px; }
    #ambl-btn.ambl-off svg { opacity: .45; }

    #ambl-panel {
      position: absolute; right: 12px; bottom: 60px; z-index: 80;
      width: 280px; box-sizing: border-box; padding: 12px 14px;
      max-height: calc(100% - 72px); overflow-y: auto; overscroll-behavior: contain;
      background: rgba(28, 28, 28, .95);
      border-radius: 12px; color: #fff;
      font: 13px/1.4 "YouTube Sans", Roboto, -apple-system, sans-serif;
      display: none; text-align: left; cursor: default;
    }
    #ambl-panel.ambl-open { display: block; }
    #ambl-panel .ambl-title { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
    #ambl-panel .ambl-section { margin: 12px 0 2px; font-size: 11px; letter-spacing: .04em; opacity: .55; }
    #ambl-panel .ambl-row { margin: 6px 0; }
    #ambl-panel .ambl-label { display: flex; justify-content: space-between; opacity: .9; }
    #ambl-panel input[type=range] { width: 100%; margin: 3px 0 0; accent-color: #f00; }
    #ambl-panel .ambl-check { display: flex; align-items: center; gap: 8px; margin: 6px 0; cursor: pointer; }
    #ambl-panel .ambl-check input { margin: 0; accent-color: #f00; }
    #ambl-panel .ambl-reset {
      margin-top: 8px; background: rgba(255,255,255,.12); color: #fff; border: 0;
      border-radius: 8px; padding: 6px 10px; font: inherit; cursor: pointer;
    }
    #ambl-panel .ambl-reset:hover { background: rgba(255,255,255,.2); }
    #ambl-panel .ambl-hint { opacity: .55; font-size: 11px; margin-top: 6px; }
  `;
  (document.head || document.documentElement).appendChild(style);

  // ───────────────────────── State ─────────────────────────
  const root = document.documentElement;
  const DET_W = 64; // resolution used for black bar detection
  const DET_H = 36;
  let video = null;
  let content = null;
  let player = null;
  let box = null; // #ambl-root
  let renderer = null;
  let geo = null;
  let lastRect = "";
  let running = false;
  let frameReq = 0;
  let usingRVFC = false;
  let lastDraw = 0;
  let lastDetect = 0;
  let needFull = true;
  let drawing = false;
  let redrawQueued = false;
  let costAvg = 0;
  let crop = { t: 0, b: 0, l: 0, r: 0 };
  let resizeObs = null;
  let styleObs = null;
  let viewObs = null;
  let inView = true;
  let forcedDark = false;

  const VIDEO_EVENTS = {
    play: () => restartLoop(),
    seeked: () => {
      needFull = true;
      drawNow();
    },
    loadeddata: () => {
      needFull = true;
      resetCrop();
      drawNow();
    },
    emptied: () => {
      needFull = true;
      resetCrop();
    },
    resize: () => layout(),
  };

  // ───────────────────────── Renderer: WebGL ─────────────────────────
  // 1) video -> small buffer (cropped, downscaled in two steps for large videos, optional frame blending)
  // 2) "edge ring" projection + spread fade, as in the original extension
  // 3) separable Gaussian blur + brightness / contrast / saturation
  // Everything stays on the GPU, so 4K frames are never copied to the CPU.
  const VS = "attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}";

  const FS_SAMPLE = `precision highp float;
    varying vec2 uv;
    uniform sampler2D tex;
    uniform vec4 src; // source rect (x, y, w, h), y pointing down
    uniform vec2 tap; // sample spacing
    uniform float flip; // 1: flip video rows (top = 0) into GL orientation
    void main() {
      vec2 c = vec2(uv.x, mix(uv.y, 1.0 - uv.y, flip));
      vec2 b = src.xy + c * src.zw;
      vec2 lo = src.xy, hi = src.xy + src.zw;
      vec3 sum = vec3(0.0);
      for (int i = 0; i < 4; i++)
        for (int j = 0; j < 4; j++)
          sum += texture2D(tex, clamp(b + (vec2(float(i), float(j)) - 1.5) * tap, lo, hi)).rgb;
      gl_FragColor = vec4(sum / 16.0, 1.0);
    }`;

  // Port of multiTexture() from the original projector-webgl.js and the fade from projector-shadow.js
  const FS_PROJECT = `precision highp float;
    varying vec2 uv;
    uniform sampler2D tex;
    uniform vec4 area;    // projected area (video + margin) inside the canvas
    uniform vec2 scale;   // scale of the outermost ring
    uniform vec2 stp;     // scale increase per ring
    uniform float maxRing;
    uniform vec2 marg;    // margin size inside the projected area
    uniform vec2 fade;    // x: fade start, y: curve exponent
    float vis(float d, float m) {
      if (m <= 0.0) return d <= 0.0 ? 1.0 : 0.0;
      float u = clamp((1.0 - d / m) / (1.0 - fade.x), 0.0, 1.0);
      return 1.0 - pow(1.0 - u, fade.y);
    }
    void main() {
      vec2 f = (uv - area.xy) / area.zw;
      if (f.x < 0.0 || f.y < 0.0 || f.x > 1.0 || f.y > 1.0) { gl_FragColor = vec4(0.0); return; }
      vec2 dir = ceil(f * 2.0) - 1.0;
      vec2 iuv = ((dir - f) * scale) / ((dir - 0.5) * stp);
      float i = min(floor(min(iuv.x, iuv.y)), maxRing);
      vec2 s = (f - 0.5) * (scale / max(scale - stp * i, vec2(0.05))) + 0.5;
      vec3 c = texture2D(tex, s).rgb;
      vec2 d = max(marg - f, f - (1.0 - marg));
      float a = vis(d.x, marg.x) * vis(d.y, marg.y);
      gl_FragColor = vec4(c * a, a);
    }`;

  const BLUR_BODY = `
    vec4 sum = vec4(0.0); float ws = 0.0;
    for (int i = -12; i <= 12; i++) {
      float x = float(i);
      float w = exp(-0.5 * x * x / (sigma * sigma));
      sum += texture2D(tex, uv + dir * x) * w; ws += w;
    }
    sum /= ws;`;

  const FS_BLUR = `precision highp float;
    varying vec2 uv;
    uniform sampler2D tex;
    uniform vec2 dir;
    uniform float sigma;
    void main() {${BLUR_BODY}
      gl_FragColor = sum;
    }`;

  const FS_FINAL = `precision highp float;
    varying vec2 uv;
    uniform sampler2D tex;
    uniform vec2 dir;
    uniform float sigma;
    uniform vec3 adj; // brightness, contrast, saturation
    void main() {${BLUR_BODY}
      float a = sum.a;
      vec3 c = a > 0.0001 ? sum.rgb / a : vec3(0.0);
      c = (c - 0.5) * adj.y + 0.5;
      c *= adj.x;
      c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, adj.z);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0) * a, a);
    }`;

  function createGLRenderer() {
    const canvas = document.createElement("canvas");
    const opts = {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    };
    let gl = canvas.getContext("webgl2", opts);
    const isGL2 = !!gl;
    if (!gl) gl = canvas.getContext("webgl", opts);
    if (!gl) return null;

    let progs = null;
    let vtex = null;
    let mid = null; // intermediate buffer for the two-step downscale of large videos
    let src = null; // downscaled video + frame blending
    let proj = null;
    let tmp = null;
    let det = null;
    let floatOK = false;
    let srcFloat = false;
    let sw = 0, sh = 0, mw = 0, mh = 0, bw = 0, bh = 0;
    let lost = false;
    const detBuf = new Uint8Array(DET_W * DET_H * 4);

    function makeTex() {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    function makeTarget(w, h, useFloat) {
      const tex = makeTex();
      if (useFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) {
        gl.deleteFramebuffer(fb);
        gl.deleteTexture(tex);
        return null;
      }
      return { tex, fb };
    }

    function freeTarget(t) {
      if (!t) return;
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    }

    function program(fs) {
      const shader = (type, text) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, text);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, "p");
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const name = gl.getActiveUniform(p, i).name;
        u[name] = gl.getUniformLocation(p, name);
      }
      return { p, u };
    }

    function init() {
      progs = {
        sample: program(FS_SAMPLE),
        project: program(FS_PROJECT),
        blur: program(FS_BLUR),
        final: program(FS_FINAL),
      };
      const vbuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      vtex = makeTex();
      // Half-float buffer: small blend steps do not get stuck short of the target color
      floatOK = isGL2 && !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
      det = makeTarget(DET_W, DET_H, false);
      mid = src = proj = tmp = null;
      sw = sh = mw = mh = bw = bh = 0;
    }

    function run(prog, target, w, h, tex, uniforms) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(prog.u.tex, 0);
      for (const k in uniforms) {
        const loc = prog.u[k];
        if (!loc) continue;
        const v = uniforms[k];
        if (typeof v === "number") gl.uniform1f(loc, v);
        else if (v.length === 2) gl.uniform2fv(loc, v);
        else if (v.length === 3) gl.uniform3fv(loc, v);
        else gl.uniform4fv(loc, v);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      lost = true;
    });
    canvas.addEventListener("webglcontextrestored", () => {
      lost = false;
      init();
      geo = null;
      lastRect = "";
      layout();
      needFull = true;
      queueRedraw();
    });

    init();

    return {
      kind: isGL2 ? "WebGL2" : "WebGL",
      canvas,
      cssFilter: false,

      setGeometry(g) {
        if (lost) return false;
        let resized = false;
        if (g.sw !== sw || g.sh !== sh || !src) {
          sw = g.sw;
          sh = g.sh;
          freeTarget(src);
          src = floatOK ? makeTarget(sw, sh, true) : null;
          srcFloat = !!src;
          if (!src) src = makeTarget(sw, sh, false);
          resized = true;
        }
        if (g.mw !== mw || g.mh !== mh) {
          mw = g.mw;
          mh = g.mh;
          freeTarget(mid);
          mid = mw ? makeTarget(mw, mh, false) : null;
        }
        if (g.bw !== bw || g.bh !== bh || !proj) {
          bw = g.bw;
          bh = g.bh;
          canvas.width = bw;
          canvas.height = bh;
          freeTarget(proj);
          freeTarget(tmp);
          proj = makeTarget(bw, bh, false);
          tmp = makeTarget(bw, bh, false);
          resized = true;
        }
        return resized;
      },

      upload(v) {
        if (lost || !src || gl.isContextLost()) return false;
        gl.bindTexture(gl.TEXTURE_2D, vtex);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
        } catch (e) {
          return false;
        }
        return true;
      },

      detect() {
        if (!det) return null;
        run(progs.sample, det, DET_W, DET_H, vtex, {
          src: [0, 0, 1, 1],
          tap: [1 / DET_W / 4, 1 / DET_H / 4],
          flip: 1,
        });
        gl.readPixels(0, 0, DET_W, DET_H, gl.RGBA, gl.UNSIGNED_BYTE, detBuf);
        return { data: detBuf, flipY: true };
      },

      accumulate(a) {
        const c = [crop.l, crop.t, 1 - crop.l - crop.r, 1 - crop.t - crop.b];
        let tex = vtex;
        let rect = c;
        let flip = 1;
        let tw = sw;
        let th = sh;
        if (mid) {
          run(progs.sample, mid, mw, mh, vtex, { src: c, tap: [c[2] / mw / 4, c[3] / mh / 4], flip: 1 });
          tex = mid.tex;
          rect = [0, 0, 1, 1];
          flip = 0;
        }
        if (a < 1) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
          gl.blendColor(0, 0, 0, srcFloat ? a : Math.max(a, 0.06));
        }
        run(progs.sample, src, tw, th, tex, { src: rect, tap: [rect[2] / tw / 4, rect[3] / th / 4], flip });
        gl.disable(gl.BLEND);
      },

      post() {
        if (lost || !src || !proj || !tmp || !geo) return;
        run(progs.project, proj, bw, bh, src.tex, {
          area: geo.area,
          scale: geo.scale,
          stp: geo.step,
          maxRing: geo.maxRing,
          marg: geo.marg,
          fade: geo.fade,
        });
        // Space the 25 taps so they cover ±3σ
        const s = Math.max(0.5, geo.sigma);
        const step = Math.max(1, s / 4);
        const sigma = s / step;
        run(progs.blur, tmp, bw, bh, proj.tex, { dir: [step / bw, 0], sigma });
        run(progs.final, null, bw, bh, tmp.tex, {
          dir: [0, step / bh],
          sigma,
          adj: [S.brightness / 100, S.contrast / 100, S.saturation / 100],
        });
      },

      destroy() {
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
        canvas.remove();
      },
    };
  }

  // ───────────────────────── Renderer: Canvas2D (fallback) ─────────────────────────
  // Without WebGL: stretch the video over the margin and apply a CSS blur at the small size
  function create2DRenderer() {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    const dc = document.createElement("canvas");
    dc.width = DET_W;
    dc.height = DET_H;
    const dctx = dc.getContext("2d", { willReadFrequently: true });

    return {
      kind: "Canvas2D",
      canvas,
      cssFilter: true,

      setGeometry(g) {
        if (canvas.width === g.bw && canvas.height === g.bh) return false;
        canvas.width = g.bw;
        canvas.height = g.bh;
        return true;
      },

      upload(v) {
        return !!v;
      },

      detect() {
        try {
          dctx.drawImage(video, 0, 0, DET_W, DET_H);
          return { data: dctx.getImageData(0, 0, DET_W, DET_H).data, flipY: false };
        } catch (e) {
          return null;
        }
      },

      accumulate(a) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        ctx.globalAlpha = a < 1 ? Math.max(a, 0.06) : 1;
        try {
          ctx.drawImage(
            video,
            vw * crop.l,
            vh * crop.t,
            vw * (1 - crop.l - crop.r),
            vh * (1 - crop.t - crop.b),
            0,
            0,
            canvas.width,
            canvas.height
          );
        } catch (e) {}
        ctx.globalAlpha = 1;
      },

      post() {},

      destroy() {
        canvas.remove();
      },
    };
  }

  function createRenderer() {
    if (S.webgl) {
      try {
        const r = createGLRenderer();
        if (r) return r;
      } catch (e) {
        console.warn("[Ambient Light] WebGL is unavailable, falling back to Canvas2D.", e);
      }
    }
    return create2DRenderer();
  }

  function rebuildRenderer() {
    if (renderer) renderer.destroy();
    renderer = null;
    geo = null;
    lastRect = "";
    if (!box) return;
    renderer = createRenderer();
    box.appendChild(renderer.canvas);
    updateStatus();
    needFull = true;
    layout();
    drawNow();
  }

  // ───────────────────────── Attach / detach ─────────────────────────
  function isWatchPage() {
    const p = location.pathname;
    return p === "/watch" || p.startsWith("/live/");
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function findTargets() {
    const flexy = document.querySelector("ytd-watch-flexy:not([hidden])");
    const c = document.querySelector("#content.ytd-app");
    if (!flexy || !c) return null;
    const p = flexy.querySelector("#movie_player");
    const v = p && p.querySelector("video.html5-main-video");
    if (!v) return null;
    return { content: c, player: p, video: v };
  }

  function ensure() {
    const t = S.enabled && isWatchPage() && !isFullscreen() ? findTargets() : null;
    ensureButton(t ? t.player : document.querySelector("ytd-watch-flexy:not([hidden]) #movie_player"));

    if (!t) {
      deactivate();
      return;
    }

    player = t.player;
    if (t.video !== video) bindVideo(t.video);
    if (!box || box.parentElement !== t.content) attach(t.content);

    root.classList.add("ambl-on");
    root.classList.toggle("ambl-header-clear", !!S.headerTransparent);
    root.classList.toggle("ambl-search-clear", !!S.searchClear);
    applyReadability();
    if (S.headerTransparent) markHeader();
    if (S.searchClear) markSearchbox();
    applyTheme();
    updateAtTop();

    // Also re-check the position, in case the player moved without resizing (banners etc.)
    layout();

    // Watchdog for requestVideoFrameCallback occasionally stalling (e.g. Safari tab switches)
    if (!video.paused && !document.hidden && inView && performance.now() - lastDraw > 1500) restartLoop();
  }

  function attach(c) {
    content = c;
    if (!box) {
      box = document.createElement("div");
      box.id = "ambl-root";
    }
    c.insertBefore(box, c.firstChild);

    if (resizeObs) resizeObs.disconnect();
    if (window.ResizeObserver) {
      resizeObs = new ResizeObserver(() => layout());
      resizeObs.observe(video);
    }

    // Stop rendering entirely while the video is far off-screen (e.g. reading comments)
    if (viewObs) viewObs.disconnect();
    inView = true;
    if (window.IntersectionObserver) {
      viewObs = new IntersectionObserver(
        (entries) => {
          const visible = entries[entries.length - 1].isIntersecting;
          if (visible === inView) return;
          inView = visible;
          if (inView) restartLoop();
        },
        { rootMargin: "300px" }
      );
      viewObs.observe(video);
    }

    if (!renderer) {
      renderer = createRenderer();
      updateStatus();
    }
    if (renderer.canvas.parentElement !== box) box.appendChild(renderer.canvas);

    needFull = true;
    geo = null;
    lastRect = "";
    layout();
    drawNow();
    restartLoop();
  }

  function bindVideo(v) {
    unbindVideo();
    video = v;
    for (const [ev, fn] of Object.entries(VIDEO_EVENTS)) video.addEventListener(ev, fn);
    // YouTube resizes the video through its style attribute
    styleObs = new MutationObserver(() => layout());
    styleObs.observe(video, { attributes: true, attributeFilter: ["style"] });
    if (resizeObs) resizeObs.observe(video);
    if (viewObs) viewObs.observe(video);
    needFull = true;
    resetCrop();
  }

  function unbindVideo() {
    if (!video) return;
    stopLoop();
    for (const [ev, fn] of Object.entries(VIDEO_EVENTS)) video.removeEventListener(ev, fn);
    if (styleObs) styleObs.disconnect();
    styleObs = null;
    if (resizeObs) resizeObs.unobserve(video);
    if (viewObs) viewObs.unobserve(video);
    video = null;
  }

  function deactivate() {
    if (!video && !renderer && !root.classList.contains("ambl-on")) return;
    unbindVideo();
    if (resizeObs) resizeObs.disconnect();
    resizeObs = null;
    if (viewObs) viewObs.disconnect();
    viewObs = null;
    // Release GPU memory (video texture etc.)
    if (renderer) renderer.destroy();
    renderer = null;
    geo = null;
    lastRect = "";
    if (box) {
      box.classList.remove("ambl-ready");
      box.remove();
    }
    content = null;
    player = null;
    root.classList.remove("ambl-on", "ambl-header-clear", "ambl-search-clear", "ambl-top");
    clearReadability();
    restoreTheme();
    updateStatus();
  }

  // ───────────────────────── Theme / header ─────────────────────────
  function applyTheme() {
    if (!S.forceDark) {
      restoreTheme();
      return;
    }
    if (!root.hasAttribute("dark")) {
      root.setAttribute("dark", "");
      forcedDark = true;
    }
    if (forcedDark) {
      const m = document.querySelector("ytd-masthead");
      if (m && !m.hasAttribute("dark")) m.setAttribute("dark", "");
    }
  }

  function restoreTheme() {
    if (!forcedDark) return;
    forcedDark = false;
    root.removeAttribute("dark");
    const m = document.querySelector("ytd-masthead");
    if (m) m.removeAttribute("dark");
  }

  // Readability boost: 0 = off; higher values strengthen halos, boxes and the header dim
  const READ_VARS = ["--ambl-text-shadow", "--ambl-icon-filter", "--ambl-box", "--ambl-head-dim", "--ambl-search-bg"];
  let readKey = "";
  function applyReadability() {
    const r = clamp((S.readability || 0) / 100, 0, 1);
    const dark = root.hasAttribute("dark");
    root.classList.toggle("ambl-read", r > 0);
    const key = r + (dark ? "d" : "l");
    if (key === readKey && root.style.getPropertyValue("--ambl-box")) return;
    readKey = key;
    const c = dark ? "0,0,0" : "255,255,255";
    const a = (v) => (v * r).toFixed(2);
    const set = (k, v) => root.style.setProperty(k, v);
    set("--ambl-text-shadow", `0 0 2px rgba(${c},${a(0.9)}), 0 0 6px rgba(${c},${a(0.7)})`);
    set("--ambl-icon-filter", `drop-shadow(0 0 1px rgba(${c},${a(0.85)})) drop-shadow(0 0 4px rgba(${c},${a(0.55)}))`);
    set("--ambl-box", dark ? `rgba(0,0,0,${(0.12 + 0.38 * r).toFixed(2)})` : `rgba(255,255,255,${(0.2 + 0.45 * r).toFixed(2)})`);
    set("--ambl-head-dim", dark ? `rgba(0,0,0,${a(0.45)})` : `rgba(255,255,255,${a(0.5)})`);
    set("--ambl-search-bg", dark ? `rgba(0,0,0,${a(0.4)})` : `rgba(255,255,255,${a(0.45)})`);
  }

  function clearReadability() {
    READ_VARS.forEach((k) => root.style.removeProperty(k));
    readKey = "";
    root.classList.remove("ambl-read");
  }

  function updateAtTop() {
    if (!root.classList.contains("ambl-on")) return;
    const top = window.scrollY < 1;
    if (root.classList.contains("ambl-top") !== top) root.classList.toggle("ambl-top", top);
  }

  // Mark elements with a background color inside the search bar (independent of class names).
  // Marked elements become transparent via CSS; re-rendered ones are picked up within a second.
  function hasFill(color) {
    const m = /rgba?\(([^)]*)\)/.exec(color || "");
    if (!m) return !!color && color !== "transparent";
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length < 4 || parseFloat(parts[3]) > 0;
  }

  // Mark header-wide background layers. Small elements such as buttons and badges are left alone.
  function markHeader() {
    const mh = document.querySelector("#masthead-container");
    if (!mh) return;
    const minW = window.innerWidth * 0.6;
    for (const el of [mh, ...mh.querySelectorAll("*")]) {
      if (el.hasAttribute("data-ambl-hdr")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < minW || r.height < 24) continue;
      const cs = getComputedStyle(el);
      const bf = cs.backdropFilter || cs.webkitBackdropFilter || "none";
      if (hasFill(cs.backgroundColor) || cs.backgroundImage !== "none" || bf !== "none") el.setAttribute("data-ambl-hdr", "");
    }
  }

  function markSearchbox() {
    const mh = document.querySelector("#masthead-container");
    if (!mh) return;
    for (const group of mh.querySelectorAll("yt-searchbox, ytd-searchbox, #voice-search-button")) {
      // While hovered or focused the original colors are showing, so skip this round
      if (group.matches(":hover, :focus-within")) continue;
      for (const el of [group, ...group.querySelectorAll("*")]) {
        if (el.hasAttribute("data-ambl-clear")) continue;
        // Do not skip suggestion containers: some designs wrap the input inside them.
        // (While typing, :focus-within restores the original background immediately.)
        if (hasFill(getComputedStyle(el).backgroundColor)) el.setAttribute("data-ambl-clear", "");
      }
    }
  }

  // ───────────────────────── Layout ─────────────────────────
  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function layout() {
    if (!box || !video || !content || !renderer) return;
    const cr = content.getBoundingClientRect();
    const vr = video.getBoundingClientRect();
    if (vr.width < 20 || vr.height < 20 || !video.videoWidth) return;

    // Anchor the glow layer at the document origin even when #content starts below the header
    // (otherwise the glow is clipped and the header area stays black)
    const offX = Math.round(cr.left + window.scrollX);
    const offY = Math.round(cr.top + window.scrollY);
    const bs = box.style;
    if (bs.left !== -offX + "px" || bs.top !== -offY + "px") {
      bs.left = -offX + "px";
      bs.top = -offY + "px";
      bs.width = "calc(100% + " + offX + "px)";
      bs.height = "calc(100% + " + offY + "px)";
    }

    // Visible picture area without detected black bars (document coordinates, scroll-independent)
    const x = vr.left + window.scrollX + vr.width * crop.l;
    const y = vr.top + window.scrollY + vr.height * crop.t;
    const w = vr.width * (1 - crop.l - crop.r);
    const h = vr.height * (1 - crop.t - crop.b);

    const key = [x, y, w, h, renderer.kind, S.blur, S.edge, S.spread, S.fadeStart, S.fadeCurve, S.brightness, S.contrast, S.saturation]
      .map((n) => (typeof n === "number" ? n.toFixed(1) : n))
      .join(",");
    if (key === lastRect && geo) return;
    lastRect = key;

    // Same math as the original: each ring grows by edge% of the long side; rings = spread / edge
    const L = Math.max(w, h);
    const stepPx = (S.edge / 100) * L;
    const rings = S.spread > 0 ? Math.round(S.spread / S.edge) : 0;
    const margin = (rings * stepPx) / 2;
    const sigma = Math.max(0.5, (S.blur * vr.height * 1.275) / 512); // blur radius of the original
    const pad = renderer.cssFilter ? margin : margin + Math.ceil(3 * sigma);
    const ow = w + 2 * pad;
    const oh = h + 2 * pad;

    // Output resolution: just enough for the blur to span ~2.5 texels (more is wasted work)
    const texel = Math.max(sigma / 2.5, ow / 384, oh / 384, 1);
    const bw = Math.round(clamp(ow / texel, 16, 384));
    const bh = Math.round(clamp(oh / texel, 16, 384));

    // Downscaled video buffer: 128 px on the long side; large videos go through 512 px first (less shimmer)
    const land = w >= h;
    const sw = land ? 128 : Math.max(8, Math.round((128 * w) / h));
    const sh = land ? Math.max(8, Math.round((128 * h) / w)) : 128;
    const vMax = Math.max(video.videoWidth, video.videoHeight);
    const twoStep = vMax > 128 * 8;
    const pw = w + 2 * margin;
    const ph = h + 2 * margin;
    const minF = margin > 0 ? -Math.min(h / 2 / margin, w / 2 / margin) : 0;

    geo = {
      sw,
      sh,
      mw: twoStep ? sw * 4 : 0,
      mh: twoStep ? sh * 4 : 0,
      bw,
      bh,
      sigma: sigma / texel,
      area: [(pad - margin) / ow, (pad - margin) / oh, pw / ow, ph / oh],
      scale: [1 + (rings * stepPx) / w, 1 + (rings * stepPx) / h],
      step: [stepPx / w, stepPx / h],
      maxRing: rings + 2,
      marg: [margin / pw, margin / ph],
      fade: [clamp(S.fadeStart / 100, minF, 0.99), 16 / (S.fadeCurve * 0.64)],
    };

    const cs = renderer.canvas.style;
    cs.width = bw + "px";
    cs.height = bh + "px";
    cs.transform = `translate(${(x - pad).toFixed(1)}px, ${(y - pad).toFixed(1)}px) scale(${(ow / bw).toFixed(4)}, ${(oh / bh).toFixed(4)})`;
    if (renderer.cssFilter) {
      cs.filter = cs.webkitFilter =
        `blur(${(sigma / texel).toFixed(2)}px) contrast(${S.contrast}%) brightness(${S.brightness}%) saturate(${S.saturation}%)`;
    }

    if (renderer.setGeometry(geo)) {
      needFull = true;
      queueRedraw();
    } else if (!drawing) {
      renderer.post(); // apply setting changes immediately, even while paused
    }
  }

  // ───────────────────────── Render loop ─────────────────────────
  function restartLoop() {
    stopLoop();
    if (!video || !renderer) return;
    running = true;
    schedule();
  }

  function stopLoop() {
    running = false;
    if (!frameReq) return;
    if (usingRVFC && video && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameReq);
    else cancelAnimationFrame(frameReq);
    frameReq = 0;
  }

  function schedule() {
    if (!running || !video) return;
    usingRVFC = typeof video.requestVideoFrameCallback === "function";
    frameReq = usingRVFC ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
  }

  function tick(now) {
    frameReq = 0;
    if (!running) return;
    // Stop the loop while off-screen or hidden (it restarts when visible again)
    if (!inView || document.hidden) {
      running = false;
      return;
    }
    // If drawing gets expensive, back off so the main thread stays under ~10% usage
    const interval = Math.max(1000 / S.fps, costAvg * 10);
    if (now - lastDraw >= interval - 2) drawFrame(now);
    schedule();
  }

  function queueRedraw() {
    if (redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(() => {
      redrawQueued = false;
      drawNow();
    });
  }

  function drawNow() {
    drawFrame(performance.now());
  }

  function drawFrame(now) {
    if (drawing || !video || !renderer || video.readyState < 2 || !video.videoWidth) return;
    if (!geo) layout();
    if (!geo) return;
    drawing = true;
    const t0 = performance.now();
    try {
      if (!renderer.upload(video)) return;

      if (S.barDetection && (needFull || now - lastDetect > 1500)) {
        lastDetect = now;
        const r = renderer.detect();
        if (r) detectBars(r.data, r.flipY);
      }

      // Smooth motion: blend over the previous result (corrected for the frame rate)
      const dt = Math.min(250, Math.max(1, now - lastDraw));
      const keep = needFull || !S.smoothing ? 0 : Math.pow(Math.min(0.95, S.smoothing / 100), dt / 33.3);
      renderer.accumulate(1 - keep);
      renderer.post();

      needFull = false;
      lastDraw = now;
      if (!box.classList.contains("ambl-ready")) box.classList.add("ambl-ready");
    } finally {
      drawing = false;
      costAvg = costAvg * 0.9 + (performance.now() - t0) * 0.1;
    }
  }

  // ───────────────────────── Black bar detection ─────────────────────────
  function resetCrop() {
    if (crop.t || crop.b || crop.l || crop.r) {
      crop = { t: 0, b: 0, l: 0, r: 0 };
      layout();
    }
  }

  function detectBars(d, flipY) {
    const W = DET_W;
    const H = DET_H;
    const TH = 24;
    const isDark = (x, y) => {
      const i = ((flipY ? H - 1 - y : y) * W + x) * 4;
      return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < TH;
    };
    const rowDark = (y) => {
      let lit = 0;
      for (let x = 0; x < W; x++) if (!isDark(x, y) && ++lit > W * 0.04) return false;
      return true;
    };
    const colDark = (x) => {
      let lit = 0;
      for (let y = 0; y < H; y++) if (!isDark(x, y) && ++lit > H * 0.04) return false;
      return true;
    };

    // Keep the previous result while the whole frame is dark (fades etc.)
    if (rowDark(H >> 1) || colDark(W >> 1)) return;

    const maxR = Math.floor(H * 0.35);
    const maxC = Math.floor(W * 0.35);
    let t = 0, b = 0, l = 0, r = 0;
    while (t < maxR && rowDark(t)) t++;
    while (b < maxR && rowDark(H - 1 - b)) b++;
    while (l < maxC && colDark(l)) l++;
    while (r < maxC && colDark(W - 1 - r)) r++;

    const next = { t: t / H, b: b / H, l: l / W, r: r / W };
    const changed = ["t", "b", "l", "r"].some((k) => Math.abs(next[k] - crop[k]) > 0.001);
    if (changed) {
      crop = next;
      layout();
    }
  }

  // ───────────────────────── UI strings ─────────────────────────
  // The panel follows YouTube's interface language: Korean for ko, English otherwise.
  const STRINGS = {
    en: {
      title: "Ambient Light",
      enabled: "Enabled",
      secLight: "AMBIENT LIGHT",
      blur: "Blur",
      edge: "Edge size",
      spread: "Spread",
      fadeStart: "Spread fade start",
      fadeCurve: "Spread fade curve",
      smoothing: "Smooth motion",
      secFilters: "FILTERS",
      brightness: "Brightness",
      contrast: "Contrast",
      saturation: "Saturation",
      secPage: "PAGE",
      forceDark: "Use dark theme",
      headerTransparent: "Transparent header at the top",
      searchClear: "Glow through the search bar",
      readability: "Readability boost",
      barDetection: "Remove black bars",
      secPerf: "PERFORMANCE",
      fps: "Frame rate limit",
      webgl: "GPU acceleration (WebGL)",
      reset: "Reset to defaults",
      renderer: "Renderer: ",
      hint: "Press A to toggle the glow, Shift+A to open these settings.",
      button: "Ambient light settings",
    },
    ko: {
      title: "Ambient Light",
      enabled: "사용",
      secLight: "앰비언트 라이트",
      blur: "블러",
      edge: "가장자리 크기",
      spread: "퍼짐",
      fadeStart: "퍼짐 페이드 시작",
      fadeCurve: "퍼짐 페이드 곡선",
      smoothing: "부드러운 움직임",
      secFilters: "필터",
      brightness: "밝기",
      contrast: "대비",
      saturation: "채도",
      secPage: "페이지",
      forceDark: "다크 테마로 보기",
      headerTransparent: "맨 위에서 헤더 투명하게",
      searchClear: "검색창에도 빛 비치기",
      readability: "가독성 보정",
      barDetection: "검은 띠 제거",
      secPerf: "성능",
      fps: "프레임 제한",
      webgl: "GPU 가속 (WebGL)",
      reset: "기본값으로",
      renderer: "렌더러: ",
      hint: "A 키로 켜고 끄고, Shift+A로 이 설정 창을 열고 닫아요.",
      button: "앰비언트 라이트 설정",
    },
  };

  function tr(key) {
    const lang = (root.lang || navigator.language || "en").toLowerCase().startsWith("ko") ? "ko" : "en";
    return STRINGS[lang][key];
  }

  // ───────────────────────── Settings UI ─────────────────────────
  const SVG_NS = "http://www.w3.org/2000/svg";
  let button = null;
  let panel = null;
  let statusEl = null;
  const inputs = {};

  function svgIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", "#fff");
    path.setAttribute(
      "d",
      "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5 1.2 3h-2.4L12 2Zm0 20-1.2-3h2.4L12 22ZM2 12l3-1.2v2.4L2 12Zm20 0-3 1.2v-2.4L22 12ZM4.9 4.9l3 1.3-1.7 1.7-1.3-3Zm14.2 14.2-3-1.3 1.7-1.7 1.3 3Zm0-14.2-1.3 3-1.7-1.7 3-1.3ZM4.9 19.1l1.3-3 1.7 1.7-3 1.3Z"
    );
    svg.appendChild(path);
    return svg;
  }

  function ensureButton(p) {
    if (!p) return;
    const controls = p.querySelector(".ytp-right-controls");
    if (!controls) return;
    if (!button) {
      button = document.createElement("button");
      button.id = "ambl-btn";
      button.className = "ytp-button";
      button.title = tr("button") + " (Shift+A)";
      button.setAttribute("aria-label", tr("button"));
      button.appendChild(svgIcon());
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePanel();
      });
    }
    if (button.parentElement !== controls) controls.insertBefore(button, controls.firstChild);
    if (!panel) buildPanel();
    if (panel.parentElement !== p) p.appendChild(panel);
    button.classList.toggle("ambl-off", !S.enabled);
  }

  function togglePanel(force) {
    if (!panel) return;
    panel.classList.toggle("ambl-open", force);
  }


  function updateStatus() {
    if (!statusEl) return;
    statusEl.textContent = renderer ? tr("renderer") + renderer.kind : "";
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function onChange() {
    saveSettings();
    ensure();
    lastRect = "";
    layout();
  }

  function addSection(parent, label) {
    parent.appendChild(el("div", "ambl-section", label));
  }

  function addSlider(parent, key, label, min, max, step, unit) {
    const row = el("div", "ambl-row");
    const lab = el("div", "ambl-label");
    const fmt = (v) => v + (unit || "");
    const val = el("span", null, fmt(S[key]));
    lab.append(el("span", null, label), val);
    const input = el("input");
    input.type = "range";
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = S[key];
    input.addEventListener("input", () => {
      S[key] = parseFloat(input.value);
      val.textContent = fmt(S[key]);
      onChange();
    });
    inputs[key] = {
      sync: () => {
        input.value = S[key];
        val.textContent = fmt(S[key]);
      },
    };
    row.append(lab, input);
    parent.appendChild(row);
  }

  function addCheck(parent, key, label, after) {
    const row = el("label", "ambl-check");
    const input = el("input");
    input.type = "checkbox";
    input.checked = !!S[key];
    input.addEventListener("change", () => {
      S[key] = input.checked;
      if (after) after();
      onChange();
    });
    inputs[key] = { sync: () => (input.checked = !!S[key]) };
    row.append(input, el("span", null, label));
    parent.appendChild(row);
  }

  function buildPanel() {
    panel = el("div");
    panel.id = "ambl-panel";
    // Keep clicks and keys inside the panel away from the player (play/pause, shortcuts)
    ["click", "dblclick", "mousedown", "pointerdown", "keydown", "keyup", "wheel"].forEach((ev) =>
      panel.addEventListener(ev, (e) => e.stopPropagation(), { passive: true })
    );

    panel.appendChild(el("div", "ambl-title", tr("title")));
    addCheck(panel, "enabled", tr("enabled"));

    addSection(panel, tr("secLight"));
    addSlider(panel, "blur", tr("blur"), 0, 100, 1, "%");
    addSlider(panel, "edge", tr("edge"), 2, 50, 1, "%");
    addSlider(panel, "spread", tr("spread"), 0, 400, 1, "%");
    addSlider(panel, "fadeStart", tr("fadeStart"), -50, 100, 1, "%");
    addSlider(panel, "fadeCurve", tr("fadeCurve"), 1, 100, 1, "%");
    addSlider(panel, "smoothing", tr("smoothing"), 0, 95, 5, "%");

    addSection(panel, tr("secFilters"));
    addSlider(panel, "brightness", tr("brightness"), 0, 200, 1, "%");
    addSlider(panel, "contrast", tr("contrast"), 0, 200, 1, "%");
    addSlider(panel, "saturation", tr("saturation"), 0, 200, 1, "%");

    addSection(panel, tr("secPage"));
    addCheck(panel, "forceDark", tr("forceDark"));
    addCheck(panel, "headerTransparent", tr("headerTransparent"));
    addCheck(panel, "searchClear", tr("searchClear"));
    addSlider(panel, "readability", tr("readability"), 0, 100, 5, "%");
    addCheck(panel, "barDetection", tr("barDetection"), () => {
      if (!S.barDetection) resetCrop();
    });

    addSection(panel, tr("secPerf"));
    addSlider(panel, "fps", tr("fps"), 10, 60, 5, " fps");
    addCheck(panel, "webgl", tr("webgl"), () => setTimeout(rebuildRenderer));

    const reset = el("button", "ambl-reset", tr("reset"));
    reset.addEventListener("click", () => {
      const glChanged = S.webgl !== DEFAULTS.webgl;
      S = Object.assign({}, DEFAULTS);
      Object.values(inputs).forEach((i) => i.sync());
      resetCrop();
      if (glChanged) rebuildRenderer();
      onChange();
    });
    panel.appendChild(reset);
    statusEl = el("div", "ambl-hint");
    panel.appendChild(statusEl);
    panel.appendChild(el("div", "ambl-hint", tr("hint")));
    updateStatus();
  }

  function setEnabled(on) {
    S.enabled = on;
    saveSettings();
    if (inputs.enabled) inputs.enabled.sync();
    ensure();
  }

  // ───────────────────────── Events ─────────────────────────
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.code !== "KeyA" || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (!isWatchPage()) return;
      // A: toggle the glow, Shift+A: open/close the settings panel
      if (e.shiftKey) {
        ensureButton(document.querySelector("ytd-watch-flexy:not([hidden]) #movie_player"));
        togglePanel();
      } else {
        setEnabled(!S.enabled);
      }
    },
    true
  );

  document.addEventListener("click", (e) => {
    if (panel && panel.classList.contains("ambl-open") && !panel.contains(e.target) && !(button && button.contains(e.target))) {
      togglePanel(false);
    }
  });

  // While scrolling only the header state is updated (passive, no layout work)
  window.addEventListener("scroll", updateAtTop, { passive: true });

  // YouTube SPA navigation and layout changes (theater mode etc.)
  ["yt-navigate-finish", "yt-page-data-updated", "fullscreenchange", "webkitfullscreenchange"].forEach((ev) =>
    document.addEventListener(ev, () => setTimeout(ensure, 50))
  );
  window.addEventListener("resize", () => layout());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && video) {
      needFull = true;
      drawNow();
      restartLoop();
    }
  });

  // Pick up setting changes made in other tabs
  window.addEventListener("storage", (e) => {
    if (e.key !== STORE_KEY) return;
    const prevGL = S.webgl;
    S = loadSettings();
    Object.values(inputs).forEach((i) => i.sync());
    if (prevGL !== S.webgl) rebuildRenderer();
    onChange();
  });

  setInterval(ensure, 1000);
  ensure();
})();
