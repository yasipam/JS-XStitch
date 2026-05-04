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
    // size: 1.0 = Full (remove entire line), 0.5 = Half (remove one segment), 0.25 = Quarter (remove quarter segment)
    // Returns array of removed line IDs
    removeNearPoint(clickX, clickY, radius, size = 1.0) {
        const removedIds = [];
        
        for (let i = this.lines.length - 1; i >= 0; i--) {
            const line = this.lines[i];
            let isNear = false;
            let nearestSegmentIdx = -1;
            let nearestSegmentDist = Infinity;

            // Check all segments in the line
            for (let j = 0; j < line.points.length - 1; j++) {
                const [x1, y1] = line.points[j];
                const [x2, y2] = line.points[j + 1];
                const dist = this._pointToSegmentDistance(clickX, clickY, x1, y1, x2, y2);
                
                if (dist <= radius && dist < nearestSegmentDist) {
                    nearestSegmentDist = dist;
                    nearestSegmentIdx = j;
                }
                
                if (dist <= radius) {
                    isNear = true;
                }
            }

            // Check endpoints as fallback
            const nearEndpoint = line.points.some(([px, py]) => 
                Math.abs(px - clickX) <= radius && Math.abs(py - clickY) <= radius
            );

            if (isNear || nearEndpoint) {
                if (size < 1.0 && nearestSegmentIdx >= 0) {
                    // Partial removal: remove only a segment of this line
                    this._removePartialSegment(i, nearestSegmentIdx, clickX, clickY, size);
                } else {
                    // Full removal: remove entire line
                    removedIds.push(line.id);
                    this.lines.splice(i, 1);
                }
            }
        }

        return removedIds;
    }

    // Remove only a portion of a line at a specific segment
    // size: 1.0 = full segment, 0.5 = half segment, 0.25 = quarter segment
    _removePartialSegment(lineIdx, segmentIdx, clickX, clickY, size) {
        const line = this.lines[lineIdx];
        if (!line || segmentIdx < 0 || segmentIdx >= line.points.length - 1) return;

        const [x1, y1] = line.points[segmentIdx];
        const [x2, y2] = line.points[segmentIdx + 1];

        // Calculate parametric position on segment
        const segDx = x2 - x1;
        const segDy = y2 - y1;
        const segLenSq = segDx * segDx + segDy * segDy;
        
        if (segLenSq === 0) return;
        
        const clickDx = clickX - x1;
        const clickDy = clickY - y1;
        const t = Math.max(0, Math.min(1, (clickDx * segDx + clickDy * segDy) / segLenSq));

        // Determine removal range based on size
        let tStart, tEnd;
        if (size >= 1.0) {
            // Full segment removal
            tStart = 0;
            tEnd = 1;
        } else if (size >= 0.5) {
            // Half segment - remove from center
            const centerT = 0.5;
            if (t <= centerT) {
                tStart = 0;
                tEnd = centerT;
            } else {
                tStart = centerT;
                tEnd = 1;
            }
        } else {
            // Quarter segment - remove quarter around click point
            const quarter = 0.25;
            const halfQ = quarter / 2;
            tStart = Math.max(0, t - halfQ);
            tEnd = Math.min(1, t + halfQ);
        }

        const startX = x1 + tStart * segDx;
        const startY = y1 + tStart * segDy;
        const endX = x1 + tEnd * segDx;
        const endY = y1 + tEnd * segDy;

        // Only remove if there's meaningful length
        const removeLenSq = (endX - startX) ** 2 + (endY - startY) ** 2;
        if (removeLenSq < 0.01) return;

        // Need at least 3 points to have a middle segment to remove
        if (line.points.length <= 2) {
            // Single segment line - remove entire line
            this.lines.splice(lineIdx, 1);
            return;
        }

        // The line has multiple segments - we need to split it
        const midX = x1 + t * segDx;
        const midY = y1 + t * segDy;

        // Build new points array by removing the portion
        const newPoints = [];
        
        // Add all points before the segment
        for (let j = 0; j <= segmentIdx; j++) {
            newPoints.push([...line.points[j]]);
        }

        // Add start point if different from existing point
        if (newPoints.length === 0 || 
            Math.abs(newPoints[newPoints.length - 1][0] - startX) > 0.01 ||
            Math.abs(newPoints[newPoints.length - 1][1] - startY) > 0.01) {
            newPoints.push([startX, startY]);
        }

        // Now add a gap - we actually need to split into two separate lines
        // Create two new lines: one before the removed portion, one after
        const pointsBefore = [];
        const pointsAfter = [];

        for (let j = 0; j <= segmentIdx; j++) {
            pointsBefore.push([...line.points[j]]);
        }
        // Add start of removed segment
        pointsBefore.push([startX, startY]);

        // Add end of removed segment
        pointsAfter.push([endX, endY]);
        // Add all points after the segment
        for (let j = segmentIdx + 1; j < line.points.length; j++) {
            pointsAfter.push([...line.points[j]]);
        }

        // Remove old line
        this.lines.splice(lineIdx, 1);

        // Add line before removal if it has 2+ points
        if (pointsBefore.length >= 2) {
            this.lines.push({
                id: this.nextId++,
                points: pointsBefore,
                color: [...line.color]
            });
        }

        // Add line after removal if it has 2+ points and segment was actually removed
        // Quarter (size < 0.5): always create after portion for the other quarter
        // Half (size >= 0.5): only create after if not at edge
        if (pointsAfter.length >= 2 && (size < 0.5 || t <= 0.5)) {
            this.lines.push({
                id: this.nextId++,
                points: pointsAfter,
                color: [...line.color]
            });
        }
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

    // Get colour counts for all backstitch lines
    // Returns Map of RGB string "r,g,b" to count of segments
    getColorCounts() {
        const counts = new Map();
        
        for (const line of this.lines) {
            const colorKey = line.color.join(',');
            // Count segments (each segment is between consecutive points)
            const segments = line.points.length - 1;
            counts.set(colorKey, (counts.get(colorKey) || 0) + segments);
        }
        
        return counts;
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
