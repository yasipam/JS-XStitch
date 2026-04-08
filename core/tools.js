// core/tools.js
// -----------------------------------------------------------------------------
// Tool system: Updated for Layered Architecture and Iframe Precision.
// -----------------------------------------------------------------------------

export class BaseTool {
    onPointerDown(state, gx, gy, screenX, screenY, options) {}
    onPointerMove(state, gx, gy, screenX, screenY) {}
    onPointerUp(state) {}
    cursor = "default";
}

export class PencilTool extends BaseTool {
    cursor = "crosshair";

    onPointerDown(state, gx, gy, screenX, screenY, options) {
        state.pixelGrid.pushUndo(); 
        this.drawing = true;

        if (options?.shiftKey && this.lastGx !== undefined) {
            this.drawLine(state, this.lastGx, this.lastGy, gx, gy);
        } else {
            state.setPixel(gx, gy, state.activeColor);
        }

        this.lastGx = gx;
        this.lastGy = gy;
    }

    onPointerMove(state, gx, gy) {
        if (!this.drawing) return;
        if (this.lastGx !== gx || this.lastGy !== gy) {
            this.drawLine(state, this.lastGx, this.lastGy, gx, gy);
            this.lastGx = gx;
            this.lastGy = gy;
        }
    }

    onPointerUp() {
        this.drawing = false;
    }

    drawLine(state, x0, y0, x1, y1) {
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = (x0 < x1) ? 1 : -1;
        const sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;

        while (true) {
            state.setPixel(x0, y0, state.activeColor);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }
}

export class EraserTool extends BaseTool {
    cursor = "cell";

    onPointerDown(state, gx, gy) {
        state.pixelGrid.pushUndo();
        this.erasing = true;
        state.setPixel(gx, gy, [255, 255, 255]);
        this.lastGx = gx;
        this.lastGy = gy;
    }

    onPointerMove(state, gx, gy) {
        if (!this.erasing) return;
        if (this.lastGx !== gx || this.lastGy !== gy) {
            this.eraseLine(state, this.lastGx, this.lastGy, gx, gy);
            this.lastGx = gx;
            this.lastGy = gy;
        }
    }

    onPointerUp() {
        this.erasing = false;
    }

    eraseLine(state, x0, y0, x1, y1) {
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = (x0 < x1) ? 1 : -1;
        const sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;

        while (true) {
            state.setPixel(x0, y0, [255, 255, 255]);
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }
}

export class FillTool extends BaseTool {
    cursor = "cell";
    onPointerDown(state, gx, gy) {
        state.floodFill(gx, gy, state.activeColor);
    }
}

export class PickerTool extends BaseTool {
    cursor = "copy";
    onPointerDown(state, gx, gy) {
        const px = state.pixelGrid.get(gx, gy);
        if (!px) return;
        state.setColor(px);
    }
}

export class PanTool extends BaseTool {
    cursor = "grab";
    onPointerDown(state, gx, gy, screenX, screenY) {
        this.dragging = true;
        this.startX = screenX;
        this.startY = screenY;
        this.startPanX = state.panX;
        this.startPanY = state.panY;
        this.cursor = "grabbing";
    }
    onPointerMove(state, gx, gy, screenX, screenY) {
        if (!this.dragging) return;
        const dx = screenX - this.startX;
        const dy = screenY - this.startY;
        state.setPan(this.startPanX + dx, this.startPanY + dy);
    }
    onPointerUp() {
        this.dragging = false;
        this.cursor = "grab";
    }
}

export class ZoomTool extends BaseTool {
    cursor = "zoom-in";
    
    applyZoom(state, delta, clientX, clientY) {
        const oldZoom = state.zoom;
        const zoomFactor = delta < 0 ? 1.1 : 0.9;
        const newZoom = Math.max(0.5, Math.min(oldZoom * zoomFactor, 200));

        // FIX: Look at the UI layer canvas to get the local bounding rect
        const targetCanvas = state.renderer.canvases.ui;
        const rect = targetCanvas.getBoundingClientRect();
        
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;

        // Get the grid point under the mouse BEFORE changing zoom
        const { gx, gy } = state.renderer.screenToGrid(clientX, clientY);

        state.setZoom(newZoom);

        // Adjust pan so the specific grid cell stays under the cursor
        const newPanX = mouseX - gx * newZoom;
        const newPanY = mouseY - gy * newZoom;
        state.setPan(newPanX, newPanY);
    }

    onWheel(state, deltaY, mouseX, mouseY) {
        this.applyZoom(state, deltaY, mouseX, mouseY);
    }
}

export const ToolRegistry = {
    pencil: new PencilTool(),
    eraser: new EraserTool(),
    fill: new FillTool(),
    picker: new PickerTool(),
    pan: new PanTool(),
    zoom: new ZoomTool()
};