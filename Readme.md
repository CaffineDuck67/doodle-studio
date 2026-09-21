# Doodle Studio

A fast, free drawing app that runs entirely in your browser. No install, no account, no build step. Just open it and draw.

<!-- Add a screenshot: ![Doodle Studio](screenshot.png) -->

**Live demo:** [https://caffineduck67.github.io/doodle-studio/](https://caffineduck67.github.io/doodle-studio/)

## Features

- **Layers:** up to 12 layers with show/hide, per-layer opacity, rename (double-click), duplicate, reorder, merge down and delete. The paper can be hidden too, so exports become transparent
- **Text tool:** click to type right on the canvas, with four font styles, bold, italic and any size from 8 to 200 px. Multi-line text works
- **Zoom and pan:** zoom from 5% to 800% with the mouse wheel, pinch, the zoom buttons or the keyboard. Pan with the hand tool, by holding `Space`, or by scrolling
- **Copy to clipboard:** copy the finished image and paste it straight into a chat, document or another app
- **Eleven tools:** brush, spray, eraser, line, rectangle, ellipse, text, fill bucket, eyedropper, move and pan
- **Color:** color picker, 18-color palette, hex input and recently used colors
- **Brush controls:** size (1–100 px) and opacity sliders with a live preview, plus a brush outline that follows your cursor
- **Smooth strokes:** freehand lines are curve-smoothed, and mouse, touch and pen input all work
- **Shapes:** outline or filled rectangles and ellipses. Hold `Shift` for perfect squares and circles, or to snap lines to 45°
- **Smart fill:** flood fill with an adjustable tolerance. Choose **This layer** or **All layers** to color inside lines that live on a different layer
- **Real eraser:** erases to transparent, so lower layers show through
- **Move tool:** drag to reposition everything on a layer, which is handy for imported images
- **Undo and redo:** up to 100 steps, covering strokes, fills, text and every layer action
- **Autosave:** your whole drawing, layers included, is saved in the browser and restored when you come back
- **Import and export:** save as PNG, or import an image as a new layer by clicking, dragging it onto the canvas or pasting it
- **Custom canvas size:** presets or any size from 64 to 3000 px
- **Light and dark themes:** follows your system setting and remembers your choice
- **Responsive:** works on desktop, tablet and phone

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Brush | `B` |
| Spray | `S` |
| Eraser | `E` |
| Line | `L` |
| Rectangle | `R` |
| Ellipse | `O` |
| Text | `T` |
| Fill | `F` |
| Eyedropper | `I` |
| Move layer | `V` |
| Pan | `H` |
| Pan while held | `Space` |
| Smaller / larger size | `[` / `]` |
| Zoom in / out | `+` / `-` |
| Fit to window | `0` |
| Actual size (100%) | `1` |
| Undo | `Ctrl` + `Z` |
| Redo | `Ctrl` + `Shift` + `Z` (or `Ctrl` + `Y`) |
| Copy image | `Ctrl` + `C` |
| Save as PNG | `Ctrl` + `S` |
| Import image | `Ctrl` + `O` |
| Finish text | `Ctrl` + `Enter` (or click away) |
| Cancel text | `Esc` |
| Show shortcuts | `?` |

On a Mac, use `⌘` instead of `Ctrl`.

Other gestures: scroll to pan, `Ctrl` + scroll to zoom, middle-click and drag to pan, and pinch with two fingers on a touch screen.

## Run it locally

There is nothing to install. Clone the repo and open `index.html` in your browser:

```bash
git clone https://github.com/CaffineDuck67/doodle-studio.git
cd doodle-studio
```

If you prefer a local server, any static server works, for example:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy to GitHub Pages

1. Push the files to your repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select your default branch (for example `main`) and the `/ (root)` folder, then click **Save**.
5. After a minute or so, your site is live at [https://caffineduck67.github.io/doodle-studio/](https://caffineduck67.github.io/doodle-studio/).

## Project structure

```
├── index.html   # Markup, icon sprite and dialogs
├── style.css    # Theme, layout and components
└── script.js    # Layers, drawing engine, tools, history, autosave and shortcuts
```

## How it works

- **Layers.** Each layer is its own transparent canvas, stacked in the page and combined only when you save or copy. The paper is a separate white backdrop, which is why the eraser can truly erase and why you can export with a transparent background.
- **Zoom and pan.** The drawing keeps its real resolution (1280 × 800 by default, 900 × 1200 on narrow screens). A single CSS transform moves and scales it, and pointer positions are converted back to canvas pixels, so drawing stays accurate at any zoom. Past 300% the browser shows crisp pixels instead of blurring them.
- **Overlay stroke.** Strokes and shape previews are drawn on a transparent canvas just above the active layer, then committed when you lift the pointer. This is what makes opacity behave properly: overlapping parts of one stroke don't get darker.
- **Smooth lines.** Freehand strokes are drawn as quadratic curves through the midpoints between pointer samples, using coalesced pointer events when the browser provides them.
- **Flood fill.** A scanline fill on the raw pixel data, with a 1 px grow so the fill tucks under anti-aliased edges (skipped at 0% tolerance). It can read from the active layer or from all layers combined, and it always paints onto the active layer.
- **Undo history.** Each step stores only the rectangle that changed, not the whole canvas, so strokes cost a few kilobytes. Layer actions are stored as small entries of their own. The history is capped at 100 steps and about 128 MB.
- **Autosave.** After each change, layers are encoded as PNG blobs and written to IndexedDB. Only layers that changed are re-encoded, and IndexedDB has far more room than `localStorage`, so big multi-layer drawings fit. A drawing saved by the first version of the app is imported automatically as a single layer.
- **Copy to clipboard.** Uses the async Clipboard API with a PNG of the combined image. It needs a secure page (HTTPS, which GitHub Pages provides) and a browser that supports copying images. If copying isn't available, Save still works.

## Customize

| What | Where |
| --- | --- |
| Colors and theme | CSS variables at the top of `style.css` (`:root` and `:root[data-theme='dark']`) |
| Fonts (UI) | The Google Fonts link in `index.html` and `--font-ui` / `--font-display` in `style.css` |
| Fonts (text tool) | The `FONTS` object in `script.js` (and the matching `<option>` list in `index.html`) |
| Palette | The `PALETTE` array in `script.js` |
| Canvas size limits | `MIN_SIDE` and `MAX_SIDE` in `script.js` |
| Layer limit | `MAX_LAYERS` in `script.js` |
| Zoom range | `MIN_ZOOM` and `MAX_ZOOM` in `script.js` |
| Undo depth and memory | `MAX_STEPS` and `HISTORY_BUDGET` in `script.js` |

To reset the app to a clean state, clear the site's data in your browser. Settings are stored under keys that start with `doodle:`, and the drawing lives in an IndexedDB database called `doodle-studio`.

## Browser support

Any current version of Chrome, Edge, Firefox or Safari. The app uses Pointer Events, IndexedDB, the `<dialog>` element, `ResizeObserver` and `color-mix()`, so very old browsers are not supported. Copying an image to the clipboard needs a recent browser; Chrome, Edge, Safari and current Firefox all support it.

## Ideas for later

- Drag to reorder layers, and blend modes such as multiply and screen
- Rectangle select with cut, copy and paste
- Gradient fill and more brush types
- Export as JPG or WebP, and save a project file to share a drawing with its layers
