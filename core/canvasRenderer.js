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

        Object.values(this.ctxs).forEach(ctx => ctx.imageSmoothingEnabled = false);
        window.addEventListener("resize", () => this.resizeToContainer());
        this.resizeToContainer();
    }

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

    setPixelGrid(grid) { this.pixelGrid = grid; this.draw(); }
    setZoom(z) { this.zoom = z; this.draw(); }
    setPan(x, y) { this.offsetX = x; this.offsetY = y; this.draw(); }
    toggleGrid(s) { this.showGrid = s; this.draw(); }
    draw() { this.drawBackground(); this.drawGrid(); }

    drawBackground() {
        const ctx = this.ctxs.bg;
        const grid = this.pixelGrid;
        if (!grid || !grid.grid) return;

        const dpr = window.devicePixelRatio || 1;
        const w = this.canvases.bg.width / dpr;
        const h = this.canvases.bg.height / dpr;

        // --- 1. DRAW THE CHECKERED PATTERN ---
        const checkSize = 10;
        ctx.fillStyle = "#dddddd"; // Light gray
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = "#ffffff"; // White toggled
        for (let y = 0; y < h; y += checkSize) {
            for (let x = 0; x < w; x += checkSize) {
                if ((x / checkSize + y / checkSize) % 2 === 0) {
                    ctx.fillRect(x, y, checkSize, checkSize);
                }
            }
        }

        // --- 2. DRAW THE PIXELS ---
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                const [r, g, b] = grid.grid[y][x];

                // OPTIONAL: Skip drawing if it's pure white (to let checks show)
                // If you want white pixels to be "solid", remove this IF statement.
                if (r === 255 && g === 255 && b === 255) continue;

                ctx.fillStyle = `rgb(${r},${g},${b})`;
                const px = Math.floor(this.offsetX + x * this.zoom);
                const py = Math.floor(this.offsetY + y * this.zoom);

                // The +0.3 prevents sub-pixel gaps when zooming
                ctx.fillRect(px, py, Math.ceil(this.zoom) + 0.3, Math.ceil(this.zoom) + 0.3);
            }
        }
    }

    drawGrid() {
        const ctx = this.ctxs.grid;
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, this.canvases.grid.width / dpr, this.canvases.grid.height / dpr);
        if (!this.showGrid || this.zoom < 6) return;

        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        const endX = this.offsetX + this.pixelGrid.width * this.zoom;
        const endY = this.offsetY + this.pixelGrid.height * this.zoom;

        for (let x = 0; x <= this.pixelGrid.width; x++) {
            const px = Math.floor(this.offsetX + x * this.zoom);
            ctx.moveTo(px, this.offsetY); ctx.lineTo(px, endY);
        }
        for (let y = 0; y <= this.pixelGrid.height; y++) {
            const py = Math.floor(this.offsetY + y * this.zoom);
            ctx.moveTo(this.offsetX, py); ctx.lineTo(endX, py);
        }
        ctx.stroke();
    }

    screenToGrid(clientX, clientY) {
        const gx = Math.floor((clientX - this.offsetX) / this.zoom);
        const gy = Math.floor((clientY - this.offsetY) / this.zoom);
        return { gx, gy };
    }

    drawCell(gx, gy, color) {
        const ctx = this.ctxs.bg;
        ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
        const px = Math.floor(this.offsetX + gx * this.zoom);
        const py = Math.floor(this.offsetY + gy * this.zoom);
        ctx.fillRect(px, py, Math.ceil(this.zoom), Math.ceil(this.zoom));
    }
}