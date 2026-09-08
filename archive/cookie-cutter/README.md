# Cookie cutter (archived)

A manual disc cut-out tool that lived in `manage.html`. Removed on 2026-09-08
because the images are being cleaned up in other software instead. Nothing else
depends on it, and it is kept here in one piece so it can go back in.

## What it did

Opened from the photo tools in the product editor. It placed a circle over the
disc, using the same bright-region centroid the automatic backdrop pass uses,
and replaced everything outside that circle with a dark tint of the disc's own
strongest colour — the same colour rule and feathering as the automatic pass, so
a hand-cut photo matched the rest of the grid.

Controls: drag inside to move, drag any of the four edge handles to resize that
axis, scroll to scale both, arrow keys to nudge (shift for bigger steps),
`[` `]` for width, `;` `'` for height, `-` `=` for both. *Make it a circle*
evened up an oval, *Snap back to auto* re-detected, Enter applied, Esc
cancelled. Applying cleared that product's flag.

## Files

| File | Goes back into |
| --- | --- |
| `cutter.js` | `assets/js/manage.js`, just before the *Spreadsheet round trip* section |
| `cutter.css` | `assets/css/main.css`, just before `/* Flagged rows stand out in the table. */` |
| `cutter.html` | `manage.html`, just before `<!-- ============ IMAGE MANAGER MODAL ============ -->` |

## Putting it back

1. Paste each file back at the position in the table above.
2. In `manage.js`, restore the tool button in `renderEditor()`:
   ```js
   const CUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8" stroke-dasharray="3 2"/><circle cx="12" cy="12" r="2.5"/></svg>';
   ```
   and add `tool(i, 'cut', 'Cut out by hand', CUT) +` to the `.photo-tools` row.
3. In the `[data-img-panel]` click handler, restore the branch that runs before
   the other photo operations:
   ```js
   if (op && op.dataset.imgOp === 'cut') {
     await openCutter(Number(op.dataset.imgI));
     return;
   }
   ```
4. Call `bindCutter();` inside `bind()`.

## What it depends on

All still present in `manage.js`: `lum`, `edgeColour`, `keyColour`, `rgbToHsl`,
`hslToRgb`, `BACKDROP` (uses `discBright` and `featherPx`), `sourceBitmap`,
`thumbUrl`, `setPreview`, `QUALITY`, `state`, `editing`, `renderEditor`,
`render`.

The flagging it worked alongside — the **Fix** column, the *Flagged for fixing*
filter, and the automatic flagging of photos the backdrop pass refuses — is
still in the live code and works on its own.
