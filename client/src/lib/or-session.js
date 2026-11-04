// Each patient's OR view layout (grid and what each cell shows) is
// remembered in this browser between visits.

const STORAGE_KEY = "or-view-layout";

export function orSessionKey(patientId) {
    return `${STORAGE_KEY}:${patientId}`;
}

// The saved layout as stored, or null when there is none or it can't be read
export function readOrSession(patientId) {
    try {
        return JSON.parse(localStorage.getItem(orSessionKey(patientId)));
    } catch {
        return null;
    }
}

export function writeOrSession(patientId, layout) {
    try {
        localStorage.setItem(orSessionKey(patientId), JSON.stringify(layout));
    } catch {
        // Storage unavailable: the layout just won't be remembered
    }
}

// Whether a saved layout has at least one cell showing a series
export function hasOrSession(patientId) {
    const saved = readOrSession(patientId);
    return Array.isArray(saved?.cells) && saved.cells.some(Boolean);
}
