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
    currentLine = null; // { points: [[x,y],...], color: [r,g,b] }
    lastIntersection = null; // Last snapped intersection point

    onPointerDown(state, ix, iy) {
        // ix, iy are grid intersection coordinates (not pixel grid coords)
        if (ix < 0 || iy < 0 || ix > state.backstitchGrid.width || iy > state.backstitchGrid.height) return;
        
        state.backstitchGrid.pushUndo();
        this.drawing = true;
        this.currentLine = {
            points: [[ix, iy]],
            color: [...state.backstitchColor]
        };
        this.lastIntersection = [ix, iy];
    }

    onPointerMove(state, ix, iy) {
        if (!this.drawing || !this.currentLine) return;
        if (ix < 0 || iy < 0 || ix > state.backstitchGrid.width || iy > state.backstitchGrid.height) return;

        // Only add point if it's different from last and valid direction
        if (this.lastIntersection[0] !== ix || this.lastIntersection[1] !== iy) {
            // Snap to 8-direction if we have a previous point
            const snapped = this._snapTo8Directions(
                this.lastIntersection[0], this.lastIntersection[1],
                ix, iy
            );
            
            if (snapped) {
                this.currentLine.points.push([snapped.x, snapped.y]);
                this.lastIntersection = [snapped.x, snapped.y];
                
                // Render preview
                if (state.renderer) {
                    state.renderer.drawBackstitchPreview(this.currentLine);
                }
            }
        }
    }

    onPointerUp(state) {
        if (!this.drawing || !this.currentLine) {
            this.drawing = false;
            this.currentLine = null;
            this.lastIntersection = null;
            return;
        }

        // Save the line to backstitchGrid
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
    }

    // Snap to 8 cardinal/intercardinal directions
    _snapTo8Directions(x0, y0, x1, y1) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        
        // If no movement, return null
        if (dx === 0 && dy === 0) return null;
        
        const angle = Math.atan2(dy, dx);
        const octant = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        
        const dist = Math.sqrt(dx * dx + dy * dy);
        const snappedX = Math.round(x0 + Math.cos(octant) * dist);
        const snappedY = Math.round(y0 + Math.sin(octant) * dist);
        
        return { x: snappedX, y: snappedY };
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