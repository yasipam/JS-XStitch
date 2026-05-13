// parent/tools.js
// -----------------------------------------------------------------------------
// Tool switching logic
// -----------------------------------------------------------------------------

import { state } from './state.js';
import { sendToCanvas } from './canvas.js';

// Helper: switch active tool and update UI consistently
export function switchTool(toolId) {
    state.setTool(toolId);
    sendToCanvas('SET_TOOL', toolId);
    // Clear active from all tool buttons, then activate the chosen one
    document.querySelectorAll("#pixelTools button, #backstitchTools button, #toolPicker, #cropBtn, #fillBtn").forEach(b => b.classList.remove("active"));
    const btnMap = {
        'pencil': 'pencilBtn',
        'eraser': 'eraserBtn',
        'fill': 'fillBtn',
        'picker': 'toolPicker',
        'crop': 'cropBtn',
        'backstitchPencil': 'backstitchPencilBtn',
        'backstitchEraser': 'backstitchEraserBtn'
    };
    const btnId = btnMap[toolId];
    if (btnId) document.getElementById(btnId)?.classList.add("active");
}