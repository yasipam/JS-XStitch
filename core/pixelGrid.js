// core/pixelGrid.js
// -----------------------------------------------------------------------------
// PixelGrid: the core data model for the editor.
// Stores a 2D grid of RGB pixels (or DMC codes after mapping).
// Provides safe access, mutation, undo/redo, and resizing.
// -----------------------------------------------------------------------------

export class PixelGrid {
    constructor(width, height, fill = [255, 255, 255]) {
        this.width = width;
        this.height = height;

        // 2D array of [r,g,b]
        this.grid = Array.from({ length: height }, () =>
            Array.from({ length: width }, () => [...fill])
        );

        // Undo/redo stacks
        this.undoStack = [];
        this.redoStack = [];
    }

    // -------------------------------------------------------------------------
    // INTERNAL HELPERS
    // -------------------------------------------------------------------------
    _cloneGrid() {
        return this.grid.map(row => row.map(px => [...px]));
    }

    pushUndo() {
        // Only keep the last 50 actions to save memory
        if (this.undoStack.length > 50) this.undoStack.shift();
        
        // Deep clone current state before changing it
        this.undoStack.push(this._cloneGrid());
        this.redoStack.length = 0; 
    }

    // -------------------------------------------------------------------------
    // BASIC GET/SET
    // -------------------------------------------------------------------------
    get(x, y) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
        return this.grid[y][x];
    }

    set(x, y, rgb) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
        this.grid[y][x] = [...rgb];
    }

    // -------------------------------------------------------------------------
    // BULK OPERATIONS
    // -------------------------------------------------------------------------
    
    fillAll(rgb) {
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                this.grid[y][x] = [...rgb];
            }
        }
    }
    
    replaceColor(targetRgb, newRgb, recordUndo = true) {
        if (recordUndo) this.pushUndo();

        const [tr, tg, tb] = targetRgb;

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const [r, g, b] = this.grid[y][x];
                if (r === tr && g === tg && b === tb) {
                    this.grid[y][x] = [...newRgb];
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // FLOOD FILL (for paint bucket tool)
    // -------------------------------------------------------------------------
    floodFill(x, y, newRgb, recordUndo = true) {
        const target = this.get(x, y);
        if (!target) return;
        const [tr, tg, tb] = target;
        const [nr, ng, nb] = newRgb;

        if (tr === nr && tg === ng && tb === nb) return;

        if (recordUndo) this.pushUndo();

        const stack = [[x, y]];

        while (stack.length) {
            const [cx, cy] = stack.pop();
            const px = this.get(cx, cy);
            if (!px) continue;

            const [r, g, b] = px;
            if (r !== tr || g !== tg || b !== tb) continue;

            this.grid[cy][cx] = [...newRgb];

            stack.push([cx + 1, cy]);
            stack.push([cx - 1, cy]);
            stack.push([cx, cy + 1]);
            stack.push([cx, cy - 1]);
        }
    }

    // -------------------------------------------------------------------------
    // RESIZE GRID
    // -------------------------------------------------------------------------
    resize(newW, newH, fill = [255, 255, 255], recordUndo = true) {
        if (recordUndo) this.pushUndo();

        const newGrid = Array.from({ length: newH }, (_, y) =>
            Array.from({ length: newW }, (_, x) =>
                y < this.height && x < this.width
                    ? [...this.grid[y][x]]
                    : [...fill]
            )
        );

        this.width = newW;
        this.height = newH;
        this.grid = newGrid;
    }

    // -------------------------------------------------------------------------
    // UNDO / REDO
    // -------------------------------------------------------------------------
    undo() {
        if (this.undoStack.length === 0) return null;
        
        // Save current state to redo stack before moving back
        this.redoStack.push(this._cloneGrid());
        this.grid = this.undoStack.pop();
        
        return this.grid;
    }

    redo() {
        if (this.redoStack.length === 0) return null;
        
        // Save current state back to undo stack before moving forward
        this.undoStack.push(this._cloneGrid());
        this.grid = this.redoStack.pop();
        
        return this.grid;
    }

    // -------------------------------------------------------------------------
    // MINIMUM OCCURRENCE CLEANUP
    // -------------------------------------------------------------------------
    cleanupMinOccurrence(minOccurrence) {
        if (minOccurrence <= 1) return;

        // 1. Count occurrences of every color
        const countMap = {};
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const rgb = this.grid[y][x];
                const key = rgb.join(',');
                countMap[key] = (countMap[key] || 0) + 1;
            }
        }

        // 2. Identify colors to remove
        const toRemove = Object.entries(countMap)
            .filter(([rgbKey, count]) => count < minOccurrence)
            .map(([rgbKey]) => rgbKey);

        if (toRemove.length === 0) return;

        // 3. Identify surviving colors
        const remaining = Object.keys(countMap)
            .filter(key => !toRemove.includes(key))
            .map(key => key.split(',').map(Number));

        // Safety check: if everything is removed, abort
        if (remaining.length === 0) return;

        this.pushUndo(); // Save state before bulk change

        // 4. Replace rare colors with the nearest surviving RGB
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const currentKey = this.grid[y][x].join(',');
                
                if (toRemove.includes(currentKey)) {
                    const orig = this.grid[y][x];
                    let bestColor = remaining[0];
                    let minSquareDist = Infinity;

                    for (const rgb of remaining) {
                        const d = Math.pow(orig[0] - rgb[0], 2) + 
                                  Math.pow(orig[1] - rgb[1], 2) + 
                                  Math.pow(orig[2] - rgb[2], 2);
                        if (d < minSquareDist) {
                            minSquareDist = d;
                            bestColor = rgb;
                        }
                    }
                    this.grid[y][x] = [...bestColor];
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // EXPORT HELPERS
    // -------------------------------------------------------------------------
    toFlatArray() {
        return this.grid.flat();
    }

    to2DArray() {
        return this.grid.map(row => row.map(px => [...px]));
    }
}