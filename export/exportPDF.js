import "jspdf";
import { DEJAVU_FONT_BASE64 } from "./fontData.js";

export async function exportPDF(data, exportType = 'PRINTABLE') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

    if (DEJAVU_FONT_BASE64 && DEJAVU_FONT_BASE64.length > 100) {
        doc.addFileToVFS("DejaVuSansMono.ttf", DEJAVU_FONT_BASE64);
        doc.addFont("DejaVuSansMono.ttf", "DejaVu", "normal");
    }

    doc.deletePage(1);

    if (exportType !== 'PK') {
        // Now handles side-by-side Original vs Pixel Preview
        await drawCoverPage(doc, data);
    }

    if (exportType === 'PRINTABLE') {
        drawPatternPages(doc, data, true, false);
    } else if (exportType === 'STANDARD') {
        drawPatternPages(doc, data, false, false);
    } else if (exportType === 'PK') {
        drawPatternPages(doc, data, false, true);
    }

    drawLegendPage(doc, data, exportType === 'PK');
    doc.save(`KrissKross_${exportType.toLowerCase()}.pdf`);
}

async function drawCoverPage(doc, data) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("Kriss Kross Pattern", 105, 25, { align: "center" });

    const imgY = 40;
    const boxSize = 80;

    // 1. ORIGINAL IMAGE (Left)
    if (data.originalImage) {
        try {
            doc.addImage(data.originalImage, 'JPEG', 20, imgY, boxSize, boxSize);
            doc.setFontSize(10);
            doc.text("Original Image", 60, imgY + boxSize + 5, { align: "center" });
        } catch (e) {
            console.warn("Original image failed:", e);
        }
    } else {
        doc.setFontSize(10);
        doc.text("(No original image)", 60, imgY + boxSize + 5, { align: "center" });
    }

    // 2. PIXEL PREVIEW (Right) - Draws a mini-version of the Editor Grid
    const grid = data.dmcGrid;
    const rows = grid.length;
    const cols = grid[0].length;
    const pCellSize = boxSize / Math.max(rows, cols);
    const pX0 = 110 + (boxSize - (cols * pCellSize)) / 2;
    const pY0 = imgY + (boxSize - (rows * pCellSize)) / 2;

    // Draw background for the preview box
    doc.setFillColor(240, 240, 240);
    doc.rect(110, imgY, boxSize, boxSize, 'F');

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const code = String(grid[y][x]);
            if (code === "0") continue;
            const entry = data.palette.find(p => p.code === code);
            if (entry) {
                doc.setFillColor(entry.rgb[0], entry.rgb[1], entry.rgb[2]);
                doc.rect(pX0 + (x * pCellSize), pY0 + (y * pCellSize), pCellSize, pCellSize, 'F');
            }
        }
     }

     // Draw backstitches on cover page preview
     if (data.backstitchLines && data.backstitchLines.length > 0) {
         data.backstitchLines.forEach(line => {
             if (!line.points || line.points.length < 2) return;

             const [r, g, b] = line.color;
             doc.setDrawColor(r, g, b);
             doc.setLineWidth(Math.max(0.1, pCellSize * 0.15));
             doc.setLineCap('round');

             const [firstX, firstY] = line.points[0];
             doc.moveTo(pX0 + (firstX * pCellSize), pY0 + (firstY * pCellSize));

             for (let i = 1; i < line.points.length; i++) {
                 const [x, y] = line.points[i];
                 doc.lineTo(pX0 + (x * pCellSize), pY0 + (y * pCellSize));
             }

             doc.stroke();
         });
     }

     doc.setFontSize(10);
     doc.text("Editor Preview", 150, imgY + boxSize + 5, { align: "center" });

    // 3. STATS
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    const statsY = imgY + boxSize + 25;

    doc.text(`Total Stitches: ${data.totalStitches.toLocaleString()}`, 105, statsY, { align: "center" });
    doc.text(`Stitched Area: ${data.stitchedSize.w} x ${data.stitchedSize.h} stitches`, 105, statsY + 10, { align: "center" });
    doc.text(`Fabric Count: ${data.fabricCount}-count Aida`, 105, statsY + 20, { align: "center" });

    const sizeW = (data.stitchedSize.w / data.fabricCount * 2.54).toFixed(1);
    const sizeH = (data.stitchedSize.h / data.fabricCount * 2.54).toFixed(1);
    doc.text(`Pattern Size: ${sizeW} cm x ${sizeH} cm`, 105, statsY + 30, { align: "center" });
}

/**
 * Pattern Grid Renderer
 */
/**
 * Grid Lines Helper
 */
function drawGrid(doc, x0, y0, w, h, size) {
    doc.setDrawColor(0);
    for (let i = 0; i <= w; i++) {
        doc.setLineWidth(i % 10 === 0 ? 0.5 : 0.1);
        doc.line(x0 + i * size, y0, x0 + i * size, y0 + h * size);
    }
    for (let j = 0; j <= h; j++) {
        doc.setLineWidth(j % 10 === 0 ? 0.5 : 0.1);
        doc.line(x0, y0 + j * size, x0 + w * size, y0 + j * size);
    }
}

function drawPatternPages(doc, data, isPrintable, isPK) {
    const { dmcGrid, rgbGrid, fabricCount, symbolMap, palette, backstitchLines } = data;
    const mode = isPK ? 'symbol' : data.exportMode;

    const cellSize = isPrintable ? (25.4 / fabricCount) : 3.5;
    const tileW = isPrintable ? dmcGrid[0].length : 50;
    const tileH = isPrintable ? dmcGrid.length : 70;

    for (let yOff = 0; yOff < dmcGrid.length; yOff += tileH) {
        for (let xOff = 0; xOff < dmcGrid[0].length; xOff += tileW) {
            doc.addPage();

            const activeFont = doc.getFontList()["DejaVu"] ? "DejaVu" : "courier";
            doc.setFont(activeFont, "normal");

            const actualTileW = Math.min(tileW, dmcGrid[0].length - xOff);
            const actualTileH = Math.min(tileH, dmcGrid.length - yOff);
            const x0 = (210 - (actualTileW * cellSize)) / 2;
            const y0 = 40;

            for (let y = 0; y < actualTileH; y++) {
                for (let x = 0; x < actualTileW; x++) {
                    const gx = x + xOff;
                    const gy = y + yOff;
                    const code = String(dmcGrid[gy][gx]);

                    if (code === "0") continue;

                    const cx = x0 + (x * cellSize);
                    const cy = y0 + (y * cellSize);

                    // Logic: Use the RGB from the visual grid (rgbGrid)
                    // This will be Original DMC colors if stampedMode is OFF,
                    // and Stamped colors if stampedMode is ON.
                    const displayRgb = rgbGrid[gy][gx];

                    switch (mode) {
                        case 'symbol':
                            doc.setFillColor(displayRgb[0], displayRgb[1], displayRgb[2]);
                            doc.rect(cx, cy, cellSize, cellSize, 'F');
                            const sym = symbolMap[code] || '?';
                            // Dynamic text color based on background luminance
                            doc.setTextColor(isPK ? 0 : (getLuminance(displayRgb) < 128 ? 255 : 0));
                            doc.setFontSize(cellSize * 2.5);
                            doc.text(sym, cx + (cellSize / 2), cy + (cellSize / 1.4), { align: "center" });
                            break;

                        case 'filled':
                            doc.setFillColor(displayRgb[0], displayRgb[1], displayRgb[2]);
                            doc.rect(cx, cy, cellSize, cellSize, 'F');
                            doc.setFillColor(255, 255, 255);
                            doc.circle(cx, cy, cellSize * 0.2, 'F');
                            break;

                        case 'cross':
                        default:
                            doc.setDrawColor(displayRgb[0], displayRgb[1], displayRgb[2]);
                            doc.setLineWidth(0.2);
                            doc.line(cx + 0.3, cy + 0.3, cx + cellSize - 0.3, cy + cellSize - 0.3);
                            doc.line(cx + cellSize - 0.3, cy + 0.3, cx + 0.3, cy + cellSize - 0.3);
                            break;
                    }
                }
            }
            drawGrid(doc, x0, y0, actualTileW, actualTileH, cellSize);

            // Draw backstitches if available
            if (backstitchLines && backstitchLines.length > 0) {
                drawBackstitchesOnPage(doc, backstitchLines, x0, y0, cellSize, xOff, yOff, actualTileW, actualTileH);
            }
        }
    }
}

function drawBackstitchesOnPage(doc, lines, x0, y0, cellSize, xOff, yOff, tileW, tileH) {
    lines.forEach(line => {
        if (!line.points || line.points.length < 2) return;

        const [r, g, b] = line.color;
        doc.setDrawColor(r, g, b);
        doc.setLineWidth(Math.max(0.3, cellSize * 0.15));
        doc.setLineCap('round');

        // Find first point within tile boundaries
        let startIndex = -1;
        for (let i = 0; i < line.points.length; i++) {
            const [px, py] = line.points[i];
            if (px >= xOff && px <= xOff + tileW && py >= yOff && py <= yOff + tileH) {
                startIndex = i;
                break;
            }
        }

        if (startIndex === -1) return; // No points in this tile

        const [firstX, firstY] = line.points[startIndex];
        const startPx = x0 + (firstX - xOff) * cellSize;
        const startPy = y0 + (firstY - yOff) * cellSize;
        doc.moveTo(startPx, startPy);

        for (let i = startIndex + 1; i < line.points.length; i++) {
            const [x, y] = line.points[i];

            // Skip points outside tile
            if (x < xOff || x > xOff + tileW || y < yOff || y > yOff + tileH) continue;

            const px = x0 + (x - xOff) * cellSize;
            const py = y0 + (y - yOff) * cellSize;
            doc.lineTo(px, py);
        }

        doc.stroke();
    });
}

/**
 * Legend Generation - Fixed text color leak and dual-column rendering.
 */
function drawLegendPage(doc, data, isPK) {
    doc.addPage();

    // CRITICAL: Explicitly set text color to black (0) to prevent "white text" leak
    doc.setTextColor(0);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(isPK ? "Pattern Keeper Legend" : "Symbol Legend", 20, 20);

    let y = 40;
    doc.setFontSize(10);

    // Headers
    doc.text("Symbol", 20, 32);
    doc.text("DMC", 40, 32);
    doc.text("Name", 60, 32);
    doc.text("Stitches", 130, 32);

    if (data.stampedMode && !isPK) {
        doc.text("Original", 155, 32);
        doc.text("Stamped", 180, 32);
    } else {
        doc.text("Swatch", 175, 32);
    }

    const activeFont = doc.getFontList()["DejaVu"] ? "DejaVu" : "courier";
    doc.setFont(activeFont, "normal");

    data.palette.forEach(p => {
        doc.setTextColor(0); // Prevents color bleed from swatches to text

        const sym = data.symbolMap[p.code] || "?";
        const name = String(p.name || ""); // Safety cast
        const count = String(p.count || 0);

        doc.setFontSize(16)
        doc.text(sym, 22, y);
        doc.text(p.code, 40, y);
        doc.text(name.substring(0, 30), 60, y);
        doc.text(count, 135, y);

        if (!isPK) {
            // Render Original DMC Swatch
            if (p.rgb) {
                doc.setFillColor(p.rgb[0], p.rgb[1], p.rgb[2]);
                doc.rect(data.stampedMode ? 155 : 175, y - 4, 10, 5, 'F');
                doc.setDrawColor(200);
                doc.rect(data.stampedMode ? 155 : 175, y - 4, 10, 5, 'S');
            }

            // Render Stamped Swatch - CRITICAL: Check both stampedMode AND p.stampedRgb exists
            if (data.stampedMode && p.stampedRgb && Array.isArray(p.stampedRgb)) {
                doc.setFillColor(p.stampedRgb[0], p.stampedRgb[1], p.stampedRgb[2]);
                doc.rect(180, y - 4, 10, 5, 'F');
                doc.setDrawColor(200);
                doc.rect(180, y - 4, 10, 5, 'S');
            }
        }

        y += 10;
        if (y > 275) {
            doc.addPage();
            y = 30;
            doc.setTextColor(0); // Reset color on new page too
            doc.setFont("helvetica", "bold");
            doc.text("Symbol", 20, 20);
            doc.text("DMC", 40, 20);
            doc.text("Name", 60, 20);
            doc.text("Stitches", 130, 20);
            doc.text(data.stampedMode ? "Original / Stamped" : "Swatch", 175, 20);
            doc.setFont(activeFont, "normal");
        }
    });

    // BACKSTITCH SECTION
    if (data.backstitchLines && data.backstitchLines.length > 0 && !isPK) {
        // Add new page if not enough space
        if (y > 230) {
            doc.addPage();
            y = 30;
        }

        y += 15;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text("Backstitch Key", 20, y);
        y += 10;

        doc.setFontSize(10);
        doc.text("DMC", 20, y);
        doc.text("Name", 60, y);
        doc.text("Stitches", 130, y);
        doc.text("Swatch", 175, y);
        y += 8;

        // Build reverse lookup from RGB to DMC code
        const rgbToDmc = {};
        data.palette.forEach(p => {
            const key = JSON.stringify(p.rgb);
            rgbToDmc[key] = { code: p.code, name: p.name };
        });

        // Count backstitches by color
        const bsColorMap = {};
        data.backstitchLines.forEach(line => {
            if (!line.points || line.points.length < 2) return;
            const key = JSON.stringify(line.color);
            if (!bsColorMap[key]) {
                const dmcInfo = rgbToDmc[key] || { code: 'Unknown', name: `RGB(${line.color.join(',')})` };
                bsColorMap[key] = {
                    color: line.color,
                    code: dmcInfo.code,
                    name: dmcInfo.name,
                    count: 0
                };
            }
            bsColorMap[key].count += Math.max(0, line.points.length - 1);
        });

        doc.setFont(activeFont, "normal");
        Object.values(bsColorMap).forEach(bs => {
            const [r, g, b] = bs.color;
            doc.text(bs.code, 20, y);
            doc.text(bs.name.substring(0, 30), 60, y);
            doc.text(String(bs.count), 130, y);
            doc.setFillColor(r, g, b);
            doc.rect(175, y - 4, 10, 5, 'F');
            doc.setDrawColor(200);
            doc.rect(175, y - 4, 10, 5, 'S');
            y += 8;

            if (y > 275) {
                doc.addPage();
                y = 30;
            }
        });

        // Add total backstitch count
        y += 5;
        doc.setFont("helvetica", "bold");
        doc.text(`Total Backstitches: ${data.totalBackstitches || 0}`, 20, y);
    }
}

function getLuminance(rgb) {
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

function findStampedRgbForCode(targetCode, dmcGrid, rgbGrid) {
    for (let y = 0; y < dmcGrid.length; y++) {
        for (let x = 0; x < dmcGrid[y].length; x++) {
            if (String(dmcGrid[y][x]) === String(targetCode)) {
                return rgbGrid[y][x]; // Returns the neon/stamped RGB
            }
        }
    }
    return null;
}