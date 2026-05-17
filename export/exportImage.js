/**
 * Image-Only To-Size Export
 * Generates a PNG/JPEG containing only the stitched pattern rendered at physical scale
 * based on fabric count (e.g., 14-count = 14 px per inch).
 */

export async function exportToSizeImage(data, options = {}) {
    const {
        format = 'png',
        dpi = 96,
        includeBackstitches = true
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

            renderStitch(ctx, mode, displayRgb, cx, cy, cellPixelSize, code, symbolMap);
        }
    }

    if (includeBackstitches && backstitchLines && backstitchLines.length > 0) {
        renderBackstitches(ctx, backstitchLines, cellPixelSize);
    }

    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const dataUrl = offscreenCanvas.toDataURL(mimeType, 0.95);

    const filename = `pattern_to-size.${format}`;
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
}

function renderStitch(ctx, mode, rgb, x, y, cellSize, code, symbolMap) {
    switch (mode) {
        case 'filled':
            ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            ctx.fillRect(x, y, cellSize, cellSize);
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(x + cellSize / 2, y + cellSize / 2, cellSize * 0.3, 0, Math.PI * 2);
            ctx.fill();
            break;

        case 'cross':
            ctx.strokeStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            ctx.lineWidth = Math.max(1, cellSize * 0.08);
            ctx.lineCap = 'round';
            const offset = cellSize * 0.3;
            ctx.beginPath();
            ctx.moveTo(x + offset, y + offset);
            ctx.lineTo(x + cellSize - offset, y + cellSize - offset);
            ctx.moveTo(x + cellSize - offset, y + offset);
            ctx.lineTo(x + offset, y + cellSize - offset);
            ctx.stroke();
            break;

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