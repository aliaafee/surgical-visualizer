// 3D volume rendering: presets and how far their opacity is shifted, the
// tools for a 3D view, outlines of the slice planes drawn in it, cutting the
// volume along one of those planes, and the crop box.

import {
    Enums as csToolsEnums,
    PanTool,
    ToolGroupManager,
    TrackballRotateTool,
    VolumeCroppingControlTool,
    VolumeCroppingTool,
    ZoomTool,
} from "@cornerstonejs/tools";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import vtkPlane from "@kitware/vtk.js/Common/DataModel/Plane";
import vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";

const { MouseBindings } = csToolsEnums;

// ─── Presets ─────────────────────────────────────────────────────────────────

// Transfer functions offered for a 3D view (names of Cornerstone's built-in
// viewport presets), with the one each modality starts on
export const VOLUME_3D_PRESETS = {
    CT: [
        { id: "CT-Bone", label: "Bone" },
        { id: "CT-Bones", label: "Bones (high contrast)" },
        { id: "CT-Soft-Tissue", label: "Soft tissue" },
        { id: "CT-Muscle", label: "Muscle" },
        { id: "CT-Lung", label: "Lung" },
        { id: "CT-Chest-Contrast-Enhanced", label: "Chest, contrast" },
        { id: "CT-Chest-Vessels", label: "Chest vessels" },
        { id: "CT-Cardiac", label: "Cardiac" },
        { id: "CT-Coronary-Arteries", label: "Coronary arteries" },
        { id: "CT-AAA", label: "Aorta (AAA)" },
        { id: "CT-Liver-Vasculature", label: "Liver vasculature" },
        { id: "CT-MIP", label: "MIP" },
    ],
    MR: [
        { id: "MR-Default", label: "Default" },
        { id: "MR-Angio", label: "Angio" },
        { id: "MR-T2-Brain", label: "T2 brain" },
        { id: "MR-MIP", label: "MIP" },
    ],
};

// Presets for a series' modality; anything that isn't CT gets the MR ones,
// whose ramps suit unscaled intensities
export function volume3DPresetsFor(modality) {
    return modality === "CT" ? VOLUME_3D_PRESETS.CT : VOLUME_3D_PRESETS.MR;
}

// How far the opacity shift slider reaches either way, and its step, in the
// volume's own units (Hounsfield units for CT)
export function opacityShiftRange(modality) {
    return modality === "CT"
        ? { max: 1000, step: 5, unit: "HU" }
        : { max: 500, step: 5, unit: "" };
}

// Colours the volume with `preset`, its opacity and colour ramps moved by
// `shift` along the intensity axis: a positive shift needs denser tissue
// before anything shows (e.g. skin falls away to reveal bone), a negative
// one shows fainter tissue.
//
// The preset is applied as usual first. Shifting the preset's numbers before
// applying it would not work: Cornerstone re-centres every preset on its own
// range, which cancels a uniform shift.
export function applyVolumePreset(viewport, preset, shift = 0) {
    viewport.setProperties({ preset });

    const property = viewport.getDefaultActor()?.actor?.getProperty?.();
    if (property && shift) {
        shiftOpacityFunction(property.getScalarOpacity(0), shift);
        shiftColorFunction(property.getRGBTransferFunction(0), shift);
    }
    viewport.render();
}

function shiftOpacityFunction(fn, shift) {
    const nodes = [];
    for (let i = 0; i < fn.getSize(); i++) {
        const node = [0, 0, 0, 0];
        fn.getNodeValue(i, node);
        nodes.push(node);
    }
    fn.removeAllPoints();
    nodes.forEach(([x, y, midpoint, sharpness]) =>
        fn.addPointLong(x + shift, y, midpoint, sharpness),
    );
}

function shiftColorFunction(fn, shift) {
    const nodes = [];
    for (let i = 0; i < fn.getSize(); i++) {
        const node = [0, 0, 0, 0, 0, 0];
        fn.getNodeValue(i, node);
        nodes.push(node);
    }
    fn.removeAllPoints();
    nodes.forEach(([x, r, g, b, midpoint, sharpness]) =>
        fn.addRGBPointLong(x + shift, r, g, b, midpoint, sharpness),
    );
}

// Short text for a 3D view's corner, e.g. "Bone · +200 HU · cut Axial"
export function volume3DLabel(presets, settings, shiftRange, cutOptions = []) {
    const unit = shiftRange.unit ? ` ${shiftRange.unit}` : "";
    const cut = cutOptions.find((option) => option.id === settings.cut);
    return [
        presets.find((p) => p.id === settings.preset)?.label,
        settings.shift ? `${settings.shift > 0 ? "+" : ""}${settings.shift}${unit}` : "",
        settings.crop && "cropped",
        settings.cut && `cut ${cut?.label ?? ""}`.trim(),
    ]
        .filter(Boolean)
        .join(" · ");
}

// Shows `volumeId` volume-rendered in a 3D viewport
export async function showVolume3D(viewport, volumeId, preset, shift = 0) {
    await viewport.setVolumes([{ volumeId }]);
    applyVolumePreset(viewport, preset, shift);
    viewport.resetCamera();
    viewport.render();
}

// ─── Tools ───────────────────────────────────────────────────────────────────

// Both crop tools start with the box this far in from each edge of the
// volume (as a share of its size), so they agree before they first sync
const CROP_CONFIGURATION = { initialCropFactor: 0.08 };

// A tool group for one 3D view: left drag turns the volume, middle drag
// pans, right drag zooms. The crop box tool is added but stays off until
// turned on. The crop tool only drives the first viewport of its group, so
// every 3D view needs a group of its own.
export function createVolume3DToolGroup(toolGroupId) {
    const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
    [TrackballRotateTool, PanTool, ZoomTool].forEach(({ toolName }) =>
        toolGroup.addTool(toolName),
    );
    toolGroup.addTool(VolumeCroppingTool.toolName, CROP_CONFIGURATION);
    toolGroup.setToolActive(TrackballRotateTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary }],
    });
    toolGroup.setToolActive(PanTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Auxiliary }],
    });
    toolGroup.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Secondary }],
    });
    return toolGroup;
}

// Turns the crop box in `viewport` (the 3D view of `toolGroup`) on or off.
// While it is on, left drag belongs to the crop tool: on a sphere it moves
// that face or corner of the box, elsewhere it turns the volume (with shift
// held, it turns the box).
export function setVolume3DCropping(toolGroup, viewport, enabled) {
    const cropName = VolumeCroppingTool.toolName;
    const trackballName = TrackballRotateTool.toolName;

    if (enabled) {
        // The box adds six clipping planes, the most the renderer takes, so
        // a cut along a plane has to go first
        setVolumeCut(viewport, null);
        toolGroup.setToolPassive(trackballName, { removeAllBindings: true });
        toolGroup.setToolActive(cropName, {
            bindings: [{ mouseButton: MouseBindings.Primary }],
        });
        // Activating the tool hides the box; show it
        toolGroup.getToolInstance(cropName)?.setClippingPlanesVisible(true);
    } else {
        // Only a crop tool that has been on has a box to take away
        const crop = toolGroup.getToolInstance(cropName);
        const mode = toolGroup.toolOptions[cropName]?.mode;
        if (crop && mode && mode !== csToolsEnums.ToolModes.Disabled) {
            crop.setClippingPlanesVisible(false);
        }
        toolGroup.setToolDisabled(cropName);
        toolGroup.setToolActive(trackballName, {
            bindings: [{ mouseButton: MouseBindings.Primary }],
        });
    }
}

// Adds the crop box's control tool to a group of slice viewports, where it
// draws the box and lets its edges be dragged
export function addCropControlTool(toolGroup, configuration = {}) {
    toolGroup.addTool(VolumeCroppingControlTool.toolName, {
        ...CROP_CONFIGURATION,
        ...configuration,
    });
}

// Shows or hides the crop box in the slice viewports. Its edges can be
// dragged whichever tool is on the left button, as with the crosshairs.
export function setCropControlVisible(toolGroup, visible) {
    const name = VolumeCroppingControlTool.toolName;
    if (visible) {
        // Activating builds the box; passive keeps it draggable without
        // taking a mouse button from the chosen tool
        toolGroup.setToolActive(name, { bindings: [] });
        toolGroup.setToolPassive(name);
    } else {
        toolGroup.setToolDisabled(name);
    }
}

// ─── Plane outlines ──────────────────────────────────────────────────────────

const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const normalize = (v) => {
    const length = Math.hypot(...v) || 1;
    return v.map((x) => x / length);
};

// "#rrggbb" or "rgb(r, g, b)" as vtk's 0-1 RGB
export function cssColorToRgb(color) {
    const hex = /^#([0-9a-f]{6})$/i.exec(color || "");
    if (hex) {
        const n = parseInt(hex[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
    }
    const rgb = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(
        color || "",
    );
    if (rgb) return rgb.slice(1, 4).map((c) => Number(c) / 255);
    return [1, 1, 1];
}

// The corners of the volume's box in world space, and its 12 edges as pairs
// of corner indices
function volumeBox(viewport) {
    const imageData = viewport
        .getDefaultActor()
        ?.actor?.getMapper?.()
        ?.getInputData?.();
    if (!imageData) return null;

    const [nx, ny, nz] = imageData.getDimensions().map((d) => d - 1);
    const corners = [];
    for (const i of [0, nx]) {
        for (const j of [0, ny]) {
            for (const k of [0, nz]) {
                corners.push(imageData.indexToWorld([i, j, k]));
            }
        }
    }
    // Corner c has bits (i, j, k); an edge joins corners one bit apart
    const edges = [];
    for (let c = 0; c < 8; c++) {
        for (const bit of [1, 2, 4]) {
            if (!(c & bit)) edges.push([c, c | bit]);
        }
    }
    return { corners, edges };
}

// Where a plane cuts the volume's box: the corners of that cross-section in
// order around it, or null when the plane misses the volume
function planeSection(box, origin, normal) {
    const n = normalize(normal);
    const side = box.corners.map((corner) => dot(n, sub(corner, origin)));

    const points = [];
    box.edges.forEach(([a, b]) => {
        const da = side[a];
        const db = side[b];
        if ((da > 0 && db > 0) || (da < 0 && db < 0) || da === db) return;
        const t = da / (da - db);
        const [pa, pb] = [box.corners[a], box.corners[b]];
        points.push(pa.map((v, i) => v + (pb[i] - v) * t));
    });
    if (points.length < 3) return null;

    // Order the points by angle around their centre, within the plane
    const centre = [0, 1, 2].map(
        (i) => points.reduce((sum, p) => sum + p[i], 0) / points.length,
    );
    const helper = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = normalize(cross(n, helper));
    const v = cross(n, u);
    const angle = (p) => {
        const d = sub(p, centre);
        return Math.atan2(dot(d, v), dot(d, u));
    };
    const ordered = points.sort((p, q) => angle(p) - angle(q));

    // Two edges meeting at a corner on the plane give the same point twice
    return ordered.filter(
        (p, i) => Math.hypot(...sub(p, ordered[(i + 1) % ordered.length])) > 1e-3,
    );
}

// Outline actors drawn in each 3D viewport, by plane key
const outlinesByViewport = new WeakMap();

function outlineUid(key) {
    return `slice-plane-outline-${key}`;
}

// Draws where each of `planes` ({ key, origin, normal, color }) cuts the
// volume, as a closed outline in that plane's colour. Outlines of planes no
// longer listed are removed; pass [] to remove them all.
export function syncPlaneOutlines(viewport, planes) {
    let outlines = outlinesByViewport.get(viewport);
    if (!outlines) {
        outlines = new Map();
        outlinesByViewport.set(viewport, outlines);
    }

    const box = planes.length ? volumeBox(viewport) : null;
    const wanted = new Set();

    planes.forEach(({ key, origin, normal, color }) => {
        const section = box && planeSection(box, origin, normal);
        if (!section) return;
        wanted.add(key);

        let outline = outlines.get(key);
        if (!outline) {
            const polyData = vtkPolyData.newInstance();
            const mapper = vtkMapper.newInstance();
            mapper.setInputData(polyData);
            const actor = vtkActor.newInstance();
            actor.setMapper(mapper);
            // Flat colour: lighting would darken the lines as they turn
            actor.getProperty().setLighting(false);
            actor.getProperty().setLineWidth(2);
            // Not pickable, so it never gets in the way of the tools
            actor.setPickable(false);
            viewport.addActor({ uid: outlineUid(key), actor });
            outline = { polyData, actor };
            outlines.set(key, outline);
        }

        outline.polyData.getPoints().setData(Float32Array.from(section.flat()), 3);
        outline.polyData
            .getLines()
            .setData(
                Uint32Array.from([
                    section.length + 1,
                    ...section.map((_, i) => i),
                    0,
                ]),
            );
        outline.polyData.modified();
        outline.actor.getProperty().setColor(...cssColorToRgb(color));
    });

    const stale = [...outlines.keys()].filter((key) => !wanted.has(key));
    if (stale.length) {
        viewport.removeActors(stale.map(outlineUid));
        stale.forEach((key) => outlines.delete(key));
    }
}

// ─── Cut along a plane ───────────────────────────────────────────────────────

// Cuts the volume along a plane ({ origin, normal }), keeping the side the
// normal points to; null takes the cut away. One plane only: the volume
// renderer takes at most six clipping planes, the crop box uses all six,
// and Cornerstone rearranges a volume's planes once it has two or more.
// So a cut and the crop box can't both be on in one view.
export function setVolumeCut(viewport, cut) {
    const mapper = viewport.getDefaultActor()?.actor?.getMapper?.();
    if (!mapper) return;
    mapper.removeAllClippingPlanes();
    if (cut) {
        mapper.addClippingPlane(
            vtkPlane.newInstance({
                origin: cut.origin,
                normal: normalize(cut.normal),
            }),
        );
    }
}
