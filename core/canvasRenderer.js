// core/canvasRenderer.js
// -----------------------------------------------------------------------------
// CanvasRenderer: draws a PixelGrid onto an HTML <canvas>.
// Handles zoom, pan, gridlines, and efficient redraws.
// -----------------------------------------------------------------------------

export class CanvasRenderer {
    constructor(canvas, pixelGrid) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d", { alpha: false });
        this.pixelGrid = pixelGrid;

        // View transform
        this.zoom = 1;          // pixels per stitch
        this.offsetX = 0;       // pan X
        this.offsetY = 0;       // pan Y

        // Rendering options
        this.showGrid = true;
        this.gridColor = "#000000";
        this.gridThickness = 0.2;

        // Ensure crisp rendering
        this.ctx.imageSmoothingEnabled = false;

        // Resize canvas to match container
        this.resizeToContainer();
    }

    // -------------------------------------------------------------------------
    // RESIZE CANVAS TO MATCH CSS SIZE
    // -------------------------------------------------------------------------
    resizeToContainer() {
        const parent = this.canvas.parentElement;
        if (!parent) return;

        // Get the available space in the mainArea
        const w = parent.clientWidth;
        const h = parent.clientHeight;

        if (w === 0 || h === 0) return;

        this.canvas.width = w;
        this.canvas.height = h;
        this.ctx.imageSmoothingEnabled = false;
        this.draw();
    }

    // -------------------------------------------------------------------------
    // SETTERS
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // MAIN DRAW FUNCTION
    // -------------------------------------------------------------------------
    draw() {
        const ctx = this.ctx;
        const grid = this.pixelGrid;

        if (!grid) return;

        const { width: gw, height: gh } = grid;

        // Clear canvas
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw pixels
        for (let y = 0; y < gh; y++) {
            for (let x = 0; x < gw; x++) {
                const [r, g, b] = grid.grid[y][x];

                ctx.fillStyle = `rgb(${r},${g},${b})`;

                const px = this.offsetX + x * this.zoom;
                const py = this.offsetY + y * this.zoom;

                ctx.fillRect(px, py, this.zoom, this.zoom);
            }
        }

        // Draw gridlines
        if (this.showGrid && this.zoom >= 6) {
            ctx.strokeStyle = this.gridColor;
            ctx.lineWidth = this.gridThickness;

            // Vertical lines
            for (let x = 0; x <= gw; x++) {
                const px = this.offsetX + x * this.zoom;
                ctx.beginPath();
                ctx.moveTo(px, this.offsetY);
                ctx.lineTo(px, this.offsetY + gh * this.zoom);
                ctx.stroke();
            }

            // Horizontal lines
            for (let y = 0; y <= gh; y++) {
                const py = this.offsetY + y * this.zoom;
                ctx.beginPath();
                ctx.moveTo(this.offsetX, py);
                ctx.lineTo(this.offsetX + gw * this.zoom, py);
                ctx.stroke();
            }
        }
    }

    // -------------------------------------------------------------------------
    // CONVERT CANVAS COORDINATES → GRID COORDINATES
    // -------------------------------------------------------------------------
    screenToGrid(x, y) {
        const gx = Math.floor((x - this.offsetX) / this.zoom);
        const gy = Math.floor((y - this.offsetY) / this.zoom);
        return { gx, gy };
    }

    // -------------------------------------------------------------------------
    // CONVERT GRID COORDINATES → CANVAS PIXELS
    // -------------------------------------------------------------------------
    gridToScreen(gx, gy) {
        return {
            x: this.offsetX + gx * this.zoom,
            y: this.offsetY + gy * this.zoom
        };
    }

    // -------------------------------------------------------------------------
    // DRAW ONLY ONE CELL (for fast tool updates)
    // -------------------------------------------------------------------------
        drawCell(gx, gy, color) {
            // Safety check: if color is null/undefined, don't try to draw it
            if (!color || !Array.isArray(color)) return;

            const { x, y } = this.gridToScreen(gx, gy);
            const size = this.state.zoom;

            const [r, g, b] = color;
            this.ctx.fillStyle = `rgb(${r},${g},${b})`;
            this.ctx.fillRect(x, y, size, size);
        
    }
}
