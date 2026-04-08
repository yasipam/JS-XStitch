// core/canvasRenderer.js

export class LayeredRenderer {
    constructor(canvases, pixelGrid) {
        this.pixelGrid = pixelGrid;
        this.canvases = canvases;
        this.ctxs = {
            bg: canvases.bg.getContext("2d", { alpha: false }),
            grid: canvases.grid.getContext("2d"),
            ui: canvases.ui.getContext("2d")
        };

        this.zoom = 20;
        this.offsetX = 0;
        this.offsetY = 0;
        this.showGrid = true;

        // Set rendering properties for all layers
        Object.values(this.ctxs).forEach(ctx => {
            ctx.imageSmoothingEnabled = false;
        });

        window.addEventListener("resize", () => this.resizeToContainer());
        this.resizeToContainer();
    }

    /**
     * Syncs internal resolution with the high-DPI display
     */
    resizeToContainer() {
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth;
        const h = window.innerHeight;

        Object.values(this.canvases).forEach(canvas => {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
        });

        Object.values(this.ctxs).forEach(ctx => {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.imageSmoothingEnabled = false;
        });

        this.draw();
    }

    setPixelGrid(grid) {
        this.pixelGrid = grid;
        this.draw();
    }

    setZoom(z) { this.zoom = z; this.draw(); }
    setPan(x, y) { this.offsetX = x; this.offsetY = y; this.draw(); }
    toggleGrid(s) { this.showGrid = s; this.draw(); }

    draw() {
        this.drawBackground();
        this.drawGrid();
    }

    /**
     * Renders only the stitches to the bottom layer
     */
    drawBackground() {
        const ctx = this.ctxs.bg;
        const grid = this.pixelGrid;
        if (!grid || !grid.grid) return;

        // Use logical dimensions for clearing since transform is applied
        const logicalW = this.canvases.bg.width / (window.devicePixelRatio || 1);
        const logicalH = this.canvases.bg.height / (window.devicePixelRatio || 1);

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, logicalW, logicalH);

        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                const pixel = grid.grid[y][x];
                if (!pixel) continue;
                
                const [r, g, b] = pixel;
                ctx.fillStyle = `rgb(${r},${g},${b})`;
                
                const px = Math.floor(this.offsetX + x * this.zoom);
                const py = Math.floor(this.offsetY + y * this.zoom);
                // Draw slightly larger (0.3px) to prevent sub-pixel gaps between cells
                ctx.fillRect(px, py, Math.ceil(this.zoom) + 0.3, Math.ceil(this.zoom) + 0.3);
            }
        }
    }

    drawGrid() {
        const ctx = this.ctxs.grid;
        const logicalW = this.canvases.grid.width / (window.devicePixelRatio || 1);
        const logicalH = this.canvases.grid.height / (window.devicePixelRatio || 1);
        
        ctx.clearRect(0, 0, logicalW, logicalH);
        if (!this.showGrid || this.zoom < 6) return;

        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();

        const endX = this.offsetX + this.pixelGrid.width * this.zoom;
        const endY = this.offsetY + this.pixelGrid.height * this.zoom;

        for (let x = 0; x <= this.pixelGrid.width; x++) {
            const px = Math.floor(this.offsetX + x * this.zoom);
            ctx.moveTo(px, this.offsetY);
            ctx.lineTo(px, endY);
        }
        for (let y = 0; y <= this.pixelGrid.height; y++) {
            const py = Math.floor(this.offsetY + y * this.zoom);
            ctx.moveTo(this.offsetX, py);
            ctx.lineTo(endX, py);
        }
        ctx.stroke();
    }

    /**
     * Precision conversion: No longer needs rect math because 
     * clientX inside the iframe is already local.
     */
    screenToGrid(clientX, clientY) {
        const gx = Math.floor((clientX - this.offsetX) / this.zoom);
        const gy = Math.floor((clientY - this.offsetY) / this.zoom);
        return { gx, gy };
    }

    drawCell(gx, gy, color) {
        const ctx = this.ctxs.bg;
        const [r, g, b] = color;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        const px = Math.floor(this.offsetX + gx * this.zoom);
        const py = Math.floor(this.offsetY + gy * this.zoom);
        ctx.fillRect(px, py, Math.ceil(this.zoom), Math.ceil(this.zoom));
    }
}