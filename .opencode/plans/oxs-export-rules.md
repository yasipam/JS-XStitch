# **OXS Export Specification — Cross Stitch Editor**

## **1. Purpose**
This document defines the required behaviour and XML structure for generating valid `.oxs` files from the Cross Stitch Editor.  
The goal is to ensure full compatibility with third‑party cross‑stitch software such as FlossCross, Pattern Keeper, WinStitch, etc.

The exporter must:

- Output a clean, minimal, standards‑compliant OXS file  
- Correctly map DMC colours for full stitches and backstitches  
- Avoid exporting unnecessary background stitches  
- Use consistent palette formatting and numeric symbols  
- Follow the expected XML ordering and structure  

---

# **2. XML Structure Requirements**

The exported file **must** follow this exact structure and ordering:

```xml
<chart>
    <format />
    <properties />
    <palette>
        <palette_item />
        ...
    </palette>
    <fullstitches>
        <stitch />
        ...
    </fullstitches>
    <backstitches>
        <bs />
        ...
    </backstitches>
</chart>
```

Order is mandatory.

---

# **3. Palette Specification**

## **3.1 Palette Construction**
The palette must include:

1. **Index 0** — cloth/background  
2. One entry for each **unique DMC code** used in:
   - full stitches  
   - backstitches  

No unused colours may be included.

---

## **3.2 Palette Item Format**

Each palette item must include the following attributes:

| Attribute | Description |
|----------|-------------|
| `index` | 0 for cloth, 1..N for colours |
| `number` | `"DMC <code>"` |
| `name` | Human‑readable DMC name |
| `color` | Lowercase hex RGB |
| `printcolor` | Same as `color` |
| `blendcolor` | `"nil"` |
| `strands` | `"2"` |
| `symbol` | Numeric string `"1"`, `"2"`, `"3"`… |
| `bsstrands` | `"1"` |
| `bscolor` | Same hex as `color` |

Example:

```xml
<palette_item index="1" number="DMC 304" name="Red Medium" color="c83737" printcolor="c83737" strands="2" symbol="1" bsstrands="1" bscolor="c83737" />
```

---

## **3.3 Symbol Rules**
- Symbols must be **numeric only**.
- Symbol for palette index *i* = string of (i).
- No letters, punctuation, or special characters.

---

## **3.4 Hex Colour Rules**
- Must be lowercase.
- Must be 6‑digit hex.
- Must match the DMC colour or stamped colour (if stamped mode is active).

---

# **4. Full Stitch Export Specification**

## **4.1 Stitch Filtering**
Only export stitches where:

```
liveGrid[y][x] !== "0"
```

Cloth/background stitches must **not** be exported.

---

## **4.2 Stitch Format**

```xml
<stitch x="X" y="Y" palindex="N" />
```

Where:

- `x`, `y` are integer coordinates  
- `palindex` references the palette index for the DMC code  

---

## **4.3 Ordering**
Stitches must be sorted:

1. By `y` ascending  
2. By `x` ascending  

This matches the behaviour of other OXS‑compliant editors.

---

# **5. Backstitch Export Specification**

## **5.1 Required Data Structure**

Backstitches must be provided to the exporter as objects:

```js
{
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    code: string | number   // DMC code
}
```

---

## **5.2 Backstitch XML Format**

```xml
<bs x1="X1" y1="Y1" x2="X2" y2="Y2" palindex="N" />
```

Where:

- `palindex` references the same palette index used for full stitches  
- Coordinates define the endpoints of the backstitch line  

---

## **5.3 Ordering**
Backstitches must be sorted:

1. By `y1` ascending  
2. By `x1` ascending  

---

# **6. Properties Block Specification**

The `<properties>` tag must include:

| Attribute | Value |
|----------|--------|
| `oxsversion` | `"1.0"` |
| `software` | `"CrossStitchEditor"` |
| `software_version` | `"1.0"` |
| `chartheight` | number of rows |
| `chartwidth` | number of columns |
| `charttitle` | filename without extension |
| `stitchesperinch` | `"14"` |
| `stitchesperinch_y` | `"14"` |
| `palettecount` | number of palette items including cloth |
| `misc1` | `"normal"` |

Example:

```xml
<properties oxsversion="1.0" software="CrossStitchEditor" software_version="1.0" chartheight="80" chartwidth="75" charttitle="pattern" stitchesperinch="14" stitchesperinch_y="14" palettecount="12" misc1="normal" />
```

---

# **7. Format Block Specification**

```xml
<format comments01="Exported by CrossStitchEditor" />
```

---

# **8. Behaviour Summary**

### ✔ Must Do
- Build palette from all used colours (full + backstitch)
- Use lowercase hex
- Use numeric symbols
- Export only non‑background stitches
- Export backstitches in their own block
- Ensure palette indices match both stitch types
- Maintain required XML structure and ordering

### ❌ Must Not Do
- Export cloth/background stitches
- Use uppercase hex
- Use non‑numeric symbols
- Include unused palette colours
- Place backstitches inside `<fullstitches>`
- Export empty or malformed palette items

---

# **9. Example Minimal Valid Output**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<chart>
  <format comments01="Exported by CrossStitchEditor" />
  <properties oxsversion="1.0" software="CrossStitchEditor" software_version="1.0" chartheight="50" chartwidth="50" charttitle="example" stitchesperinch="14" stitchesperinch_y="14" palettecount="3" misc1="normal" />
  <palette>
    <palette_item index="0" number="cloth" name="cloth" color="ffffff" printcolor="ffffff" strands="2" symbol="0" bsstrands="0" bscolor="000000" />
    <palette_item index="1" number="DMC 304" name="Red Medium" color="c83737" printcolor="c83737" strands="2" symbol="1" bsstrands="1" bscolor="c83737" />
    <palette_item index="2" number="DMC 310" name="Black" color="000000" printcolor="000000" strands="2" symbol="2" bsstrands="1" bscolor="000000" />
  </palette>
  <fullstitches>
    <stitch x="10" y="12" palindex="1" />
    <stitch x="11" y="12" palindex="2" />
  </fullstitches>
  <backstitches>
    <bs x1="10" y1="10" x2="11" y2="10" palindex="2" />
  </backstitches>
</chart>
```

---

# **10. Acceptance Criteria**

An exported OXS file is considered valid when:

- It loads correctly in FlossCross, Pattern Keeper, WinStitch, etc.
- All full stitches appear with correct DMC colours.
- All backstitches appear with correct DMC colours.
- No background stitches are present.
- Palette count matches actual usage.
- Symbols are numeric.
- Hex colours are lowercase.
- XML structure matches the required schema.
