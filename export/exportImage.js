/**
 * Image-Only To-Size Export
 * Generates a PNG/JPEG containing only the stitched pattern rendered at physical scale
 * based on fabric count (e.g., 14-count = 14 px per inch).
 */

export async function exportToSizeImage(data, options = {}) {
    const {
        format = 'png',
        dpi = 96,
        includeBackstitches = true,
        showGrid = false
    } = options;

    const { dmcGrid, rgbGrid, fabricCount, symbolMap, backstitchLines } = data;
    const mode = data.exportMode || 'filled';

    const cellPixelSize = dpi / fabricCount;
    const width = dmcGrid[0].length;
    const height = dmcGrid.length;

    const canvasWidth = width * cellPixelSize;
    const canvasHeight = height * cellPixelSize;

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = canvasWidth;
    offscreenCanvas.height = canvasHeight;
    const ctx = offscreenCanvas.getContext('2d', { alpha: true });

    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const code = String(dmcGrid[y][x]);
            if (code === "0") continue;

            const cx = x * cellPixelSize;
            const cy = y * cellPixelSize;
            const displayRgb = rgbGrid[y][x];

            renderStitch(ctx, mode, displayRgb, cx, cy, cellPixelSize, code, symbolMap, width, height);
        }
    }

    if (includeBackstitches && backstitchLines && backstitchLines.length > 0) {
        renderBackstitches(ctx, backstitchLines, cellPixelSize);
    }

    if (showGrid) {
        drawCanvasGrid(ctx, width, height, cellPixelSize);
    }

    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataUrl = offscreenCanvas.toDataURL(mimeType, 0.95);

    const filename = `pattern_to-size.${format}`;
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
}

function renderStitch(ctx, mode, rgb, x, y, cellSize, code, symbolMap, gridWidth, gridHeight) {
    switch (mode) {
        case 'filled':
            ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            ctx.fillRect(x, y, cellSize, cellSize);
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(x, y, cellSize * 0.3, 0, Math.PI * 2);
            ctx.fill();
            break;

        case 'cross':
            ctx.strokeStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            ctx.lineWidth = Math.max(1, cellSize * 0.40);
            ctx.lineCap = 'round';
            const offset = cellSize * 0.20;
            ctx.beginPath();
            ctx.moveTo(x + offset, y + offset);
            ctx.lineTo(x + cellSize - offset, y + cellSize - offset);
            ctx.moveTo(x + cellSize - offset, y + offset);
            ctx.lineTo(x + offset, y + cellSize - offset);
            ctx.stroke();
            break;

        case 'tent': {
            ctx.strokeStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            ctx.lineWidth = Math.max(1, cellSize * 0.50);
            ctx.lineCap = 'round';
            const offset = cellSize * 0.20;
            ctx.beginPath();
            ctx.moveTo(x + cellSize - offset, y + offset); // Changed start point
            ctx.lineTo(x + offset, y + cellSize - offset);   // Changed end point
            ctx.stroke();
            break;
        }

        case 'tent-symmetry': {
            ctx.strokeStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            ctx.lineWidth = Math.max(1, cellSize * 0.50);
            ctx.lineCap = 'round';
            const centerX = gridWidth / 2;
            const centerY = gridHeight / 2;
            const isAscending = (x / cellSize >= centerX && y / cellSize < centerY) ||
                                (x / cellSize < centerX && y / cellSize >= centerY);
            const offsetSym = cellSize * 0.20;
            ctx.beginPath();
            if (isAscending) {
                ctx.moveTo(x + offsetSym, y + cellSize - offsetSym);
                ctx.lineTo(x + cellSize - offsetSym, y + offsetSym);
            } else {
                ctx.moveTo(x + offsetSym, y + offsetSym);
                ctx.lineTo(x + cellSize - offsetSym, y + cellSize - offsetSym);
            }
            ctx.stroke();
            break;
        }

        case 'tent-symmetry-inverse': {
            ctx.strokeStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            ctx.lineWidth = Math.max(1, cellSize * 0.50);
            ctx.lineCap = 'round';
            const centerXInv = gridWidth / 2;
            const centerYInv = gridHeight / 2;
            const isAscendingInv = (x / cellSize >= centerXInv && y / cellSize < centerYInv) ||
                                    (x / cellSize < centerXInv && y / cellSize >= centerYInv);
            const directionInv = !isAscendingInv;
            const offsetSymInv = cellSize * 0.20;
            ctx.beginPath();
            if (directionInv) {
                ctx.moveTo(x + offsetSymInv, y + cellSize - offsetSymInv);
                ctx.lineTo(x + cellSize - offsetSymInv, y + offsetSymInv);
            } else {
                ctx.moveTo(x + offsetSymInv, y + offsetSymInv);
                ctx.lineTo(x + cellSize - offsetSymInv, y + cellSize - offsetSymInv);
            }
            ctx.stroke();
            break;
        }

        case 'symbol':
            ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            ctx.fillRect(x, y, cellSize, cellSize);
            const sym = symbolMap[code] || '?';
            const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
            ctx.fillStyle = luminance < 128 ? 'white' : 'black';
            ctx.font = `bold ${cellSize * 0.7}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(sym, x + cellSize / 2, y + cellSize / 2);
            break;

        default:
            ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            ctx.fillRect(x, y, cellSize, cellSize);
    }
}

function renderBackstitches(ctx, lines, cellPixelSize) {
    const lineWidth = Math.max(1, cellPixelSize * 0.15);

    lines.forEach(line => {
        if (!line.points || line.points.length < 2) return;

        const [r, g, b] = line.color;
        ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        const [firstX, firstY] = line.points[0];
        ctx.moveTo(
            firstX * cellPixelSize + cellPixelSize / 2,
            firstY * cellPixelSize + cellPixelSize / 2
        );

        for (let i = 1; i < line.points.length; i++) {
            const [px, py] = line.points[i];
            ctx.lineTo(
                px * cellPixelSize + cellPixelSize / 2,
                py * cellPixelSize + cellPixelSize / 2
            );
        }

        ctx.stroke();
    });
}

function drawCanvasGrid(ctx, cols, rows, cellSize) {
    ctx.strokeStyle = 'rgba(10, 10, 10, 0.5)';
    ctx.beginPath();

    for (let i = 0; i <= cols; i++) {
        const x = i * cellSize;
        ctx.lineWidth = i % 10 === 0 ? 3 : 1;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, rows * cellSize);
    }

    for (let j = 0; j <= rows; j++) {
        const y = j * cellSize;
        ctx.lineWidth = j % 10 === 0 ? 3 : 1;
        ctx.moveTo(0, y);
        ctx.lineTo(cols * cellSize, y);
    }

    ctx.stroke();
}