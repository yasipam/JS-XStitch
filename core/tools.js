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
                // Use cloth sentinel (254,254,254) to reveal checkered background
                state.setPixel(cx + dx, cy + dy, [254, 254, 254]);
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
    onPointerDown(state, gx, gy, screenX, screenY) {
        let colorPicked = false;
        let pickedColor = null;
        
        // Check backstitch first (if in backstitch mode or backstitch exists)
        if (state.mode === "backstitch" || state.backstitchGrid.getLines().length > 0) {
            const coords = state.renderer.screenToIntersection(screenX, screenY);
            const bsColor = state.backstitchGrid.getColorAt(coords.ix, coords.iy);
            if (bsColor) {
                state.setColor(bsColor);
                colorPicked = true;
                pickedColor = bsColor;
            }
        }
        
        // Fall back to pixel grid
        if (!colorPicked) {
            const px = state.pixelGrid.get(gx, gy);
            if (px) {
                state.setColor(px);
                colorPicked = true;
                pickedColor = px;
            }
        }
        
        // Auto-switch to brush tool after picking and notify parent
        if (colorPicked) {
            // Notify parent of color change (for UI update)
            window.parent.postMessage({
                type: 'COLOR_CHANGED',
                payload: pickedColor
            }, '*');
            
            if (state.mode === "backstitch") {
                state.setBackstitchTool("backstitchPencil");
                window.parent.postMessage({
                    type: 'SET_BACKSTITCH_TOOL',
                    payload: 'backstitchPencil'
                }, '*');
            } else {
                state.setTool("pencil");
                window.parent.postMessage({
                    type: 'SET_TOOL',
                    payload: 'pencil'
                }, '*');
            }
        }
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

export class CropTool extends BaseTool {
    cursor = "crosshair";
    startGx = null;
    startGy = null;
    active = false;
    box = null;

    onPointerDown(state, gx, gy) {
        console.log('[CropTool] onPointerDown fired', { gx, gy });
        this.active = true;
        this.startGx = gx;
        this.startGy = gy;
    }

    onPointerMove(state, gx, gy) {
        if (!this.active || this.startGx === null) return;
        state.renderer.drawCropBox(this.startGx, this.startGy, gx, gy);
    }

    onPointerUp(state, gx, gy) {
        console.log('[CropTool] onPointerUp fired', { active: this.active, startGx: this.startGx, startGy: this.startGy, gx, gy });
        if (!this.active) return;
        this.active = false;

        const x1 = Math.min(this.startGx, gx);
        const y1 = Math.min(this.startGy, gy);
        const x2 = Math.max(this.startGx, gx);
        const y2 = Math.max(this.startGy, gy);

        console.log('[CropTool] crop box:', { x1, y1, x2, y2, w: x2-x1, h: y2-y1 });

        if (x2 - x1 >= 3 && y2 - y1 >= 3) {
            this.box = { x1, y1, x2, y2 };
            console.log('[CropTool] sending CROP_START to parent');
            window.parent.postMessage({
                type: 'CROP_START',
                payload: { x1, y1, x2, y2 }
            }, '*');
        } else {
            this.startGx = null;
            this.startGy = null;
        }
    }

    cancel(state) {
        this.active = false;
        this.box = null;
        this.startGx = null;
        this.startGy = null;
        if (state && state.renderer) {
            state.renderer.drawCropBox(-1, -1, -1, -1);
        }
    }
}

// -----------------------------------------------------------------------------
// BACKSTITCH TOOLS
// -----------------------------------------------------------------------------

export class BackstitchPencilTool extends BaseTool {
    cursor = "crosshair";
    drawing = false;
    currentLine = null;
    lastIntersection = null;
    minSegmentLength = 1.0; // Full - can be changed via dropdown
    angleDeadzone = Math.PI / 12;

    onPointerDown(state, ix, iy) {
        if (ix < 0 || iy < 0 || ix > state.backstitchGrid.width || iy > state.backstitchGrid.height) return;
        state.backstitchGrid.pushUndo();
        this.drawing = true;
        this.currentLine = {
            points: [[ix, iy]],
            color: [...state.activeColor]
        };
        this.lastIntersection = [ix, iy];
        this.lastAngle = null;
    }

    onPointerMove(state, ix, iy) {
        if (!this.drawing || !this.currentLine) return;
        if (ix < 0 || iy < 0 || ix > state.backstitchGrid.width || iy > state.backstitchGrid.height) return;

        const dx = ix - this.lastIntersection[0];
        const dy = iy - this.lastIntersection[1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < this.minSegmentLength) return;

        const rawAngle = Math.atan2(dy, dx);
        const stabilized = this._stabilizeAngle(rawAngle, this.lastAngle);
        const newX = this.lastIntersection[0] + Math.cos(stabilized) * dist;
        const newY = this.lastIntersection[1] + Math.sin(stabilized) * dist;

        this.currentLine.points.push([newX, newY]);
        this.lastIntersection = [newX, newY];
        this.lastAngle = stabilized;

        if (state.renderer) {
            state.renderer.drawBackstitchPreview(this.currentLine);
        }
    }

    onPointerUp(state) {
        if (!this.drawing || !this.currentLine) {
            this.drawing = false;
            this.currentLine = null;
            this.lastIntersection = null;
            this.lastAngle = null;
            return;
        }

        if (this.currentLine.points.length >= 2) {
            state.backstitchGrid.addLine(
                this.currentLine.points,
                this.currentLine.color
            );
            if (state.renderer) {
                state.renderer.drawBackstitch();
            }
            state.emit("backstitchChanged");
        }

        this.drawing = false;
        this.currentLine = null;
        this.lastIntersection = null;
        this.lastAngle = null;
    }

    _stabilizeAngle(rawAngle, lastAngle) {
        if (lastAngle === null) return rawAngle;
        let diff = rawAngle - lastAngle;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        if (Math.abs(diff) < this.angleDeadzone) return lastAngle;
        return Math.round(rawAngle / (Math.PI / 4)) * (Math.PI / 4);
    }
}

export class BackstitchEraserTool extends BaseTool {
    cursor = "cell";
    erasing = false;
    lastErasedIds = [];

    onPointerDown(state, ix, iy) {
        if (ix < 0 || iy < 0 || ix > state.backstitchGrid.width || iy > state.backstitchGrid.height) return;

        state.backstitchGrid.pushUndo();
        this.erasing = true;
        this.lastErasedIds = [];

        // Remove lines near the click point
        const removed = state.backstitchGrid.removeNearPoint(ix, iy, 0.5);
        this.lastErasedIds.push(...removed);

        if (state.renderer) {
            state.renderer.drawBackstitch();
        }
        state.emit("backstitchChanged");
    }

    onPointerMove(state, ix, iy) {
        if (!this.erasing) return;

        if (ix < 0 || iy < 0 || ix > state.backstitchGrid.width || iy > state.backstitchGrid.height) return;

        // Continuously erase lines near the cursor
        const removed = state.backstitchGrid.removeNearPoint(ix, iy, 0.5);
        this.lastErasedIds.push(...removed);

        if (removed.length > 0 && state.renderer) {
            state.renderer.drawBackstitch();
            state.emit("backstitchChanged");
        }
    }

    onPointerUp() {
        this.erasing = false;
        this.lastErasedIds = [];
    }
}

export const ToolRegistry = {
    pencil: new PencilTool(), eraser: new EraserTool(),
    fill: new FillTool(), picker: new PickerTool(),
    pan: new PanTool(), zoom: new ZoomTool(),
    crop: new CropTool(),
    backstitchPencil: new BackstitchPencilTool(),
    backstitchEraser: new BackstitchEraserTool()
};