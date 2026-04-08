// core/state.js
// -----------------------------------------------------------------------------
// Central application state for the Cross Stitch Editor.
// Coordinates PixelGrid, LayeredRenderer, tools, and UI.
// -----------------------------------------------------------------------------

import { PixelGrid } from "./pixelGrid.js";
import { LayeredRenderer } from "./canvasRenderer.js";

export class EditorState {
    constructor(canvases = null) {
        // Core data model is always initialized
        this.pixelGrid = new PixelGrid(50, 50);
        
        // FIX: Only initialize renderer if canvases are provided (Iframe side)
        // If canvases is null, this is the Parent side which handles logic only.
        this.renderer = canvases ? new LayeredRenderer(canvases, this.pixelGrid) : null;

        this.activeTool = "pencil";
        this.activeColor = [0, 0, 0];

        this.zoom = 20; 
        this.panX = 0;
        this.panY = 0;

        this.showGrid = true;
        this.stampedMode = false;
        this.mappedRgbGrid = null;
        this.mappedDmcGrid = null;

        this.history = []; 
        this.listeners = {};
    }

    // -------------------------------------------------------------------------
    // RESET STATE
    // -------------------------------------------------------------------------
    clear() {
        this.pixelGrid = new PixelGrid(50, 50); 
        this.mappedRgbGrid = null;
        this.mappedDmcGrid = null;
        this.history = [];
        this.activeColor = [0, 0, 0]; 

        // Safety Guard: Only update renderer if it exists in this window context
        if (this.renderer) {
            this.renderer.setPixelGrid(this.pixelGrid);
            this.renderer.draw();
        }
        this.emit("gridLoaded", { width: 50, height: 50 });
    }

    clearCanvasAction() {
        this.pixelGrid.pushUndo();
        this.pixelGrid.fillAll([255, 255, 255]);
        this.mappedRgbGrid = null;
        this.mappedDmcGrid = null;

        if (this.renderer) this.renderer.draw(); // Safety Guard
        this.emit("gridChanged");
        this.emit("mappingUpdated", { rgbGrid: null, dmcGrid: null }); 
    }

    resetToMappedState() {
        if (!this.mappedRgbGrid) return;
        this.pixelGrid.pushUndo();
        if (this.stampedMode && this.mappedDmcGrid) {
            this.emit("requestStampedReload"); 
        } else {
            this.loadGrid(this.mappedRgbGrid);
        }
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
        if (this.renderer) this.renderer.setZoom(zoom); // Safety Guard
        this.emit("zoomChanged", zoom);
    }

    setPan(x, y) {
        this.panX = x;
        this.panY = y;
        if (this.renderer) this.renderer.setPan(x, y); // Safety Guard
        this.emit("panChanged", { x, y });
    }

    // -------------------------------------------------------------------------
    // GRID VISIBILITY
    // -------------------------------------------------------------------------
    toggleGrid(show) {
        this.showGrid = show;
        if (this.renderer) this.renderer.toggleGrid(show); // Safety Guard
        this.emit("gridVisibilityChanged", show);
    }

    // -------------------------------------------------------------------------
    // PIXEL OPERATIONS
    // -------------------------------------------------------------------------
    setPixel(x, y, rgb) {
        this.pixelGrid.set(x, y, rgb);
        if (this.renderer) this.renderer.drawCell(x, y, rgb); // Safety Guard
        this.emit("pixelChanged", { x, y, rgb });
    }

    floodFill(x, y, rgb) {
        this.pixelGrid.pushUndo();
        this.pixelGrid.floodFill(x, y, rgb);
        if (this.renderer) this.renderer.draw(); // Safety Guard
        this.emit("gridChanged");
    }

    fillAll(rgb) {
        this.pixelGrid.pushUndo();
        this.pixelGrid.fillAll(rgb);
        if (this.renderer) this.renderer.draw(); // Safety Guard
        this.emit("gridChanged");
    }

    // -------------------------------------------------------------------------
    // UNDO / REDO
    // -------------------------------------------------------------------------
    undo() {
        const previousGrid = this.pixelGrid.undo();
        if (previousGrid && this.renderer) {
            this.renderer.setPixelGrid(this.pixelGrid);
            this.renderer.draw();
            this.emit("gridChanged");
        }
        return previousGrid;
    }

    redo() {
        const nextGrid = this.pixelGrid.redo();
        if (nextGrid && this.renderer) {
            this.renderer.setPixelGrid(this.pixelGrid);
            this.renderer.draw();
            this.emit("gridChanged");
        }
        return nextGrid;
    }

    // -------------------------------------------------------------------------
    // GRID RESIZING
    // -------------------------------------------------------------------------
    resizeGrid(newW, newH, fill = [255, 255, 255]) {
        this.pixelGrid.resize(newW, newH, fill);
        if (this.renderer) this.renderer.draw(); // Safety Guard
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
        if (!newGrid || newGrid.length === 0) return;
        const h = newGrid.length;
        const w = newGrid[0].length;

        this.pixelGrid = new PixelGrid(w, h);
        this.pixelGrid.grid = newGrid.map(row => row.map(px => [...px]));

        if (this.renderer) { // Safety Guard
            this.renderer.setPixelGrid(this.pixelGrid);
            this.renderer.draw();
        }

        this.emit("gridLoaded", { width: w, height: h });
    }
}