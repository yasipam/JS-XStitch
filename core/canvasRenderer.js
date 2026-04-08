// core/canvasRenderer.js
// -----------------------------------------------------------------------------
// High-Precision CanvasRenderer: Factors in Device Pixel Ratio (DPR) 
// to eliminate coordinate drift and blurriness.
// -----------------------------------------------------------------------------

export class CanvasRenderer {
    constructor(canvas, pixelGrid) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d", { alpha: false });
        this.pixelGrid = pixelGrid;

        this.zoom = 1;          
        this.offsetX = 0;       
        this.offsetY = 0;       

        this.showGrid = true;
        this.gridColor = "#000000";
        this.gridThickness = 0.5; // Slightly thicker for high-DPI screens

        // Ensure crisp rendering at the engine level
        this.ctx.imageSmoothingEnabled = false;
        
        this.resizeToContainer();
    }

    /**
     * OVERRIDE: Syncs CSS size with internal resolution using DPR.
     * This prevents the "drift" caused by browser scaling.
     */
// core/canvasRenderer.js
// --- ADD TO resizeToContainer ---

    resizeToContainer() {
        const parent = this.canvas.parentElement;
        if (!parent) return;
        
        const dpr = window.devicePixelRatio || 1;
        const rect = parent.getBoundingClientRect();
        
        // CRITICAL: Snap the CSS display size to integers to prevent 
        // the browser from "guessing" the pixel alignment.
        const displayWidth = Math.floor(rect.width);
        const displayHeight = Math.floor(rect.height);

        if (this.canvas.width !== displayWidth * dpr) {
            this.canvas.width = displayWidth * dpr;
            this.canvas.height = displayHeight * dpr;
            this.canvas.style.width = `${displayWidth}px`;
            this.canvas.style.height = `${displayHeight}px`;
            
            this.ctx.scale(dpr, dpr);
            this.ctx.imageSmoothingEnabled = false;
        }
        this.draw();
    }

    setPixelGrid(pixelGrid) {
        this.pixelGrid = pixelGrid;
        this.draw();
    }

    setZoom(zoom) {
        this.zoom = Math.max(0.5, Math.min(zoom, 200));
        this.draw();
    }

    setPan(x, y) {
        this.offsetX = x;
        this.offsetY = y;
        this.draw();
    }

    toggleGrid(show) {
        this.showGrid = show;
        this.draw();
    }

    draw() {
        const ctx = this.ctx;
        const grid = this.pixelGrid;
        if (!grid) return;

        const { width: gw, height: gh } = grid;
        const cw = this.canvas.width / (window.devicePixelRatio || 1);
        const ch = this.canvas.height / (window.devicePixelRatio || 1);

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, cw, ch);

        const startX = Math.max(0, Math.floor(-this.offsetX / this.zoom));
        const startY = Math.max(0, Math.floor(-this.offsetY / this.zoom));
        const endX = Math.min(gw, Math.ceil((cw - this.offsetX) / this.zoom));
        const endY = Math.min(gh, Math.ceil((ch - this.offsetY) / this.zoom));

        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                const [r, g, b] = grid.grid[y][x];
                ctx.fillStyle = `rgb(${r},${g},${b})`;

                const px = this.offsetX + x * this.zoom;
                const py = this.offsetY + y * this.zoom;

                // Precision fix: Use Math.floor on positions to avoid sub-pixel blurring
                ctx.fillRect(Math.floor(px), Math.floor(py), Math.ceil(this.zoom), Math.ceil(this.zoom));
            }
        }

        if (this.showGrid && this.zoom >= 6) {
            ctx.strokeStyle = this.gridColor;
            ctx.lineWidth = this.gridThickness;
            ctx.beginPath();

            for (let x = startX; x <= endX; x++) {
                const px = Math.floor(this.offsetX + x * this.zoom);
                ctx.moveTo(px, this.offsetY + startY * this.zoom);
                ctx.lineTo(px, this.offsetY + endY * this.zoom);
            }

            for (let y = startY; y <= endY; y++) {
                const py = Math.floor(this.offsetY + y * this.zoom);
                ctx.moveTo(this.offsetX + startX * this.zoom, py);
                ctx.lineTo(this.offsetX + endX * this.zoom, py);
            }
            ctx.stroke();
        }
    }

    /**
     * PRECISION OVERRIDE: 
     * Uses client coordinates relative to the bounding box to ensure 
     * clicks align perfectly with the grid regardless of zoom/pan.
     */
    screenToGrid(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        
        // 1. Force integer mouse coordinates relative to the canvas CSS box
        const x = Math.round(clientX - rect.left);
        const y = Math.round(clientY - rect.top);

        // 2. Snap the Pan offsets to integers during the calculation
        // This ensures the "anchor" of your grid isn't sitting between pixels
        const snapX = Math.round(this.offsetX);
        const snapY = Math.round(this.offsetY);

        // 3. Calculate grid position
        const gx = Math.floor((x - snapX) / this.zoom);
        const gy = Math.floor((y - snapY) / this.zoom);

        return { gx, gy };
    }

    gridToScreen(gx, gy) {
        return {
            x: this.offsetX + (gx * this.zoom),
            y: this.offsetY + (gy * this.zoom)
        };
    }

    drawCell(gx, gy, color) {
        if (!color || !Array.isArray(color)) return;
        const { x, y } = this.gridToScreen(gx, gy);
        const size = this.zoom;
        const [r, g, b] = color;
        this.ctx.fillStyle = `rgb(${r},${g},${b})`;
        
        // Align to pixel grid
        this.ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(size), Math.ceil(size));

        if (this.showGrid && this.zoom >= 6) {
            this.ctx.strokeStyle = this.gridColor;
            this.ctx.lineWidth = this.gridThickness;
            this.ctx.strokeRect(Math.floor(x), Math.floor(y), Math.ceil(size), Math.ceil(size));
        }
    }
}