// core/events.js
// -----------------------------------------------------------------------------
// Event system: Updated for Layered Renderer and precise Zoom tracking.
// -----------------------------------------------------------------------------

import { ToolRegistry } from "./tools.js";

export class EditorEvents {
    constructor(canvas, state) {
        this.canvas = canvas; // This is the uiLayer canvas
        this.state = state;
        this.isPointerDown = false;
        this.renderPending = false;
        this._bindEvents();
    }

    _bindEvents() {
        this.canvas.addEventListener("pointerdown", e => this._onPointerDown(e));
        this.canvas.addEventListener("pointermove", e => this._onPointerMove(e));
        this.canvas.addEventListener("pointerup", e => this._onPointerUp(e));
        this.canvas.addEventListener("pointerleave", e => this._onPointerUp(e));
        this.canvas.addEventListener("contextmenu", e => e.preventDefault());
        
        // Key listener on window to catch shortcuts regardless of focus
        window.addEventListener("keydown", e => this._onKeyDown(e));

        // Wheel zoom: must be non-passive to call preventDefault
        this.canvas.addEventListener("wheel", e => this._onWheel(e), { passive: false });

        // Auto-resize sync
        new ResizeObserver(() => {
            if (this.state.renderer) {
                this.state.renderer.resizeToContainer();
            }
        }).observe(this.canvas);
    }

    _onKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            e.shiftKey ? this.state.redo() : this.state.undo();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
            e.preventDefault();
            this.state.redo();
        }
    }

    _onPointerDown(e) {
        e.preventDefault();
        
        if (e.button === 2) { // Right Click Pan
            this.isPanning = true;
            this.lastPointerX = e.clientX;
            this.lastPointerY = e.clientY;
            this.canvas.setPointerCapture(e.pointerId);
            return;
        }

        this.isPointerDown = true;
        const tool = ToolRegistry[this.state.activeTool];
        if (!tool) return;

        const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
        this.canvas.setPointerCapture(e.pointerId);
        tool.onPointerDown(this.state, gx, gy, e.clientX, e.clientY, { shiftKey: e.shiftKey });
    }

    _onPointerMove(e) {
        if (!this.isPanning && !this.isPointerDown) return;

        if (this.renderPending) return;
        this.renderPending = true;

        requestAnimationFrame(() => {
            const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
            
            if (this.isPanning) {
                const dx = e.clientX - this.lastPointerX;
                const dy = e.clientY - this.lastPointerY;
                this.state.setPan(this.state.panX + dx, this.state.panY + dy);
                this.lastPointerX = e.clientX;
                this.lastPointerY = e.clientY;
            } else if (this.isPointerDown) {
                const tool = ToolRegistry[this.state.activeTool];
                tool.onPointerMove(this.state, gx, gy, e.clientX, e.clientY);
            }
            
            this.renderPending = false;
        });
    }

    _onPointerUp(e) {
        if (e.button === 2) {
            this.isPanning = false;
        } else {
            this.isPointerDown = false;
            const tool = ToolRegistry[this.state.activeTool];
            if (tool) tool.onPointerUp(this.state);
        }
        this.canvas.releasePointerCapture(e.pointerId);
    }

    _onWheel(e) {
        e.preventDefault();
        const tool = ToolRegistry["zoom"];
        if (!tool) return;

        // Pass the actual screen coordinates so zoom centers on the cursor
        tool.onWheel(this.state, e.deltaY, e.clientX, e.clientY);
    }
}