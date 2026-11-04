import { init as csRenderInit, imageLoader } from "@cornerstonejs/core";
import { init as dicomImageLoaderInit } from "@cornerstonejs/dicom-image-loader";
import {
    init as csToolsInit,
    addTool,
    Enums as csToolsEnums,
    WindowLevelTool,
    PanTool,
    ZoomTool,
    StackScrollTool,
    PlanarRotateTool,
    CrosshairsTool,
    TrackballRotateTool,
    ToolGroupManager,
} from "@cornerstonejs/tools";
import { pb } from "@/lib/pb";

// Tools the viewer registers; each can be bound to the left mouse button
export const VIEWER_TOOLS = [
    WindowLevelTool,
    PanTool,
    ZoomTool,
    PlanarRotateTool,
    StackScrollTool,
];

const { MouseBindings } = csToolsEnums;

// Colour of each anatomical plane: its label, and its line in other views
export const PLANE_COLORS = {
    axial: "rgb(240, 90, 90)",
    sagittal: "rgb(240, 200, 60)",
    coronal: "rgb(90, 200, 110)",
};

// Bindings that stay active whichever tool is on the left button
const FIXED_BINDINGS = {
    [PanTool.toolName]: [{ mouseButton: MouseBindings.Auxiliary }],
    [ZoomTool.toolName]: [{ mouseButton: MouseBindings.Secondary }],
    [StackScrollTool.toolName]: [{ mouseButton: MouseBindings.Wheel }],
};

// Puts the given tool on the left mouse button, keeping the fixed bindings
export function applyToolBindings(toolGroup, primaryToolName) {
    VIEWER_TOOLS.forEach(({ toolName }) => {
        const bindings = [...(FIXED_BINDINGS[toolName] || [])];
        if (toolName === primaryToolName) {
            bindings.push({ mouseButton: MouseBindings.Primary });
        }

        toolGroup.setToolPassive(toolName, { removeAllBindings: true });
        if (bindings.length) {
            toolGroup.setToolActive(toolName, { bindings });
        }
    });
}

// ─── 3D volume rendering ─────────────────────────────────────────────────────

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

const VOLUME_3D_TOOLS = [TrackballRotateTool, PanTool, ZoomTool];

// A tool group for 3D views: left drag turns the volume, middle drag pans,
// right drag zooms. The slice tools make no sense on a rendered volume.
export function createVolume3DToolGroup(toolGroupId) {
    const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
    VOLUME_3D_TOOLS.forEach(({ toolName }) => toolGroup.addTool(toolName));
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

// Shows `volumeId` volume-rendered in a 3D viewport with the given preset
export async function showVolume3D(viewport, volumeId, preset) {
    await viewport.setVolumes([{ volumeId }]);
    viewport.setProperties({ preset });
    viewport.resetCamera();
    viewport.render();
}

// Parallel slice downloads while building a volume
const LOAD_CONCURRENCY = 6;

// Downloads every slice (a few at a time) so their metadata is available
// before the volume is assembled
export async function loadImages(imageIds, onProgress, isCancelled) {
    let next = 0;
    let loaded = 0;

    async function worker() {
        while (next < imageIds.length && !isCancelled()) {
            const imageId = imageIds[next++];
            await imageLoader.loadAndCacheImage(imageId);
            onProgress(++loaded);
        }
    }

    await Promise.all(Array.from({ length: LOAD_CONCURRENCY }, worker));
}

// Volume (MPR and 3D) viewports need WebGL; without it Cornerstone falls back
// to CPU rendering, which only draws stacks
export const MPR_UNAVAILABLE_MESSAGE =
    "MPR and 3D need WebGL, which this browser has not made available. " +
    "Turn on hardware acceleration in the browser settings and reload, " +
    "or view the series as a stack.";

let initPromise = null;

export function initializeCornerstone() {
    if (!initPromise) {
        initPromise = (async () => {
            // Initialize Cornerstone Core
            await csRenderInit();

            // Registers the wadouri loader + metadata providers, and attaches
            // the PocketBase auth token to every DICOM file request
            dicomImageLoaderInit({
                maxWebWorkers: Math.max(
                    1,
                    Math.floor((navigator.hardwareConcurrency || 2) / 2),
                ),
                beforeSend: () =>
                    pb.authStore.token
                        ? { Authorization: `Bearer ${pb.authStore.token}` }
                        : {},
            });

            csToolsInit();
            VIEWER_TOOLS.forEach((tool) => addTool(tool));
            // Only used by the multi-planar view, which adds it per tool group
            addTool(CrosshairsTool);
            // Only used by 3D views, which have a tool group of their own
            addTool(TrackballRotateTool);

            console.log("Cornerstone initialized successfully");
        })().catch((err) => {
            initPromise = null;
            throw err;
        });
    }
    return initPromise;
}

// wadouri image ID pointing at the authenticated instance file route
export function instanceImageId(instanceId) {
    return `wadouri:${pb.buildURL(
        `/api/visualizer/dicom/instances/${instanceId}/file`,
    )}`;
}

// Adds the crosshairs tool to a tool group, with every reference line
// draggable and each one rotatable on its own.
//
// Out of the box the tool turns all the other planes together when any
// rotation handle is dragged, which keeps the lines locked at right angles.
// Here only the plane whose line was grabbed is allowed to turn.
export function addCrosshairsTool(toolGroup, configuration) {
    let rotatingViewportId = null;

    toolGroup.addTool(CrosshairsTool.toolName, {
        ...configuration,
        getReferenceLineControllable: () => true,
        getReferenceLineDraggableRotatable: (viewportId) =>
            rotatingViewportId === null || viewportId === rotatingViewportId,
    });

    const crosshairs = toolGroup.getToolInstance(CrosshairsTool.toolName);
    const findRotationHandle =
        crosshairs._getRotationHandleNearImagePoint.bind(crosshairs);

    // The choice of plane is fixed for the length of a drag, even if the
    // pointer strays off the handle while turning it
    let isDragging = false;
    const activateModify = crosshairs._activateModify;
    const deactivateModify = crosshairs._deactivateModify;
    crosshairs._activateModify = (element) => {
        isDragging = true;
        activateModify(element);
    };
    crosshairs._deactivateModify = (element) => {
        isDragging = false;
        deactivateModify(element);
    };

    // Runs on every hover and mouse down, so it always reflects the handle
    // under the pointer: remember which plane that handle belongs to
    crosshairs._getRotationHandleNearImagePoint = (
        viewport,
        annotation,
        canvasCoords,
        proximity,
    ) => {
        // Every line's handle can be picked up until a drag begins
        if (!isDragging) rotatingViewportId = null;

        const point = findRotationHandle(
            viewport,
            annotation,
            canvasCoords,
            proximity,
        );
        if (isDragging) return point;

        if (point) {
            const handle = annotation.data.handles.rotationPoints.find(
                ([handlePoint]) => handlePoint === point,
            );
            rotatingViewportId = handle?.[1]?.id ?? null;
        }
        return point;
    };

    return crosshairs;
}
