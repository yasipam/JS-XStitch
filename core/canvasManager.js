// core/canvasManager.js
import { EditorState } from "./state.js";
import { EditorEvents } from "./events.js";

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
            
            // Sync dimensions and force an immediate layout update
            state.pixelGrid.resize(payload.width, payload.height, [255, 255, 255], false);
            state.renderer.resizeToContainer(); 
            break;

        case 'UPDATE_GRID':
            if (state && payload) {
                state.loadGrid(payload);
                // Ensure the view resets so the new image isn't hidden off-screen
                const bestZoom = Math.min((window.innerWidth - 40) / state.pixelGrid.width, (window.innerHeight - 40) / state.pixelGrid.height, 20);
                state.setZoom(bestZoom);
                state.setPan((window.innerWidth - state.pixelGrid.width * bestZoom) / 2, (window.innerHeight - state.pixelGrid.height * bestZoom) / 2);
            }
            break;
            
        case 'SET_TOOL': if (state) state.setTool(payload); break;
        case 'SET_COLOR': if (state) state.setColor(payload); break;
    }
});