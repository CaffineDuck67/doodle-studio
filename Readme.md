# Doodle Studio

A fast, free drawing app that runs entirely in your browser. No install, no account, no build step. Just open it and draw.

<!-- Add a screenshot: ![Doodle Studio](screenshot.png) -->

**Live demo:** [https://caffineduck67.github.io/doodle-studio/](https://caffineduck67.github.io/doodle-studio/)

## Features

- **Eight tools:** brush, spray, eraser, line, rectangle, ellipse, fill bucket and eyedropper
- **Color:** color picker, 18-color palette, hex input and recently used colors
- **Brush controls:** size (1–100 px) and opacity sliders with a live preview, plus a brush outline that follows your cursor
- **Smooth strokes:** freehand lines are curve-smoothed, and mouse, touch and pen input all work
- **Shapes:** outline or filled rectangles and ellipses. Hold `Shift` for perfect squares and circles, or to snap lines to 45°
- **Smart fill:** flood fill with an adjustable tolerance so it can cross soft, anti-aliased edges
- **Undo and redo:** the number of steps adapts to canvas size to keep memory use in check
- **Autosave:** your drawing is saved in the browser and restored when you come back
- **Import and export:** save as PNG, or open an image by clicking, dragging it onto the canvas, or pasting it
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
| Fill | `F` |
| Eyedropper | `I` |
| Smaller / larger size | `[` / `]` |
| Undo | `Ctrl` + `Z` |
| Redo | `Ctrl` + `Shift` + `Z` (or `Ctrl` + `Y`) |
| Save as PNG | `Ctrl` + `S` |
| Open image | `Ctrl` + `O` |
| Show shortcuts | `?` |

On a Mac, use `⌘` instead of `Ctrl`.

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
└── script.js    # Drawing engine, tools, history, autosave and shortcuts
```

## How it works

- **Fixed-resolution canvas.** The drawing keeps its own resolution (1280 × 800 by default, 900 × 1200 on narrow screens) and is scaled with CSS to fit the window. Exports are always full size.
- **Overlay layer.** Strokes and shape previews are drawn on a transparent canvas above the drawing, then committed when you lift the pointer. This is what makes opacity behave properly: overlapping parts of one stroke don't get darker.
- **Smooth lines.** Freehand strokes are drawn as quadratic curves through the midpoints between pointer samples, using coalesced pointer events when the browser provides them.
- **Flood fill.** A scanline fill on the raw pixel data, with a 1 px grow so the fill tucks under anti-aliased edges (skipped at 0% tolerance).
- **Undo history.** Snapshots are stored as `ImageData` within a memory budget of about 96 MB, which is 4 to 50 steps depending on canvas size.
- **Autosave.** After each change, the drawing is saved as a PNG data URL in `localStorage`. Very large drawings may exceed the browser's storage quota, in which case the status bar shows "Autosave unavailable" and you can still save a PNG manually.

## Customize

| What | Where |
| --- | --- |
| Colors and theme | CSS variables at the top of `style.css` (`:root` and `:root[data-theme='dark']`) |
| Fonts | The Google Fonts link in `index.html` and `--font-ui` / `--font-display` in `style.css` |
| Palette | The `PALETTE` array in `script.js` |
| Canvas size limits | `MIN_SIDE` and `MAX_SIDE` in `script.js` |
| Undo memory budget | `HISTORY_BUDGET` in `script.js` |

To reset the app to a clean state, clear the site's data in your browser. Everything is stored under keys that start with `doodle:`.

## Browser support

Any current version of Chrome, Edge, Firefox or Safari. The app uses Pointer Events, the `<dialog>` element, `ResizeObserver` and `color-mix()`, so very old browsers are not supported.

## Ideas for later

- Text tool
- Layers
- Zoom and pan
- Copy to clipboard
