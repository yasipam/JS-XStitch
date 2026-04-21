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
        
        // Only initialize renderer if canvases are provided (Iframe side)
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

        if (this.renderer) this.renderer.draw();
        this.emit("gridChanged");
        this.emit("mappingUpdated", { rgbGrid: null, dmcGrid: null }); 
    }

    resetToMappedState() {
        if (!this.mappedRgbGrid) return;
        this.pixelGrid.pushUndo();
        this.pixelGrid.redoStack = [];
        if (this.stampedMode && this.mappedDmcGrid) {
            this.emit("requestStampedReload");
        } else {
            this.loadGrid(this.mappedRgbGrid);
        }
    }

    // -------------------------------------------------------------------------
    // EVENT SYSTEM
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
    // TOOL & COLOR MANAGEMENT
    // -------------------------------------------------------------------------
    setTool(toolName) {
        this.activeTool = toolName;
        this.emit("toolChanged", toolName);
    }

    setColor(rgb) {
        this.activeColor = [...rgb];
        this.emit("colorChanged", rgb);
    }

    // -------------------------------------------------------------------------
    // ZOOM & PAN
    // -------------------------------------------------------------------------
    setZoom(zoom) {
        this.zoom = zoom;
        if (this.renderer) this.renderer.setZoom(zoom);
        this.emit("zoomChanged", zoom);
    }

    setPan(x, y) {
        this.panX = x;
        this.panY = y;
        if (this.renderer) this.renderer.setPan(x, y);
        this.emit("panChanged", { x, y });
    }

    toggleGrid(show) {
        this.showGrid = show;
        if (this.renderer) this.renderer.toggleGrid(show);
        this.emit("gridVisibilityChanged", show);
    }

    // -------------------------------------------------------------------------
    // PIXEL OPERATIONS
    // -------------------------------------------------------------------------
    setPixel(x, y, rgb) {
        this.pixelGrid.set(x, y, rgb);
        if (this.renderer) this.renderer.drawCell(x, y, rgb);
        this.emit("pixelChanged", { x, y, rgb });
        // Trigger gridChanged so threads table updates during manual drawing
        this.emit("gridChanged"); 
    }

    floodFill(x, y, rgb) {
        this.pixelGrid.pushUndo();
        this.pixelGrid.floodFill(x, y, rgb);
        if (this.renderer) this.renderer.draw();
        this.emit("gridChanged");
    }

    fillAll(rgb) {
        this.pixelGrid.pushUndo();
        this.pixelGrid.fillAll(rgb);
        if (this.renderer) this.renderer.draw();
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
    // GRID RESIZING & LOADING
    // -------------------------------------------------------------------------
    resizeGrid(newW, newH, fill = [255, 255, 255]) {
        this.pixelGrid.resize(newW, newH, fill);
        if (this.renderer) this.renderer.draw();
        this.emit("gridChanged");
    }

    loadGrid(newGrid) {
        if (!newGrid || newGrid.length === 0) return;
        const h = newGrid.length;
        const w = newGrid[0].length;

        if (!this.pixelGrid || this.pixelGrid.width !== w || this.pixelGrid.height !== h) {
            this.pixelGrid = new PixelGrid(w, h);
        }
        this.pixelGrid.grid = newGrid.map(row => row.map(px => [...px]));

        if (this.renderer) {
            this.renderer.setPixelGrid(this.pixelGrid);
            this.renderer.draw();
        }

        this.emit("gridLoaded", { width: w, height: h });
        this.emit("gridChanged");
    }

    // -------------------------------------------------------------------------
    // STATS & CLEANUP
    // -------------------------------------------------------------------------
    getUniqueColorCount() {
        const uniqueColors = new Set();
        const gridData = this.pixelGrid.grid;

        for (let y = 0; y < this.pixelGrid.height; y++) {
            for (let x = 0; x < this.pixelGrid.width; x++) {
                const [r, g, b] = gridData[y][x];
                if (r === 255 && g === 255 && b === 255) continue;
                uniqueColors.add(`${r},${g},${b}`);
            }
        }
        return uniqueColors.size;
    }

    getThreadStats() {
        const stats = {};
        const gridData = this.pixelGrid.grid;

        for (let y = 0; y < this.pixelGrid.height; y++) {
            for (let x = 0; x < this.pixelGrid.width; x++) {
                const [r, g, b] = gridData[y][x];
                if (r === 255 && g === 255 && b === 255) continue;
                
                const key = `${r},${g},${b}`;
                if (!stats[key]) {
                    stats[key] = { r, g, b, count: 0 };
                }
                stats[key].count++;
            }
        }
        return Object.values(stats);
    }

    applyMinOccurrence(threshold) {
        this.pixelGrid.cleanupMinOccurrence(threshold);
        if (this.renderer) {
            this.renderer.draw();
            this.emit("gridChanged"); 
        }
    }

    setMappingResults(rgbGrid, dmcGrid) {
        this.mappedRgbGrid = rgbGrid;
        this.mappedDmcGrid = dmcGrid;
        this.emit("mappingUpdated", { rgbGrid, dmcGrid });
    }
}