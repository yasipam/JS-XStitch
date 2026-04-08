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
        window.addEventListener("keydown", e => this._onKeyDown(e));

        // Wheel zoom
        this.canvas.addEventListener("wheel", e => this._onWheel(e), { passive: false });

        // Resize observer (canvas auto-resize)
        new ResizeObserver(() => {
            this.state.renderer.resizeToContainer();
        }).observe(this.canvas);
    }

    _onKeyDown(e) {
        // Detect Ctrl+Z or Cmd+Z for Undo
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
            e.preventDefault();
            if (e.shiftKey) {
                this.state.redo(); // Ctrl+Shift+Z
            } else {
                this.state.undo();
            }
        }

        // Detect Ctrl+Y or Cmd+Y for Redo
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
            e.preventDefault();
            this.state.redo();
        }
    }

    // -------------------------------------------------------------------------
    // POINTER DOWN
    // -------------------------------------------------------------------------
    _onPointerDown(e) {
        e.preventDefault();
        
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

        const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
        
        // Pass the shiftKey status to the tool
        const options = { shiftKey: e.shiftKey };

        this.canvas.setPointerCapture(e.pointerId);
        tool.onPointerDown(this.state, gx, gy, e.clientX, e.clientY, options);
    }

    // -------------------------------------------------------------------------
    // POINTER MOVE
    // -------------------------------------------------------------------------
    _onPointerMove(e) {
        if (this.isPanning || this.isPointerDown) {
            // Stop the browser from trying to draw 100+ times per second
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
