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
        this.isPointerDown = true;

        const tool = ToolRegistry[this.state.activeTool];
        if (!tool) return;

        // Convert screen → grid
        const rect = this.canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;

        const { gx, gy } = this.state.renderer.screenToGrid(screenX, screenY);

        // Capture pointer for smooth dragging
        this.canvas.setPointerCapture(e.pointerId);

        // Tools may need screen coords (pan tool)
        tool.onPointerDown(this.state, gx, gy, screenX, screenY);
    }

    // -------------------------------------------------------------------------
    // POINTER MOVE
    // -------------------------------------------------------------------------
    _onPointerMove(e) {
        if (!this.isPointerDown) return;

        const tool = ToolRegistry[this.state.activeTool];
        if (!tool) return;

        const rect = this.canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;

        const { gx, gy } = this.state.renderer.screenToGrid(screenX, screenY);

        tool.onPointerMove(this.state, gx, gy, screenX, screenY);
    }

    // -------------------------------------------------------------------------
    // POINTER UP
    // -------------------------------------------------------------------------
    _onPointerUp(e) {
        if (!this.isPointerDown) return;

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
