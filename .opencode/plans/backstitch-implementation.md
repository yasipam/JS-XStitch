# Backstitch Implementation Plan

## Status
- ✅ Basic backstitch drawing (click-drag)
- ✅ 8-direction snapping (N, NE, E, SE, S, SW, W, NW)
- ✅ Mode switching (pixel ↔ backstitch)
- ✅ Separate undo/redo stacks
- ✅ Backstitch eraser tool
- ✅ Backstitch clear (retains pixels)
- ✅ Boundary checking (0,0 to width,height)

---

## Issues to Fix

### 1. Backstitch Color Not Applied (Priority: HIGH)
**Problem**: All backstitch lines render as black regardless of palette selection.

**Investigation needed**:
- Check if `state.backstitchColor` is correctly synced between parent (`app.js`) and iframe (`canvasManager.js`)
- Verify `SET_BACKSTITCH_COLOR` message is received and applied in iframe
- Check if `BackstitchPencilTool.onPointerDown()` correctly reads `state.backstitchColor`
- Verify `drawBackstitch()` and `drawBackstitchPreview()` use the color from line data (not a hardcoded value)

**Files to check**:
- `app.js:2150-2155` - palette click handler
- `core/state.js:144-147` - `setBackstitchColor()`
- `core/canvasManager.js:97` - `SET_BACKSTITCH_COLOR` handler
- `core/tools.js:241-246` - `BackstitchPencilTool.onPointerDown()`
- `core/canvasRenderer.js:220-245` - `drawBackstitch()`

**Fix approach**:
1. Add debug logs to trace `backstitchColor` value through the flow
2. Ensure `state.backstitchColor` is correctly set before tool uses it
3. Verify line objects store color correctly: `{ points: [...], color: [r,g,b] }`

---

### 2. Diagonal Backstitch Rendering (Priority: MEDIUM)
**Problem**: User reports backstitch can't cross pixels diagonally.

**Status**: Code review shows `_snapTo8Directions()` already supports diagonals. The snapping function:
- Calculates angle using `Math.atan2(dy, dx)`
- Rounds to nearest octant (π/4 = 45°)
- Returns snapped coordinates

**Possible issues**:
- Line width too thin to see diagonal lines clearly
- Snap sensitivity might be too strict
- Visual rendering might make diagonals look like stair-steps

**Files to check**:
- `core/tools.js:298-314` - `_snapTo8Directions()`
- `core/canvasRenderer.js:218-246` - `drawBackstitch()`

**Fix approach**:
1. Test diagonal drawing manually
2. If working, improve visual clarity (increase line width or add endpoints)
3. If not working, debug snap logic

---

### 3. Resize Grid Warning (Priority: HIGH)
**Problem**: Resizing grid removes backstitch lines without warning.

**Current behavior**:
- `resizeEmptyCanvas()` in `app.js:1295-1336` creates new grids
- Sends `INIT` to iframe which calls `state.backstitchGrid = new BackstitchGrid(50, 50)` (resets)
- No warning to user

**Files to modify**:
- `app.js:1295-1336` - `resizeEmptyCanvas()` - add confirmation dialog
- `app.js:2810-2870` - Mapping resize handlers - add backstitch warning
- `core/state.js:249-254` - `resizeGrid()` - already handles backstitch

**Fix approach**:
1. Add warning message: "Resizing will also remove all backstitch lines. Continue?"
2. Option to preserve backstitch data (clip to new bounds)
3. Update confirmation dialogs to mention backstitch

---

### 4. Backstitch in Exports (Priority: HIGH)
**Problem**: Backstitch lines don't appear in PDF, PNG, or OXS exports.

#### 4.1 OXS Export
**File**: `export/exportOXS.js`
**Current**: Only exports `<fullstitches>` section
**Needed**: Add `<backstitches>` section with format:
```xml
<backstitches>
  <backstitch x1="10" y1="10" x2="20" y2="20" palindex="1" />
</backstitches>
```
**Note**: OXS backstitch uses `palindex` referencing the palette (same as stitches).

#### 4.2 PDF Export
**File**: `export/exportPDF.js`
**Current**: Only renders pixel grid (filled/cross/symbol modes)
**Needed**: Overlay backstitch lines on pattern pages
- Use `state.backstitchGrid.getLines()` to get lines
- Convert grid intersection coords to PDF coordinates
- Draw lines with correct color and width

#### 4.3 PNG Export
**File**: `app.js:3089-3130` - `exportPixelPNG()`
**Current**: Only exports pixel grid
**Needed**: Create `exportPatternPNG()` that includes backstitch overlay
- Render pixels to canvas
- Overlay backstitch lines
- Export combined image

#### 4.4 Build Export Data
**File**: `export/buildExportData.js`
**Needed**: Add `backstitchLines` to export data object
```javascript
return {
    // ... existing fields
    backstitchLines: state.backstitchGrid.getLines(),
    backstitchColorMap: // map line colors to palette indices
}
```

---

### 5. Variable Line Widths (Priority: LOW - Future Feature)
**Problem**: Backstitch lines should support full, 1/2, and 1/4 pixel widths.

**Current**: Line width = `Math.max(1, this.zoom * 0.15)` (fixed scale)

**Desired behavior**:
- **Full width** (1.0): Line fills entire pixel intersection (current behavior scaled)
- **Half width** (0.5): Thin line centered in pixel
- **Quarter width** (0.25): Very thin line for detail work

**Files to modify**:
- `core/state.js`: Add `backstitchLineWidth` property (1.0, 0.5, 0.25)
- `core/tools.js`: Add UI for selecting line width
- `core/canvasRenderer.js`: Use `state.backstitchLineWidth` in `drawBackstitch()`
- `app.js`: Add line width selector to backstitch toolbar

**Implementation**:
1. Add `backstitchLineWidth` to `EditorState` (default: 1.0)
2. Add width selector UI (3 buttons: "Full", "1/2", "1/4")
3. Modify `drawBackstitch()` to scale line width:
   ```javascript
   const baseLineWidth = Math.max(1, this.zoom * 0.15 * state.backstitchLineWidth);
   ```
4. Store line width with each line object for exports

---

## Implementation Order
1. **Fix backstitch color** (Issue 1) - blocking visual confirmation
2. **Add resize warning** (Issue 3) - prevents data loss
3. **Add to OXS export** (Issue 4.1) - most standard format
4. **Add to PDF export** (Issue 4.2) - needed for printing
5. **Add to PNG export** (Issue 4.3) - quick sharing
6. **Diagonal rendering check** (Issue 2) - verify and improve
7. **Variable line widths** (Issue 5) - future enhancement

---

## Testing Checklist
After each fix:
- [ ] Draw backstitch with selected color → renders correct color
- [ ] Resize grid → warning shown, backstitch handled appropriately
- [ ] Export to OXS → backstitch lines present in file
- [ ] Export to PDF → backstitch lines visible on pattern
- [ ] Export to PNG → backstitch overlay rendered
- [ ] Switch line width → renders at correct thickness
- [ ] Undo/redo → works for backstitch independently
- [ ] Diagonal drawing → smooth 45° lines

---

## Notes
- Backstitch grid coordinates: Intersections (0..width, 0..height)
- Pixel grid coordinates: Cells (0..width-1, 0..height-1)
- OXS format uses same palette as stitches for backstitch
- PDF export uses `jsPDF` library - check coordinate conversion
- PNG export uses canvas `toBlob()` or `toDataURL()`
