import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
    RenderingEngine,
    Enums,
    cache,
    imageLoader,
    volumeLoader,
    setVolumesForViewports,
    utilities as csUtils,
} from "@cornerstonejs/core";
import { wadouri } from "@cornerstonejs/dicom-image-loader";
import {
    ToolGroupManager,
    SynchronizerManager,
    synchronizers,
    Enums as csToolsEnums,
    WindowLevelTool,
    PanTool,
    ZoomTool,
    StackScrollTool,
    PlanarRotateTool,
    CrosshairsTool,
} from "@cornerstonejs/tools";
import { pb } from "@/lib/pb";
import {
    initializeCornerstone,
    instanceImageId,
    VIEWER_TOOLS,
} from "@/lib/cornerstone";

const { MouseBindings } = csToolsEnums;

// Viewports shown for a series that can be loaded as a volume. Each plane's
// colour is used for its label and for its reference line in the other views.
const MPR_VIEWPORTS = [
    {
        id: "axial",
        label: "Axial",
        orientation: Enums.OrientationAxis.AXIAL,
        color: "rgb(240, 90, 90)",
    },
    {
        id: "sagittal",
        label: "Sagittal",
        orientation: Enums.OrientationAxis.SAGITTAL,
        color: "rgb(240, 200, 60)",
    },
    {
        id: "coronal",
        label: "Coronal",
        orientation: Enums.OrientationAxis.CORONAL,
        color: "rgb(90, 200, 110)",
    },
];

const CROSSHAIRS_CONFIG = {
    getReferenceLineColor: (viewportId) =>
        MPR_VIEWPORTS.find((vp) => vp.id === viewportId)?.color,
    getReferenceLineControllable: () => true,
    getReferenceLineDraggableRotatable: () => true,
    // Draws each plane's slab as a pair of lines either side of its reference
    // line, with handles to drag the thickness
    getReferenceLineSlabThicknessControlsOn: () => true,
};

// Single viewport for everything else (colour captures, scouts, short series)
const STACK_VIEWPORTS = [{ id: "stack", label: "Image" }];

// Tools selectable for the left mouse button
const PRIMARY_TOOLS = [
    { name: WindowLevelTool.toolName, label: "Window/Level" },
    { name: PanTool.toolName, label: "Pan" },
    { name: ZoomTool.toolName, label: "Zoom" },
    { name: PlanarRotateTool.toolName, label: "Rotate" },
    { name: StackScrollTool.toolName, label: "Scroll" },
    { name: CrosshairsTool.toolName, label: "Crosshairs", volumeOnly: true },
];

// Bindings that stay active whichever tool is on the left button
const FIXED_BINDINGS = {
    [PanTool.toolName]: [{ mouseButton: MouseBindings.Auxiliary }],
    [ZoomTool.toolName]: [{ mouseButton: MouseBindings.Secondary }],
    [StackScrollTool.toolName]: [{ mouseButton: MouseBindings.Wheel }],
};

// How a viewport combines the slices inside its slab
const PROJECTIONS = [
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

const DEFAULT_SLAB = { projection: "none", thickness: 10 };
const MAX_SLAB_THICKNESS = 100;
// Thinner than this the viewport is effectively showing a single slice
const MIN_SLAB_THICKNESS = 0.5;

const CT_PRESETS = [
    { label: "Soft tissue", width: 400, center: 40 },
    { label: "Bone", width: 1800, center: 400 },
    { label: "Lung", width: 1500, center: -600 },
    { label: "Brain", width: 80, center: 40 },
];

// Parallel slice downloads while building a volume
const LOAD_CONCURRENCY = 6;

let viewerInstanceCount = 0;

function applyToolBindings(toolGroup, primaryToolName) {
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

// The projection a plane uses once its slab has thickness: the one chosen for
// it, else the one it had before being dragged down to a single slice, else MIP
function slabProjectionId(slab) {
    if (slab?.projection && slab.projection !== "none") return slab.projection;
    return slab?.resumeProjection || "mip";
}

// Crosshairs on the left button when selected; otherwise the reference lines
// stay visible (and draggable) while another tool is in use, or are hidden.
function applyCrosshairsMode(toolGroup, primaryToolName, visible) {
    const toolName = CrosshairsTool.toolName;

    if (primaryToolName === toolName) {
        toolGroup.setToolActive(toolName, {
            bindings: [{ mouseButton: MouseBindings.Primary }],
        });
    } else if (visible) {
        toolGroup.setToolPassive(toolName, { removeAllBindings: true });
    } else {
        toolGroup.setToolDisabled(toolName);
    }
}

// Downloads every slice (a few at a time) so their metadata is available
// before the volume is assembled
async function loadImages(imageIds, onProgress, isCancelled) {
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

function voiToWindow(range) {
    if (!range) return {};
    return {
        windowWidth: range.upper - range.lower,
        windowCenter: (range.upper + range.lower) / 2,
    };
}

function formatDate(value) {
    return value ? String(value).slice(0, 10) : "";
}

function formatNumbers(values, digits = 3) {
    if (!Array.isArray(values) || !values.length) return "";
    return values.map((v) => Number(v).toFixed(digits)).join(" × ");
}

// mode "mpr" opens the series in the multi-planar view when it forms a volume;
// "stack" (the default) always shows it slice by slice
export default function DicomViewer({ seriesId, mode = "stack", onClose }) {
    const [seriesData, setSeriesData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [initialized, setInitialized] = useState(false);
    const [forceStack, setForceStack] = useState(false);
    const [loadProgress, setLoadProgress] = useState(null);
    const [activeTool, setActiveTool] = useState(WindowLevelTool.toolName);
    const [layout, setLayout] = useState("all");
    const [showCrosshairs, setShowCrosshairs] = useState(true);
    const [linkWindowing, setLinkWindowing] = useState(false);
    const [slabSettings, setSlabSettings] = useState({});
    const [openSettings, setOpenSettings] = useState({});
    const [volumeReady, setVolumeReady] = useState(false);
    const [viewportInfo, setViewportInfo] = useState({});

    const gridRef = useRef(null);
    const elementRefs = useRef({});
    const renderingEngineRef = useRef(null);
    const toolGroupRef = useRef(null);
    const activeToolRef = useRef(activeTool);
    const slabSettingsRef = useRef(slabSettings);

    const isVolume =
        mode === "mpr" && Boolean(seriesData?.is3DCapable) && !forceStack;
    const viewports = isVolume ? MPR_VIEWPORTS : STACK_VIEWPORTS;
    // Window presets are in Hounsfield units, so greyscale CT only
    const isCT =
        seriesData?.modality === "CT" &&
        (seriesData.instances?.[0]?.metadata?.samplesPerPixel ?? 1) === 1;

    const updateViewportInfo = useCallback((viewportId, patch) => {
        setViewportInfo((prev) => ({
            ...prev,
            [viewportId]: { ...prev[viewportId], ...patch },
        }));
    }, []);

    // Initialize Cornerstone
    useEffect(() => {
        let isCancelled = false;

        initializeCornerstone()
            .then(() => {
                if (!isCancelled) setInitialized(true);
            })
            .catch((err) => {
                console.error("Failed to initialize Cornerstone:", err);
                if (!isCancelled) setError("Failed to initialize viewer");
            });

        return () => {
            isCancelled = true;
        };
    }, []);

    // Fetch series data
    useEffect(() => {
        if (!seriesId) return;

        let isCancelled = false;

        async function fetchSeries() {
            setLoading(true);
            setError("");
            setNotice("");
            setForceStack(false);
            setLayout("all");

            try {
                const data = await pb.send(
                    `/api/visualizer/dicom/series/${seriesId}`,
                    {
                        method: "GET",
                    },
                );

                if (isCancelled) return;

                // Sort instances by instance number
                if (data.instances) {
                    data.instances.sort((a, b) => {
                        const aNum = a.instanceNumber || 0;
                        const bNum = b.instanceNumber || 0;
                        return aNum - bNum;
                    });
                }

                setSeriesData(data);
            } catch (err) {
                if (isCancelled) return;
                console.error("Failed to fetch series:", err);
                setError(err.message || "Failed to fetch series");
            } finally {
                if (!isCancelled) {
                    setLoading(false);
                }
            }
        }

        fetchSeries();

        return () => {
            isCancelled = true;
        };
    }, [seriesId]);

    // Setup viewports, tools and load the images
    useEffect(() => {
        if (!initialized || !seriesData?.instances?.length) return;

        const activeViewports = isVolume ? MPR_VIEWPORTS : STACK_VIEWPORTS;
        const elements = activeViewports.map(
            (vp) => elementRefs.current[vp.id],
        );
        if (elements.some((el) => !el)) return;

        let isCancelled = false;
        const instanceNumber = ++viewerInstanceCount;
        const renderingEngineId = `viewerEngine-${instanceNumber}`;
        const toolGroupId = `viewerTools-${instanceNumber}`;
        const viewportIds = activeViewports.map((vp) => vp.id);
        const imageIds = seriesData.instances.map((instance) =>
            instanceImageId(instance.id),
        );

        setViewportInfo({});
        setSlabSettings({});
        setLoadProgress(null);
        setVolumeReady(false);

        const renderingEngine = new RenderingEngine(renderingEngineId);
        renderingEngineRef.current = renderingEngine;

        activeViewports.forEach((vp, i) => {
            renderingEngine.enableElement({
                viewportId: vp.id,
                type: isVolume
                    ? Enums.ViewportType.ORTHOGRAPHIC
                    : Enums.ViewportType.STACK,
                element: elements[i],
                defaultOptions: {
                    background: [0, 0, 0],
                    ...(isVolume ? { orientation: vp.orientation } : {}),
                },
            });
        });

        const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
        toolGroupRef.current = toolGroup;
        VIEWER_TOOLS.forEach(({ toolName }) => toolGroup.addTool(toolName));
        viewportIds.forEach((id) =>
            toolGroup.addViewport(id, renderingEngineId),
        );
        applyToolBindings(toolGroup, activeToolRef.current);

        // Keep the slice sliders and overlays in sync with what is displayed
        const listeners = [];
        const listen = (element, type, handler) => {
            element.addEventListener(type, handler);
            listeners.push(() => element.removeEventListener(type, handler));
        };
        activeViewports.forEach((vp, i) => {
            const element = elements[i];
            listen(element, Enums.Events.STACK_NEW_IMAGE, (evt) => {
                const { image, imageIdIndex } = evt.detail;
                updateViewportInfo(vp.id, {
                    index: imageIdIndex,
                    count: imageIds.length,
                    rows: image.rows,
                    columns: image.columns,
                });
            });
            listen(element, Enums.Events.VOLUME_NEW_IMAGE, (evt) => {
                const { imageIndex, numberOfSlices } = evt.detail;
                updateViewportInfo(vp.id, {
                    index: imageIndex,
                    count: numberOfSlices,
                });
            });
            listen(element, Enums.Events.VOI_MODIFIED, (evt) => {
                updateViewportInfo(vp.id, voiToWindow(evt.detail.range));
            });
            // The right mouse button is bound to zoom
            listen(element, "contextmenu", (evt) => evt.preventDefault());
        });

        // Dragging a slab handle on a reference line changes that plane's
        // thickness inside the crosshairs tool, so read the result back into
        // the settings shown for that plane
        const syncSlabs = () => {
            const current = slabSettingsRef.current;
            let next = null;

            viewportIds.forEach((id) => {
                const viewport = renderingEngine.getViewport(id);
                if (!viewport) return;

                const slab = { ...DEFAULT_SLAB, ...current[id] };
                const thickness = viewport.getSlabThickness();
                let updated;

                if (thickness < MIN_SLAB_THICKNESS) {
                    if (slab.projection === "none") return;
                    updated = {
                        ...slab,
                        projection: "none",
                        resumeProjection: slab.projection,
                    };
                } else {
                    const projectionId = slabProjectionId(slab);
                    const rounded = Math.max(1, Math.round(thickness));
                    if (
                        projectionId === slab.projection &&
                        rounded === slab.thickness
                    ) {
                        return;
                    }
                    updated = { projection: projectionId, thickness: rounded };
                }

                next = { ...(next || current), [id]: updated };
            });

            if (next) {
                slabSettingsRef.current = next;
                setSlabSettings(next);
            }
        };
        if (isVolume) {
            elements.forEach((element) => {
                listen(element, csToolsEnums.Events.MOUSE_DRAG, syncSlabs);
                listen(element, csToolsEnums.Events.MOUSE_UP, syncSlabs);
            });
        }

        const refreshInfo = () => {
            viewportIds.forEach((id) => {
                const viewport = renderingEngine.getViewport(id);
                updateViewportInfo(id, {
                    index: viewport.getSliceIndex(),
                    count: viewport.getNumberOfSlices(),
                    ...voiToWindow(viewport.getProperties()?.voiRange),
                });
            });
        };

        async function showVolume() {
            setLoadProgress({ loaded: 0, total: imageIds.length });
            await loadImages(
                imageIds,
                (loaded) => {
                    if (!isCancelled) {
                        setLoadProgress({ loaded, total: imageIds.length });
                    }
                },
                () => isCancelled,
            );
            if (isCancelled) return;

            const volumeId = `cornerstoneStreamingImageVolume:${seriesData.id}`;
            const volume = await volumeLoader.createAndCacheVolume(volumeId, {
                imageIds,
            });
            if (isCancelled) return;
            volume.load();

            await setVolumesForViewports(
                renderingEngine,
                [{ volumeId }],
                viewportIds,
            );
            if (isCancelled) return;

            renderingEngine.renderViewports(viewportIds);

            // Crosshairs position themselves from the loaded volume, so the
            // tool can only join once the viewports are showing it
            toolGroup.addTool(CrosshairsTool.toolName, CROSSHAIRS_CONFIG);

            // The tool switches a plane to MIP on every step of a slab handle
            // drag; apply the plane's own projection instead
            const crosshairs = toolGroup.getToolInstance(
                CrosshairsTool.toolName,
            );
            crosshairs.setSlabThickness = (viewport, slabThickness) => {
                const projectionId =
                    slabThickness < MIN_SLAB_THICKNESS
                        ? "none"
                        : slabProjectionId(slabSettingsRef.current[viewport.id]);
                const projection = PROJECTIONS.find(
                    (p) => p.id === projectionId,
                );
                viewport.setBlendMode(projection.blendMode);
                viewport.setSlabThickness(slabThickness);
            };
            setVolumeReady(true);
        }

        async function showStack() {
            const viewport = renderingEngine.getViewport(viewportIds[0]);
            await viewport.setStack(imageIds, 0);
            if (isCancelled) return;
            viewport.render();
        }

        (isVolume ? showVolume() : showStack())
            .then(() => {
                if (isCancelled) return;
                setLoadProgress(null);
                refreshInfo();
            })
            .catch((err) => {
                if (isCancelled) return;
                console.error("Failed to load images:", err);
                setLoadProgress(null);
                if (isVolume) {
                    // Fall back to plain slice-by-slice viewing
                    setNotice(
                        "This series could not be loaded as a volume, showing it as a stack instead.",
                    );
                    setForceStack(true);
                } else {
                    setError("Failed to load images");
                }
            });

        // Keep the canvases matched to their elements
        const resizeObserver = new ResizeObserver(() => {
            if (!isCancelled) renderingEngine.resize(true, true);
        });
        if (gridRef.current) resizeObserver.observe(gridRef.current);

        // Cleanup
        return () => {
            isCancelled = true;
            resizeObserver.disconnect();
            listeners.forEach((remove) => remove());
            ToolGroupManager.destroyToolGroup(toolGroupId);
            renderingEngine.destroy();
            if (renderingEngineRef.current === renderingEngine) {
                renderingEngineRef.current = null;
                toolGroupRef.current = null;
            }
            // Free the decoded slices and the raw DICOM files behind them
            cache.purgeCache();
            wadouri.dataSetCacheManager.purge();
        };
    }, [initialized, seriesData, isVolume, updateViewportInfo]);

    useEffect(() => {
        slabSettingsRef.current = slabSettings;
    }, [slabSettings]);

    // Switch the tool on the left mouse button
    useEffect(() => {
        activeToolRef.current = activeTool;
        if (toolGroupRef.current) {
            applyToolBindings(toolGroupRef.current, activeTool);
        }
    }, [activeTool]);

    // Show, hide or activate the crosshairs
    useEffect(() => {
        if (!volumeReady || !toolGroupRef.current) return;
        applyCrosshairsMode(toolGroupRef.current, activeTool, showCrosshairs);
        renderingEngineRef.current?.render();
    }, [volumeReady, activeTool, showCrosshairs]);

    // Optionally keep window/level the same in all three planes
    useEffect(() => {
        const renderingEngine = renderingEngineRef.current;
        if (!volumeReady || !linkWindowing || !renderingEngine) return;

        const viewportIds = MPR_VIEWPORTS.map((vp) => vp.id);

        // Start from a common window: the first plane's
        const [source, ...others] = viewportIds.map((id) =>
            renderingEngine.getViewport(id),
        );
        const voiRange = source.getProperties()?.voiRange;
        if (voiRange) {
            others.forEach((viewport) => {
                viewport.setProperties({ voiRange });
                viewport.render();
            });
        }

        const syncId = `viewerVoiSync-${renderingEngine.id}`;
        const voiSync = synchronizers.createVOISynchronizer(syncId, {
            syncInvertState: false,
            syncColormap: false,
        });
        viewportIds.forEach((viewportId) =>
            voiSync.add({ renderingEngineId: renderingEngine.id, viewportId }),
        );

        return () => SynchronizerManager.destroySynchronizer(syncId);
    }, [volumeReady, linkWindowing]);

    // The crosshairs tool only exists in the multi-planar view
    useEffect(() => {
        if (!isVolume && activeTool === CrosshairsTool.toolName) {
            setActiveTool(WindowLevelTool.toolName);
        }
    }, [isVolume, activeTool]);

    // Panels change size when the layout does
    useEffect(() => {
        renderingEngineRef.current?.resize(true, true);
    }, [layout]);

    const forEachViewport = (fn) => {
        const renderingEngine = renderingEngineRef.current;
        if (!renderingEngine) return;
        viewports.forEach((vp) => {
            const viewport = renderingEngine.getViewport(vp.id);
            if (viewport) fn(viewport, vp);
        });
    };

    // Handle image navigation
    const showSlice = (viewportId, index) => {
        const element = elementRefs.current[viewportId];
        const count = viewportInfo[viewportId]?.count || 0;
        if (!element || index < 0 || index >= count) return;

        updateViewportInfo(viewportId, { index });
        csUtils.jumpToSlice(element, { imageIndex: index }).catch((err) => {
            console.error("Failed to change slice:", err);
        });
    };

    // Per-viewport window/level (follows to the other planes when linked)
    const applyWindow = (viewportId, width, center) => {
        const viewport = renderingEngineRef.current?.getViewport(viewportId);
        if (!viewport || !(width > 0) || !Number.isFinite(center)) return;

        viewport.setProperties({
            voiRange: { lower: center - width / 2, upper: center + width / 2 },
        });
        viewport.render();
    };

    // Per-viewport slab: how thick it is and how its slices are combined
    const applySlab = (viewportId, patch) => {
        const viewport = renderingEngineRef.current?.getViewport(viewportId);
        if (!viewport) return;

        const slab = {
            ...DEFAULT_SLAB,
            ...slabSettings[viewportId],
            ...patch,
            resumeProjection: undefined,
        };
        const projection = PROJECTIONS.find((p) => p.id === slab.projection);

        viewport.setBlendMode(projection.blendMode);
        if (slab.projection === "none") {
            viewport.resetSlabThickness();
        } else {
            viewport.setSlabThickness(slab.thickness);
        }
        viewport.render();

        setSlabSettings((prev) => ({ ...prev, [viewportId]: slab }));
    };

    const selectTool = (toolName) => {
        if (toolName === CrosshairsTool.toolName) setShowCrosshairs(true);
        setActiveTool(toolName);
    };

    const toggleCrosshairs = (visible) => {
        setShowCrosshairs(visible);
        if (!visible && activeTool === CrosshairsTool.toolName) {
            setActiveTool(WindowLevelTool.toolName);
        }
    };

    const resetView = () => {
        setSlabSettings({});
        forEachViewport((viewport, vp) => {
            if (isVolume) viewport.setBlendMode(Enums.BlendModes.COMPOSITE);
            viewport.resetProperties();
            viewport.resetCamera();
            viewport.render();
            updateViewportInfo(vp.id, {
                index: viewport.getSliceIndex(),
                ...voiToWindow(viewport.getProperties()?.voiRange),
            });
        });
    };

    const currentInstance = useMemo(() => {
        const instances = seriesData?.instances || [];
        if (isVolume) return instances[0];
        return instances[viewportInfo.stack?.index ?? 0] || instances[0];
    }, [seriesData, isVolume, viewportInfo]);

    if (loading) {
        return (
            <div style={containerStyle}>
                <p>Loading series...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div style={containerStyle}>
                <p style={{ color: "red" }}>{error}</p>
                {onClose && (
                    <button onClick={onClose} style={btnStyle}>
                        Close
                    </button>
                )}
            </div>
        );
    }

    if (!seriesData) {
        return null;
    }

    const study = seriesData.study || {};
    const meta = currentInstance?.metadata || {};
    const visibleLayout =
        isVolume && viewports.some((vp) => vp.id === layout) ? layout : "all";

    return (
        <div style={containerStyle}>
            <div style={headerStyle}>
                <div>
                    <h2 style={{ margin: 0 }}>DICOM Viewer</h2>
                    <p
                        style={{
                            margin: "4px 0",
                            fontSize: "0.9em",
                            color: "#a6adc8",
                        }}
                    >
                        {seriesData.seriesDescription || "No description"}
                        {" - "}
                        {seriesData.modality || "Unknown modality"}
                        {" - "}
                        {isVolume ? "Multi-planar view" : "Stack view"}
                    </p>
                </div>
                {onClose && (
                    <button onClick={onClose} style={btnStyle}>
                        Close
                    </button>
                )}
            </div>

            {notice && <p style={noticeStyle}>{notice}</p>}

            <div style={toolbarStyle}>
                <div style={toolbarGroupStyle}>
                    {PRIMARY_TOOLS.filter(
                        (tool) => isVolume || !tool.volumeOnly,
                    ).map((tool) => (
                        <button
                            key={tool.name}
                            onClick={() => selectTool(tool.name)}
                            style={
                                activeTool === tool.name
                                    ? activeBtnStyle
                                    : btnStyle
                            }
                        >
                            {tool.label}
                        </button>
                    ))}
                </div>

                {isVolume && (
                    <div style={toolbarGroupStyle}>
                        {[{ id: "all", label: "All" }, ...viewports].map(
                            (option) => (
                                <button
                                    key={option.id}
                                    onClick={() => setLayout(option.id)}
                                    style={
                                        visibleLayout === option.id
                                            ? activeBtnStyle
                                            : btnStyle
                                    }
                                >
                                    {option.label}
                                </button>
                            ),
                        )}
                    </div>
                )}

                <div style={toolbarGroupStyle}>
                    {isVolume && (
                        <label style={toggleStyle}>
                            <input
                                type="checkbox"
                                checked={showCrosshairs}
                                onChange={(e) =>
                                    toggleCrosshairs(e.target.checked)
                                }
                            />
                            Reference lines
                        </label>
                    )}
                    {isVolume && (
                        <label style={toggleStyle}>
                            <input
                                type="checkbox"
                                checked={linkWindowing}
                                onChange={(e) =>
                                    setLinkWindowing(e.target.checked)
                                }
                            />
                            Link windowing
                        </label>
                    )}
                    <button onClick={resetView} style={btnStyle}>
                        Reset
                    </button>
                </div>
            </div>

            <div
                ref={gridRef}
                style={{
                    ...gridStyle,
                    gridTemplateColumns:
                        visibleLayout === "all"
                            ? `repeat(${viewports.length}, minmax(0, 1fr))`
                            : "minmax(0, 1fr)",
                }}
            >
                {viewports.map((vp) => {
                    const info = viewportInfo[vp.id] || {};
                    const count = info.count || 0;
                    const hidden =
                        visibleLayout !== "all" && visibleLayout !== vp.id;
                    const slab = { ...DEFAULT_SLAB, ...slabSettings[vp.id] };
                    const projection = PROJECTIONS.find(
                        (p) => p.id === slab.projection,
                    );
                    const settingsOpen = Boolean(openSettings[vp.id]);

                    return (
                        <div
                            key={vp.id}
                            data-panel={vp.id}
                            style={{
                                ...(hidden ? hiddenPanelStyle : panelStyle),
                                ...(vp.color
                                    ? { borderTop: `3px solid ${vp.color}` }
                                    : {}),
                            }}
                            onDoubleClick={() => {
                                if (!isVolume) return;
                                setLayout(
                                    visibleLayout === "all" ? vp.id : "all",
                                );
                            }}
                        >
                            <div style={viewportWrapperStyle}>
                                <div
                                    ref={(el) => {
                                        elementRefs.current[vp.id] = el;
                                    }}
                                    data-viewport={vp.id}
                                    style={viewportStyle}
                                />
                                <div
                                    style={{
                                        ...overlayStyle,
                                        top: 6,
                                        left: 8,
                                        ...(vp.color
                                            ? { color: vp.color }
                                            : {}),
                                    }}
                                >
                                    {vp.label}
                                </div>
                                <div
                                    style={{ ...overlayStyle, top: 6, right: 8 }}
                                >
                                    {slab.projection !== "none" &&
                                        `${projection.short} ${slab.thickness} mm`}
                                </div>
                                <div
                                    style={{
                                        ...overlayStyle,
                                        bottom: 6,
                                        left: 8,
                                    }}
                                >
                                    {count > 0 &&
                                        `Slice ${(info.index ?? 0) + 1} / ${count}`}
                                </div>
                                <div
                                    style={{
                                        ...overlayStyle,
                                        bottom: 6,
                                        right: 8,
                                    }}
                                >
                                    {info.windowWidth !== undefined &&
                                        `W ${Math.round(info.windowWidth)} / L ${Math.round(info.windowCenter)}`}
                                </div>
                            </div>
                            <div style={sliderRowStyle}>
                                <button
                                    onClick={() =>
                                        showSlice(vp.id, (info.index ?? 0) - 1)
                                    }
                                    style={smallBtnStyle}
                                    disabled={(info.index ?? 0) <= 0}
                                    aria-label={`Previous ${vp.label} slice`}
                                >
                                    ‹
                                </button>
                                <input
                                    type="range"
                                    min="0"
                                    max={Math.max(0, count - 1)}
                                    value={info.index ?? 0}
                                    onChange={(e) =>
                                        showSlice(
                                            vp.id,
                                            parseInt(e.target.value),
                                        )
                                    }
                                    disabled={count <= 1}
                                    style={{ flex: 1, minWidth: 0 }}
                                    aria-label={`${vp.label} slice`}
                                />
                                <button
                                    onClick={() =>
                                        showSlice(vp.id, (info.index ?? 0) + 1)
                                    }
                                    style={smallBtnStyle}
                                    disabled={(info.index ?? 0) >= count - 1}
                                    aria-label={`Next ${vp.label} slice`}
                                >
                                    ›
                                </button>
                                <button
                                    onClick={() =>
                                        setOpenSettings((prev) => ({
                                            ...prev,
                                            [vp.id]: !prev[vp.id],
                                        }))
                                    }
                                    style={
                                        settingsOpen
                                            ? smallActiveBtnStyle
                                            : smallBtnStyle
                                    }
                                    aria-expanded={settingsOpen}
                                >
                                    Settings
                                </button>
                            </div>
                            {settingsOpen && (
                                <div
                                    style={settingsStyle}
                                    onDoubleClick={(e) => e.stopPropagation()}
                                >
                                    {isVolume && (
                                        <div style={settingsRowStyle}>
                                            <label style={fieldStyle}>
                                                Projection
                                                <select
                                                    value={slab.projection}
                                                    onChange={(e) =>
                                                        applySlab(vp.id, {
                                                            projection:
                                                                e.target.value,
                                                        })
                                                    }
                                                    style={fieldInputStyle}
                                                >
                                                    {PROJECTIONS.map((p) => (
                                                        <option
                                                            key={p.id}
                                                            value={p.id}
                                                        >
                                                            {p.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label
                                                style={{
                                                    ...fieldStyle,
                                                    flex: 1,
                                                    minWidth: 120,
                                                }}
                                            >
                                                Thickness
                                                <input
                                                    type="range"
                                                    min="1"
                                                    max={MAX_SLAB_THICKNESS}
                                                    step="1"
                                                    value={slab.thickness}
                                                    disabled={
                                                        slab.projection ===
                                                        "none"
                                                    }
                                                    onChange={(e) =>
                                                        applySlab(vp.id, {
                                                            thickness: Number(
                                                                e.target.value,
                                                            ),
                                                        })
                                                    }
                                                    style={{
                                                        flex: 1,
                                                        minWidth: 0,
                                                    }}
                                                />
                                                <span style={{ minWidth: 52 }}>
                                                    {slab.projection === "none"
                                                        ? "—"
                                                        : `${slab.thickness} mm`}
                                                </span>
                                            </label>
                                        </div>
                                    )}
                                    <div style={settingsRowStyle}>
                                        {isCT && (
                                            <label style={fieldStyle}>
                                                Window
                                                <select
                                                    value=""
                                                    onChange={(e) => {
                                                        const preset =
                                                            CT_PRESETS[
                                                                e.target.value
                                                            ];
                                                        if (preset) {
                                                            applyWindow(
                                                                vp.id,
                                                                preset.width,
                                                                preset.center,
                                                            );
                                                        }
                                                    }}
                                                    style={fieldInputStyle}
                                                >
                                                    <option value="">
                                                        Preset…
                                                    </option>
                                                    {CT_PRESETS.map(
                                                        (preset, i) => (
                                                            <option
                                                                key={
                                                                    preset.label
                                                                }
                                                                value={i}
                                                            >
                                                                {preset.label}
                                                            </option>
                                                        ),
                                                    )}
                                                </select>
                                            </label>
                                        )}
                                        <label style={fieldStyle}>
                                            W
                                            <NumberField
                                                label={`${vp.label} window width`}
                                                value={info.windowWidth}
                                                min={1}
                                                onCommit={(width) =>
                                                    applyWindow(
                                                        vp.id,
                                                        width,
                                                        info.windowCenter,
                                                    )
                                                }
                                            />
                                        </label>
                                        <label style={fieldStyle}>
                                            L
                                            <NumberField
                                                label={`${vp.label} window level`}
                                                value={info.windowCenter}
                                                onCommit={(center) =>
                                                    applyWindow(
                                                        vp.id,
                                                        info.windowWidth,
                                                        center,
                                                    )
                                                }
                                            />
                                        </label>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {loadProgress && (
                    <div style={progressOverlayStyle}>
                        Loading slices {loadProgress.loaded} /{" "}
                        {loadProgress.total}
                    </div>
                )}
            </div>

            <p style={hintStyle}>
                Left drag: selected tool · Wheel: scroll slices · Middle drag:
                pan · Right drag: zoom
                {isVolume &&
                    " · Double-click a view to enlarge it · Drag a reference line to move that plane, or its end handles to rotate it · A plane with a slab shows its thickness as two outer lines, which can be dragged by their handles"}
            </p>

            <div style={infoStyle}>
                <MetadataSection
                    title="Patient"
                    rows={[
                        ["Name", study.patientName],
                        ["ID", study.patientID],
                        ["Birth date", formatDate(study.patientBirthDate)],
                        ["Sex", study.patientSex],
                        ["Anonymized", study.isAnonymized ? "Yes" : "No"],
                    ]}
                />
                <MetadataSection
                    title="Study"
                    rows={[
                        ["Description", study.studyDescription],
                        ["Date", formatDate(study.studyDate)],
                        ["Accession", study.accessionNumber],
                        ["Institution", study.institutionName],
                    ]}
                />
                <MetadataSection
                    title="Series"
                    rows={[
                        ["Number", seriesData.seriesNumber],
                        ["Body part", seriesData.bodyPartExamined],
                        ["Protocol", seriesData.protocolName],
                        ["Images", seriesData.instances.length],
                        [
                            "Slice thickness",
                            seriesData.sliceThickness
                                ? `${Number(seriesData.sliceThickness).toFixed(3)} mm`
                                : "",
                        ],
                        [
                            "Slice spacing",
                            seriesData.sliceSpacing
                                ? `${Number(seriesData.sliceSpacing).toFixed(3)} mm`
                                : "",
                        ],
                    ]}
                />
                <MetadataSection
                    title={isVolume ? "Image (first slice)" : "Image"}
                    rows={[
                        ["Instance", currentInstance?.instanceNumber],
                        [
                            "Size",
                            meta.rows
                                ? `${meta.columns} × ${meta.rows} px`
                                : "",
                        ],
                        [
                            "Pixel spacing",
                            meta.pixelSpacing?.length
                                ? `${formatNumbers(meta.pixelSpacing)} mm`
                                : "",
                        ],
                        [
                            "Bits",
                            meta.bitsAllocated
                                ? `${meta.bitsStored} stored / ${meta.bitsAllocated} allocated`
                                : "",
                        ],
                        ["Photometric", meta.photometricInterpretation],
                        ["kVp", meta.kvp],
                        ["Kernel", meta.convolutionKernel],
                        [
                            "Position",
                            formatNumbers(currentInstance?.imagePosition, 1),
                        ],
                    ]}
                />
            </div>
        </div>
    );
}

// Number input that only applies its value on Enter or when leaving the field,
// so half-typed numbers are never sent to the viewport
function NumberField({ label, value, min, onCommit }) {
    const [draft, setDraft] = useState(null);

    const commit = () => {
        if (draft === null) return;
        const number = parseFloat(draft);
        setDraft(null);
        if (Number.isNaN(number)) return;
        if (min !== undefined && number < min) return;
        onCommit(number);
    };

    return (
        <input
            type="number"
            aria-label={label}
            value={draft ?? (value === undefined ? "" : Math.round(value))}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === "Enter") commit();
            }}
            style={{ ...fieldInputStyle, width: 72 }}
        />
    );
}

function MetadataSection({ title, rows }) {
    const visibleRows = rows.filter(
        ([, value]) => value !== undefined && value !== null && value !== "",
    );

    return (
        <div style={{ minWidth: 0 }}>
            <h3 style={sectionTitleStyle}>{title}</h3>
            {visibleRows.length === 0 && (
                <p style={{ margin: 0, color: "#6c7086" }}>No data</p>
            )}
            {visibleRows.map(([label, value]) => (
                <p key={label} style={metadataRowStyle}>
                    <span style={{ color: "#a6adc8" }}>{label}:</span>{" "}
                    {String(value)}
                </p>
            ))}
        </div>
    );
}

const containerStyle = {
    fontFamily: "monospace",
    maxWidth: 1400,
    margin: "2rem auto",
    padding: "1rem",
    background: "#1e1e2e",
    borderRadius: 8,
    color: "#cdd6f4",
};

const headerStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "1rem",
    paddingBottom: "1rem",
    borderBottom: "1px solid #45475a",
};

const noticeStyle = {
    margin: "0 0 1rem",
    padding: "0.5rem 0.75rem",
    background: "#45475a",
    borderRadius: 4,
    color: "#f9e2af",
};

const toolbarStyle = {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "0.75rem",
    marginBottom: "0.75rem",
};

const toolbarGroupStyle = {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.4rem",
};

const toggleStyle = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: "0.9em",
};

const gridStyle = {
    position: "relative",
    display: "grid",
    gap: "0.5rem",
    height: "600px",
    marginBottom: "0.5rem",
};

const panelStyle = {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    background: "#000",
    borderRadius: 4,
    overflow: "hidden",
};

// Kept at a real size (but out of sight) so its canvas stays valid
const hiddenPanelStyle = {
    ...panelStyle,
    position: "absolute",
    top: 0,
    left: 0,
    width: 200,
    height: 200,
    visibility: "hidden",
    pointerEvents: "none",
};

const viewportWrapperStyle = {
    position: "relative",
    flex: 1,
    minHeight: 0,
};

const viewportStyle = {
    position: "absolute",
    inset: 0,
};

const overlayStyle = {
    position: "absolute",
    pointerEvents: "none",
    color: "#f9e2af",
    fontSize: "0.85em",
    textShadow: "0 0 3px #000",
};

const sliderRowStyle = {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.3rem 0.5rem",
    background: "#181825",
};

const progressOverlayStyle = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.7)",
    borderRadius: 4,
    fontSize: "1.1em",
};

const hintStyle = {
    margin: "0 0 1rem",
    fontSize: "0.8em",
    color: "#a6adc8",
};

const infoStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "1.5rem",
    padding: "1rem",
    background: "#181825",
    borderRadius: 4,
    fontSize: "0.9em",
};

const sectionTitleStyle = {
    margin: "0 0 0.5rem",
    fontSize: "1em",
    color: "#89b4fa",
};

const metadataRowStyle = {
    margin: "2px 0",
    overflowWrap: "anywhere",
};

const btnStyle = {
    padding: "6px 14px",
    cursor: "pointer",
    border: "1px solid #555",
    borderRadius: 4,
    background: "#313244",
    color: "#cdd6f4",
    transition: "all 0.2s",
};

const activeBtnStyle = {
    ...btnStyle,
    border: "1px solid #89b4fa",
    background: "#89b4fa",
    color: "#1e1e2e",
    fontWeight: "bold",
};

const smallBtnStyle = {
    ...btnStyle,
    padding: "2px 10px",
};

const smallActiveBtnStyle = {
    ...activeBtnStyle,
    padding: "2px 10px",
};

const settingsStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    padding: "0.5rem",
    background: "#181825",
    borderTop: "1px solid #313244",
    fontSize: "0.85em",
};

const settingsRowStyle = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.75rem",
};

const fieldStyle = {
    display: "flex",
    alignItems: "center",
    gap: 6,
};

const fieldInputStyle = {
    padding: "2px 6px",
    border: "1px solid #555",
    borderRadius: 4,
    background: "#313244",
    color: "#cdd6f4",
    fontFamily: "inherit",
    fontSize: "inherit",
};
