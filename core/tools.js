export class BaseTool {
    onPointerDown() { }
    onPointerMove() { }
    onPointerUp() { }
    cursor = "default";
}

export class PencilTool extends BaseTool {
    cursor = "crosshair";
    size = 1;
    lastGx = undefined;
    lastGxOffset = undefined;
    lastGy = undefined;
    lastGyOffset = undefined;

    onPointerDown(state, gx, gy, screenX, screenY, options) {
        const size = this.size;
        const half = Math.floor(size / 2);

        if (gx - half < 0 || gy - half < 0 || gx + half >= state.pixelGrid.width || gy + half >= state.pixelGrid.height) return;
        state.pixelGrid.pushUndo();
        this.drawing = true;

        const isFresh = this.lastGx === undefined ||
            Math.abs(this.lastGx - gx) > state.pixelGrid.width / 2;

        if (options?.shiftKey && !isFresh) {
            this.drawLine(state, this.lastGx, this.lastGy, gx, gy);
        } else {
            this.drawBlock(state, gx, gy, state.activeColor);
        }
        this.lastGx = gx; this.lastGy = gy;
    }

    onPointerMove(state, gx, gy) {
        if (!this.drawing) return;
        const half = Math.floor(this.size / 2);
        if (gx - half >= 0 && gy - half >= 0 && gx + half < state.pixelGrid.width && gy + half < state.pixelGrid.height) {
            if (this.lastGx !== undefined && (this.lastGx !== gx || this.lastGy !== gy)) {
                this.drawLine(state, this.lastGx, this.lastGy, gx, gy);
                this.lastGx = gx; this.lastGy = gy;
            }
        }
    }

    onPointerUp() {
        this.drawing = false;
        this.lastGx = undefined; this.lastGy = undefined;
    }

    drawBlock(state, cx, cy, color) {
        const size = this.size;
        const half = Math.floor(size / 2);
        for (let dy = -half; dy < size - half; dy++) {
            for (let dx = -half; dx < size - half; dx++) {
                state.setPixel(cx + dx, cy + dy, color);
            }
        }
    }

    drawLine(state, x0, y0, x1, y1) {
        const size = this.size;
        const half = Math.floor(size / 2);
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;
        while (true) {
            this.drawBlock(state, x0, y0, state.activeColor);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }
}

export class EraserTool extends BaseTool {
    cursor = "cell";
    size = 1;
    lastGx = undefined; lastGy = undefined;

    onPointerDown(state, gx, gy) {
        const size = this.size;
        const half = Math.floor(size / 2);

        if (gx - half < 0 || gy - half < 0 || gx + half >= state.pixelGrid.width || gy + half >= state.pixelGrid.height) return;
        state.pixelGrid.pushUndo();
        this.erasing = true;
        this.eraseBlock(state, gx, gy);
        this.lastGx = gx; this.lastGy = gy;
    }

    onPointerMove(state, gx, gy) {
        if (!this.erasing) return;
        const half = Math.floor(this.size / 2);
        if (gx - half >= 0 && gy - half >= 0 && gx + half < state.pixelGrid.width && gy + half < state.pixelGrid.height) {
            if (this.lastGx !== undefined && (this.lastGx !== gx || this.lastGy !== gy)) {
                this.eraseLine(state, this.lastGx, this.lastGy, gx, gy);
                this.lastGx = gx; this.lastGy = gy;
            }
        }
    }

    onPointerUp() { this.erasing = false; this.lastGx = undefined; this.lastGy = undefined; }

    eraseBlock(state, cx, cy) {
        const size = this.size;
        const half = Math.floor(size / 2);
        for (let dy = -half; dy < size - half; dy++) {
            for (let dx = -half; dx < size - half; dx++) {
                state.setPixel(cx + dx, cy + dy, [255, 255, 255]);
            }
        }
    }

    eraseLine(state, x0, y0, x1, y1) {
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;
        while (true) {
            this.eraseBlock(state, x0, y0);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }
}

export class FillTool extends BaseTool {
    cursor = "cell";
    onPointerDown(state, gx, gy) { state.floodFill(gx, gy, state.activeColor); }
}

export class PickerTool extends BaseTool {
    cursor = "copy";
    onPointerDown(state, gx, gy) {
        const px = state.pixelGrid.get(gx, gy);
        if (px) state.setColor(px);
    }
}

export class PanTool extends BaseTool {
    cursor = "grab";
    onPointerDown(state, gx, gy, screenX, screenY) {
        this.dragging = true; this.startX = screenX; this.startY = screenY;
        this.startPanX = state.panX; this.startPanY = state.panY;
        this.cursor = "grabbing";
    }
    onPointerMove(state, gx, gy, screenX, screenY) {
        if (!this.dragging) return;
        state.setPan(this.startPanX + (screenX - this.startX), this.startPanY + (screenY - this.startY));
    }
    onPointerUp() { this.dragging = false; this.cursor = "grab"; }
}

export class ZoomTool extends BaseTool {
    applyZoom(state, delta, clientX, clientY) {
        const factor = delta < 0 ? 1.1 : 0.9;
        const newZoom = Math.max(0.5, Math.min(state.zoom * factor, 200));
        const rect = state.renderer.canvases.ui.getBoundingClientRect();
        const { gx, gy } = state.renderer.screenToGrid(clientX, clientY);
        state.setZoom(newZoom);
        state.setPan((clientX - rect.left) - gx * newZoom, (clientY - rect.top) - gy * newZoom);
    }
    onWheel(state, deltaY, mouseX, mouseY) { this.applyZoom(state, deltaY, mouseX, mouseY); }
}

export const ToolRegistry = {
    pencil: new PencilTool(), eraser: new EraserTool(),
    fill: new FillTool(), picker: new PickerTool(),
    pan: new PanTool(), zoom: new ZoomTool()
};