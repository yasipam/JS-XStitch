// core/backstitchGrid.js
// -----------------------------------------------------------------------------
// BackstitchGrid: data model for backstitch lines.
// Stores lines as arrays of grid intersection points with unique IDs.
// Provides undo/redo, line management, and grid-bounded validation.
// -----------------------------------------------------------------------------

export class BackstitchGrid {
    constructor(width, height) {
        this.width = width;   // Grid width in pixels (intersections: 0..width)
        this.height = height; // Grid height in pixels (intersections: 0..height)
        
        // Array of line objects: { id, points: [[x,y],...], color: [r,g,b] }
        this.lines = [];
        
        // Unique ID counter for new lines
        this.nextId = 1;
        
        // Undo/redo stacks (separate from pixel grid)
        this.undoStack = [];
        this.redoStack = [];
    }

    // -------------------------------------------------------------------------
    // INTERNAL HELPERS
    // -------------------------------------------------------------------------
    _cloneLines() {
        return this.lines.map(line => ({
            ...line,
            points: line.points.map(p => [...p]), // Deep copy points
            color: [...line.color]                 // Deep copy color
        }));
    }

    _pointToSegmentDistance(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        if (lenSq !== 0) param = dot / lenSq;

        let xx, yy;

        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }

        const dx = px - xx;
        const dy = py - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // -------------------------------------------------------------------------
    // UNDO/REDO
    // -------------------------------------------------------------------------
    pushUndo() {
        // Keep last 50 actions to save memory (matches PixelGrid behavior)
        if (this.undoStack.length > 50) this.undoStack.shift();
        
        // Deep clone current state
        this.undoStack.push(this._cloneLines());
        this.redoStack.length = 0; // Clear redo stack on new action
    }

    undo() {
        if (this.undoStack.length === 0) return null;
        
        // Save current state to redo stack
        this.redoStack.push(this._cloneLines());
        
        // Restore previous state
        this.lines = this.undoStack.pop();
        return this.lines;
    }

    redo() {
        if (this.redoStack.length === 0) return null;
        
        // Save current state to undo stack
        this.undoStack.push(this._cloneLines());
        
        // Restore next state
        this.lines = this.redoStack.pop();
        return this.lines;
    }

    // -------------------------------------------------------------------------
    // LINE MANAGEMENT
    // -------------------------------------------------------------------------
    addLine(points, color) {
        // Validate inputs
        if (!Array.isArray(points) || points.length < 2) return null;
        if (!Array.isArray(color) || color.length !== 3) return null;

        // Validate all points are within grid bounds (intersections: 0..width, 0..height)
        const allValid = points.every(([x, y]) => 
            x >= 0 && x <= this.width && y >= 0 && y <= this.height
        );
        if (!allValid) return null;

        // Create line object
        const line = {
            id: this.nextId++,
            points: points.map(p => [...p]), // Copy points array
            color: [...color]                 // Copy color array
        };

        this.lines.push(line);
        return line.id;
    }

    removeLine(id) {
        const index = this.lines.findIndex(line => line.id === id);
        if (index === -1) return false;
        
        this.lines.splice(index, 1);
        return true;
    }

    // Remove lines near a grid intersection point (for eraser)
    // Returns array of removed line IDs
    removeNearPoint(clickX, clickY, radius) {
        const removedIds = [];
        
        for (let i = this.lines.length - 1; i >= 0; i--) {
            const line = this.lines[i];
            let isNear = false;

            // Check all segments in the line
            for (let j = 0; j < line.points.length - 1; j++) {
                const [x1, y1] = line.points[j];
                const [x2, y2] = line.points[j + 1];
                const dist = this._pointToSegmentDistance(clickX, clickY, x1, y1, x2, y2);
                
                if (dist <= radius) {
                    isNear = true;
                    break;
                }
            }

            if (isNear || 
                // Also check if click is near any endpoint
                line.points.some(([px, py]) => 
                    Math.abs(px - clickX) <= radius && Math.abs(py - clickY) <= radius
                )) {
                removedIds.push(line.id);
                this.lines.splice(i, 1);
            }
        }

        return removedIds;
    }

    // Resize grid (preserves lines within new bounds, removes others)
    resize(newWidth, newHeight, recordUndo = true) {
        if (recordUndo) this.pushUndo();
        
        this.width = newWidth;
        this.height = newHeight;
        
        // Remove lines with points outside new bounds
        this.lines = this.lines.filter(line => 
            line.points.every(point => {
                const [x, y] = point;
                return x >= 0 && x <= newWidth && y >= 0 && y <= newHeight;
            })
        );
    }

    // Get all lines (for rendering)
    getLines() {
        return this.lines;
    }

    // Find line color near a grid intersection point (for hover detection)
    getColorAt(ix, iy, radius = 0.5) {
        for (const line of this.lines) {
            for (let j = 0; j < line.points.length - 1; j++) {
                const [x1, y1] = line.points[j];
                const [x2, y2] = line.points[j + 1];
                const dist = this._pointToSegmentDistance(ix, iy, x1, y1, x2, y2);
                if (dist <= radius) return line.color;
            }
        }
        return null;
    }

    // Clear all lines
    clear(recordUndo = true) {
        if (recordUndo) this.pushUndo();
        this.lines = [];
        this.nextId = 1;
    }
}
