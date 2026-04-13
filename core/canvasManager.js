// core/canvasManager.js
import { EditorState } from "./state.js";
import { EditorEvents } from "./events.js";
import { ToolRegistry } from "./tools.js";

let state;
let events;

window.addEventListener('message', (e) => {
    const { type, payload } = e.data;

    switch (type) {
        case 'INIT':
            const canvases = {
                bg: document.getElementById('bgLayer'),
                grid: document.getElementById('gridLayer'),
                ui: document.getElementById('uiLayer')
            };

            state = new EditorState(canvases);
            events = new EditorEvents(canvases.ui, state);

            // This listener catches manual drawing, flood fills, and undos
            state.on("gridChanged", () => {
                const count = state.getUniqueColorCount();
                const threadStats = state.getThreadStats();
                window.parent.postMessage({ 
                    type: 'REPORT_GRID_STATS', 
                    payload: { count, threadStats } 
                }, '*');
            });

            // We also need to trigger this on individual pixel changes for real-time table updates
            state.on("pixelChanged", () => {
                const count = state.getUniqueColorCount();
                const threadStats = state.getThreadStats();
                window.parent.postMessage({ 
                    type: 'REPORT_GRID_STATS', 
                    payload: { count, threadStats } 
                }, '*');
            });
            
            state.pixelGrid.resize(payload.width, payload.height, [255, 255, 255], false);
            state.renderer.resizeToContainer(); 
            break;

        case 'UPDATE_GRID':
            if (state && payload) {
                // 1. Load the data into the local iframe state
                state.loadGrid(payload);

                // 2. FORCE the renderer to recognize the new dimensions immediately
                state.renderer.resizeToContainer();

                // 3. Optional: manually trigger a draw to ensure no "blank" frames
                state.renderer.draw();
            }
            break;

        case 'CMD_UNDO':
            if (state) state.undo();
            break;

        case 'CMD_REDO':
            if (state) state.redo();
            break;

        case 'CMD_CLEAR':
            if (state) state.clearCanvasAction();
            break;

        case 'SET_TOOL':
            if (state) state.setTool(payload);
            break;

        case 'SET_COLOR':
            if (state) state.setColor(payload);
            break;

        case 'CMD_ZOOM':
            if (state) {
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                ToolRegistry.zoom.applyZoom(state, payload > 0 ? -1 : 1, cx, cy);
            }
            break;

        case 'CMD_RESET_VIEW':
            if (state) {
                const grid = state.pixelGrid;
                const bestZoom = Math.min((window.innerWidth - 40) / grid.width, (window.innerHeight - 40) / grid.height, 20);
                state.setZoom(bestZoom);
                state.setPan((window.innerWidth - grid.width * bestZoom) / 2, (window.innerHeight - grid.height * bestZoom) / 2);
            }
            break;

        case 'CMD_KEYDOWN':
            if (events) {
                // We reconstruct a fake event object because real KeyboardEvents 
                // cannot be sent over postMessage
                events.onKeyDown({
                    ctrlKey: payload.ctrlKey,
                    metaKey: payload.metaKey,
                    shiftKey: payload.shiftKey,
                    key: payload.key,
                    preventDefault: () => {} // Dummy function to prevent errors
                });
            }
            break;

        case 'CMD_CLEANUP_MIN':
        if (state) {
            state.applyMinOccurrence(payload);
        }
        break;
    }
});