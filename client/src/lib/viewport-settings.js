import { Enums } from "@cornerstonejs/core";

// How a viewport combines the slices inside its slab
export const PROJECTIONS = [
    {
        id: "none",
        label: "Single slice",
        short: "",
        blendMode: Enums.BlendModes.COMPOSITE,
    },
    {
        id: "mip",
        label: "MIP (maximum)",
        short: "MIP",
        blendMode: Enums.BlendModes.MAXIMUM_INTENSITY_BLEND,
    },
    {
        id: "minip",
        label: "MinIP (minimum)",
        short: "MinIP",
        blendMode: Enums.BlendModes.MINIMUM_INTENSITY_BLEND,
    },
    {
        id: "avg",
        label: "Average",
        short: "Avg",
        blendMode: Enums.BlendModes.AVERAGE_INTENSITY_BLEND,
    },
];

export const DEFAULT_SLAB = { projection: "none", thickness: 10 };
export const MAX_SLAB_THICKNESS = 100;
// Thinner than this the viewport is effectively showing a single slice
export const MIN_SLAB_THICKNESS = 0.5;

export const CT_PRESETS = [
    { label: "Soft tissue", width: 400, center: 40 },
    { label: "Bone", width: 1800, center: 400 },
    { label: "Lung", width: 1500, center: -600 },
    { label: "Brain", width: 80, center: 40 },
];

// Short text for a slab, e.g. "MIP 40 mm" ("" for a single slice)
export function slabLabel(slab) {
    if (!slab || slab.projection === "none") return "";
    const projection = PROJECTIONS.find((p) => p.id === slab.projection);
    return `${projection.short} ${slab.thickness} mm`;
}

// Sets a volume viewport's projection and slab thickness
export function applySlabToViewport(viewport, slab) {
    const projection = PROJECTIONS.find((p) => p.id === slab.projection);

    viewport.setBlendMode(projection.blendMode);
    if (slab.projection === "none") {
        viewport.resetSlabThickness();
    } else {
        viewport.setSlabThickness(slab.thickness);
    }
    viewport.render();
}

// Sets a viewport's window width/level; ignores values that make no sense
export function applyWindowToViewport(viewport, width, center) {
    if (!(width > 0) || !Number.isFinite(center)) return;

    viewport.setProperties({
        voiRange: { lower: center - width / 2, upper: center + width / 2 },
    });
    viewport.render();
}
