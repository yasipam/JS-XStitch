// core/events.js
// @ts-nocheck
// -----------------------------------------------------------------------------
// Event system for the Cross Stitch Editor.
// Connects DOM events → tools → EditorState → CanvasRenderer.
// -----------------------------------------------------------------------------

import { ToolRegistry } from "./tools.js";

export class EditorEvents {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.state = state;

        // Track pointer state
        this.isPointerDown = false;

        // Bind event handlers
        this._bindEvents();
    }

    // -------------------------------------------------------------------------
    // EVENT BINDING
    // -------------------------------------------------------------------------
    _bindEvents() {
        // Mouse
        this.canvas.addEventListener("pointerdown", e => this._onPointerDown(e));
        this.canvas.addEventListener("pointermove", e => this._onPointerMove(e));
        this.canvas.addEventListener("pointerup", e => this._onPointerUp(e));
        this.canvas.addEventListener("pointerleave", e => this._onPointerUp(e));
        this.canvas.addEventListener("contextmenu", e => e.preventDefault());

        // Wheel zoom
        this.canvas.addEventListener("wheel", e => this._onWheel(e), { passive: false });

        // Resize observer (canvas auto-resize)
        new ResizeObserver(() => {
            this.state.renderer.resizeToContainer();
        }).observe(this.canvas);
    }

    // -------------------------------------------------------------------------
    // POINTER DOWN
    // -------------------------------------------------------------------------
    _onPointerDown(e) {
        e.preventDefault();
        
        // Right-Click Pan Logic
        if (e.button === 2) {
            this.isPanning = true;
            this.lastPointerX = e.clientX;
            this.lastPointerY = e.clientY;
            this.canvas.setPointerCapture(e.pointerId);
            return;
        }

        this.isPointerDown = true;
        const tool = ToolRegistry[this.state.activeTool];
        if (!tool) return;

        // JUST pass raw e.clientX/Y. The renderer does the hard work now.
        const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);

        this.canvas.setPointerCapture(e.pointerId);
        tool.onPointerDown(this.state, gx, gy, e.clientX, e.clientY);
    }

    // -------------------------------------------------------------------------
    // POINTER MOVE
    // -------------------------------------------------------------------------
    _onPointerMove(e) {
    if (this.isPanning) {
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.state.setPan(this.state.panX + dx, this.state.panY + dy);
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        return;
    }

    if (!this.isPointerDown) return;

    const tool = ToolRegistry[this.state.activeTool];
    if (!tool) return;

    // Use raw e.clientX/Y again
    const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
    tool.onPointerMove(this.state, gx, gy, e.clientX, e.clientY);
}

    // -------------------------------------------------------------------------
    // POINTER UP
    // -------------------------------------------------------------------------
    _onPointerUp(e) {
        if (e.button === 2) {
            this.isPanning = false;
            this.canvas.releasePointerCapture(e.pointerId);
            return;
        }

        this.isPointerDown = false;

        const tool = ToolRegistry[this.state.activeTool];
        if (tool) tool.onPointerUp(this.state);

        this.canvas.releasePointerCapture(e.pointerId);
    }

    // -------------------------------------------------------------------------
    // WHEEL ZOOM
    // -------------------------------------------------------------------------
    _onWheel(e) {
        const tool = ToolRegistry["zoom"];
        if (!tool) return;

        e.preventDefault();

        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        tool.onWheel(this.state, e.deltaY, mouseX, mouseY);
    }
}
