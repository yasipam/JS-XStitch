// import/importOXS.js
// -----------------------------------------------------------------------------
// OXS (Cross Stitch Saga) file parser
// Parses exported OXS files and loads them into the editor
// -----------------------------------------------------------------------------

function hexToRgb(hex) {
    if (!hex || hex.length !== 6) return [0, 0, 0];
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return [r, g, b];
}

function getDmcCodeFromNumber(numberAttr) {
    if (!numberAttr) return null;
    const match = numberAttr.match(/DMC\s*(\d+)/i);
    return match ? match[1] : null;
}

function pointsEqual(p1, p2, tolerance = 0.01) {
    return Math.abs(p1[0] - p2[0]) < tolerance && Math.abs(p1[1] - p2[1]) < tolerance;
}

function groupBackstitchSegments(segments) {
    const lines = [];
    const used = new Set();

    for (let i = 0; i < segments.length; i++) {
        if (used.has(i)) continue;

        const line = {
            points: [segments[i].start, segments[i].end],
            palindex: segments[i].palindex
        };
        used.add(i);

        let extended = true;
        while (extended) {
            extended = false;

            for (let j = 0; j < segments.length; j++) {
                if (used.has(j)) continue;
                if (segments[j].palindex !== line.palindex) continue;

                const segStart = segments[j].start;
                const segEnd = segments[j].end;
                const lineStart = line.points[0];
                const lineEnd = line.points[line.points.length - 1];

                if (pointsEqual(segEnd, lineStart)) {
                    line.points.unshift(segStart);
                    used.add(j);
                    extended = true;
                } else if (pointsEqual(segStart, lineStart)) {
                    line.points.unshift(segEnd);
                    used.add(j);
                    extended = true;
                } else if (pointsEqual(segStart, lineEnd)) {
                    line.points.push(segEnd);
                    used.add(j);
                    extended = true;
                } else if (pointsEqual(segEnd, lineEnd)) {
                    line.points.push(segStart);
                    used.add(j);
                    extended = true;
                }
            }
        }

        lines.push(line);
    }

    return lines;
}

export function parseOxsFile(xmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");

    const parseError = doc.querySelector("parsererror");
    if (parseError) {
        throw new Error("Invalid OXS file: " + parseError.textContent);
    }

    const chart = doc.querySelector("chart");
    if (!chart) {
        throw new Error("Invalid OXS file: missing <chart> element");
    }

    const props = chart.querySelector("properties");
    const width = props ? parseInt(props.getAttribute("chartwidth"), 10) : 50;
    const height = props ? parseInt(props.getAttribute("chartheight"), 10) : 50;

    if (!width || !height) {
        throw new Error("Invalid OXS file: missing dimensions");
    }

    const paletteItems = chart.querySelectorAll("palette_item");
    const paletteMap = {};
    const dmcPalette = {};

    paletteItems.forEach(item => {
        const index = item.getAttribute("index");
        const number = item.getAttribute("number");
        const name = item.getAttribute("name");
        const color = item.getAttribute("color");

        if (index === "0") {
            paletteMap[index] = { code: "0", name: "cloth", rgb: [255, 255, 255] };
            return;
        }

        const dmcCode = getDmcCodeFromNumber(number);
        const rgb = hexToRgb(color);

        paletteMap[index] = {
            code: dmcCode || "310",
            name: name || `DMC ${dmcCode}`,
            rgb: rgb
        };

        if (dmcCode) {
            dmcPalette[dmcCode] = { name: name || `DMC ${dmcCode}`, rgb: rgb };
        }
    });

    const dmcGrid = Array.from({ length: height }, () => Array(width).fill("0"));
    const rgbGrid = Array.from({ length: height }, () => Array(width).fill([255, 255, 255]));

    const stitches = chart.querySelectorAll("stitch");
    stitches.forEach(stitch => {
        const x = parseInt(stitch.getAttribute("x"), 10);
        const y = parseInt(stitch.getAttribute("y"), 10);
        const palindex = stitch.getAttribute("palindex");

        if (x >= 0 && x < width && y >= 0 && y < height && paletteMap[palindex]) {
            const paletteEntry = paletteMap[palindex];
            dmcGrid[y][x] = paletteEntry.code;
            rgbGrid[y][x] = [...paletteEntry.rgb];
        }
    });

    const backstitchLines = [];
    const backstitches = chart.querySelectorAll("backstitch");

    // 6. Reference Image Data (optional - for backward compatibility)
    const referenceImageEl = chart.querySelector("referenceImageData");
    const referenceImageData = referenceImageEl ? referenceImageEl.textContent.trim() : null;

    if (backstitches.length > 0) {
        const segments = [];

        backstitches.forEach(bs => {
            const x1 = parseFloat(bs.getAttribute("x1"));
            const y1 = parseFloat(bs.getAttribute("y1"));
            const x2 = parseFloat(bs.getAttribute("x2"));
            const y2 = parseFloat(bs.getAttribute("y2"));
            const palindex = bs.getAttribute("palindex");

            if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2) && palindex && paletteMap[palindex]) {
                segments.push({
                    start: [x1, y1],
                    end: [x2, y2],
                    palindex: palindex
                });
            }
        });

        const groupedLines = groupBackstitchSegments(segments);

        groupedLines.forEach(line => {
            const paletteEntry = paletteMap[line.palindex];
            if (paletteEntry) {
                backstitchLines.push({
                    points: line.points,
                    color: [...paletteEntry.rgb]
                });
            }
        });
    }

    return {
        width,
        height,
        dmcGrid,
        rgbGrid,
        dmcPalette,
        backstitchLines,
        referenceImageData
    };
}

export function parseOxsFileFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const result = parseOxsFile(event.target.result);
                resolve(result);
            } catch (e) {
                reject(e);
            }
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file);
    });
}