import { init as csRenderInit } from "@cornerstonejs/core";
import { init as dicomImageLoaderInit } from "@cornerstonejs/dicom-image-loader";
import {
    init as csToolsInit,
    addTool,
    WindowLevelTool,
    PanTool,
    ZoomTool,
    StackScrollTool,
    PlanarRotateTool,
    CrosshairsTool,
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
