export class LayeredRenderer {
    constructor(canvases, pixelGrid, backstitchGrid) {
        this.pixelGrid = pixelGrid;
        this.backstitchGrid = backstitchGrid;
        this.canvases = canvases;
        this.ctxs = {
            ref: canvases.ref ? canvases.ref.getContext("2d") : null,
            bg: canvases.bg.getContext("2d", { alpha: false }),
            grid: canvases.grid.getContext("2d"),
            backstitch: canvases.backstitch ? canvases.backstitch.getContext("2d") : null,
            refOverlay: canvases.refOverlay ? canvases.refOverlay.getContext("2d") : null,
            ui: canvases.ui.getContext("2d")
        };
        this.zoom = 20;
        this.offsetX = 0;
        this.offsetY = 0;
        this.showGrid = true;

        this.showReference = false;
        this.referenceImage = null;
        this.referenceOpacity = 0;
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
    setBackstitchGrid(grid) { this.backstitchGrid = grid; this.drawBackstitch(); }
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

    draw() { this.drawReference(); this.drawBackground(); this.drawGrid(); this.drawBackstitch(); }

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
        const canvasW = this.canvases.bg.width / dpr;
        const canvasH = this.canvases.bg.height / dpr;
        
        // Fill with grey first (areas outside the grid)
        ctx.fillStyle = "#999999";
        ctx.fillRect(0, 0, canvasW, canvasH);
        
        // Create checkered pattern for cloth/transparent background
        const patternSize = 8;
        const patternCanvas = document.createElement('canvas');
        patternCanvas.width = patternSize * 2;
        patternCanvas.height = patternSize * 2;
        const pCtx = patternCanvas.getContext('2d');
        pCtx.fillStyle = '#cccccc';
        pCtx.fillRect(0, 0, patternSize * 2, patternSize * 2);
        pCtx.fillStyle = '#ffffff';
        pCtx.fillRect(0, 0, patternSize, patternSize);
        pCtx.fillRect(patternSize, patternSize, patternSize, patternSize);
        const pattern = ctx.createPattern(patternCanvas, 'repeat');
        
        // Fill the grid area with checkered pattern (cloth background)
        const gridPixelW = Math.ceil(grid.width * this.zoom);
        const gridPixelH = Math.ceil(grid.height * this.zoom);
        ctx.fillStyle = pattern;
        ctx.fillRect(this.offsetX, this.offsetY, gridPixelW, gridPixelH);

        // Draw pixel colors (skip cloth sentinel - it's checkered)
        for (let y = 0; y < grid.height; y++) {
            for (let x = 0; x < grid.width; x++) {
                const [r, g, b] = grid.grid[y][x];
                // Skip cloth sentinel (254,254,254) - show checkered background
                if (r === 254 && g === 254 && b === 254) continue;
                // Also skip actual white thread (255,255,255) - show as white on checkered
                if (r === 255 && g === 255 && b === 255) {
                    ctx.fillStyle = '#ffffff';
                } else {
                    ctx.fillStyle = `rgb(${r},${g},${b})`;
                }
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

    // -------------------------------------------------------------------------
    // BACKSTITCH RENDERING
    // -------------------------------------------------------------------------
    drawBackstitch() {
        const ctx = this.ctxs.backstitch;
        if (!ctx || !this.backstitchGrid) {
            console.log('[Renderer] drawBackstitch: missing ctx or backstitchGrid', { hasCtx: !!ctx, hasGrid: !!this.backstitchGrid });
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, this.canvases.backstitch.width / dpr, this.canvases.backstitch.height / dpr);

        const lines = this.backstitchGrid.getLines();
        console.log('[Renderer] drawBackstitch called', { lineCount: lines.length, zoom: this.zoom, offsetX: this.offsetX, offsetY: this.offsetY });
        
        if (lines.length === 0) return;

        // Scale line width with zoom (thin but visible)
        const baseLineWidth = Math.max(1, this.zoom * 0.15);

        lines.forEach((line, idx) => {
            if (!line.points || line.points.length < 2) return;

            const [r, g, b] = line.color;
            console.log(`[Renderer] drawBackstitch line ${idx} color:`, line.color);
            ctx.beginPath();
            ctx.strokeStyle = `rgb(${r},${g},${b})`;
            ctx.lineWidth = baseLineWidth;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            // Move to first point
            const [startX, startY] = line.points[0];
            const px0 = Math.floor(this.offsetX + startX * this.zoom);
            const py0 = Math.floor(this.offsetY + startY * this.zoom);
            ctx.moveTo(px0, py0);

            // Draw line segments
            for (let i = 1; i < line.points.length; i++) {
                const [x, y] = line.points[i];
                const px = Math.floor(this.offsetX + x * this.zoom);
                const py = Math.floor(this.offsetY + y * this.zoom);
                ctx.lineTo(px, py);
            }

            ctx.stroke();
            console.log(`[Renderer] drew line ${idx}`, { color: [r,g,b], points: line.points, px0, py0 });
        });
    }

    drawBackstitchPreview(line) {
        const ctx = this.ctxs.backstitch;
        if (!ctx || !line || line.points.length < 2) {
            console.log('[Renderer] drawBackstitchPreview: early return', { hasCtx: !!ctx, hasLine: !!line, points: line?.points?.length, color: line?.color });
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        // We don't clear here - the main drawBackstitch will handle that
        // This is for real-time preview during drawing

        const [r, g, b] = line.color;
        console.log('[Renderer] drawBackstitchPreview color from line:', line.color);
        const baseLineWidth = Math.max(1, this.zoom * 0.15);

        console.log('[Renderer] drawBackstitchPreview', { points: line.points, color: [r,g,b], zoom: this.zoom });

        ctx.beginPath();
        ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`; // Semi-transparent for preview
        ctx.lineWidth = baseLineWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        const [startX, startY] = line.points[0];
        const px0 = Math.floor(this.offsetX + startX * this.zoom);
        const py0 = Math.floor(this.offsetY + startY * this.zoom);
        ctx.moveTo(px0, py0);

        for (let i = 1; i < line.points.length; i++) {
            const [x, y] = line.points[i];
            const px = Math.floor(this.offsetX + x * this.zoom);
            const py = Math.floor(this.offsetY + y * this.zoom);
            ctx.lineTo(px, py);
        }

        ctx.stroke();
    }

    // -------------------------------------------------------------------------
    // STABILISATION ROPE VISUALIZATION
    // -------------------------------------------------------------------------
    drawStabilisationRope(tool) {
        if (!tool || !tool.ropePoints || tool.ropePoints.length < 2) return;

        const ctx = this.ctxs.ui;
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.clearRect(0, 0, this.canvases.ui.width / dpr, this.canvases.ui.height / dpr);

        const ropeColor = 'rgba(0, 180, 216, 0.6)';
        const ropeWidth = Math.max(2, this.zoom * 0.12);

        ctx.beginPath();
        ctx.strokeStyle = ropeColor;
        ctx.lineWidth = ropeWidth;
        ctx.setLineDash([8, 6]);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const [startX, startY] = tool.ropePoints[0];
        const pxStart = this.offsetX + startX * this.zoom;
        const pyStart = this.offsetY + startY * this.zoom;
        ctx.moveTo(pxStart, pyStart);

        for (let i = 1; i < tool.ropePoints.length; i++) {
            const [x, y] = tool.ropePoints[i];
            const px = this.offsetX + x * this.zoom;
            const py = this.offsetY + y * this.zoom;
            ctx.lineTo(px, py);
        }

        ctx.stroke();
        ctx.setLineDash([]);

        const lastPoint = tool.ropePoints[tool.ropePoints.length - 1];
        if (lastPoint) {
            const tipX = this.offsetX + lastPoint[0] * this.zoom;
            const tipY = this.offsetY + lastPoint[1] * this.zoom;

            ctx.beginPath();
            ctx.fillStyle = ropeColor;
            ctx.arc(tipX, tipY, ropeWidth * 1.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.arc(tipX, tipY, ropeWidth * 1.5, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.restore();
    }

    clearStabilisationRope() {
        const ctx = this.ctxs.ui;
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, this.canvases.ui.width / dpr, this.canvases.ui.height / dpr);
    }

    // -------------------------------------------------------------------------
    // GRID UTILITIES
    // -------------------------------------------------------------------------
    screenToGrid(clientX, clientY) {
        const gx = Math.floor((clientX - this.offsetX) / this.zoom);
        const gy = Math.floor((clientY - this.offsetY) / this.zoom);
        return { gx, gy };
    }

    // Convert screen coordinates to grid intersection coordinates
    screenToIntersection(clientX, clientY) {
        const ix = (clientX - this.offsetX) / this.zoom;
        const iy = (clientY - this.offsetY) / this.zoom;
        return { ix, iy };
    }

    drawCell(gx, gy, color) {
        const ctx = this.ctxs.bg;
        // Check for cloth sentinel (254,254,254) - show checkered background
        if (color[0] === 254 && color[1] === 254 && color[2] === 254) {
            // Clear the cell to show the checkered background
            const px = Math.floor(this.offsetX + gx * this.zoom);
            const py = Math.floor(this.offsetY + gy * this.zoom);
            ctx.clearRect(px, py, Math.ceil(this.zoom) + 0.3, Math.ceil(this.zoom) + 0.3);
            return;
        }
        ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
        const px = Math.floor(this.offsetX + gx * this.zoom);
        const py = Math.floor(this.offsetY + gy * this.zoom);
        ctx.fillRect(px, py, Math.ceil(this.zoom), Math.ceil(this.zoom));
    }

    drawCropBox(x1, y1, x2, y2) {
        const dpr = window.devicePixelRatio || 1;
        const ctx = this.ctxs.ui;
        ctx.clearRect(0, 0, this.canvases.ui.width / dpr, this.canvases.ui.height / dpr);

        const px1 = Math.floor(this.offsetX + Math.min(x1, x2) * this.zoom);
        const py1 = Math.floor(this.offsetY + Math.min(y1, y2) * this.zoom);
        const w = Math.abs(x2 - x1) * this.zoom;
        const h = Math.abs(y2 - y1) * this.zoom;

        ctx.strokeStyle = "#00ff00";
        ctx.lineWidth = 2;
        ctx.strokeRect(px1, py1, w, h);
        ctx.fillStyle = "rgba(0,255,0,0.1)";
        ctx.fillRect(px1, py1, w, h);
    }
}