// core/state.js
// -----------------------------------------------------------------------------
// Central application state for the Cross Stitch Editor.
// Coordinates PixelGrid, CanvasRenderer, tools, and UI.
// -----------------------------------------------------------------------------

import { PixelGrid } from "./pixelGrid.js";
import { CanvasRenderer } from "./canvasRenderer.js";

export class EditorState {
    constructor(canvasElement) {
        // ... Core components
        this.pixelGrid = new PixelGrid(50, 50);
        this.renderer = new CanvasRenderer(canvasElement, this.pixelGrid);

        this.activeTool = "pencil";
        this.activeColor = [0, 0, 0]; // Keep this name consistent

        // ... Zoom & pan
        this.zoom = 20; 
        this.panX = 0;
        this.panY = 0;

        this.showGrid = true;
        this.stampedMode = false;
        this.mappedRgbGrid = null;
        this.mappedDmcGrid = null;

        this.history = []; // Added this so clear() doesn't fail
        this.listeners = {};
    }

    // -------------------------------------------------------------------------
    // RESET STATE
    // -------------------------------------------------------------------------
    clear() {
        // 1. Reset grids
        this.pixelGrid = new PixelGrid(50, 50); 
        this.mappedRgbGrid = null;
        this.mappedDmcGrid = null;
        
        // 2. Reset history
        this.history = [];

        // 3. Reset colors to prevent "null" iterable crashes
        this.activeColor = [0, 0, 0]; 

        // 4. Update renderer with the new blank grid
        this.renderer.setPixelGrid(this.pixelGrid);
        this.renderer.draw();

        // 5. Tell the UI we cleared out (using your .emit system)
        this.emit("gridLoaded", { width: 50, height: 50 });
    }
    
    // -------------------------------------------------------------------------
    // EVENT SYSTEM (simple pub/sub)
    // -------------------------------------------------------------------------
    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    emit(event, payload) {
        if (!this.listeners[event]) return;
        for (const cb of this.listeners[event]) cb(payload);
    }

    // -------------------------------------------------------------------------
    // TOOL MANAGEMENT
    // -------------------------------------------------------------------------
    setTool(toolName) {
        this.activeTool = toolName;
        this.emit("toolChanged", toolName);
    }

    // -------------------------------------------------------------------------
    // COLOR MANAGEMENT
    // -------------------------------------------------------------------------
    setColor(rgb) {
        this.activeColor = [...rgb];
        this.emit("colorChanged", rgb);
    }

    // -------------------------------------------------------------------------
    // ZOOM & PAN
    // -------------------------------------------------------------------------
    setZoom(zoom) {
        this.zoom = zoom;
        this.renderer.setZoom(zoom);
        this.emit("zoomChanged", zoom);
    }

    setPan(x, y) {
        this.panX = x;
        this.panY = y;
        this.renderer.setPan(x, y);
        this.emit("panChanged", { x, y });
    }

    // -------------------------------------------------------------------------
    // GRID VISIBILITY
    // -------------------------------------------------------------------------
    toggleGrid(show) {
        this.showGrid = show;
        this.renderer.toggleGrid(show);
        this.emit("gridVisibilityChanged", show);
    }

    // -------------------------------------------------------------------------
    // STAMPED MODE
    // -------------------------------------------------------------------------
    setStampedMode(enabled) {
        this.stampedMode = enabled;
        this.emit("stampedModeChanged", enabled);
    }

    // -------------------------------------------------------------------------
    // PIXEL OPERATIONS
    // -------------------------------------------------------------------------
    setPixel(x, y, rgb) {
        this.pixelGrid.set(x, y, rgb);
        this.renderer.drawCell(x, y);
        this.emit("pixelChanged", { x, y, rgb });
    }

    floodFill(x, y, rgb) {
        this.pixelGrid.floodFill(x, y, rgb);
        this.renderer.draw();
        this.emit("gridChanged");
    }

    fillAll(rgb) {
        this.pixelGrid.fillAll(rgb);
        this.renderer.draw();
        this.emit("gridChanged");
    }

    // -------------------------------------------------------------------------
    // UNDO / REDO
    // -------------------------------------------------------------------------
    undo() {
        this.pixelGrid.undo();
        this.renderer.draw();
        this.emit("gridChanged");
    }

    redo() {
        this.pixelGrid.redo();
        this.renderer.draw();
        this.emit("gridChanged");
    }

    // -------------------------------------------------------------------------
    // GRID RESIZING
    // -------------------------------------------------------------------------
    resizeGrid(newW, newH, fill = [255, 255, 255]) {
        this.pixelGrid.resize(newW, newH, fill);
        this.renderer.draw();
        this.emit("gridChanged");
    }

    // -------------------------------------------------------------------------
    // MAPPING PIPELINE RESULTS
    // -------------------------------------------------------------------------
    setMappingResults(rgbGrid, dmcGrid) {
        this.mappedRgbGrid = rgbGrid;
        this.mappedDmcGrid = dmcGrid;
        this.emit("mappingUpdated", { rgbGrid, dmcGrid });
    }

    // -------------------------------------------------------------------------
    // REPLACE ENTIRE GRID (e.g., after image import)
    // -------------------------------------------------------------------------
    loadGrid(newGrid) {
        const h = newGrid.length;
        const w = newGrid[0].length;

        this.pixelGrid = new PixelGrid(w, h);
        this.pixelGrid.grid = newGrid.map(row => row.map(px => [...px]));

        this.renderer.setPixelGrid(this.pixelGrid);
        this.renderer.draw();

        this.emit("gridLoaded", { width: w, height: h });
    }
}
