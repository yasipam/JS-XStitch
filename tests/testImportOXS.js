// tests/testImportOXS.js
// -----------------------------------------------------------------------------
// Regression tests for OXS import functionality
// Tests backstitch parsing added in fix for backstitch import bug
// -----------------------------------------------------------------------------

import { parseOxsFile } from "../import/importOXS.js";

// Mock DOMParser for Node environment (if needed)
if (typeof DOMParser === 'undefined') {
    const { JSDOM } = require('jsdom');
    global.DOMParser = new JSDOM().window.DOMParser;
}

function createTestOXSWithBackstitches() {
    return `<?xml version="1.0" encoding="utf-8"?>
<chart>
    <format comments01="Exported by CrossStitchEditor" />
    <properties oxsversion="1.0" software="CrossStitchEditor" software_version="1.0" 
                chartwidth="50" chartheight="50" charttitle="Test Pattern" 
                stitchesperinch="14" stitchesperinch_y="14" palettecount="2" />
    <palette>
        <palette_item index="0" number="cloth" name="cloth" color="FFFFFF" printcolor="FFFFFF" 
                      blendcolor="nil" comments="aida" strands="2" symbol="0" 
                      dashpattern="" misc1="" bsstrands="0" bscolor="000000" />
        <palette_item index="1" number="DMC 310" name="DMC 310" color="000000" 
                      printcolor="000000" blendcolor="nil" comments="" strands="2" 
                      symbol="1" dashpattern="" misc1="" bsstrands="1" bscolor="000000" />
    </palette>
    <fullstitches>
        <stitch x="5" y="5" palindex="1" />
        <stitch x="6" y="5" palindex="1" />
        <stitch x="7" y="5" palindex="1" />
    </fullstitches>
    <backstitches>
        <backstitch x1="5.00" y1="5.00" x2="6.00" y2="5.00" palindex="1" objecttype="backstitch" sequence="0" />
        <backstitch x1="6.00" y1="5.00" x2="7.00" y2="5.00" palindex="1" objecttype="backstitch" sequence="1" />
        <backstitch x1="7.00" y1="5.00" x2="8.00" y2="6.00" palindex="1" objecttype="backstitch" sequence="2" />
    </backstitches>
    <partstitches>
        <partstitch />
    </partstitches>
    <ornaments_inc_knots_and_beads>
        <object />
    </ornaments_inc_knots_and_beads>
    <commentboxes />
</chart>`;
}

function createTestOXSWithoutBackstitches() {
    return `<?xml version="1.0" encoding="utf-8"?>
<chart>
    <format comments01="Exported by CrossStitchEditor" />
    <properties oxsversion="1.0" software="CrossStitchEditor" software_version="1.0" 
                chartwidth="30" chartheight="30" charttitle="Simple Pattern" 
                stitchesperinch="14" stitchesperinch_y="14" palettecount="1" />
    <palette>
        <palette_item index="0" number="cloth" name="cloth" color="FFFFFF" printcolor="FFFFFF" 
                      blendcolor="nil" comments="aida" strands="2" symbol="0" 
                      dashpattern="" misc1="" bsstrands="0" bscolor="000000" />
    </palette>
    <fullstitches>
        <stitch x="10" y="10" palindex="0" />
    </fullstitches>
    <backstitches>
    </backstitches>
    <partstitches>
        <partstitch />
    </partstitches>
    <ornaments_inc_knots_and_beads>
        <object />
    </ornaments_inc_knots_and_beads>
    <commentboxes />
</chart>`;
}

export function testBackstitchImport() {
    console.log("Testing backstitch import...");

    // Test 1: OXS with backstitches
    const xmlWithBS = createTestOXSWithBackstitches();
    const result1 = parseOxsFile(xmlWithBS);

    console.assert(result1.width === 50, "Width should be 50");
    console.assert(result1.height === 50, "Height should be 50");
    console.assert(result1.backstitchLines !== undefined, "backstitchLines should be defined");
    console.assert(result1.backstitchLines.length > 0, "Should have backstitch lines");

    if (result1.backstitchLines.length > 0) {
        const line = result1.backstitchLines[0];
        console.assert(line.points.length >= 3, "Line should have at least 3 points (grouped from segments)");
        console.assert(line.color.length === 3, "Color should be [r,g,b]");
        console.log("Backstitch line points:", line.points);
        console.log("Backstitch line color:", line.color);
    }

    console.log("Test 1 passed: OXS with backstitches");

    // Test 2: OXS without backstitches
    const xmlWithoutBS = createTestOXSWithoutBackstitches();
    const result2 = parseOxsFile(xmlWithoutBS);

    console.assert(result2.backstitchLines !== undefined, "backstitchLines should be defined even if empty");
    console.assert(result2.backstitchLines.length === 0, "Should have no backstitch lines");

    console.log("Test 2 passed: OXS without backstitches");

    // Test 3: Verify pixel data still imports correctly
    console.assert(result1.dmcGrid[5][5] === "310", "Pixel at (5,5) should be DMC 310");
    console.assert(result1.dmcGrid[5][6] === "310", "Pixel at (6,5) should be DMC 310");
    console.assert(result1.dmcGrid[5][7] === "310", "Pixel at (7,5) should be DMC 310");

    console.log("Test 3 passed: Pixel data imports correctly with backstitches");

    console.log("All backstitch import tests passed!");
    return true;
}

// Run tests if this file is executed directly
if (typeof window !== 'undefined') {
    window.testBackstitchImport = testBackstitchImport;
}

export default testBackstitchImport;
