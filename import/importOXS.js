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

    return {
        width,
        height,
        dmcGrid,
        rgbGrid,
        dmcPalette
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