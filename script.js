/* Doodle Studio — a small drawing app with layers, text, zoom and pan.
   No dependencies, no build step. */
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

  const canvasToBlob = (c, type = 'image/png') =>
    new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), type));

  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image failed to load'));
      img.src = src;
    });

  async function loadBlobImage(blob) {
    const url = URL.createObjectURL(blob);
    try {
      return await loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#' + name);
    svg.append(use);
    return svg;
  }

  /* ------------------------------------------------------------------
     Config
  ------------------------------------------------------------------ */
  const PALETTE = [
    '#000000', '#6b7280', '#ffffff', '#ef4444', '#f97316', '#facc15',
    '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#2f4bff', '#6366f1',
    '#a855f7', '#ff48b0', '#92400e', '#f2c9a0', '#9f1239', '#14213d',
  ];

  const TOOL_KEYS = {
    b: 'brush', s: 'spray', e: 'eraser', l: 'line', r: 'rect', o: 'ellipse',
    t: 'text', f: 'fill', i: 'picker', v: 'move', h: 'hand',
  };
  const SHAPE_TOOLS = new Set(['line', 'rect', 'ellipse']);
  const RING_TOOLS = new Set(['brush', 'spray', 'eraser']);
  const NEEDS_LAYER = new Set(['brush', 'spray', 'eraser', 'line', 'rect', 'ellipse', 'text', 'fill', 'move']);

  const TIPS = {
    brush: 'Press [ or ] to change the size without leaving the canvas.',
    spray: 'Hold still to build up more paint.',
    eraser: 'Erases to transparent. Lower the opacity to erase softly.',
    line: 'Hold Shift to snap the line to 45°.',
    rect: 'Hold Shift for a perfect square.',
    ellipse: 'Hold Shift for a perfect circle.',
    text: 'Click to type. Press Ctrl+Enter or click away to finish, Esc to cancel.',
    fill: 'Pick "All layers" to fill inside lines drawn on another layer.',
    picker: 'Click anywhere on the canvas to pick up a color.',
    move: 'Drag to move everything on the selected layer.',
    hand: 'Drag to pan. Scroll to pan and Ctrl+scroll to zoom.',
  };

  const FONTS = {
    sans: "'Instrument Sans', system-ui, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    hand: "'Segoe Print', 'Bradley Hand', 'Marker Felt', 'Comic Sans MS', cursive",
  };
  const LINE_HEIGHT = 1.25;

  const MIN_SIDE = 64;
  const MAX_SIDE = 3000;
  const MAX_LAYERS = 12;
  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 8;
  const MAX_STEPS = 100;
  const HISTORY_BUDGET = 128 * 1024 * 1024; // bytes of undo data we are willing to hold

  /* ------------------------------------------------------------------
     Elements
  ------------------------------------------------------------------ */
  const root = document.documentElement;
  const stage = $('#stage');
  const paper = $('#paper');
  const layersEl = $('#layers');
  const overlay = $('#overlay');
  const ring = $('#ring');
  const textInput = $('#textEditor');
  const octx = overlay.getContext('2d');
  const measureCtx = document.createElement('canvas').getContext('2d');
  const sampleCtx = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.getContext('2d', { willReadFrequently: true });
  })();

  const undoBtn = $('#undoBtn');
  const redoBtn = $('#redoBtn');
  const clearBtn = $('#clearBtn');
  const newBtn = $('#newBtn');
  const importBtn = $('#importBtn');
  const copyBtn = $('#copyBtn');
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
  const textSizeInput = $('#textSize');
  const textSizeOut = $('#textSizeOut');
  const fontSelect = $('#fontFamily');
  const brushPreview = $('#brushPreview');
  const tipEl = $('#tip');

  const layerList = $('#layerList');
  const layerOpacity = $('#layerOpacity');
  const layerOpacityOut = $('#layerOpacityOut');
  const layerAddBtn = $('#layerAdd');
  const layerDuplicateBtn = $('#layerDuplicate');
  const layerMergeBtn = $('#layerMerge');
  const layerUpBtn = $('#layerUp');
  const layerDownBtn = $('#layerDown');
  const layerDeleteBtn = $('#layerDelete');

  const coordsEl = $('#coords');
  const dimsEl = $('#dims');
  const zoomOutBtn = $('#zoomOut');
  const zoomInBtn = $('#zoomIn');
  const zoomResetBtn = $('#zoomReset');
  const zoomFitBtn = $('#zoomFit');
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
  const savedFont = store.get('font', 'sans');
  const savedTolerance = Number(store.get('tolerance', 16));

  const state = {
    tool: 'brush',
    prevTool: 'brush',
    color: normalizeHex(store.get('color', '#000000')) || '#000000',
    size: clamp(Number(store.get('size', 8)) || 8, 1, 100),
    opacity: clamp(Number(store.get('opacity', 100)) || 100, 5, 100),
    tolerance: Number.isFinite(savedTolerance) ? clamp(savedTolerance, 0, 100) : 16,
    shape: 'outline',
    sample: 'layer',
    textSize: clamp(Number(store.get('textSize', 48)) || 48, 8, 200),
    font: FONTS[savedFont] ? savedFont : 'sans',
    bold: false,
    italic: false,
  };

  let recent = (store.get('recent', []) || []).filter((c) => normalizeHex(c)).slice(0, 8);

  // The document: a stack of transparent layers (bottom first) over an optional white paper.
  let W = 1280;
  let H = 800;
  let layers = [];
  let active = null;
  let paperVisible = true;

  // The view: how the paper is moved and scaled inside the stage.
  const view = { zoom: 1, x: 0, y: 0, auto: true };

  // Pointer interaction
  let drawing = false;
  let moved = false;
  let shiftKey = false;
  let spaceDown = false;
  let start = null;
  let last = null;
  let mid = null;
  let bounds = null;
  let sprayRaf = 0;
  let strokeLayer = null;
  let strokeCtx = null;
  let moveTmp = null;
  let editBase = null;
  let pan = null;
  let gesture = null;
  let textEdit = null;
  const touches = new Map();

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
    toastTimer = setTimeout(hideToast, action ? 5000 : 2400);
  }
  function hideToast() {
    toastEl.classList.remove('show');
  }

  /* ------------------------------------------------------------------
     View: fit, zoom and pan
  ------------------------------------------------------------------ */
  const stageSize = () => ({ w: stage.clientWidth, h: stage.clientHeight });

  function fitView() {
    view.auto = true;
    const { w, h } = stageSize();
    if (w <= 0 || h <= 0) return;
    const pad = w < 600 ? 12 : 28;
    const z = clamp(Math.min((w - pad * 2) / W, (h - pad * 2) / H, 1), MIN_ZOOM, MAX_ZOOM);
    view.zoom = z;
    view.x = (w - W * z) / 2;
    view.y = (h - H * z) / 2;
    applyView();
  }

  function clampPan() {
    const { w, h } = stageSize();
    if (w <= 0 || h <= 0) return;
    const pw = W * view.zoom;
    const ph = H * view.zoom;
    const keep = Math.min(80, pw / 2, ph / 2); // always keep some paper in view
    view.x = clamp(view.x, keep - pw, w - keep);
    view.y = clamp(view.y, keep - ph, h - keep);
  }

  function applyView() {
    clampPan();
    paper.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    paper.classList.toggle('pixelated', view.zoom >= 3);
    zoomResetBtn.textContent = Math.round(view.zoom * 100) + '%';
    updateRingSize();
    positionTextEditor();
  }

  function zoomAt(z, cx, cy) {
    const { w, h } = stageSize();
    if (cx === undefined) {
      cx = w / 2;
      cy = h / 2;
    }
    z = clamp(z, MIN_ZOOM, MAX_ZOOM);
    const k = z / view.zoom;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.zoom = z;
    view.auto = false;
    applyView();
  }

  const zoomStep = (dir) => zoomAt(view.zoom * (dir > 0 ? 1.25 : 0.8));

  function toCanvas(e) {
    const r = paper.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        zoomAt(view.zoom * Math.exp(-e.deltaY * unit * 0.0035), e.clientX - r.left, e.clientY - r.top);
      } else {
        const swap = e.shiftKey && !e.deltaX;
        view.x -= (swap ? e.deltaY : e.deltaX) * unit;
        view.y -= (swap ? 0 : e.deltaY) * unit;
        view.auto = false;
        applyView();
      }
    },
    { passive: false }
  );

  function startPan(e) {
    pan = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: view.x, y: view.y };
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    stage.classList.add('is-panning');
  }

  function movePan(e) {
    view.x = pan.x + (e.clientX - pan.sx);
    view.y = pan.y + (e.clientY - pan.sy);
    view.auto = false;
    applyView();
  }

  function endPan() {
    pan = null;
    stage.classList.remove('is-panning');
  }

  // Two-finger pinch to zoom and drag to pan
  function startGesture() {
    if (drawing) endStroke(true);
    if (pan) endPan();
    const [a, b] = [...touches.values()];
    const r = stage.getBoundingClientRect();
    gesture = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      cx: (a.x + b.x) / 2 - r.left,
      cy: (a.y + b.y) / 2 - r.top,
      zoom: view.zoom,
      x: view.x,
      y: view.y,
    };
  }

  function updateGesture() {
    const [a, b] = [...touches.values()];
    if (!a || !b) return;
    const r = stage.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left;
    const my = (a.y + b.y) / 2 - r.top;
    const z = clamp(gesture.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / gesture.dist), MIN_ZOOM, MAX_ZOOM);
    view.zoom = z;
    view.x = mx - ((gesture.cx - gesture.x) / gesture.zoom) * z;
    view.y = my - ((gesture.cy - gesture.y) / gesture.zoom) * z;
    view.auto = false;
    applyView();
  }

  zoomOutBtn.addEventListener('click', () => zoomStep(-1));
  zoomInBtn.addEventListener('click', () => zoomStep(1));
  zoomResetBtn.addEventListener('click', () => zoomAt(1));
  zoomFitBtn.addEventListener('click', fitView);

  /* ------------------------------------------------------------------
     Layers
  ------------------------------------------------------------------ */
  let layerSeq = 0;

  function makeLayer(name, w = W, h = H) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const thumb = document.createElement('canvas');
    thumb.width = 44;
    thumb.height = 32;
    thumb.className = 'thumb';
    return {
      id: ++layerSeq,
      name,
      canvas,
      ctx: canvas.getContext('2d', { willReadFrequently: true }),
      thumb,
      tctx: thumb.getContext('2d'),
      visible: true,
      opacity: 1,
      rev: 0, // bumped whenever pixels change
      savedRev: -1, // the rev the cached blob was encoded from
      blob: null,
    };
  }

  function nextLayerName() {
    let n = layers.length + 1;
    while (layers.some((l) => l.name === `Layer ${n}`)) n++;
    return `Layer ${n}`;
  }

  function applyLayerStyle(layer) {
    layer.canvas.style.display = layer.visible ? '' : 'none';
    layer.canvas.style.opacity = layer.opacity;
  }

  // Put the layer canvases in the right order, with the stroke overlay just above the active one.
  function syncStack() {
    layers.forEach((l) => {
      layersEl.appendChild(l.canvas);
      applyLayerStyle(l);
    });
    if (active) active.canvas.after(overlay);
    else layersEl.appendChild(overlay);
  }

  const thumbQueue = new Set();
  let thumbRaf = 0;
  function drawThumb(layer) {
    const { tctx: t, thumb } = layer;
    t.clearRect(0, 0, thumb.width, thumb.height);
    const s = Math.min(thumb.width / W, thumb.height / H);
    const dw = W * s;
    const dh = H * s;
    t.imageSmoothingQuality = 'high';
    t.drawImage(layer.canvas, (thumb.width - dw) / 2, (thumb.height - dh) / 2, dw, dh);
  }
  function scheduleThumb(layer) {
    thumbQueue.add(layer);
    if (thumbRaf) return;
    thumbRaf = requestAnimationFrame(() => {
      thumbRaf = 0;
      thumbQueue.forEach(drawThumb);
      thumbQueue.clear();
    });
  }

  // Call whenever a layer's pixels change.
  function touch(layer) {
    layer.rev++;
    scheduleThumb(layer);
    scheduleSave();
  }

  function insertLayer(layer, index) {
    layers.splice(clamp(index, 0, layers.length), 0, layer);
  }

  function removeLayer(layer) {
    const i = layers.indexOf(layer);
    if (i < 0) return -1;
    layers.splice(i, 1);
    layer.canvas.remove();
    if (active === layer) active = layers[Math.min(i, layers.length - 1)] || null;
    return i;
  }

  function moveLayerTo(layer, index) {
    const i = layers.indexOf(layer);
    if (i < 0) return;
    layers.splice(i, 1);
    layers.splice(clamp(index, 0, layers.length), 0, layer);
  }

  function setActive(layer) {
    if (drawing || !layer || layer === active) return;
    active = layer;
    syncStack();
    renderLayers();
  }

  function afterStructure() {
    if (!layers.includes(active)) active = layers[layers.length - 1] || null;
    syncStack();
    renderLayers();
    syncHistoryButtons();
    scheduleSave();
  }

  function layerRow(layer) {
    const li = document.createElement('li');
    li.className = 'layer-row' + (layer === active ? ' is-active' : '') + (layer.visible ? '' : ' is-hidden');
    li.dataset.id = layer.id;

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'eye';
    eye.title = layer.visible ? 'Hide layer' : 'Show layer';
    eye.setAttribute('aria-label', `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`);
    eye.append(icon(layer.visible ? 'i-eye' : 'i-eye-off'));

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'layer-main';
    main.title = 'Select layer (double-click to rename)';
    if (layer === active) main.setAttribute('aria-current', 'true');
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = layer.name;
    drawThumb(layer);
    main.append(layer.thumb, name);

    li.append(eye, main);
    return li;
  }

  function paperRow() {
    const li = document.createElement('li');
    li.className = 'layer-row paper-row' + (paperVisible ? '' : ' is-hidden');

    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'eye';
    eye.title = paperVisible ? 'Hide paper (transparent background)' : 'Show paper';
    eye.setAttribute('aria-label', paperVisible ? 'Hide paper' : 'Show paper');
    eye.append(icon(paperVisible ? 'i-eye' : 'i-eye-off'));

    const main = document.createElement('div');
    main.className = 'layer-main';
    const swatch = document.createElement('span');
    swatch.className = 'thumb paper-swatch';
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = 'Paper';
    main.append(swatch, name);

    li.append(eye, main);
    return li;
  }

  function renderLayers() {
    layerList.replaceChildren(...[...layers].reverse().map(layerRow), paperRow());

    const i = layers.indexOf(active);
    layerUpBtn.disabled = i < 0 || i >= layers.length - 1;
    layerDownBtn.disabled = i <= 0;
    layerMergeBtn.disabled = i <= 0;
    layerAddBtn.disabled = layers.length >= MAX_LAYERS;
    layerDuplicateBtn.disabled = !active || layers.length >= MAX_LAYERS;
    layerDeleteBtn.disabled = !active;

    const pct = active ? Math.round(active.opacity * 100) : 100;
    layerOpacity.value = pct;
    layerOpacity.disabled = !active;
    layerOpacityOut.textContent = pct + '%';
    paintRange(layerOpacity);

    paper.classList.toggle('is-clear', !paperVisible);
  }

  function startRename(layer, row) {
    const main = $('.layer-main', row);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-rename';
    input.value = layer.name;
    input.maxLength = 30;
    input.setAttribute('aria-label', 'Layer name');
    main.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== layer.name) {
        layer.name = v;
        scheduleSave();
      }
      renderLayers();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  layerList.addEventListener('click', (e) => {
    const row = e.target.closest('.layer-row');
    if (!row) return;
    if (row.classList.contains('paper-row')) {
      if (e.target.closest('.eye')) {
        paperVisible = !paperVisible;
        renderLayers();
        scheduleSave();
      }
      return;
    }
    const layer = layers.find((l) => String(l.id) === row.dataset.id);
    if (!layer) return;
    if (e.target.closest('.eye')) {
      layer.visible = !layer.visible;
      applyLayerStyle(layer);
      renderLayers();
      scheduleSave();
    } else {
      setActive(layer);
    }
  });

  layerList.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.layer-row');
    if (!row || row.classList.contains('paper-row') || !e.target.closest('.layer-main')) return;
    const layer = layers.find((l) => String(l.id) === row.dataset.id);
    if (layer) startRename(layer, row);
  });

  layerOpacity.addEventListener('input', () => {
    if (!active) return;
    active.opacity = clamp(+layerOpacity.value, 5, 100) / 100;
    applyLayerStyle(active);
    layerOpacityOut.textContent = layerOpacity.value + '%';
    paintRange(layerOpacity);
    scheduleSave();
  });

  function addLayer() {
    if (layers.length >= MAX_LAYERS) return toast(`You can have up to ${MAX_LAYERS} layers`);
    const layer = makeLayer(nextLayerName());
    const index = layers.indexOf(active) + 1;
    insertLayer(layer, index);
    active = layer;
    touch(layer);
    pushHistory({ type: 'add', layer, index });
    afterStructure();
  }

  function duplicateLayer() {
    if (!active) return;
    if (layers.length >= MAX_LAYERS) return toast(`You can have up to ${MAX_LAYERS} layers`);
    const src = active;
    const copy = makeLayer(`${src.name} copy`.slice(0, 30));
    copy.ctx.drawImage(src.canvas, 0, 0);
    copy.opacity = src.opacity;
    copy.visible = src.visible;
    const index = layers.indexOf(src) + 1;
    insertLayer(copy, index);
    active = copy;
    touch(copy);
    pushHistory({ type: 'add', layer: copy, index });
    afterStructure();
  }

  function deleteLayer() {
    if (!active) return;
    if (layers.length <= 1) return clearLayer();
    const layer = active;
    const index = removeLayer(layer);
    pushHistory({ type: 'remove', layer, index, bytes: W * H * 4 });
    afterStructure();
    toast(`Deleted ${layer.name}`, { label: 'Undo', run: undo });
  }

  function moveLayer(dir) {
    const from = layers.indexOf(active);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= layers.length) return;
    moveLayerTo(active, to);
    pushHistory({ type: 'reorder', layer: active, from, to });
    afterStructure();
  }

  function mergeDown() {
    const i = layers.indexOf(active);
    if (i <= 0) return toast('There is no layer below to merge into');
    const top = layers[i];
    const bottom = layers[i - 1];
    const before = bottom.ctx.getImageData(0, 0, W, H);
    if (top.visible) {
      bottom.ctx.save();
      bottom.ctx.globalAlpha = top.opacity;
      bottom.ctx.drawImage(top.canvas, 0, 0);
      bottom.ctx.restore();
    }
    const after = bottom.ctx.getImageData(0, 0, W, H);
    removeLayer(top);
    active = bottom;
    pushHistory({
      type: 'group',
      bytes: 3 * W * H * 4,
      entries: [
        { type: 'pixels', layer: bottom, rect: { x: 0, y: 0, w: W, h: H }, before, after },
        { type: 'remove', layer: top, index: i },
      ],
    });
    touch(bottom);
    afterStructure();
  }

  function clearLayer() {
    if (drawing || !active) return;
    const layer = active;
    beginEdit(layer);
    layer.ctx.clearRect(0, 0, W, H);
    endEdit(null);
    toast(`Cleared ${layer.name}`, { label: 'Undo', run: undo });
  }

  layerAddBtn.addEventListener('click', addLayer);
  layerDuplicateBtn.addEventListener('click', duplicateLayer);
  layerMergeBtn.addEventListener('click', mergeDown);
  layerUpBtn.addEventListener('click', () => moveLayer(1));
  layerDownBtn.addEventListener('click', () => moveLayer(-1));
  layerDeleteBtn.addEventListener('click', deleteLayer);

  /* ------------------------------------------------------------------
     Document
  ------------------------------------------------------------------ */
  function setDocument(w, h, list, activeIndex, paperOn) {
    cancelText();
    layers.forEach((l) => l.canvas.remove());
    W = w;
    H = h;
    overlay.width = w;
    overlay.height = h;
    paper.style.width = w + 'px';
    paper.style.height = h + 'px';
    layers = list;
    active = layers[clamp(activeIndex, 0, layers.length - 1)];
    paperVisible = paperOn;
    dimsEl.textContent = `${w} × ${h}`;
    undoStack.length = 0;
    redoStack.length = 0;
    syncStack();
    renderLayers();
    syncHistoryButtons();
    fitView();
  }

  function newDocument(w, h) {
    setDocument(w, h, [makeLayer('Layer 1', w, h)], 0, true);
  }

  // Combine visible layers (and the paper) into one canvas.
  function flatten() {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const x = c.getContext('2d');
    if (paperVisible) {
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, W, H);
    }
    for (const l of layers) {
      if (!l.visible) continue;
      x.globalAlpha = l.opacity;
      x.drawImage(l.canvas, 0, 0);
    }
    return c;
  }

  function sampleColor(x, y) {
    const c = sampleCtx;
    c.clearRect(0, 0, 1, 1);
    c.globalAlpha = 1;
    if (paperVisible) {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, 1, 1);
    }
    for (const l of layers) {
      if (!l.visible) continue;
      c.globalAlpha = l.opacity;
      c.drawImage(l.canvas, x, y, 1, 1, 0, 0, 1, 1);
    }
    c.globalAlpha = 1;
    return c.getImageData(0, 0, 1, 1).data;
  }

  /* ------------------------------------------------------------------
     Undo / redo
  ------------------------------------------------------------------ */
  const undoStack = [];
  const redoStack = [];

  function pushHistory(entry) {
    entry.bytes = entry.bytes || 0;
    undoStack.push(entry);
    redoStack.length = 0;
    let total = undoStack.reduce((s, e) => s + e.bytes, 0);
    while (undoStack.length > MAX_STEPS || (total > HISTORY_BUDGET && undoStack.length > 1)) {
      total -= undoStack.shift().bytes;
    }
    syncHistoryButtons();
  }

  function applyEntry(e, dir) {
    const undoing = dir === 'undo';
    switch (e.type) {
      case 'pixels':
        e.layer.ctx.putImageData(undoing ? e.before : e.after, e.rect.x, e.rect.y);
        touch(e.layer);
        break;
      case 'add':
        if (undoing) removeLayer(e.layer);
        else {
          insertLayer(e.layer, e.index);
          active = e.layer;
        }
        break;
      case 'remove':
        if (undoing) {
          insertLayer(e.layer, e.index);
          active = e.layer;
        } else removeLayer(e.layer);
        break;
      case 'reorder':
        moveLayerTo(e.layer, undoing ? e.from : e.to);
        break;
      case 'group':
        (undoing ? [...e.entries].reverse() : e.entries).forEach((sub) => applyEntry(sub, dir));
        break;
    }
  }

  const busy = () => drawing || !!gesture || !!pan;

  function undo() {
    if (busy() || !undoStack.length) return;
    const e = undoStack.pop();
    applyEntry(e, 'undo');
    redoStack.push(e);
    afterStructure();
  }

  function redo() {
    if (busy() || !redoStack.length) return;
    const e = redoStack.pop();
    applyEntry(e, 'redo');
    undoStack.push(e);
    afterStructure();
  }

  function syncHistoryButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  // Pixel edits: capture the layer before, then store just the changed rectangle.
  function beginEdit(layer) {
    editBase = { layer, data: layer.ctx.getImageData(0, 0, W, H) };
  }

  function cropImage(img, r) {
    if (r.x === 0 && r.y === 0 && r.w === img.width && r.h === img.height) return img;
    const out = new ImageData(r.w, r.h);
    for (let y = 0; y < r.h; y++) {
      const s = ((r.y + y) * img.width + r.x) * 4;
      out.data.set(img.data.subarray(s, s + r.w * 4), y * r.w * 4);
    }
    return out;
  }

  function endEdit(rect) {
    const base = editBase;
    editBase = null;
    if (!base) return;
    const r = rect || { x: 0, y: 0, w: W, h: H };
    if (r.w <= 0 || r.h <= 0) return;
    const before = cropImage(base.data, r);
    const after = base.layer.ctx.getImageData(r.x, r.y, r.w, r.h);
    pushHistory({ type: 'pixels', layer: base.layer, rect: r, before, after, bytes: before.data.length + after.data.length });
    touch(base.layer);
    syncHistoryButtons();
  }

  function rollbackEdit() {
    if (editBase) editBase.layer.ctx.putImageData(editBase.data, 0, 0);
    editBase = null;
  }

  /* ------------------------------------------------------------------
     Autosave (IndexedDB, with a localStorage fallback for older saves)
  ------------------------------------------------------------------ */
  const DB_NAME = 'doodle-studio';
  const DB_STORE = 'docs';
  const DB_KEY = 'current';
  let dbPromise = null;

  function openDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function dbGet() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(DB_STORE).objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPut(doc) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(doc, DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  let saveTimer = 0;
  let savePending = false;
  let saveRunning = false;
  let saveAgain = false;

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

  async function saveNow() {
    clearTimeout(saveTimer);
    if (saveRunning) {
      saveAgain = true;
      return;
    }
    if (!layers.length) return;
    saveRunning = true;
    savePending = false;
    try {
      const list = layers.slice();
      const doc = { v: 2, w: W, h: H, paper: paperVisible, active: layers.indexOf(active), layers: [] };
      for (const l of list) {
        if (!l.blob || l.savedRev !== l.rev) {
          const rev = l.rev;
          l.blob = await canvasToBlob(l.canvas);
          l.savedRev = rev;
        }
        doc.layers.push({ name: l.name, visible: l.visible, opacity: l.opacity, blob: l.blob });
      }
      await dbPut(doc);
      if (!saveAgain && !savePending) setSaveState('saved');
    } catch {
      setSaveState('failed');
    } finally {
      saveRunning = false;
      if (saveAgain) {
        saveAgain = false;
        scheduleSave();
      }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && savePending) saveNow();
  });

  async function loadSavedDocument(doc) {
    const w = clamp(Number(doc.w) || 0, MIN_SIDE, MAX_SIDE);
    const h = clamp(Number(doc.h) || 0, MIN_SIDE, MAX_SIDE);
    const list = [];
    for (const item of doc.layers.slice(0, MAX_LAYERS)) {
      const layer = makeLayer(String(item.name || `Layer ${list.length + 1}`).slice(0, 30), w, h);
      layer.visible = item.visible !== false;
      layer.opacity = Number.isFinite(item.opacity) ? clamp(item.opacity, 0.05, 1) : 1;
      if (item.blob) {
        layer.ctx.drawImage(await loadBlobImage(item.blob), 0, 0);
        layer.blob = item.blob;
        layer.rev = 0;
        layer.savedRev = 0;
      }
      list.push(layer);
    }
    if (!list.length) throw new Error('Empty document');
    setDocument(w, h, list, Number.isInteger(doc.active) ? doc.active : list.length - 1, doc.paper !== false);
  }

  function startFresh() {
    const narrow = window.matchMedia('(max-width: 860px)').matches;
    newDocument(narrow ? 900 : 1280, narrow ? 1200 : 800);
  }

  async function restore() {
    try {
      const doc = await dbGet();
      if (doc && Array.isArray(doc.layers) && doc.layers.length) {
        await loadSavedDocument(doc);
        return;
      }
    } catch {
      /* fall through */
    }
    // Drawings saved by the first version of the app live in localStorage.
    const legacy = store.get('canvas', null);
    if (legacy && typeof legacy.data === 'string') {
      try {
        const img = await loadImage(legacy.data);
        const w = clamp(Number(legacy.w) || img.width, MIN_SIDE, MAX_SIDE);
        const h = clamp(Number(legacy.h) || img.height, MIN_SIDE, MAX_SIDE);
        const layer = makeLayer('Layer 1', w, h);
        layer.ctx.drawImage(img, 0, 0);
        setDocument(w, h, [layer], 0, true);
        touch(layer);
        store.remove('canvas');
        return;
      } catch {
        /* fall through */
      }
    }
    startFresh();
  }

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
    stage.dataset.tool = state.tool;
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
    positionTextEditor();
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
     Size, opacity, tolerance, shape, text options
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
    positionTextEditor();
  }

  function setTolerance(v) {
    state.tolerance = clamp(Math.round(v), 0, 100);
    toleranceInput.value = state.tolerance;
    toleranceOut.textContent = state.tolerance + '%';
    paintRange(toleranceInput);
    store.set('tolerance', state.tolerance);
  }

  function setTextSize(v) {
    state.textSize = clamp(Math.round(v), 8, 200);
    textSizeInput.value = state.textSize;
    textSizeOut.textContent = state.textSize + ' px';
    paintRange(textSizeInput);
    store.set('textSize', state.textSize);
    positionTextEditor();
  }

  function setShape(shape) {
    state.shape = shape;
    $$('[data-shape]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.shape === shape)));
  }

  function setSample(sample) {
    state.sample = sample;
    $$('[data-sample]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sample === sample)));
  }

  function syncFormat() {
    $$('[data-fmt]').forEach((b) => b.setAttribute('aria-pressed', String(state[b.dataset.fmt])));
  }

  sizeInput.addEventListener('input', () => setSize(+sizeInput.value));
  opacityInput.addEventListener('input', () => setOpacity(+opacityInput.value));
  toleranceInput.addEventListener('input', () => setTolerance(+toleranceInput.value));
  textSizeInput.addEventListener('input', () => setTextSize(+textSizeInput.value));
  $$('[data-shape]').forEach((b) => b.addEventListener('click', () => setShape(b.dataset.shape)));
  $$('[data-sample]').forEach((b) => b.addEventListener('click', () => setSample(b.dataset.sample)));
  $$('[data-fmt]').forEach((b) =>
    b.addEventListener('click', () => {
      state[b.dataset.fmt] = !state[b.dataset.fmt];
      syncFormat();
      positionTextEditor();
    })
  );
  fontSelect.addEventListener('change', () => {
    state.font = FONTS[fontSelect.value] ? fontSelect.value : 'sans';
    store.set('font', state.font);
    positionTextEditor();
  });

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
    ring.style.width = ring.style.height = Math.max(diameter * view.zoom, 4) + 'px';
  }

  /* ------------------------------------------------------------------
     Drawing
  ------------------------------------------------------------------ */
  function grow(p) {
    bounds.x0 = Math.min(bounds.x0, p.x);
    bounds.y0 = Math.min(bounds.y0, p.y);
    bounds.x1 = Math.max(bounds.x1, p.x);
    bounds.y1 = Math.max(bounds.y1, p.y);
  }

  // The rectangle (in canvas pixels) that the current stroke may have touched.
  function strokeRect() {
    let pad = state.size / 2 + 2;
    if (state.tool === 'spray') pad = state.size * 1.6 + 2 + Math.max(0.6, state.size / 22) + 2;
    const x0 = clamp(Math.floor(bounds.x0 - pad), 0, W);
    const y0 = clamp(Math.floor(bounds.y0 - pad), 0, H);
    const x1 = clamp(Math.ceil(bounds.x1 + pad), 0, W);
    const y1 = clamp(Math.ceil(bounds.y1 + pad), 0, H);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // Brush, spray and shapes are drawn opaque on a transparent overlay that sits above the
  // active layer, shown at the chosen opacity, then merged in on release. That way overlapping
  // parts of one stroke never build up darker. The eraser works on the layer directly.
  function prepareStroke() {
    const erasing = state.tool === 'eraser';
    strokeCtx = erasing ? strokeLayer.ctx : octx;
    const c = strokeCtx;
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = state.size;
    if (erasing) {
      c.globalCompositeOperation = 'destination-out';
      c.globalAlpha = state.opacity / 100;
      c.strokeStyle = c.fillStyle = '#000000';
    } else {
      c.strokeStyle = c.fillStyle = state.color;
      overlay.style.opacity = (state.opacity / 100) * strokeLayer.opacity;
    }
  }

  function finishStrokeCtx() {
    if (strokeCtx) {
      strokeCtx.restore();
      strokeCtx = null;
    }
  }

  function clearOverlay() {
    octx.clearRect(0, 0, W, H);
    overlay.style.opacity = '';
  }

  function commitOverlay() {
    const c = strokeLayer.ctx;
    c.save();
    c.globalAlpha = state.opacity / 100;
    c.drawImage(overlay, 0, 0);
    c.restore();
    clearOverlay();
  }

  function dot(p) {
    strokeCtx.beginPath();
    strokeCtx.arc(p.x, p.y, state.size / 2, 0, Math.PI * 2);
    strokeCtx.fill();
  }

  // Smooth freehand lines: curve through the midpoints between pointer samples.
  function strokeTo(p) {
    const m = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    strokeCtx.beginPath();
    strokeCtx.moveTo(mid.x, mid.y);
    strokeCtx.quadraticCurveTo(last.x, last.y, m.x, m.y);
    strokeCtx.stroke();
    last = p;
    mid = m;
  }

  function sprayTick() {
    if (!drawing || state.tool !== 'spray') return;
    const radius = state.size * 1.6 + 2;
    const count = Math.ceil(radius * 0.9);
    const dotR = Math.max(0.6, state.size / 22);
    strokeCtx.beginPath();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * Math.sqrt(Math.random());
      const x = last.x + Math.cos(a) * r;
      const y = last.y + Math.sin(a) * r;
      strokeCtx.moveTo(x + dotR, y);
      strokeCtx.arc(x, y, dotR, 0, Math.PI * 2);
    }
    strokeCtx.fill();
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
    grow({ x: x2, y: y2 });

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
      if (state.shape === 'filled') octx.fill();
      else octx.stroke();
    }
  }

  function moveContent(p) {
    const dx = Math.round(p.x - start.x);
    const dy = Math.round(p.y - start.y);
    const c = strokeLayer.ctx;
    c.clearRect(0, 0, W, H);
    c.drawImage(moveTmp, dx, dy);
  }

  function handleMove(p) {
    grow(p);
    if (!moved && Math.hypot(p.x - start.x, p.y - start.y) > 1) moved = true;
    const tool = state.tool;
    if (tool === 'brush' || tool === 'eraser') strokeTo(p);
    else if (tool === 'move') moveContent(p);
    else last = p; // spray and shapes just track the latest position
  }

  function endStroke(cancelled) {
    if (!drawing) return;
    drawing = false;
    cancelAnimationFrame(sprayRaf);
    const tool = state.tool;

    if (cancelled) {
      finishStrokeCtx();
      clearOverlay();
      rollbackEdit();
      moveTmp = null;
      return;
    }

    if (tool === 'move') {
      moveTmp = null;
      if (moved) endEdit(null);
      else editBase = null;
      return;
    }

    if (tool === 'brush' || tool === 'eraser') {
      strokeCtx.beginPath();
      strokeCtx.moveTo(mid.x, mid.y);
      strokeCtx.lineTo(last.x, last.y);
      strokeCtx.stroke();
    } else if (SHAPE_TOOLS.has(tool)) {
      if (!moved) {
        finishStrokeCtx();
        clearOverlay();
        editBase = null;
        return;
      }
      drawShape();
    }

    finishStrokeCtx();
    if (tool !== 'eraser') commitOverlay();
    endEdit(strokeRect());
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.target === textInput) return;

    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) {
        startGesture();
        return;
      }
    }
    if (gesture || drawing || pan || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button > 1) return; // left and middle only

    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    if ((e.pointerType === 'mouse' && e.button === 1) || state.tool === 'hand' || spaceDown) {
      startPan(e);
      return;
    }
    if (!active) return;

    const p = toCanvas(e);
    if (state.tool === 'picker') return pickColorAt(p.x, p.y);
    if (NEEDS_LAYER.has(state.tool) && !active.visible) {
      toast('This layer is hidden. Show it to draw on it.');
      return;
    }
    if (state.tool === 'fill') return floodFillAt(p.x, p.y);
    if (state.tool === 'text') return openTextEditor(p);

    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drawing = true;
    moved = false;
    shiftKey = e.shiftKey;
    start = last = mid = p;
    bounds = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    strokeLayer = active;
    beginEdit(strokeLayer);

    if (state.tool === 'move') {
      moveTmp = document.createElement('canvas');
      moveTmp.width = W;
      moveTmp.height = H;
      moveTmp.getContext('2d').drawImage(strokeLayer.canvas, 0, 0);
      return;
    }

    prepareStroke();
    if (state.tool === 'brush' || state.tool === 'eraser') dot(p);
    else if (state.tool === 'spray') sprayTick();
  });

  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture) {
        if (touches.size >= 2) updateGesture();
        return;
      }
    }
    if (pan && e.pointerId === pan.id) {
      movePan(e);
      return;
    }
    updateHover(e);
    if (!drawing || !e.isPrimary) return;
    shiftKey = e.shiftKey;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) handleMove(toCanvas(ev));
    if (SHAPE_TOOLS.has(state.tool)) drawShape();
  });

  function onPointerEnd(e, cancelled) {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (!touches.size) gesture = null;
    }
    if (pan && e.pointerId === pan.id) {
      endPan();
      return;
    }
    if (drawing && e.isPrimary) endStroke(cancelled);
    // A just-opened text box gets focus here too: iOS only raises the keyboard from a real tap.
    if (textEdit && !textInput.hidden && document.activeElement !== textInput) textInput.focus({ preventScroll: true });
  }

  stage.addEventListener('pointerup', (e) => onPointerEnd(e, false));
  stage.addEventListener('pointercancel', (e) => onPointerEnd(e, true));
  stage.addEventListener('contextmenu', (e) => {
    if (e.target !== textInput) e.preventDefault();
  });
  stage.addEventListener('pointerleave', () => {
    ring.hidden = true;
    if (!drawing) coordsEl.textContent = '–';
  });

  function updateHover(e) {
    const p = toCanvas(e);
    coordsEl.textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
    if (e.pointerType === 'mouse' && RING_TOOLS.has(state.tool) && !spaceDown) {
      const s = stage.getBoundingClientRect();
      ring.hidden = false;
      ring.style.transform = `translate(${e.clientX - s.left}px, ${e.clientY - s.top}px) translate(-50%, -50%)`;
    } else {
      ring.hidden = true;
    }
  }

  /* ------------------------------------------------------------------
     Fill + eyedropper
  ------------------------------------------------------------------ */

  /* fill:start */
  // Scanline flood fill. Reads `d` (RGBA) and returns a mask of matching pixels
  // (1 = matched, 2 = grown by one pixel) plus its bounding box.
  function computeFillMask(d, w, h, sx, sy, tolerance, grow) {
    const s = (sy * w + sx) * 4;
    const tr = d[s], tg = d[s + 1], tb = d[s + 2], ta = d[s + 3];
    const seen = new Uint8Array(w * h);
    const match = (i) =>
      Math.abs(d[i] - tr) <= tolerance &&
      Math.abs(d[i + 1] - tg) <= tolerance &&
      Math.abs(d[i + 2] - tb) <= tolerance &&
      Math.abs(d[i + 3] - ta) <= tolerance;

    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop();
      let x = stack.pop();
      if (seen[y * w + x]) continue;
      while (x >= 0 && !seen[y * w + x] && match((y * w + x) * 4)) x--;
      x++;
      const xs = x;
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
      if (xs < x0) x0 = xs;
      if (x - 1 > x1) x1 = x - 1;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }

    // Grow the fill by one pixel so it tucks under anti-aliased edges (skipped at 0% tolerance).
    if (grow && x1 >= 0) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * w + x;
          if (seen[i] !== 1) continue;
          if (x > 0 && !seen[i - 1]) seen[i - 1] = 2;
          if (x < w - 1 && !seen[i + 1]) seen[i + 1] = 2;
          if (y > 0 && !seen[i - w]) seen[i - w] = 2;
          if (y < h - 1 && !seen[i + w]) seen[i + w] = 2;
        }
      }
      x0 = Math.max(0, x0 - 1);
      y0 = Math.max(0, y0 - 1);
      x1 = Math.min(w - 1, x1 + 1);
      y1 = Math.min(h - 1, y1 + 1);
    }
    return { seen, bbox: { x0, y0, x1, y1 } };
  }

  // Paint the masked pixels into `d` with normal ("source over") blending.
  function paintMask(d, w, seen, bbox, rgb, alpha) {
    const [fr, fg, fb] = rgb;
    for (let y = bbox.y0; y <= bbox.y1; y++) {
      for (let x = bbox.x0; x <= bbox.x1; x++) {
        const i = y * w + x;
        if (!seen[i]) continue;
        const p = i * 4;
        const da = d[p + 3] / 255;
        const oa = alpha + da * (1 - alpha);
        if (oa > 0) {
          const k = da * (1 - alpha);
          d[p] = (fr * alpha + d[p] * k) / oa;
          d[p + 1] = (fg * alpha + d[p + 1] * k) / oa;
          d[p + 2] = (fb * alpha + d[p + 2] * k) / oa;
        }
        d[p + 3] = oa * 255;
      }
    }
  }
  /* fill:end */

  function floodFillAt(px, py) {
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const layer = active;
    const target = layer.ctx.getImageData(0, 0, W, H);
    const source = state.sample === 'all' ? flatten().getContext('2d').getImageData(0, 0, W, H) : target;
    const rgb = hexToRgb(state.color);
    const alpha = state.opacity / 100;

    const s = (y * W + x) * 4;
    const sd = source.data;
    if (alpha >= 1 && sd[s] === rgb[0] && sd[s + 1] === rgb[1] && sd[s + 2] === rgb[2] && sd[s + 3] === 255) return;

    const { seen, bbox } = computeFillMask(sd, W, H, x, y, state.tolerance * 2.55, state.tolerance > 0);
    if (bbox.x1 < bbox.x0) return;
    const rect = { x: bbox.x0, y: bbox.y0, w: bbox.x1 - bbox.x0 + 1, h: bbox.y1 - bbox.y0 + 1 };

    const before = cropImage(target, rect);
    const beforeCopy = before === target ? new ImageData(new Uint8ClampedArray(target.data), W, H) : before;
    paintMask(target.data, W, seen, bbox, rgb, alpha);
    layer.ctx.putImageData(target, 0, 0, rect.x, rect.y, rect.w, rect.h);
    const after = cropImage(target, rect);
    pushHistory({ type: 'pixels', layer, rect, before: beforeCopy, after, bytes: beforeCopy.data.length + after.data.length });
    touch(layer);
  }

  function pickColorAt(px, py) {
    const x = clamp(Math.floor(px), 0, W - 1);
    const y = clamp(Math.floor(py), 0, H - 1);
    let [r, g, b, a] = sampleColor(x, y);
    if (a === 0) [r, g, b] = [255, 255, 255]; // nothing there: treat as paper
    const hex = rgbToHex(r, g, b);
    setColor(hex);
    addRecent(hex);
    setTool(state.prevTool === 'eraser' ? 'brush' : state.prevTool);
    toast(`Picked ${hex}`);
  }

  /* ------------------------------------------------------------------
     Text
  ------------------------------------------------------------------ */
  const textFont = (px) =>
    `${state.italic ? 'italic ' : ''}${state.bold ? 700 : 400} ${px}px ${FONTS[state.font]}`;

  function openTextEditor(p) {
    textEdit = { x: p.x, y: p.y };
    textInput.value = '';
    textInput.hidden = false;
    positionTextEditor();
    // Focus after the pointer event finishes, otherwise the browser moves focus back.
    setTimeout(() => textInput.focus({ preventScroll: true }), 0);
  }

  function positionTextEditor() {
    if (!textEdit) return;
    const r = paper.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const z = view.zoom;
    Object.assign(textInput.style, {
      left: r.left - s.left + textEdit.x * z + 'px',
      top: r.top - s.top + textEdit.y * z + 'px',
      font: textFont(state.textSize * z),
      lineHeight: String(LINE_HEIGHT),
      color: state.color,
      opacity: String(state.opacity / 100),
    });
    fitTextEditor();
  }

  function fitTextEditor() {
    const z = view.zoom;
    const lines = textInput.value.split('\n');
    measureCtx.font = textFont(state.textSize * z);
    const width = Math.max(...lines.map((l) => measureCtx.measureText(l || ' ').width));
    textInput.style.width = Math.ceil(width + 4) + 'px';
    textInput.style.height = Math.ceil(lines.length * state.textSize * z * LINE_HEIGHT) + 'px';
  }

  function hideTextEditor() {
    textEdit = null;
    textInput.hidden = true;
    textInput.value = '';
  }

  function cancelText() {
    hideTextEditor();
  }

  function commitText() {
    const t = textEdit;
    if (!t) return;
    const value = textInput.value;
    hideTextEditor();
    if (!value.trim() || !active || !active.visible) return;

    const layer = active;
    const lines = value.split('\n');
    const size = state.textSize;
    const lh = size * LINE_HEIGHT;

    beginEdit(layer);
    const c = layer.ctx;
    c.save();
    c.globalAlpha = state.opacity / 100;
    c.fillStyle = state.color;
    c.font = textFont(size);
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    let widest = 0;
    lines.forEach((line, i) => {
      c.fillText(line, t.x, t.y + (i + 0.5) * lh);
      widest = Math.max(widest, c.measureText(line).width);
    });
    c.restore();

    const pad = Math.ceil(size * 0.3) + 2;
    const x0 = clamp(Math.floor(t.x - pad), 0, W);
    const y0 = clamp(Math.floor(t.y - pad), 0, H);
    const x1 = clamp(Math.ceil(t.x + widest + pad), 0, W);
    const y1 = clamp(Math.ceil(t.y + lines.length * lh + pad), 0, H);
    endEdit({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }

  textInput.addEventListener('input', fitTextEditor);
  textInput.addEventListener('blur', commitText);
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      hideTextEditor();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitText();
    }
  });

  /* ------------------------------------------------------------------
     Canvas actions: new, import, copy, save
  ------------------------------------------------------------------ */
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
    newDocument(w, h);
    scheduleSave();
    toast(`Created a ${w} × ${h} canvas`);
  });

  async function importImage(file) {
    if (!file || !file.type.startsWith('image/')) return toast('That file is not an image');
    if (layers.length >= MAX_LAYERS) return toast(`You can have up to ${MAX_LAYERS} layers`);
    try {
      const img = await loadBlobImage(file);
      if (!img.width || !img.height) throw new Error('Empty image');
      const layer = makeLayer(file.name.replace(/\.[^.]+$/, '').slice(0, 30) || nextLayerName());
      const s = Math.min(W / img.width, H / img.height, 1);
      const w = img.width * s;
      const h = img.height * s;
      layer.ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      const index = layers.indexOf(active) + 1;
      insertLayer(layer, index);
      active = layer;
      touch(layer);
      pushHistory({ type: 'add', layer, index });
      afterStructure();
      toast('Added the image as a new layer');
    } catch {
      toast('Could not open that image');
    }
  }

  async function copyImage() {
    if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined') {
      return toast('Copying images is not supported in this browser. Use Save instead.');
    }
    try {
      // Passing a promise keeps Safari happy: it needs the write to start inside the click.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasToBlob(flatten()) })]);
      toast('Copied to the clipboard');
    } catch {
      toast('The browser blocked copying. Use Save instead.');
    }
  }

  async function savePNG() {
    try {
      const blob = await canvasToBlob(flatten());
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
    } catch {
      toast('Could not save the image');
    }
  }

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  clearBtn.addEventListener('click', clearLayer);
  newBtn.addEventListener('click', openNewDialog);
  importBtn.addEventListener('click', () => fileInput.click());
  copyBtn.addEventListener('click', copyImage);
  saveBtn.addEventListener('click', savePNG);
  helpBtn.addEventListener('click', () => helpDialog.showModal());
  $('#helpClose').addEventListener('click', () => helpDialog.close());
  $('#newCancel').addEventListener('click', () => newDialog.close('cancel'));
  fileInput.addEventListener('change', () => {
    importImage(fileInput.files[0]);
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
  ['dragleave', 'drop'].forEach((type) => stage.addEventListener(type, () => stage.classList.remove('is-dragging')));
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    importImage(e.dataTransfer?.files?.[0]);
  });
  document.addEventListener('paste', (e) => {
    if (e.target.matches?.('input, textarea')) return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) importImage(file);
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
  const TYPING = 'input[type="text"], input[type="number"], textarea, select';

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
      shiftKey = true;
      if (drawing && isShapeTool()) drawShape();
      return;
    }
    if (e.target.matches?.(TYPING)) return;
    if (document.querySelector('dialog[open]')) return;

    // Space pans, but only when nothing else has keyboard focus (so buttons still work with Space).
    if (e.key === ' ' && (e.target === document.body || e.target === document.documentElement)) {
      e.preventDefault();
      if (!e.repeat) {
        spaceDown = true;
        stage.classList.add('is-space');
        ring.hidden = true;
      }
      return;
    }

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
      } else if (key === 'c' && !String(window.getSelection() || '')) {
        e.preventDefault();
        copyImage();
      }
      return;
    }
    if (e.altKey) return;

    if (TOOL_KEYS[key]) setTool(TOOL_KEYS[key]);
    else if (key === '[') nudgeSize(-1);
    else if (key === ']') nudgeSize(1);
    else if (key === '+' || key === '=') zoomStep(1);
    else if (key === '-' || key === '_') zoomStep(-1);
    else if (key === '0') fitView();
    else if (key === '1') zoomAt(1);
    else if (e.key === '?') helpDialog.showModal();
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      shiftKey = false;
      if (drawing && isShapeTool()) drawShape();
    } else if (e.key === ' ' && spaceDown) {
      spaceDown = false;
      stage.classList.remove('is-space');
      e.preventDefault();
    }
  });

  /* ------------------------------------------------------------------
     Start up
  ------------------------------------------------------------------ */
  renderSwatches();
  setColor(state.color);
  setSize(state.size);
  setOpacity(state.opacity);
  setTolerance(state.tolerance);
  setTextSize(state.textSize);
  fontSelect.value = state.font;
  syncFormat();
  setShape(state.shape);
  setSample(state.sample);
  renderTool();
  syncHistoryButtons();
  setSaveState('saved');

  new ResizeObserver(() => (view.auto ? fitView() : applyView())).observe(stage);
  restore();
})();
