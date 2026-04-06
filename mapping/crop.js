// processing/crop.js
// -----------------------------------------------------------------------------
// JS conversion of crop.py
// Provides:
// - cropWithBox
// - cropWithOffsets
// - autoCrop
// -----------------------------------------------------------------------------

// A) DRAG‑TO‑CROP (box-based)
// -----------------------------------------------------------------------------
export function cropWithBox(image, box) {
    // box = [x1, y1, x2, y2]
    if (!box) return image;

    const [x1, y1, x2, y2] = box;

    const w = x2 - x1;
    const h = y2 - y1;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, x1, y1, w, h, 0, 0, w, h);

    return canvas;
}

// B) SLIDER‑BASED CROP (offsets)
// -----------------------------------------------------------------------------
export function cropWithOffsets(image, left, top, right, bottom) {
    const w = image.width;
    const h = image.height;

    const x1 = left;
    const y1 = top;
    const x2 = w - right;
    const y2 = h - bottom;

    if (x2 <= x1 || y2 <= y1) {
        return image;
    }

    const newW = x2 - x1;
    const newH = y2 - y1;

    const canvas = document.createElement("canvas");
    canvas.width = newW;
    canvas.height = newH;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, x1, y1, newW, newH, 0, 0, newW, newH);

    return canvas;
}

// C) AUTO‑CROP (remove white borders)
// -----------------------------------------------------------------------------
export function autoCrop(image, threshold = 250) {
    const w = image.width;
    const h = image.height;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Build mask of non‑white pixels
    const mask = new Array(h).fill(null).map(() => new Array(w).fill(false));

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            if (r < threshold || g < threshold || b < threshold) {
                mask[y][x] = true;
            }
        }
    }

    // If everything is white → return original
    let any = false;
    for (let y = 0; y < h && !any; y++) {
        for (let x = 0; x < w && !any; x++) {
            if (mask[y][x]) any = true;
        }
    }
    if (!any) return image;

    // Find bounding box
    let minX = w, maxX = 0, minY = h, maxY = 0;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (mask[y][x]) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    const newW = maxX - minX;
    const newH = maxY - minY;

    const canvasOut = document.createElement("canvas");
    canvasOut.width = newW;
    canvasOut.height = newH;

    const ctxOut = canvasOut.getContext("2d");
    ctxOut.drawImage(image, minX, minY, newW, newH, 0, 0, newW, newH);

    return canvasOut;
}
