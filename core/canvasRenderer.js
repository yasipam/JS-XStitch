export class LayeredRenderer {
    constructor(canvases, pixelGrid) {
        this.pixelGrid = pixelGrid;
        this.canvases = canvases;
        this.ctxs = {
            ref: canvases.ref ? canvases.ref.getContext("2d") : null,
            bg: canvases.bg.getContext("2d", { alpha: false }),
            grid: canvases.grid.getContext("2d"),
            refOverlay: canvases.refOverlay ? canvases.refOverlay.getContext("2d") : null,
            ui: canvases.ui.getContext("2d")
        };
        this.zoom = 20;
        this.offsetX = 0;
        this.offsetY = 0;
        this.showGrid = true;

        this.showReference = false;
        this.referenceImage = null;
        this.referenceOpacity = 0.5;
        this.referencePosition = 'over';
        this.referenceWidth = 0;
        this.referenceHeight = 0;

        Object.values(this.ctxs).forEach(ctx => {
            if (ctx) ctx.imageSmoothingEnabled = false;
        });
        window.addEventListener("resize", () => this.resizeToContainer());
        this.resizeToContainer();
    }

    resizeToContainer() {
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth;
        const h = window.innerHeight;

        Object.values(this.canvases).forEach(canvas => {
            if (canvas) {
                canvas.width = w * dpr;
                canvas.height = h * dpr;
                canvas.style.width = `${w}px`;
                canvas.style.height = `${h}px`;
            }
        });

        Object.values(this.ctxs).forEach(ctx => {
            if (ctx) {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.imageSmoothingEnabled = false;
            }
        });
        this.draw();
    }

    setPixelGrid(grid) { this.pixelGrid = grid; this.draw(); }
    setZoom(z) { this.zoom = z; this.draw(); }
    setPan(x, y) { this.offsetX = x; this.offsetY = y; this.draw(); }
    toggleGrid(s) { this.showGrid = s; this.draw(); }

    setReferenceImage(imageData, width, height) {
        if (!imageData) return;
        const img = new Image();
        img.onload = () => {
            this.referenceImage = img;
            this.referenceWidth = width;
            this.referenceHeight = height;
            this.showReference = true;
            this.draw();
        };
        img.src = imageData;
    }

    toggleReference(show) {
        this.showReference = show;
        this.draw();
    }

    setReferenceOpacity(opacity) {
        this.referenceOpacity = opacity;
        this.draw();
    }

    setReferencePosition(pos) {
        this.referencePosition = pos;
        this.draw();
    }

    draw() { this.drawReference(); this.drawBackground(); this.drawGrid(); }

    drawReference() {
        if (!this.showReference) {
            const dpr = window.devicePixelRatio || 1;
            if (this.ctxs.ref && this.canvases.ref) {
                this.ctxs.ref.clearRect(0, 0, this.canvases.ref.width / dpr, this.canvases.ref.height / dpr);
            }
            if (this.ctxs.refOverlay && this.canvases.refOverlay) {
                this.ctxs.refOverlay.clearRect(0, 0, this.canvases.refOverlay.width / dpr, this.canvases.refOverlay.height / dpr);
            }
            return;
        }
        if (!this.referenceImage) return;

        const isUnder = this.referencePosition === 'under';
        const ctx = isUnder ? this.ctxs.ref : this.ctxs.refOverlay;
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const canvas = isUnder ? this.canvases.ref : this.canvases.refOverlay;
        if (!canvas) return;

        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

        const gridW = this.pixelGrid ? this.pixelGrid.width : 0;
        const gridH = this.pixelGrid ? this.pixelGrid.height : 0;
        const refW = this.referenceWidth;
        const refH = this.referenceHeight;

        const refImgW = Math.floor(this.offsetX + refW * this.zoom);
        const refImgH = Math.floor(this.offsetY + refH * this.zoom);
        const startX = Math.floor(this.offsetX);
        const startY = Math.floor(this.offsetY);

        ctx.globalAlpha = this.referenceOpacity;
        ctx.drawImage(this.referenceImage, startX, startY, refImgW - startX, refImgH - startY);
        ctx.globalAlpha = 1;
    }

    drawBackground() {
        const ctx = this.ctxs.bg;
        const grid = this.pixelGrid;
        if (!grid || !grid.grid) return;

        const dpr = window.devicePixelRatio || 1;
        ctx.fillStyle = "#c1c1c1";
        ctx.fillRect(0, 0, this.canvases.bg.width / dpr, this.canvases.bg.height / dpr);

        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                const [r, g, b] = grid.grid[y][x];
                ctx.fillStyle = `rgb(${r},${g},${b})`;
                const px = Math.floor(this.offsetX + x * this.zoom);
                const py = Math.floor(this.offsetY + y * this.zoom);
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