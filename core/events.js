// core/events.js
// -----------------------------------------------------------------------------
// Event system: Handles pointer, touch (pinch-zoom), and keyboard events.
// -----------------------------------------------------------------------------

import { ToolRegistry } from "./tools.js";

export class EditorEvents {
    constructor(canvas, state) {
        this.canvas = canvas; // This is the uiLayer canvas
        this.state = state;
        this.isPointerDown = false;
        this.isPanning = false;
        this.renderPending = false;

        // Touch/Gesture Cache
        this.evCache = [];      // Stores active touch points
        this.prevDiff = -1;     // Stores distance between fingers for pinch

        this._bindEvents();
    }

    _bindEvents() {
        // Pointer Events (Handles Mouse, Pen, and Touch)
        this.canvas.addEventListener("pointerdown", e => this._onPointerDown(e));
        this.canvas.addEventListener("pointermove", e => this._onPointerMove(e));
        this.canvas.addEventListener("pointerup", e => this._onPointerUp(e));
        this.canvas.addEventListener("pointerleave", e => this._onPointerUp(e));
        
        // Prevent context menu on right-click (used for panning)
        this.canvas.addEventListener("contextmenu", e => e.preventDefault());
        
        // Internal keyboard listener for when the iframe IS focused
        window.addEventListener("keydown", e => this.onKeyDown(e));

        // Wheel zoom: centers on cursor
        this.canvas.addEventListener("wheel", e => this._onWheel(e), { passive: false });

        // Auto-resize sync via ResizeObserver
        new ResizeObserver(() => {
            if (this.state.renderer) {
                this.state.renderer.resizeToContainer();
            }
        }).observe(this.canvas);
    }

    /**
     * Public method to handle keydown events. 
     * Can be called by the parent shell via the CanvasManager bridge.
     */
    onKeyDown(e) {
        const key = e.key.toLowerCase();
        const hasMod = e.ctrlKey || e.metaKey;

        // CTRL+Z / CMD+Z (Undo)
        if (hasMod && key === "z") {
            if (typeof e.preventDefault === 'function') e.preventDefault();

            if (e.shiftKey) {
                this.state.redo();
            } else {
                this.state.undo();
            }
        }

        // CTRL+Y (Redo)
        if (hasMod && key === "y") {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            this.state.redo();
        }
    }

    _onPointerDown(e) {
        // Add to multi-touch cache for gestures
        this.evCache.push(e);

        // BLOCK INTERACTION IF STAMPED
        if (this.state.stampedMode && e.button !== 2) {
            // Allow right-click panning, but block left-click drawing
            return;
        }

        const isTouch = e.pointerType === 'touch';
        const isMultiTouch = this.evCache.length > 1;

        // Touch/Fingers: ONLY pan/zoom, no drawing
        if (isTouch || isMultiTouch) {
            this.isPanning = true;
            this.isPointerDown = false;
            this.lastPointerX = e.clientX;
            this.lastPointerY = e.clientY;
        } else if (e.button === 2) {
            // Right Click -> Panning Mode
            this.isPanning = true;
            this.isPointerDown = false;
            this.lastPointerX = e.clientX;
            this.lastPointerY = e.clientY;
        } else {
            // Pen or Mouse Left Click -> Tool Interaction
            this.isPointerDown = true;
            this.isPanning = false;
            const tool = ToolRegistry[this.state.activeTool];
            if (tool) {
                const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
                tool.onPointerDown(this.state, gx, gy, e.clientX, e.clientY, { shiftKey: e.shiftKey });
            }
        }

        this.canvas.setPointerCapture(e.pointerId);
    }

    _onPointerMove(e) {
        // Update pointer in gesture cache
        const index = this.evCache.findIndex(p => p.pointerId === e.pointerId);
        if (index !== -1) this.evCache[index] = e;

        if (this.renderPending) return;
        this.renderPending = true;

        requestAnimationFrame(() => {
            // HANDLE TWO-FINGER GESTURES (ZOOM & PAN)
            if (this.evCache.length === 2) {
                const p1 = this.evCache[0];
                const p2 = this.evCache[1];

                // 1. Calculate Distance for Zooming
                const curDiff = Math.sqrt(
                    Math.pow(p1.clientX - p2.clientX, 2) +
                    Math.pow(p1.clientY - p2.clientY, 2)
                );

                // 2. Calculate Midpoint for Panning
                const curMidX = (p1.clientX + p2.clientX) / 2;
                const curMidY = (p1.clientY + p2.clientY) / 2;

                if (this.prevDiff > 0) {
                    // Apply Zoom
                    const zoomSensitivity = 0.5;
                    const delta = (curDiff - this.prevDiff) * zoomSensitivity;

                    if (Math.abs(delta) > 5) {
                        const newZoom = delta > 0 ? this.state.zoom + 1 : this.state.zoom - 1;
                        this.state.setZoom(Math.max(1, newZoom));
                        this.prevDiff = curDiff;
                    }

                    // Apply Two-Finger Pan (with 3px deadzone to prevent accidental pans)
                    if (this.lastMidX !== undefined) {
                        const dx = curMidX - this.lastMidX;
                        const dy = curMidY - this.lastMidY;
                        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                            this.state.setPan(this.state.panX + dx, this.state.panY + dy);
                        }
                    }
                } else {
                    this.prevDiff = curDiff;
                }

                // Update midpoints for next move frame
                this.lastMidX = curMidX;
                this.lastMidY = curMidY;
            } 
            
            // HANDLE SINGLE-FINGER PANNING (Right-click mode)
            else if (this.isPanning) {
                const dx = e.clientX - this.lastPointerX;
                const dy = e.clientY - this.lastPointerY;
                this.state.setPan(this.state.panX + dx, this.state.panY + dy);
                this.lastPointerX = e.clientX;
                this.lastPointerY = e.clientY;
            } 
            
            // HANDLE DRAWING
            else if (this.isPointerDown) {
                const tool = ToolRegistry[this.state.activeTool];
                if (tool) {
                    const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
                    tool.onPointerMove(this.state, gx, gy, e.clientX, e.clientY);
                }
            }
            
            this.renderPending = false;
        });
    }

    _onPointerUp(e) {
        this.evCache = this.evCache.filter(p => p.pointerId !== e.pointerId);
        
        if (this.evCache.length < 2) {
            this.prevDiff = -1;
            this.lastMidX = undefined; // Reset so pan doesn't "jump" next time
            this.lastMidY = undefined;
        }

        if (e.button === 2 || this.evCache.length === 0) {
            this.isPanning = false;
        }

        if (this.isPointerDown && this.evCache.length === 0) {
            this.isPointerDown = false;
            const tool = ToolRegistry[this.state.activeTool];
            if (tool) tool.onPointerUp(this.state);
        }

        this.canvas.releasePointerCapture(e.pointerId);
    }

    _onWheel(e) {
        e.preventDefault();
        const tool = ToolRegistry["zoom"];
        if (tool) {
            // Standard wheel zoom centered on cursor
            tool.onWheel(this.state, e.deltaY, e.clientX, e.clientY);
        }
    }
}