// parent/crop.js
// -----------------------------------------------------------------------------
// Crop handling functions
// -----------------------------------------------------------------------------

import { state, isEmptyCanvas, isOxsLoaded, hasEmptyCanvasEdits, oxsBaselineDmcGrid, oxsBaselineRgbGrid, oxsBaselinePalette, lastBaselineGrid, userEditDiff, hasBackstitchEdits } from './state.js';
import { sendToCanvas } from './canvas.js';
import { switchTool } from './tools.js';

export function showCropOverlay({ x1, y1, x2, y2 }) {
    console.log('[Parent] showCropOverlay received', { x1, y1, x2, y2 });
    const w = x2 - x1;
    const h = y2 - y1;
    const overlay = document.getElementById('cropOverlay');
    const dimensions = document.getElementById('cropDimensions');
    const confirmBtn = document.getElementById('cropConfirmBtn');
    const cancelBtn = document.getElementById('cropCancelBtn');

    dimensions.textContent = `${w}×${h}`;
    overlay.style.display = 'flex';

    confirmBtn.onclick = () => {
        console.log('[Parent] Confirm clicked, cropping...');
        overlay.style.display = 'none';
        clearCropBox();
        handleCrop({ x1, y1, x2, y2 });
        sendToCanvas('CROP_CONFIRM', { x1, y1, x2, y2 });
    };

    cancelBtn.onclick = () => {
        console.log('[Parent] Cancel clicked');
        overlay.style.display = 'none';
        clearCropBox();
        sendToCanvas('CROP_CANCEL');
    };
}

export function clearCropBox() {
    const iframe = document.getElementById('canvasFrame');
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'CLEAR_CROP_BOX' }, '*');
    }
}

export function updateSizeUI(newWidth, newHeight) {
    const maxSizeSlider = document.getElementById('maxSizeSlider');
    const maxSizeInput = document.getElementById('maxSizeInput');

    if (maxSizeSlider) maxSizeSlider.value = newWidth;
    if (maxSizeInput) maxSizeInput.value = newWidth;
    if (mappingConfig) mappingConfig.maxSize = newWidth;

    setTimeout(() => {
        if (typeof updatePatternSizeDisplay === 'function') {
            updatePatternSizeDisplay();
        }
    }, 100);
}

import { mappingConfig } from './state.js';

export function handleCrop({ x1, y1, x2, y2 }) {
    const box = [x1, y1, x2, y2];
    const newWidth = x2 - x1;
    const newHeight = y2 - y1;

    console.log('[Parent] handleCrop called:', { newWidth, newHeight, isEmptyCanvas, isOxsLoaded, hasCurrentImage: !!currentImage });

    if (isEmptyCanvas || isOxsLoaded) {
        const oldGrid = state.mappedRgbGrid;
        console.log('[Parent] Grid mode, oldGrid:', oldGrid ? `${oldGrid.length}x${oldGrid[0]?.length}` : 'null');

        if (!oldGrid) {
            console.warn('[Parent] handleCrop: oldGrid is null, cannot crop');
            return;
        }

        const newGrid = [];
        for (let y = y1; y < y2; y++) {
            const row = [];
            for (let x = x1; x < x2; x++) {
                if (y < oldGrid.length && x < oldGrid[y].length) {
                    row.push([...oldGrid[y][x]]);
                } else {
                    row.push([255, 255, 255]);
                }
            }
            newGrid.push(row);
        }

        console.log('[Parent] New grid created:', newGrid.length, 'x', newGrid[0].length);

        state.mappedRgbGrid = newGrid;

        state.pixelGrid.undoStack.length = 0;
        state.pixelGrid.redoStack.length = 0;
        state.backstitchGrid.undoStack.length = 0;
        state.backstitchGrid.redoStack.length = 0;
        oxsBaselineDmcGrid = null;
        oxsBaselineRgbGrid = null;
        oxsBaselinePalette = null;
        hasEmptyCanvasEdits = false;
        lastBaselineGrid = newGrid.map(row => row.map(cell => [...cell]));

        state.backstitchGrid.resize(newWidth, newHeight, false);

        if (state.mappedDmcGrid) {
            const newDmcGrid = [];
            for (let y = y1; y < y2; y++) {
                const row = [];
                for (let x = x1; x < x2; x++) {
                    if (y < state.mappedDmcGrid.length && x < state.mappedDmcGrid[y].length) {
                        row.push(state.mappedDmcGrid[y][x]);
                    } else {
                        row.push("0");
                    }
                }
                newDmcGrid.push(row);
            }
            state.mappedDmcGrid = newDmcGrid;
        }

        console.log('[Parent] Sending INIT to iframe:', { width: newWidth, height: newHeight });
        sendToCanvas('INIT', { width: newWidth, height: newHeight });

        console.log('[Parent] Sending UPDATE_GRID to iframe');
        sendToCanvas('UPDATE_GRID', newGrid);

        sendToCanvas('CMD_CLEAR_UNDO');

        console.log('[Parent] Switching to pencil tool');
        switchTool('pencil');

        updateSizeUI(newWidth, newHeight);

    } else if (currentImage) {
        const oldGrid = state.mappedRgbGrid;
        console.log('[Parent] Image already mapped, cropping grid directly. oldGrid:', oldGrid ? `${oldGrid.length}x${oldGrid[0]?.length}` : 'null');

        if (!oldGrid) {
            console.warn('[Parent] handleCrop: no mapped grid to crop');
            return;
        }

        const newGrid = [];
        for (let y = y1; y < y2; y++) {
            const row = [];
            for (let x = x1; x < x2; x++) {
                if (y < oldGrid.length && x < oldGrid[y].length) {
                    row.push([...oldGrid[y][x]]);
                } else {
                    row.push([255, 255, 255]);
                }
            }
            newGrid.push(row);
        }

        console.log('[Parent] New cropped grid:', newGrid.length, 'x', newGrid[0].length);

        state.mappedRgbGrid = newGrid;

        state.pixelGrid.undoStack.length = 0;
        state.pixelGrid.redoStack.length = 0;
        state.backstitchGrid.undoStack.length = 0;
        state.backstitchGrid.redoStack.length = 0;
        oxsBaselineDmcGrid = null;
        oxsBaselineRgbGrid = null;
        oxsBaselinePalette = null;
        hasEmptyCanvasEdits = false;

        state.backstitchGrid.resize(newWidth, newHeight, false);

        lastBaselineGrid = newGrid.map(row => row.map(cell => [...cell]));

        if (state.mappedDmcGrid) {
            const newDmcGrid = [];
            for (let y = y1; y < y2; y++) {
                const row = [];
                for (let x = x1; x < x2; x++) {
                    if (y < state.mappedDmcGrid.length && x < state.mappedDmcGrid[y].length) {
                        row.push(state.mappedDmcGrid[y][x]);
                    } else {
                        row.push("0");
                    }
                }
                newDmcGrid.push(row);
            }
            state.mappedDmcGrid = newDmcGrid;
        }

        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = newWidth;
        croppedCanvas.height = newHeight;
        const ctx = croppedCanvas.getContext('2d', { alpha: true });
        ctx.clearRect(0, 0, newWidth, newHeight);
        for (let y = 0; y < newHeight; y++) {
            for (let x = 0; x < newWidth; x++) {
                const rgb = newGrid[y][x];
                if (rgb[0] === 254 && rgb[1] === 254 && rgb[2] === 254) {
                    continue;
                }
                ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
                ctx.fillRect(x, y, 1, 1);
            }
        }

        const newImg = new Image();
        newImg.onload = () => {
            currentImage = newImg;
            referenceImage = newImg;
        };
        newImg.src = croppedCanvas.toDataURL('image/png');

        console.log('[Parent] Sending INIT to iframe');
        sendToCanvas('INIT', { width: newWidth, height: newHeight });
        sendToCanvas('UPDATE_GRID', newGrid);

        sendToCanvas('CMD_CLEAR_UNDO');

        switchTool('pencil');

        updateSizeUI(newWidth, newHeight);

    } else {
        console.warn('[Parent] handleCrop: No valid mode - isEmptyCanvas:', isEmptyCanvas, 'isOxsLoaded:', isOxsLoaded, 'hasImage:', !!currentImage);
    }
}

import { currentImage } from './state.js';