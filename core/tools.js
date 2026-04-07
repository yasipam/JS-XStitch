// core/tools.js
// @ts-nocheck
// -----------------------------------------------------------------------------
// Tool system for the Cross Stitch Editor.
// Each tool implements pointer handlers and interacts with EditorState.
// -----------------------------------------------------------------------------

export class BaseTool {
    onPointerDown(state, gx, gy) {}
    onPointerMove(state, gx, gy) {}
    onPointerUp(state, gx, gy) {}
    cursor = "default";
}


// -----------------------------------------------------------------------------
// PENCIL TOOL
// -----------------------------------------------------------------------------
export class PencilTool extends BaseTool {
    cursor = "crosshair";

    onPointerDown(state, gx, gy) {
        this.drawing = true;
        // Paint the first pixel
        state.setPixel(gx, gy, state.activeColor);
    }

    onPointerMove(state, gx, gy) {
        if (!this.drawing) return;
        // Paint as you move
        state.setPixel(gx, gy, state.activeColor);
    }

    onPointerUp() {
        this.drawing = false;
    }
}

export class EraserTool extends BaseTool {
    cursor = "cell";

    onPointerDown(state, gx, gy) {
        this.erasing = true;
        state.setPixel(gx, gy, [255, 255, 255]);
    }

    onPointerMove(state, gx, gy) {
        if (!this.erasing) return;
        state.setPixel(gx, gy, [255, 255, 255]);
    }

    onPointerUp() {
        this.erasing = false;
    }
}

// -----------------------------------------------------------------------------
// FILL TOOL (BUCKET)
// -----------------------------------------------------------------------------
export class FillTool extends BaseTool {
    cursor = "cell";

    onPointerDown(state, gx, gy) {
        state.floodFill(gx, gy, state.activeColor);
    }
}

// -----------------------------------------------------------------------------
// PICKER TOOL (EYEDROPPER)
// -----------------------------------------------------------------------------
export class PickerTool extends BaseTool {
    cursor = "copy";

    onPointerDown(state, gx, gy) {
        const px = state.pixelGrid.get(gx, gy);
        if (!px) return;
        state.setColor(px);
    }
}

// -----------------------------------------------------------------------------
// PAN TOOL (HAND)
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// ZOOM TOOL (WHEEL / PINCH)
// -----------------------------------------------------------------------------
// core/tools.js
// -----------------------------------------------------------------------------
// ZOOM TOOL: Handles both wheel and manual button scaling
// -----------------------------------------------------------------------------
export class ZoomTool extends BaseTool {
    cursor = "zoom-in";

    /**
     * Internal helper to zoom at a specific screen coordinate.
     * Keeps the focal point (centerX, centerY) stable while scaling.
     */
    applyZoom(state, delta, clientX, clientY) {
        const oldZoom = state.zoom;
        const zoomFactor = delta < 0 ? 1.1 : 0.9;
        const newZoom = Math.max(0.5, Math.min(oldZoom * zoomFactor, 200));

        // Get the grid point under the mouse BEFORE the zoom
        const { gx, gy } = state.renderer.screenToGrid(clientX, clientY);
        const rect = state.renderer.canvas.getBoundingClientRect();
        
        // Save where that mouse was relative to the canvas
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;

        state.setZoom(newZoom);

        // Adjust pan so the grid point (gx, gy) stays under the mouse
        const newPanX = mouseX - gx * newZoom;
        const newPanY = mouseY - gy * newZoom;

        state.setPan(newPanX, newPanY);
    }

    onWheel(state, deltaY, mouseX, mouseY) {
        // Direct wheel zoom uses the mouse position as the focal point
        this.applyZoom(state, deltaY, mouseX, mouseY);
    }
}

// -----------------------------------------------------------------------------
// TOOL REGISTRY
// -----------------------------------------------------------------------------
// core/tools.js - Registry Export
// ... (classes go here) ...

export const ToolRegistry = {
    pencil: new PencilTool(),
    eraser: new EraserTool(),
    fill: new FillTool(),
    picker: new PickerTool(),
    pan: new PanTool(),
    zoom: new ZoomTool()
};