import "jspdf";
import { DEJAVU_FONT_BASE64 } from "./fontData.js";

/**
 * Main Export Entry Point
 */
export async function exportPDF(data, exportType = 'PRINTABLE') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });

    // --- 1. FONT REGISTRATION ---
    // Import the base64 string from your fontData.js file
    if (DEJAVU_FONT_BASE64 && DEJAVU_FONT_BASE64.length > 100) {
        doc.addFileToVFS("DejaVuSansMono.ttf", DEJAVU_FONT_BASE64);
        doc.addFont("DejaVuSansMono.ttf", "DejaVu", "normal");
    }

    doc.deletePage(1); // Start fresh

    if (exportType !== 'PK') {
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

/**
 * Page 1: Statistics and Preview
 */
async function drawCoverPage(doc, data) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("Kriss Kross Pattern", 105, 30, { align: "center" });

    if (data.processedImage) {
        try {
            doc.addImage(data.processedImage, 'PNG', 55, 50, 100, 100);
        } catch (e) {
            console.warn("Cover image failed:", e);
        }
    }

    doc.setFontSize(12);
    doc.text(`Total Stitches: ${data.totalStitches.toLocaleString()}`, 105, 160, { align: "center" });
    doc.text(`Stitched Area: ${data.stitchedSize.w} x ${data.stitchedSize.h} stitches`, 105, 170, { align: "center" });
    doc.text(`Fabric Count: ${data.fabricCount}-count Aida`, 105, 180, { align: "center" });
}

/**
 * Pattern Grid Renderer
 */
function drawPatternPages(doc, data, isPrintable, isPK) {
    const { dmcGrid, fabricCount, symbolMap } = data;
    const mode = isPK ? 'symbol' : data.exportMode;

    const cellSize = isPrintable ? (25.4 / fabricCount) : 3.5;
    const tileW = isPrintable ? dmcGrid[0].length : 50;
    const tileH = isPrintable ? dmcGrid.length : 70;

    for (let yOff = 0; yOff < dmcGrid.length; yOff += tileH) {
        for (let xOff = 0; xOff < dmcGrid[0].length; xOff += tileW) {
            doc.addPage();

            // Apply DejaVu for Unicode symbols, fallback to courier if loading failed
            const activeFont = doc.getFontList()["DejaVu"] ? "DejaVu" : "courier";
            doc.setFont(activeFont, "normal");

            const actualTileW = Math.min(tileW, dmcGrid[0].length - xOff);
            const actualTileH = Math.min(tileH, dmcGrid.length - yOff);
            const x0 = (210 - (actualTileW * cellSize)) / 2;
            const y0 = 40;

            for (let y = 0; y < actualTileH; y++) {
                for (let x = 0; x < actualTileW; x++) {
                    const code = String(dmcGrid[y + yOff][x + xOff]);
                    if (code === "0") continue;

                    const cx = x0 + (x * cellSize);
                    const cy = y0 + (y * cellSize);

                    const entry = data.palette.find(p => p.code === code);
                    const rgb = isPK ? [255, 255, 255] : (data.stampedMode ? data.rgbGrid[y + yOff][x + xOff] : entry.rgb);

                    switch (mode) {
                        case 'symbol':
                            doc.setFillColor(rgb[0], rgb[1], rgb[2]);
                            doc.rect(cx, cy, cellSize, cellSize, 'F');
                            const sym = symbolMap[code] || '?';
                            doc.setTextColor(isPK ? 0 : (getLuminance(rgb) < 128 ? 255 : 0));
                            doc.setFontSize(cellSize * 1.7);
                            doc.text(sym, cx + (cellSize / 2), cy + (cellSize / 1.4), { align: "center" });
                            break;

                        case 'filled':
                            doc.setFillColor(rgb[0], rgb[1], rgb[2]);
                            doc.rect(cx, cy, cellSize, cellSize, 'F');
                            doc.setFillColor(255, 255, 255);
                            doc.circle(cx, cy, cellSize * 0.1, 'F');
                            break;

                        case 'cross':
                        default:
                            doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
                            doc.setLineWidth(0.2);
                            doc.line(cx + 0.3, cy + 0.3, cx + cellSize - 0.3, cy + cellSize - 0.3);
                            doc.line(cx + cellSize - 0.3, cy + 0.3, cx + 0.3, cy + cellSize - 0.3);
                            break;
                    }
                }
            }
            drawGrid(doc, x0, y0, actualTileW, actualTileH, cellSize);
        }
    }
}

/**
 * Grid Lines Helper
 */
function drawGrid(doc, x0, y0, w, h, size) {
    doc.setDrawColor(180);
    for (let i = 0; i <= w; i++) {
        doc.setLineWidth(i % 10 === 0 ? 0.5 : 0.1);
        doc.line(x0 + i * size, y0, x0 + i * size, y0 + h * size);
    }
    for (let j = 0; j <= h; j++) {
        doc.setLineWidth(j % 10 === 0 ? 0.5 : 0.1);
        doc.line(x0, y0 + j * size, x0 + w * size, y0 + j * size);
    }
}

/**
 * Legend Generation - Fixed coordinates to match Streamlit
 */
function drawLegendPage(doc, data, isPK) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(0);
    doc.text(isPK ? "Pattern Keeper Legend" : "Symbol Legend", 20, 20);

    let y = 40;
    doc.setFontSize(10);

    // Column headers aligned to specific coordinates
    doc.text("Sym", 20, 32);
    doc.text("DMC", 40, 32);
    doc.text("Name", 60, 32);
    doc.text("Stitches", 130, 32);
    doc.text("Skeins", 155, 32);
    doc.text("Swatch", 175, 32);

    const activeFont = doc.getFontList()["DejaVu"] ? "DejaVu" : "courier";
    doc.setFont(activeFont, "normal");

    data.palette.forEach(p => {
        const sym = data.symbolMap[p.code] || "?";
        doc.text(sym, 22, y);
        doc.text(p.code, 40, y);
        doc.text(p.name.substring(0, 30), 60, y);
        doc.text(String(p.count), 135, y);
        doc.text(String(p.skeins), 160, y);

        if (!isPK) {
            doc.setFillColor(p.rgb[0], p.rgb[1], p.rgb[2]);
            doc.rect(175, y - 4, 8, 5, 'F');

            if (data.stampedMode) {
                const sRgb = data.rgbGrid.flat().find((_, i) => String(data.dmcGrid.flat()[i]) === p.code);
                if (sRgb) {
                    doc.setFillColor(sRgb[0], sRgb[1], sRgb[2]);
                    doc.rect(185, y - 4, 8, 5, 'F');
                }
            }
        }
        y += 10;
        if (y > 275) { doc.addPage(); y = 30; }
    });
}

function getLuminance(rgb) {
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}