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

        // Right-click tracking for context menu
        this.rightClickStartX = 0;
        this.rightClickStartY = 0;
        this.rightClickGx = -1;
        this.rightClickGy = -1;
        this.rightClickMoved = false;
        this.rightClickPixelRgb = null;
        this.PAN_THRESHOLD = 5; // pixels of movement before panning starts

        // Long-press tracking for context menu
        this.longPressTimer = null;
        this.longPressThreshold = 500;
        this.longPressGx = -1;
        this.longPressGy = -1;
        this.longPressPixelRgb = null;
        this.longPressStartX = 0;
        this.longPressStartY = 0;

        // Context menu state (tracked from parent)
        this.isContextMenuOpen = false;

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

        // Escape - cancel crop if active
        if (key === "escape" && this.state.activeTool === "crop") {
            const tool = ToolRegistry.crop;
            if (tool && typeof tool.cancel === 'function') {
                tool.cancel(this.state);
                window.parent.postMessage({ type: 'CROP_CANCEL' }, '*');
            }
        }

        // Enter - confirm crop if active
        if (key === "enter" && this.state.activeTool === "crop") {
            const tool = ToolRegistry.crop;
            if (tool && tool.box) {
                window.parent.postMessage({ type: 'CROP_CONFIRM', payload: tool.box }, '*');
            }
        }
    }

    // Called by parent to indicate context menu is open/closed
    setContextMenuOpen(open) {
        this.isContextMenuOpen = open;
    }

    _showLongPressMenu() {
        if (this.longPressGx < 0 || !this.state) return;
        
        // Check if we're in backstitch mode
        if (this.state.mode === "backstitch") {
            // For backstitch, show context menu with line options
            window.parent.postMessage({
                type: 'CONTEXT_MENU',
                payload: {
                    ix: this.longPressGx,
                    iy: this.longPressGy,
                    mode: 'backstitch',
                    clientX: this.longPressStartX,
                    clientY: this.longPressStartY
                }
            }, '*');
        } else {
            // Regular pixel mode context menu
            if (!this.state.pixelGrid) return;
            
            window.parent.postMessage({
                type: 'CONTEXT_MENU',
                payload: {
                    gx: this.longPressGx,
                    gy: this.longPressGy,
                    rgb: this.longPressPixelRgb,
                    clientX: this.longPressStartX,
                    clientY: this.longPressStartY
                }
            }, '*');
        }
        
        this.longPressTimer = null;
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
            
            // Start long-press timer for touch context menu (single touch only)
            if (!isMultiTouch) {
                this.longPressStartX = e.clientX;
                this.longPressStartY = e.clientY;
                
                // Get coordinates based on mode
                if (this.state.mode === "backstitch") {
                    const { ix, iy } = this.state.renderer.screenToIntersection(e.clientX, e.clientY);
                    this.longPressGx = ix;
                    this.longPressGy = iy;
                    this.longPressPixelRgb = null; // Backstitch doesn't use pixel RGB
                } else {
                    const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
                    this.longPressGx = gx;
                    this.longPressGy = gy;
                    if (gx >= 0 && gy >= 0 && gx < this.state.pixelGrid.width && gy < this.state.pixelGrid.height) {
                        this.longPressPixelRgb = this.state.pixelGrid.grid[gy][gx];
                    } else {
                        this.longPressPixelRgb = null;
                    }
                }
                
                this.longPressTimer = setTimeout(() => this._showLongPressMenu(), this.longPressThreshold);
            }
        } else if (e.button === 2) {
            // Right Click -> Start tracking for context menu
            // Don't start panning yet - wait to see if user drags
            this.rightClickStartX = e.clientX;
            this.rightClickStartY = e.clientY;
            this.rightClickMoved = false;
            
            // Get the grid coordinates under the cursor
            const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
            this.rightClickGx = gx;
            this.rightClickGy = gy;
            
            // Get the pixel color at this location
            if (gx >= 0 && gy >= 0 && gx < this.state.pixelGrid.width && gy < this.state.pixelGrid.height) {
                this.rightClickPixelRgb = this.state.pixelGrid.grid[gy][gx];
            } else {
                this.rightClickPixelRgb = null;
            }
            
            // Track last position for pan detection
            this.lastPointerX = e.clientX;
            this.lastPointerY = e.clientY;
        } else {
            // Pen or Mouse Left Click -> Tool Interaction (only if context menu NOT open)
            if (!this.isContextMenuOpen) {
                this.isPointerDown = true;
                this.isPanning = false;
                
                // Check if picker tool is active - works in both modes
                if (this.state.activeTool === "picker") {
                    const tool = ToolRegistry.picker;
                    if (tool) {
                        const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
                        tool.onPointerDown(this.state, gx, gy, e.clientX, e.clientY, { shiftKey: e.shiftKey });
                    }
                } else if (this.state.mode === "backstitch") {
                    // Backstitch tools (pencil, eraser)
                    const tool = ToolRegistry[this.state.activeBackstitchTool];
                    if (tool) {
                        const coords = this.state.renderer.screenToIntersection(e.clientX, e.clientY);
                        tool.onPointerDown(this.state, coords.ix, coords.iy);
                    }
                } else {
                    // Pixel mode tools
                    const tool = ToolRegistry[this.state.activeTool];
                    if (tool) {
                        const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
                        tool.onPointerDown(this.state, gx, gy, e.clientX, e.clientY, { shiftKey: e.shiftKey });
                    }
                }
            }

            // Start long-press timer for context menu (mouse left-click)
            this.longPressStartX = e.clientX;
            this.longPressStartY = e.clientY;
            
            // Get coordinates based on mode
            if (this.state.mode === "backstitch") {
                const { ix, iy } = this.state.renderer.screenToIntersection(e.clientX, e.clientY);
                this.longPressGx = ix;
                this.longPressGy = iy;
                this.longPressPixelRgb = null; // Backstitch doesn't use pixel RGB
            } else {
                const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
                this.longPressGx = gx;
                this.longPressGy = gy;
                if (gx >= 0 && gy >= 0 && gx < this.state.pixelGrid.width && gy < this.state.pixelGrid.height) {
                    this.longPressPixelRgb = this.state.pixelGrid.grid[gy][gx];
                } else {
                    this.longPressPixelRgb = null;
                }
            }
            this.longPressTimer = setTimeout(() => this._showLongPressMenu(), this.longPressThreshold);
        }

        this.canvas.setPointerCapture(e.pointerId);
    }

    _onPointerMove(e) {
        // Update pointer in gesture cache
        const index = this.evCache.findIndex(p => p.pointerId === e.pointerId);
        if (index !== -1) this.evCache[index] = e;

        // Check if right-click has moved enough to trigger panning
        if (!this.isPanning && this.rightClickGx >= 0) {
            const dx = e.clientX - this.rightClickStartX;
            const dy = e.clientY - this.rightClickStartY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance > this.PAN_THRESHOLD) {
                // User is dragging - start panning mode
                this.rightClickMoved = true;
                this.isPanning = true;
                this.lastPointerX = this.rightClickStartX;
                this.lastPointerY = this.rightClickStartY;
            }
        }

        // Cancel long-press if user moves beyond threshold
        if (this.longPressTimer) {
            const dx = e.clientX - this.longPressStartX;
            const dy = e.clientY - this.longPressStartY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > this.PAN_THRESHOLD) {
                clearTimeout(this.longPressTimer);
                this.longPressTimer = null;
            }
        }

        // Handle hover detection (when not drawing or panning)
        if (!this.isPointerDown && !this.isPanning && this.evCache.length < 2) {
            // Always check for backstitch first (regardless of mode)
            const { ix, iy } = this.state.renderer.screenToIntersection(e.clientX, e.clientY);
            let bsColor = null;

            // Check if intersection is within valid bounds
            if (ix >= 0 && iy >= 0 && ix <= this.state.backstitchGrid.width && iy <= this.state.backstitchGrid.height) {
                bsColor = this.state.backstitchGrid.getColorAt(ix, iy);
            }

            if (bsColor) {
                // Backstitch found - show its colour (regardless of mode)
                window.parent.postMessage({
                    type: 'HOVER_DMC',
                    payload: { code: null, rgb: bsColor, isBackstitch: true }
                }, '*');
            } else {
                // No backstitch - do pixel grid detection
                const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
                if (gx >= 0 && gy >= 0 && gx < this.state.pixelGrid.width && gy < this.state.pixelGrid.height) {
                    const dmcGrid = this.state.mappedDmcGrid;
                    const rgb = this.state.pixelGrid.grid[gy][gx];

                    // Check DMC code first - code "0" means cloth/transparent
                    const dmcCode = dmcGrid ? dmcGrid[gy][gx] : null;

                    // Check for cloth sentinel (254,254,254) or code "0"
                    const isCloth = (dmcCode && String(dmcCode) === '0') ||
                                   (rgb[0] === 254 && rgb[1] === 254 && rgb[2] === 254);

                    if (isCloth) {
                        // It's cloth - show "None" with checkered indicator
                        window.parent.postMessage({
                            type: 'HOVER_DMC',
                            payload: { code: '0', rgb: rgb, isCloth: true }
                        }, '*');
                    } else if (dmcCode && String(dmcCode) !== '0') {
                        // Has a DMC code (not cloth) - show the color
                        window.parent.postMessage({
                            type: 'HOVER_DMC',
                            payload: { code: dmcCode, rgb: rgb }
                        }, '*');
                    } else {
                        // No DMC code and not cloth
                        window.parent.postMessage({
                            type: 'HOVER_DMC',
                            payload: { code: null }
                        }, '*');
                    }
                } else {
                    window.parent.postMessage({
                        type: 'HOVER_DMC',
                        payload: { code: null }
                    }, '*');
                }
            }
        }

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
                if (this.state.activeTool === "picker") {
                    // Picker doesn't need move handling
                } else if (this.state.mode === "backstitch") {
                    const tool = ToolRegistry[this.state.activeBackstitchTool];
                    if (tool) {
                        const { ix, iy } = this.state.renderer.screenToIntersection(e.clientX, e.clientY);
                        tool.onPointerMove(this.state, ix, iy);
                    }
                } else {
                    const tool = ToolRegistry[this.state.activeTool];
                    if (tool) {
                        const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
                        tool.onPointerMove(this.state, gx, gy, e.clientX, e.clientY);
                    }
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

        // Handle right-click release - show context menu if didn't drag
        if (e.button === 2 && !this.rightClickMoved && this.rightClickGx >= 0) {
            // Check if valid grid position and state is ready
            if (this.rightClickGx >= 0 && this.rightClickGy >= 0 &&
                this.state.pixelGrid &&
                this.rightClickGx < this.state.pixelGrid.width && 
                this.rightClickGy < this.state.pixelGrid.height) {
                
                // Send context menu request to parent
                window.parent.postMessage({
                    type: 'CONTEXT_MENU',
                    payload: {
                        gx: this.rightClickGx,
                        gy: this.rightClickGy,
                        rgb: this.rightClickPixelRgb,
                        clientX: e.clientX,
                        clientY: e.clientY
                    }
                }, '*');
            }
            
            // Reset tracking
            this.rightClickGx = -1;
            this.rightClickGy = -1;
            this.rightClickPixelRgb = null;
            return;
        }

        if (e.button === 2 || this.evCache.length === 0) {
            this.isPanning = false;
            // Reset right-click tracking
            this.rightClickGx = -1;
            this.rightClickGy = -1;
            this.rightClickMoved = false;
            this.rightClickPixelRgb = null;
        }

        if (this.isPointerDown && this.evCache.length === 0) {
            this.isPointerDown = false;
            
            if (this.state.activeTool === "picker") {
                // Picker doesn't need pointer up handling
            } else if (this.state.mode === "backstitch") {
                const tool = ToolRegistry[this.state.activeBackstitchTool];
                if (tool) {
                    tool.onPointerUp(this.state);
                }
            } else {
                const tool = ToolRegistry[this.state.activeTool];
                if (tool) {
                    const { gx, gy } = this.state.renderer.screenToGrid(e.clientX, e.clientY);
                    tool.onPointerUp(this.state, gx, gy);
                }
            }
        }

        // Cancel any pending long-press timer
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
            this.longPressGx = -1;
            this.longPressGy = -1;
            this.longPressPixelRgb = null;
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