/* Doodle Studio — a small drawing app. No dependencies, no build step. */
(() => {
  'use strict';

  /* ------------------------------------------------------------------
     Helpers
  ------------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // localStorage can be blocked (private mode, strict settings), so never assume it works.
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('doodle:' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('doodle:' + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem('doodle:' + key);
      } catch {
        /* ignore */
      }
    },
  };

  const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const normalizeHex = (value) => {
    let h = String(value).trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
    return /^[0-9a-f]{6}$/.test(h) ? '#' + h : null;
  };

  /* ------------------------------------------------------------------
     Config
  ------------------------------------------------------------------ */
  const PALETTE = [
    '#000000', '#6b7280', '#ffffff', '#ef4444', '#f97316', '#facc15',
    '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#2f4bff', '#6366f1',
    '#a855f7', '#ff48b0', '#92400e', '#f2c9a0', '#9f1239', '#14213d',
  ];

  const TOOL_KEYS = { b: 'brush', s: 'spray', e: 'eraser', l: 'line', r: 'rect', o: 'ellipse', f: 'fill', i: 'picker' };
  const SHAPE_TOOLS = new Set(['line', 'rect', 'ellipse']);
  const RING_TOOLS = new Set(['brush', 'spray', 'eraser']);

  const TIPS = {
    brush: 'Press [ or ] to change the size without leaving the canvas.',
    spray: 'Hold still to build up more paint.',
    eraser: 'Lower the opacity to erase softly.',
    line: 'Hold Shift to snap the line to 45°.',
    rect: 'Hold Shift for a perfect square.',
    ellipse: 'Hold Shift for a perfect circle.',
    fill: 'Raise the tolerance to fill across soft edges.',
    picker: 'Click anywhere on the canvas to pick up a color.',
  };

  const MIN_SIDE = 64;
  const MAX_SIDE = 3000;
  const HISTORY_BUDGET = 96 * 1024 * 1024; // bytes of undo snapshots we are willing to hold

  /* ------------------------------------------------------------------
     Elements
  ------------------------------------------------------------------ */
  const root = document.documentElement;
  const stage = $('#stage');
  const paper = $('#paper');
  const canvas = $('#canvas');
  const overlay = $('#overlay');
  const ring = $('#ring');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const octx = overlay.getContext('2d');

  const undoBtn = $('#undoBtn');
  const redoBtn = $('#redoBtn');
  const clearBtn = $('#clearBtn');
  const newBtn = $('#newBtn');
  const openBtn = $('#openBtn');
  const saveBtn = $('#saveBtn');
  const themeBtn = $('#themeBtn');
  const helpBtn = $('#helpBtn');
  const fileInput = $('#fileInput');

  const colorInput = $('#color');
  const hexInput = $('#hex');
  const swatchesEl = $('#swatches');
  const recentEl = $('#recent');
  const recentEmpty = $('#recentEmpty');

  const sizeInput = $('#size');
  const sizeOut = $('#sizeOut');
  const opacityInput = $('#opacity');
  const opacityOut = $('#opacityOut');
  const toleranceInput = $('#tolerance');
  const toleranceOut = $('#toleranceOut');
  const brushPreview = $('#brushPreview');
  const tipEl = $('#tip');

  const coordsEl = $('#coords');
  const dimsEl = $('#dims');
  const zoomEl = $('#zoom');
  const saveDot = $('#saveDot');
  const saveText = $('#saveText');

  const newDialog = $('#newDialog');
  const newW = $('#newW');
  const newH = $('#newH');
  const presetsEl = $('#presets');
  const helpDialog = $('#helpDialog');

  const toastEl = $('#toast');
  const toastText = $('#toastText');
  const toastAction = $('#toastAction');

  /* ------------------------------------------------------------------
     State
  ------------------------------------------------------------------ */
  const state = {
    tool: 'brush',
    prevTool: 'brush',
    color: normalizeHex(store.get('color', '#000000')) || '#000000',
    size: clamp(Number(store.get('size', 8)) || 8, 1, 100),
    opacity: clamp(Number(store.get('opacity', 100)) || 100, 5, 100),
    tolerance: clamp(Number(store.get('tolerance', 16)), 0, 100),
    shape: 'outline',
  };
  if (Number.isNaN(state.tolerance)) state.tolerance = 16;

  let recent = (store.get('recent', []) || []).filter((c) => normalizeHex(c)).slice(0, 8);

  let W = 1280;
  let H = 800;
  let scale = 1;

  let drawing = false;
  let moved = false;
  let shiftKey = false;
  let start = null;
  let last = null;
  let mid = null;
  let sprayRaf = 0;

  /* ------------------------------------------------------------------
     Toast
  ------------------------------------------------------------------ */
  let toastTimer = 0;
  function toast(message, action) {
    toastText.textContent = message;
    toastAction.hidden = !action;
    if (action) {
      toastAction.textContent = action.label;
      toastAction.onclick = () => {
        action.run();
        hideToast();
      };
    }
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 5000 : 2200);
  }
  function hideToast() {
    toastEl.classList.remove('show');
  }

  /* ------------------------------------------------------------------
     Canvas size + layout
  ------------------------------------------------------------------ */
  function setCanvasSize(w, h) {
    W = w;
    H = h;
    canvas.width = overlay.width = w;
    canvas.height = overlay.height = h;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    dimsEl.textContent = `${w} × ${h}`;
    layout();
  }

  // The drawing keeps a fixed resolution and is scaled with CSS to fit the window.
  function layout() {
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const availW = Math.max(stage.clientWidth - padX, 50);
    const availH = Math.max(stage.clientHeight - padY, 50);
    scale = Math.min(availW / W, availH / H, 1);
    paper.style.width = Math.floor(W * scale) + 'px';
    paper.style.height = Math.floor(H * scale) + 'px';
    zoomEl.textContent = Math.round(scale * 100) + '%';
    updateRingSize();
  }
  new ResizeObserver(layout).observe(stage);

  function toCanvas(e) {
    const r = overlay.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }

  /* ------------------------------------------------------------------
     Undo / redo
  ------------------------------------------------------------------ */
  const steps = [];
  let stepIndex = -1;

  const maxSteps = () => clamp(Math.floor(HISTORY_BUDGET / (W * H * 4)), 4, 50);

  function snapshot({ save = true } = {}) {
    steps.length = stepIndex + 1;
    steps.push(ctx.getImageData(0, 0, W, H));
    while (steps.length > maxSteps()) steps.shift();
    stepIndex = steps.length - 1;
    syncHistoryButtons();
    if (save) scheduleSave();
  }

  function resetHistory(opts) {
    steps.length = 0;
    stepIndex = -1;
    snapshot(opts);
  }

  function restoreStep(i) {
    stepIndex = i;
    ctx.putImageData(steps[i], 0, 0);
    syncHistoryButtons();
    scheduleSave();
  }

  function undo() {
    if (drawing || stepIndex <= 0) return;
    restoreStep(stepIndex - 1);
  }

  function redo() {
    if (drawing || stepIndex >= steps.length - 1) return;
    restoreStep(stepIndex + 1);
  }

  function syncHistoryButtons() {
    undoBtn.disabled = stepIndex <= 0;
    redoBtn.disabled = stepIndex >= steps.length - 1;
  }

  /* ------------------------------------------------------------------
     Autosave (localStorage)
  ------------------------------------------------------------------ */
  let saveTimer = 0;
  let savePending = false;

  function setSaveState(s) {
    saveDot.dataset.state = s;
    saveText.textContent = { saving: 'Saving…', saved: 'Saved in this browser', failed: 'Autosave unavailable' }[s];
  }

  function scheduleSave() {
    savePending = true;
    setSaveState('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 900);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    savePending = false;
    let ok = false;
    try {
      ok = store.set('canvas', { w: W, h: H, data: canvas.toDataURL('image/png') });
    } catch {
      ok = false;
    }
    if (!ok) store.remove('canvas'); // don't leave an outdated copy behind
    setSaveState(ok ? 'saved' : 'failed');
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && savePending) saveNow();
  });

  /* ------------------------------------------------------------------
     Tools
  ------------------------------------------------------------------ */
  function setTool(tool) {
    if (drawing || tool === state.tool) return;
    if (state.tool !== 'picker') state.prevTool = state.tool;
    state.tool = tool;
    renderTool();
  }

  function renderTool() {
    $$('.tool').forEach((btn) => {
      const on = btn.dataset.tool === state.tool;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    paper.dataset.tool = state.tool;
    $$('[data-tools]').forEach((el) => {
      el.hidden = !el.dataset.tools.split(' ').includes(state.tool);
    });
    tipEl.textContent = TIPS[state.tool];
    if (!RING_TOOLS.has(state.tool)) ring.hidden = true;
    updateRingSize();
    updatePreview();
  }

  $('.tools').addEventListener('click', (e) => {
    const btn = e.target.closest('.tool');
    if (btn) setTool(btn.dataset.tool);
  });

  /* ------------------------------------------------------------------
     Color
  ------------------------------------------------------------------ */
  function swatchButton(color) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.setProperty('--c', color);
    b.dataset.color = color;
    b.title = color;
    b.setAttribute('aria-label', `Use color ${color}`);
    return b;
  }

  function renderSwatches() {
    swatchesEl.replaceChildren(...PALETTE.map(swatchButton));
    renderRecent();
  }

  function renderRecent() {
    recentEl.replaceChildren(...recent.map(swatchButton));
    recentEl.hidden = recent.length === 0;
    recentEmpty.hidden = recent.length > 0;
    syncSwatches();
  }

  function syncSwatches() {
    $$('.swatch').forEach((s) => s.classList.toggle('is-active', s.dataset.color === state.color));
  }

  function addRecent(hex) {
    if (PALETTE.includes(hex)) return;
    recent = [hex, ...recent.filter((c) => c !== hex)].slice(0, 8);
    store.set('recent', recent);
    renderRecent();
  }

  function setColor(hex) {
    state.color = hex;
    colorInput.value = hex;
    hexInput.value = hex;
    root.style.setProperty('--current', hex);
    store.set('color', hex);
    syncSwatches();
    updatePreview();
  }

  // Called when the person chooses a color themselves.
  function chooseColor(hex, { remember = false } = {}) {
    if (state.tool === 'eraser') setTool('brush');
    setColor(hex);
    if (remember) addRecent(hex);
  }

  colorInput.addEventListener('input', () => chooseColor(colorInput.value));
  colorInput.addEventListener('change', () => addRecent(colorInput.value));

  hexInput.addEventListener('change', () => {
    const hex = normalizeHex(hexInput.value);
    if (hex) chooseColor(hex, { remember: true });
    else hexInput.value = state.color;
  });
  hexInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hexInput.blur();
  });

  [swatchesEl, recentEl].forEach((el) =>
    el.addEventListener('click', (e) => {
      const s = e.target.closest('.swatch');
      if (s) chooseColor(s.dataset.color);
    })
  );

  /* ------------------------------------------------------------------
     Size, opacity, tolerance, shape style
  ------------------------------------------------------------------ */
  function paintRange(input) {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--fill', pct + '%');
  }

  function setSize(v) {
    state.size = clamp(Math.round(v), 1, 100);
    sizeInput.value = state.size;
    sizeOut.textContent = state.size + ' px';
    paintRange(sizeInput);
    store.set('size', state.size);
    updateRingSize();
    updatePreview();
  }

  function setOpacity(v) {
    state.opacity = clamp(Math.round(v), 5, 100);
    opacityInput.value = state.opacity;
    opacityOut.textContent = state.opacity + '%';
    paintRange(opacityInput);
    store.set('opacity', state.opacity);
    updatePreview();
  }

  function setTolerance(v) {
    state.tolerance = clamp(Math.round(v), 0, 100);
    toleranceInput.value = state.tolerance;
    toleranceOut.textContent = state.tolerance + '%';
    paintRange(toleranceInput);
    store.set('tolerance', state.tolerance);
  }

  function setShape(shape) {
    state.shape = shape;
    $$('[data-shape]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.shape === shape)));
  }

  sizeInput.addEventListener('input', () => setSize(+sizeInput.value));
  opacityInput.addEventListener('input', () => setOpacity(+opacityInput.value));
  toleranceInput.addEventListener('input', () => setTolerance(+toleranceInput.value));
  $$('[data-shape]').forEach((b) => b.addEventListener('click', () => setShape(b.dataset.shape)));

  function nudgeSize(dir) {
    const step = state.size >= 30 ? 5 : state.size >= 10 ? 2 : 1;
    setSize(state.size + dir * step);
  }

  function updatePreview() {
    const erasing = state.tool === 'eraser';
    const d = clamp(state.size, 2, 64);
    brushPreview.style.width = brushPreview.style.height = d + 'px';
    brushPreview.style.background = erasing ? '#ffffff' : state.color;
    brushPreview.style.opacity = state.opacity / 100;
    brushPreview.classList.toggle('is-eraser', erasing);
  }

  function updateRingSize() {
    const diameter = state.tool === 'spray' ? state.size * 3.2 + 4 : state.size;
    ring.style.width = ring.style.height = Math.max(diameter * scale, 4) + 'px';
  }

  /* ------------------------------------------------------------------
     Drawing
  ------------------------------------------------------------------ */
  function prepareOverlay() {
    octx.lineCap = 'round';
    octx.lineJoin = 'round';
    octx.lineWidth = state.size;
    octx.strokeStyle = octx.fillStyle = state.tool === 'eraser' ? '#ffffff' : state.color;
    // Strokes are drawn opaque on the overlay and shown at the chosen opacity,
    // so overlapping parts of one stroke never build up darker.
    overlay.style.opacity = state.opacity / 100;
  }

  function clearOverlay() {
    octx.clearRect(0, 0, W, H);
    overlay.style.opacity = '';
  }

  function commitOverlay() {
    ctx.save();
    ctx.globalAlpha = state.opacity / 100;
    ctx.drawImage(overlay, 0, 0);
    ctx.restore();
    clearOverlay();
    snapshot();
  }

  function dot(p) {
    octx.beginPath();
    octx.arc(p.x, p.y, state.size / 2, 0, Math.PI * 2);
    octx.fill();
  }

  // Smooth freehand lines: curve through the midpoints between pointer samples.
  function strokeTo(p) {
    const m = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    octx.beginPath();
    octx.moveTo(mid.x, mid.y);
    octx.quadraticCurveTo(last.x, last.y, m.x, m.y);
    octx.stroke();
    last = p;
    mid = m;
  }

  function sprayTick() {
    if (!drawing || state.tool !== 'spray') return;
    const radius = state.size * 1.6 + 2;
    const count = Math.ceil(radius * 0.9);
    const dotR = Math.max(0.6, state.size / 22);
    octx.beginPath();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * Math.sqrt(Math.random());
      const x = last.x + Math.cos(a) * r;
      const y = last.y + Math.sin(a) * r;
      octx.moveTo(x + dotR, y);
      octx.arc(x, y, dotR, 0, Math.PI * 2);
    }
    octx.fill();
    sprayRaf = requestAnimationFrame(sprayTick);
  }

  function drawShape() {
    octx.clearRect(0, 0, W, H);
    const x1 = start.x;
    const y1 = start.y;
    let dx = last.x - x1;
    let dy = last.y - y1;

    if (shiftKey) {
      if (state.tool === 'line') {
        const step = Math.PI / 4;
        const angle = Math.round(Math.atan2(dy, dx) / step) * step;
        const len = Math.hypot(dx, dy);
        dx = Math.cos(angle) * len;
        dy = Math.sin(angle) * len;
      } else {
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        dx = (dx < 0 ? -1 : 1) * side;
        dy = (dy < 0 ? -1 : 1) * side;
      }
    }

    const x2 = x1 + dx;
    const y2 = y1 + dy;
    const filled = state.shape === 'filled';

    octx.beginPath();
    if (state.tool === 'line') {
      octx.moveTo(x1, y1);
      octx.lineTo(x2, y2);
      octx.stroke();
    } else {
      if (state.tool === 'rect') {
        octx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(dx), Math.abs(dy));
      } else {
        octx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(dx) / 2, Math.abs(dy) / 2, 0, 0, Math.PI * 2);
      }
      if (filled) octx.fill();
      else octx.stroke();
    }
  }

  function handleMove(p) {
    if (!moved && Math.hypot(p.x - start.x, p.y - start.y) > 1) moved = true;
    if (state.tool === 'brush' || state.tool === 'eraser') strokeTo(p);
    else last = p; // spray + shapes just track the latest position
  }

  function endStroke(cancelled) {
    if (!drawing) return;
    drawing = false;
    cancelAnimationFrame(sprayRaf);

    if (cancelled) {
      clearOverlay();
      return;
    }
    if (state.tool === 'brush' || state.tool === 'eraser') {
      octx.beginPath();
      octx.moveTo(mid.x, mid.y);
      octx.lineTo(last.x, last.y);
      octx.stroke();
    } else if (SHAPE_TOOLS.has(state.tool)) {
      if (!moved) {
        clearOverlay();
        return;
      }
      drawShape();
    }
    commitOverlay();
  }

  overlay.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const p = toCanvas(e);

    if (state.tool === 'fill') return floodFillAt(p.x, p.y);
    if (state.tool === 'picker') return pickColorAt(p.x, p.y);

    overlay.setPointerCapture(e.pointerId);
    drawing = true;
    moved = false;
    shiftKey = e.shiftKey;
    start = last = mid = p;
    prepareOverlay();

    if (state.tool === 'brush' || state.tool === 'eraser') dot(p);
    else if (state.tool === 'spray') sprayTick();
  });

  overlay.addEventListener('pointermove', (e) => {
    updateHover(e);
    if (!drawing || !e.isPrimary) return;
    shiftKey = e.shiftKey;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) handleMove(toCanvas(ev));
    if (SHAPE_TOOLS.has(state.tool)) drawShape();
  });

  overlay.addEventListener('pointerup', () => endStroke(false));
  overlay.addEventListener('pointercancel', () => endStroke(true));
  overlay.addEventListener('contextmenu', (e) => e.preventDefault());
  overlay.addEventListener('pointerleave', () => {
    ring.hidden = true;
    if (!drawing) coordsEl.textContent = '–';
  });

  function updateHover(e) {
    const r = overlay.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    coordsEl.textContent = `${Math.round((cx * W) / r.width)}, ${Math.round((cy * H) / r.height)}`;
    if (e.pointerType === 'mouse' && RING_TOOLS.has(state.tool)) {
      ring.hidden = false;
      ring.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
    } else {
      ring.hidden = true;
    }
  }

  /* ------------------------------------------------------------------
     Fill + eyedropper
  ------------------------------------------------------------------ */

  /* fill:start */
  // Scanline flood fill on raw RGBA data. Returns false if nothing needs to change.
  function fillRegion(d, w, h, sx, sy, rgb, alpha, tolerance) {
    const [fr, fg, fb] = rgb;
    const s = (sy * w + sx) * 4;
    const tr = d[s], tg = d[s + 1], tb = d[s + 2], ta = d[s + 3];
    if (alpha >= 1 && tr === fr && tg === fg && tb === fb && ta === 255) return false;

    const seen = new Uint8Array(w * h);
    const match = (i) =>
      Math.abs(d[i] - tr) <= tolerance &&
      Math.abs(d[i + 1] - tg) <= tolerance &&
      Math.abs(d[i + 2] - tb) <= tolerance &&
      Math.abs(d[i + 3] - ta) <= tolerance;

    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop();
      let x = stack.pop();
      if (seen[y * w + x]) continue;
      while (x >= 0 && !seen[y * w + x] && match((y * w + x) * 4)) x--;
      x++;
      let up = false;
      let down = false;
      for (; x < w && !seen[y * w + x] && match((y * w + x) * 4); x++) {
        seen[y * w + x] = 1;
        if (y > 0) {
          const ok = !seen[(y - 1) * w + x] && match(((y - 1) * w + x) * 4);
          if (ok && !up) stack.push(x, y - 1);
          up = ok;
        }
        if (y < h - 1) {
          const ok = !seen[(y + 1) * w + x] && match(((y + 1) * w + x) * 4);
          if (ok && !down) stack.push(x, y + 1);
          down = ok;
        }
      }
    }

    const paint = (i) => {
      const p = i * 4;
      d[p] = d[p] * (1 - alpha) + fr * alpha;
      d[p + 1] = d[p + 1] * (1 - alpha) + fg * alpha;
      d[p + 2] = d[p + 2] * (1 - alpha) + fb * alpha;
      d[p + 3] = 255;
    };

    // Grow the fill by one pixel so it tucks under anti-aliased edges (skipped at 0% tolerance).
    const grow = tolerance > 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (seen[i] !== 1) continue;
        paint(i);
        if (!grow) continue;
        if (x > 0 && !seen[i - 1]) { seen[i - 1] = 2; paint(i - 1); }
        if (x < w - 1 && !seen[i + 1]) { seen[i + 1] = 2; paint(i + 1); }
        if (y > 0 && !seen[i - w]) { seen[i - w] = 2; paint(i - w); }
        if (y < h - 1 && !seen[i + w]) { seen[i + w] = 2; paint(i + w); }
      }
    }
    return true;
  }
  /* fill:end */

  function floodFillAt(px, py) {
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const img = ctx.getImageData(0, 0, W, H);
    const changed = fillRegion(img.data, W, H, x, y, hexToRgb(state.color), state.opacity / 100, state.tolerance * 2.55);
    if (!changed) return;
    ctx.putImageData(img, 0, 0);
    snapshot();
  }

  function pickColorAt(px, py) {
    const x = clamp(Math.floor(px), 0, W - 1);
    const y = clamp(Math.floor(py), 0, H - 1);
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    const hex = rgbToHex(r, g, b);
    setColor(hex);
    addRecent(hex);
    setTool(state.prevTool === 'eraser' ? 'brush' : state.prevTool);
    toast(`Picked ${hex}`);
  }

  /* ------------------------------------------------------------------
     Canvas actions: clear, new, open, save
  ------------------------------------------------------------------ */
  function clearCanvas() {
    if (drawing) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    snapshot();
    toast('Canvas cleared', { label: 'Undo', run: undo });
  }

  function openNewDialog() {
    newDialog.returnValue = '';
    newW.value = W;
    newH.value = H;
    markPreset();
    newDialog.showModal();
  }

  function markPreset() {
    $$('[data-w]', presetsEl).forEach((b) =>
      b.classList.toggle('is-active', b.dataset.w === String(newW.value) && b.dataset.h === String(newH.value))
    );
  }

  presetsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]');
    if (!b) return;
    newW.value = b.dataset.w;
    newH.value = b.dataset.h;
    markPreset();
  });
  [newW, newH].forEach((i) => i.addEventListener('input', markPreset));

  newDialog.addEventListener('close', () => {
    if (newDialog.returnValue !== 'create') return;
    const w = clamp(parseInt(newW.value, 10) || W, MIN_SIDE, MAX_SIDE);
    const h = clamp(parseInt(newH.value, 10) || H, MIN_SIDE, MAX_SIDE);
    setCanvasSize(w, h);
    resetHistory();
    toast(`Created a ${w} × ${h} canvas`);
  });

  function loadImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      toast('That file is not an image');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.width || !img.height) return toast('Could not open that image');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      const s = Math.min(W / img.width, H / img.height, 1);
      const w = img.width * s;
      const h = img.height * s;
      ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      snapshot();
      toast('Opened image');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast('Could not open that image');
    };
    img.src = url;
  }

  function savePNG() {
    canvas.toBlob((blob) => {
      if (!blob) return toast('Could not save the image');
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.href = url;
      a.download = `doodle-${stamp}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Saved as PNG');
    }, 'image/png');
  }

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  clearBtn.addEventListener('click', clearCanvas);
  newBtn.addEventListener('click', openNewDialog);
  openBtn.addEventListener('click', () => fileInput.click());
  saveBtn.addEventListener('click', savePNG);
  helpBtn.addEventListener('click', () => helpDialog.showModal());
  $('#helpClose').addEventListener('click', () => helpDialog.close());
  $('#newCancel').addEventListener('click', () => newDialog.close('cancel'));
  fileInput.addEventListener('change', () => {
    loadImageFile(fileInput.files[0]);
    fileInput.value = '';
  });

  // Close dialogs when the backdrop is clicked.
  [newDialog, helpDialog].forEach((dlg) =>
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    })
  );

  // Drag and drop / paste an image
  ['dragenter', 'dragover'].forEach((type) =>
    stage.addEventListener(type, (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
      e.preventDefault();
      stage.classList.add('is-dragging');
    })
  );
  ['dragleave', 'drop'].forEach((type) =>
    stage.addEventListener(type, () => stage.classList.remove('is-dragging'))
  );
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    loadImageFile(e.dataTransfer?.files?.[0]);
  });
  document.addEventListener('paste', (e) => {
    if (e.target.matches?.('input, textarea')) return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) loadImageFile(file);
  });

  /* ------------------------------------------------------------------
     Theme
  ------------------------------------------------------------------ */
  const themeMeta = $('meta[name="theme-color"]');
  function setTheme(theme) {
    root.dataset.theme = theme;
    store.set('theme', theme);
    if (themeMeta) themeMeta.content = theme === 'dark' ? '#141a2e' : '#f7f9fd';
  }
  themeBtn.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));

  /* ------------------------------------------------------------------
     Keyboard shortcuts
  ------------------------------------------------------------------ */
  const isShapeTool = () => SHAPE_TOOLS.has(state.tool);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
      shiftKey = true;
      if (drawing && isShapeTool()) drawShape();
      return;
    }
    if (e.target.matches?.('input[type="text"], input[type="number"]')) return;
    if (document.querySelector('dialog[open]')) return;

    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      } else if (key === 's') {
        e.preventDefault();
        savePNG();
      } else if (key === 'o') {
        e.preventDefault();
        fileInput.click();
      }
      return;
    }
    if (e.altKey) return;

    if (TOOL_KEYS[key]) setTool(TOOL_KEYS[key]);
    else if (key === '[') nudgeSize(-1);
    else if (key === ']') nudgeSize(1);
    else if (e.key === '?') helpDialog.showModal();
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      shiftKey = false;
      if (drawing && isShapeTool()) drawShape();
    }
  });

  /* ------------------------------------------------------------------
     Start up
  ------------------------------------------------------------------ */
  function startFresh() {
    const narrow = window.matchMedia('(max-width: 860px)').matches;
    setCanvasSize(narrow ? 900 : 1280, narrow ? 1200 : 800);
    resetHistory({ save: false });
  }

  function restoreSaved() {
    const saved = store.get('canvas', null);
    if (!saved || typeof saved.data !== 'string') return startFresh();
    const img = new Image();
    img.onload = () => {
      const w = clamp(Number(saved.w) || img.width, MIN_SIDE, MAX_SIDE);
      const h = clamp(Number(saved.h) || img.height, MIN_SIDE, MAX_SIDE);
      setCanvasSize(w, h);
      ctx.drawImage(img, 0, 0);
      resetHistory({ save: false });
    };
    img.onerror = startFresh;
    img.src = saved.data;
  }

  renderSwatches();
  setColor(state.color);
  setSize(state.size);
  setOpacity(state.opacity);
  setTolerance(state.tolerance);
  setShape(state.shape);
  renderTool();
  syncHistoryButtons();
  setSaveState('saved');
  restoreSaved();
})();
