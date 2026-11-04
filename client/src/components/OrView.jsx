import { useState, useEffect, useRef, useCallback } from "react";
import {
    RenderingEngine,
    Enums,
    cache,
    metaData,
    volumeLoader,
    utilities as csUtils,
    getShouldUseCPURendering,
} from "@cornerstonejs/core";
import { wadouri } from "@cornerstonejs/dicom-image-loader";
import {
    ToolGroupManager,
    WindowLevelTool,
    PanTool,
    ZoomTool,
    StackScrollTool,
} from "@cornerstonejs/tools";
import { pb } from "@/lib/pb";
import ViewportSettings, { Volume3DSettings } from "./ViewportSettings";
import {
    DEFAULT_SLAB,
    slabLabel,
    applySlabToViewport,
    applyWindowToViewport,
} from "@/lib/viewport-settings";
import {
    initializeCornerstone,
    instanceImageId,
    applyToolBindings,
    loadImages,
    MPR_UNAVAILABLE_MESSAGE,
    VIEWER_TOOLS,
} from "@/lib/cornerstone";
import {
    applyVolumePreset,
    createVolume3DToolGroup,
    opacityShiftRange,
    setVolume3DCropping,
    setVolumeCut,
    showVolume3D,
    syncPlaneOutlines,
    tagVolumeSeries,
    volume3DLabel,
    volume3DPresetsFor,
} from "@/lib/volume3d";
import { fetchPatients, patientLabel } from "@/lib/patients";
import PatientPicker from "./PatientPicker";

const STORAGE_KEY = "or-view-layout";
const MAX_GRID = 4;
// PocketBase cancels an in-flight request when an identical one is sent, but
// several cells can legitimately ask for the same thing at once
const NO_AUTO_CANCEL = { requestKey: null };

// What a cell can show: the series slice by slice, one plane of its volume,
// or the whole volume rendered in 3D
const VOLUME_3D_VIEW = "volume3d";
const VIEWS = [
    { id: "stack", label: "Stack" },
    {
        id: "axial",
        label: "MPR Axial",
        orientation: Enums.OrientationAxis.AXIAL,
    },
    {
        id: "sagittal",
        label: "MPR Sagittal",
        orientation: Enums.OrientationAxis.SAGITTAL,
    },
    {
        id: "coronal",
        label: "MPR Coronal",
        orientation: Enums.OrientationAxis.CORONAL,
    },
    { id: VOLUME_3D_VIEW, label: "3D Volume", is3D: true },
];

// Whether a cell's view is one of the MPR planes, whose section can be
// moved and turned from its line in the other cells
function isPlaneView(view) {
    return view !== "stack" && view !== VOLUME_3D_VIEW;
}

const TOOLS = [
    { name: WindowLevelTool.toolName, label: "Window/Level" },
    { name: PanTool.toolName, label: "Pan" },
    { name: ZoomTool.toolName, label: "Zoom" },
    { name: StackScrollTool.toolName, label: "Scroll" },
];

// Colours handed out to cells for their section line and title. Each stays
// readable over a greyscale image and is distinct from the others.
const CELL_COLORS = [
    "#f05a5a",
    "#f0c83c",
    "#5ac86e",
    "#78c8ff",
    "#ff8c42",
    "#c792ea",
    "#4dd0e1",
    "#f48fb1",
    "#ffffff",
    "#ffd54f",
    "#9fa8da",
    "#80cbc4",
    "#ff7043",
    "#ba68c8",
    "#a1887f",
    "#90caf9",
];
const MAX_NAME_LENGTH = 24;

// A random colour that no other cell is using
function pickCellColor(cells) {
    const used = new Set(cells.map((cell) => cell?.color).filter(Boolean));
    const free = CELL_COLORS.filter((color) => !used.has(color));
    const pool = free.length ? free : CELL_COLORS;
    return pool[Math.floor(Math.random() * pool.length)];
}

// What a cell is called on its own title and on its section lines
function cellName(content, index) {
    return content?.name?.trim() || String(index + 1);
}
// Half length (mm) of a reference line before it is clipped to the cell
const REFERENCE_LINE_REACH = 5000;
// How far a line's rotation handles sit from its middle, as a share of the
// cell's smaller side
const HANDLE_OFFSET = 0.3;

let orViewInstanceCount = 0;

// Each patient's OR layout is remembered separately
function storageKeyFor(patientId) {
    return `${STORAGE_KEY}:${patientId}`;
}

function loadLayout(patientId) {
    try {
        const saved = JSON.parse(
            localStorage.getItem(storageKeyFor(patientId)),
        );
        const rows = Math.min(MAX_GRID, Math.max(1, saved.rows | 0));
        const cols = Math.min(MAX_GRID, Math.max(1, saved.cols | 0));
        const cells = Array.from(
            { length: rows * cols },
            (_, i) => saved.cells?.[i] || null,
        );
        // Layouts saved before cells had colours get them now
        cells.forEach((cell, i) => {
            if (cell && !cell.color) {
                cells[i] = { ...cell, color: pickCellColor(cells) };
            }
        });
        return { rows, cols, cells };
    } catch {
        return { rows: 1, cols: 2, cells: [null, null] };
    }
}

function toolGroupIdFor(engine) {
    return `${engine.id}-tools`;
}

// The tool group of the 3D cell at `index`
function toolGroup3DIdFor(engine, index) {
    return `${engine.id}-3d-${index}`;
}

function viewportIdForCell(index) {
    return `or-cell-${index}`;
}

const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b, scale = 1) => a.map((v, i) => v + b[i] * scale);

// Rotates a vector about a unit axis (Rodrigues' formula)
function rotateAbout(vector, axis, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const axisCross = cross(axis, vector);
    const axisDot = dot(axis, vector);
    return vector.map(
        (v, i) =>
            v * cos + axisCross[i] * sin + axis[i] * axisDot * (1 - cos),
    );
}

// Where the source viewport's image plane cuts through the target viewport:
// the world-space line (a point centred in the target's view and a unit
// direction) and the same line in the target's canvas coordinates.
// Null when the two planes are parallel. Given a thickness (mm), also the
// lines where the faces of the source's slice meet the target, either side.
// The line's middle is the nearest point on it to `centreOn` when given.
function referenceLineGeometry(
    sourceCamera,
    targetViewport,
    thickness = 0,
    centreOn = null,
) {
    const targetCamera = targetViewport.getCamera();
    const n1 = sourceCamera.viewPlaneNormal;
    const n2 = targetCamera.viewPlaneNormal;

    const rawDirection = cross(n1, n2);
    const lengthSquared = dot(rawDirection, rawDirection);
    if (lengthSquared < 1e-6) return null;
    const direction = rawDirection.map((v) => v / Math.sqrt(lengthSquared));

    // A point lying on both planes
    const d1 = dot(n1, sourceCamera.focalPoint);
    const d2 = dot(n2, targetCamera.focalPoint);
    const a = cross(n2, rawDirection);
    const b = cross(rawDirection, n1);
    const anyPoint = [0, 1, 2].map(
        (i) => (d1 * a[i] + d2 * b[i]) / lengthSquared,
    );

    // Slide it along the line to the middle of what the target is showing
    const { clientWidth, clientHeight } = targetViewport.element;
    const viewCentre = targetViewport.canvasToWorld([
        clientWidth / 2,
        clientHeight / 2,
    ]);
    const nearest = add(
        anyPoint,
        direction,
        dot(add(viewCentre, anyPoint, -1), direction),
    );

    const [x1, y1] = targetViewport.worldToCanvas(
        add(nearest, direction, -REFERENCE_LINE_REACH),
    );
    const [x2, y2] = targetViewport.worldToCanvas(
        add(nearest, direction, REFERENCE_LINE_REACH),
    );
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;

    // The part of the line inside the cell, as `u` from -1 at (x1, y1) to
    // 1 at (x2, y2)
    let low = -1;
    let high = 1;
    [
        [(x2 - x1) / 2, (x1 + x2) / 2, clientWidth],
        [(y2 - y1) / 2, (y1 + y2) / 2, clientHeight],
    ].forEach(([step, start, size]) => {
        if (Math.abs(step) < 1e-9) return;
        const a = (0 - start) / step;
        const b = (size - start) / step;
        low = Math.max(low, Math.min(a, b));
        high = Math.min(high, Math.max(a, b));
    });

    // The line's middle is the place on it nearest `centreOn` while that is
    // inside the cell, otherwise the middle of the part inside the cell
    let middle = low < high ? (low + high) / 2 : 0;
    if (centreOn) {
        const u =
            dot(add(centreOn, nearest, -1), direction) / REFERENCE_LINE_REACH;
        if (u >= low && u <= high) middle = u;
    }
    const point = add(nearest, direction, middle * REFERENCE_LINE_REACH);
    const [cx, cy] = targetViewport.worldToCanvas(point);
    if (![cx, cy].every(Number.isFinite)) return null;

    // Rotation handles sit either side of the middle of the line
    const length = Math.hypot(x2 - x1, y2 - y1) || 1;
    const reach = Math.min(clientWidth, clientHeight) * HANDLE_OFFSET;
    const ux = ((x2 - x1) / length) * reach;
    const uy = ((y2 - y1) / length) * reach;

    // A face sits half the thickness along the source's normal. Within the
    // target's plane that is a step along the part of the source normal
    // lying in it, scaled so the step covers the full offset.
    let faces = null;
    if (thickness > 0) {
        const inPlane = add(n1, n2, -dot(n1, n2));
        faces = [-1, 1]
            .map((side) => {
                const shift = add(
                    point,
                    inPlane,
                    (side * thickness) / 2 / lengthSquared,
                );
                const [fx1, fy1] = targetViewport.worldToCanvas(
                    add(shift, direction, -REFERENCE_LINE_REACH),
                );
                const [fx2, fy2] = targetViewport.worldToCanvas(
                    add(shift, direction, REFERENCE_LINE_REACH),
                );
                return { x1: fx1, y1: fy1, x2: fx2, y2: fy2 };
            })
            .filter((face) => Object.values(face).every(Number.isFinite));
    }

    return {
        point,
        direction,
        canvas: { x1, y1, x2, y2 },
        faces,
        centre: [cx, cy],
        handles: [
            [cx - ux, cy - uy],
            [cx + ux, cy + uy],
        ],
    };
}

// A cell's stored line centre, brought onto its plane as it is now (the
// plane may have moved along its normal since the centre was set)
function lineCentreOn(centre, camera) {
    if (!centre) return null;
    const { viewPlaneNormal, focalPoint } = camera;
    return add(
        centre,
        viewPlaneNormal,
        -dot(add(centre, focalPoint, -1), viewPlaneNormal),
    );
}

// The OR view works on one patient at a time, so it starts by asking which
export default function OrView({ patientId, onChoosePatient, onClose }) {
    if (!patientId) {
        return <OrPatientChooser onChoose={onChoosePatient} onClose={onClose} />;
    }
    return (
        <OrPatientView
            patientId={patientId}
            onChangePatient={() => onChoosePatient(null)}
            onClose={onClose}
        />
    );
}

function OrPatientChooser({ onChoose, onClose }) {
    const [patients, setPatients] = useState(null);
    const [error, setError] = useState("");

    useEffect(() => {
        let isCancelled = false;
        fetchPatients(NO_AUTO_CANCEL)
            .then((data) => {
                if (!isCancelled) setPatients(data);
            })
            .catch((err) => {
                if (!isCancelled) {
                    setError(err.message || "Failed to fetch patients");
                }
            });
        return () => {
            isCancelled = true;
        };
    }, []);

    return (
        <div style={pageStyle}>
            <div style={toolbarStyle}>
                <div style={toolbarGroupStyle}>
                    {onClose && (
                        <button onClick={onClose} style={btnStyle}>
                            ← Back
                        </button>
                    )}
                    <strong style={{ alignSelf: "center" }}>OR View</strong>
                </div>
            </div>
            <div style={chooserStyle}>
                <h2 style={{ margin: 0 }}>Which patient?</h2>
                <p style={{ margin: 0, color: "#a6adc8" }}>
                    The OR view shows one patient&apos;s studies at a time.
                </p>
                <PatientPicker
                    patients={patients}
                    onSelect={(patient) => patient && onChoose(patient.id)}
                    allowCreate={false}
                />
                {patients?.length === 0 && (
                    <p style={{ margin: 0, color: "#a6adc8" }}>
                        Create a patient and upload their studies first.
                    </p>
                )}
                {error && <p style={{ color: "red", margin: 0 }}>{error}</p>}
            </div>
        </div>
    );
}

function OrPatientView({ patientId, onChangePatient, onClose }) {
    const [initialized, setInitialized] = useState(false);
    const [error, setError] = useState("");
    const [layout, setLayout] = useState(() => loadLayout(patientId));
    const [engine, setEngine] = useState(null);
    const [patient, setPatient] = useState(null);
    const [studies, setStudies] = useState(null);
    const [studySeries, setStudySeries] = useState({});
    const [readyCells, setReadyCells] = useState({});
    const [activeCell, setActiveCell] = useState(0);
    const [activeTool, setActiveTool] = useState(WindowLevelTool.toolName);
    const [showReferenceLines, setShowReferenceLines] = useState(true);
    const [showSliceThickness, setShowSliceThickness] = useState(true);
    const [referenceLines, setReferenceLines] = useState({});
    const [cellSlabs, setCellSlabs] = useState({});
    // Per MPR cell, the world point its section lines are centred on and
    // turn about, once one has been set by dragging or turning a line
    const [lineCentres, setLineCentres] = useState({});

    const seriesPromisesRef = useRef(new Map());
    const volumePromisesRef = useRef(new Map());
    const toolGroupRef = useRef(null);
    const activeToolRef = useRef(activeTool);

    const { rows, cols, cells } = layout;

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

    // One rendering engine shared by every cell
    useEffect(() => {
        if (!initialized) return;

        const renderingEngine = new RenderingEngine(
            `orViewEngine-${++orViewInstanceCount}`,
        );
        const seriesPromises = seriesPromisesRef.current;
        const volumePromises = volumePromisesRef.current;
        setEngine(renderingEngine);

        return () => {
            setEngine(null);
            setReadyCells({});
            // Tools must go before the engine they render through
            ToolGroupManager.destroyToolGroup(toolGroupIdFor(renderingEngine));
            toolGroupRef.current = null;
            renderingEngine.destroy();
            seriesPromises.clear();
            volumePromises.clear();
            // Free the decoded slices and the raw DICOM files behind them
            cache.purgeCache();
            wadouri.dataSetCacheManager.purge();
        };
    }, [initialized]);

    // The patient, and their studies offered in each cell's picker
    useEffect(() => {
        let isCancelled = false;

        pb.send(
            `/api/visualizer/patients/${encodeURIComponent(patientId)}`,
            NO_AUTO_CANCEL,
        )
            .then((data) => {
                if (isCancelled) return;
                setPatient(data);
                setStudies(data.studies || []);
                // A remembered cell whose study is no longer this patient's
                // is emptied
                const own = new Set((data.studies || []).map((s) => s.id));
                setLayout((prev) =>
                    prev.cells.every((cell) => !cell || own.has(cell.studyId))
                        ? prev
                        : {
                              ...prev,
                              cells: prev.cells.map((cell) =>
                                  cell && own.has(cell.studyId) ? cell : null,
                              ),
                          },
                );
            })
            .catch((err) => {
                console.error("Failed to fetch patient:", err);
                if (!isCancelled) {
                    setError(
                        err.status === 404
                            ? "This patient no longer exists"
                            : err.message || "Failed to fetch patient",
                    );
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [patientId]);

    // Only this patient's studies may be shown, so nothing is loaded into
    // the cells until it is known which studies those are
    const ownStudyIds = studies && new Set(studies.map((study) => study.id));

    // The MPR cells a 3D cell can be cut along: those in its study's
    // coordinates
    const cutOptionsFor = (index) => {
        const target = readyCells[index];
        if (target?.view !== VOLUME_3D_VIEW) return [];
        return Object.entries(readyCells)
            .filter(
                ([, source]) =>
                    isPlaneView(source.view) &&
                    source.frameOfReferenceUID === target.frameOfReferenceUID,
            )
            .map(([sourceIndex, source]) => ({
                id: sourceIndex,
                label: `${cellName(cells[sourceIndex], Number(sourceIndex))} · ${
                    VIEWS.find((v) => v.id === source.view)?.label
                }`,
            }));
    };

    // Remember the grid between visits
    useEffect(() => {
        try {
            localStorage.setItem(
                storageKeyFor(patientId),
                JSON.stringify(layout),
            );
        } catch {
            // Storage unavailable: the layout just won't be remembered
        }
    }, [layout, patientId]);

    const loadStudySeries = useCallback(
        async (studyId) => {
            if (studySeries[studyId]) return;
            try {
                const data = await pb.send(
                    `/api/visualizer/dicom/studies/${studyId}`,
                    NO_AUTO_CANCEL,
                );
                setStudySeries((prev) => ({
                    ...prev,
                    [studyId]: data.series || [],
                }));
            } catch (err) {
                console.error("Failed to fetch study:", err);
            }
        },
        [studySeries],
    );

    // Series details (with image IDs), fetched once per series
    const getSeries = useCallback((seriesId) => {
        const promises = seriesPromisesRef.current;
        if (!promises.has(seriesId)) {
            const promise = pb
                .send(`/api/visualizer/dicom/series/${seriesId}`, {
                    method: "GET",
                    ...NO_AUTO_CANCEL,
                })
                .then((data) => {
                    const instances = [...(data.instances || [])].sort(
                        (a, b) =>
                            (a.instanceNumber || 0) - (b.instanceNumber || 0),
                    );
                    return {
                        ...data,
                        instances,
                        imageIds: instances.map((i) => instanceImageId(i.id)),
                    };
                })
                .catch((err) => {
                    promises.delete(seriesId);
                    throw err;
                });
            promises.set(seriesId, promise);
        }
        return promises.get(seriesId);
    }, []);

    // The volume for a series, built once and shared by all its MPR cells
    const getVolume = useCallback((seriesId, imageIds, onProgress) => {
        const promises = volumePromisesRef.current;
        if (!promises.has(seriesId)) {
            const promise = (async () => {
                await loadImages(imageIds, onProgress, () => false);
                const volumeId = `cornerstoneStreamingImageVolume:or-${seriesId}`;
                const volume = await volumeLoader.createAndCacheVolume(
                    volumeId,
                    { imageIds },
                );
                tagVolumeSeries(volumeId, seriesId);
                volume.load();
                return volumeId;
            })().catch((err) => {
                promises.delete(seriesId);
                throw err;
            });
            promises.set(seriesId, promise);
        }
        return promises.get(seriesId);
    }, []);

    const handleCellReady = useCallback((index, info) => {
        setReadyCells((prev) => {
            const next = { ...prev };
            if (info) {
                next[index] = info;
            } else {
                delete next[index];
            }
            return next;
        });
    }, []);

    const setCellSlab = useCallback((index, slab) => {
        setCellSlabs((prev) => ({ ...prev, [index]: slab }));
    }, []);

    const setCellContent = (index, content) => {
        // New content starts as a plain single slice
        setCellSlabs((prev) => ({ ...prev, [index]: undefined }));
        setLineCentres((prev) => ({ ...prev, [index]: undefined }));
        setLayout((prev) => {
            const previous = prev.cells[index];
            // A cell keeps its name and colour when its series is changed,
            // and gets a fresh unused colour when it is first filled
            const next = content && {
                ...content,
                name: previous?.name,
                color: previous?.color || pickCellColor(prev.cells),
            };
            return {
                ...prev,
                cells: prev.cells.map((cell, i) => (i === index ? next : cell)),
            };
        });
    };

    // Changes a cell's name or line colour without reloading its series
    const updateCell = useCallback((index, patch) => {
        setLayout((prev) => ({
            ...prev,
            cells: prev.cells.map((cell, i) =>
                i === index && cell ? { ...cell, ...patch } : cell,
            ),
        }));
    }, []);

    const resizeGrid = (nextRows, nextCols) => {
        setLayout((prev) => ({
            rows: nextRows,
            cols: nextCols,
            cells: Array.from(
                { length: nextRows * nextCols },
                (_, i) => prev.cells[i] || null,
            ),
        }));
        setActiveCell((prev) => Math.min(prev, nextRows * nextCols - 1));
    };

    // One set of mouse tools shared by every loaded slice cell. Each 3D cell
    // has a group of its own (made by the cell), since the crop box tool
    // only works on the first viewport of its group.
    useEffect(() => {
        if (!engine) return;

        const sliceInfos = Object.values(readyCells).filter(
            (info) => info.view !== VOLUME_3D_VIEW,
        );
        if (!sliceInfos.length) return;

        const id = toolGroupIdFor(engine);
        const toolGroup = ToolGroupManager.createToolGroup(id);
        VIEWER_TOOLS.forEach(({ toolName }) => toolGroup.addTool(toolName));
        sliceInfos.forEach((info) =>
            toolGroup.addViewport(info.viewportId, engine.id),
        );
        toolGroupRef.current = toolGroup;
        applyToolBindings(toolGroup, activeToolRef.current);

        return () => {
            toolGroupRef.current = null;
            ToolGroupManager.destroyToolGroup(id);
        };
    }, [engine, readyCells]);

    // Switch the tool on the left mouse button
    useEffect(() => {
        activeToolRef.current = activeTool;
        if (toolGroupRef.current) {
            applyToolBindings(toolGroupRef.current, activeTool);
        }
    }, [activeTool]);

    // Section lines: where one cell's image plane cuts through the others.
    // Drawn in every other cell that shares its frame of reference (i.e. the
    // same study's coordinates). Every MPR cell's plane is always shown and
    // is its own independent section, movable and turnable from its line;
    // a stack cell's plane is shown only while that cell is active.
    useEffect(() => {
        if (!engine) return;

        const compute = () => {
            const lines = {};

            if (showReferenceLines) {
                const sections = Object.keys(readyCells)
                    .map(Number)
                    .filter((index) => isPlaneView(readyCells[index].view));
                const sources = [...new Set([activeCell, ...sections])];

                sources.forEach((sourceIndex) => {
                    const source = readyCells[sourceIndex];
                    if (!source?.frameOfReferenceUID) return;
                    // A rendered volume has no plane to draw
                    if (source.view === VOLUME_3D_VIEW) return;
                    const sourceCamera = engine
                        .getViewport(source.viewportId)
                        ?.getCamera();
                    if (!sourceCamera) return;

                    // A slab's thickness when the cell has one, otherwise
                    // the thickness its slices were acquired at
                    const slab = cellSlabs[sourceIndex];
                    const thickness = !showSliceThickness
                        ? 0
                        : isPlaneView(source.view) &&
                            slab &&
                            slab.projection !== "none"
                          ? slab.thickness
                          : Number(source.sliceThickness) || 0;

                    Object.entries(readyCells).forEach(([index, target]) => {
                        if (Number(index) === sourceIndex) return;
                        // Flat lines don't belong over a turnable 3D view
                        if (target.view === VOLUME_3D_VIEW) return;
                        if (
                            target.frameOfReferenceUID !==
                            source.frameOfReferenceUID
                        ) {
                            return;
                        }
                        const viewport = engine.getViewport(target.viewportId);
                        if (!viewport) return;

                        const line = referenceLineGeometry(
                            sourceCamera,
                            viewport,
                            thickness,
                            lineCentreOn(lineCentres[sourceIndex], sourceCamera),
                        );
                        if (line) {
                            (lines[index] ||= []).push({
                                ...line.canvas,
                                faces: line.faces,
                                key: sourceIndex,
                                sourceIndex,
                                // Only a volume's plane can be moved and
                                // turned; a stack shows its images as stored
                                handles: sections.includes(sourceIndex)
                                    ? line.handles
                                    : null,
                                centre: line.centre,
                                active: sourceIndex === activeCell,
                                label: cellName(cells[sourceIndex], sourceIndex),
                                color:
                                    cells[sourceIndex]?.color || CELL_COLORS[0],
                            });
                        }
                    });
                });
            }

            setReferenceLines(lines);
            sync3DCells();
        };

        // Each 3D cell shows the planes of the MPR cells in its study as
        // outlines (with the reference lines), and may be cut along one of
        // them
        const sync3DCells = () => {
            Object.entries(readyCells).forEach(([index, target]) => {
                if (target.view !== VOLUME_3D_VIEW) return;
                const viewport3D = engine.getViewport(target.viewportId);
                if (!viewport3D?.getDefaultActor?.()) return;

                const planes = [];
                const cameras = {};
                Object.entries(readyCells).forEach(([sourceIndex, source]) => {
                    if (!isPlaneView(source.view)) return;
                    if (source.frameOfReferenceUID !== target.frameOfReferenceUID) {
                        return;
                    }
                    const camera = engine.getViewport(source.viewportId)?.getCamera();
                    if (!camera) return;
                    cameras[sourceIndex] = camera;
                    planes.push({
                        key: sourceIndex,
                        origin: camera.focalPoint,
                        normal: camera.viewPlaneNormal,
                        color: cells[sourceIndex]?.color || CELL_COLORS[0],
                    });
                });
                syncPlaneOutlines(viewport3D, showReferenceLines ? planes : []);

                // The crop box owns the volume's clipping while it is on
                const content = cells[index];
                if (!content?.crop) {
                    const camera = content?.cut != null && cameras[content.cut];
                    setVolumeCut(
                        viewport3D,
                        camera && {
                            origin: camera.focalPoint,
                            normal: camera.viewPlaneNormal.map((v) =>
                                content.cutFlip ? -v : v,
                            ),
                        },
                    );
                }
                viewport3D.render();
            });
        };

        let frame = 0;
        const schedule = () => {
            if (!frame) {
                frame = requestAnimationFrame(() => {
                    frame = 0;
                    compute();
                });
            }
        };

        const elements = Object.values(readyCells).map((info) => info.element);
        elements.forEach((element) =>
            element.addEventListener(Enums.Events.CAMERA_MODIFIED, schedule),
        );
        // Any cell changing size moves the lines drawn in it. Each cell
        // resizes its viewport from its own observer in the same round as
        // this one, and `schedule` waits a frame, so the lines are worked
        // out against the resized viewports.
        const resizeObserver = new ResizeObserver(schedule);
        elements.forEach((element) => resizeObserver.observe(element));
        schedule();

        return () => {
            cancelAnimationFrame(frame);
            resizeObserver.disconnect();
            elements.forEach((element) =>
                element.removeEventListener(
                    Enums.Events.CAMERA_MODIFIED,
                    schedule,
                ),
            );
        };
    }, [
        engine,
        readyCells,
        activeCell,
        showReferenceLines,
        showSliceThickness,
        cellSlabs,
        lineCentres,
        cells,
    ]);

    // Dragging an MPR cell's section line in another cell. `from` and
    // `to` are consecutive pointer positions on the target cell's canvas.
    // `drag` lasts for the whole drag and keeps the turning point on it, so
    // the plane turns about one fixed point rather than one that slides
    // along the line as it turns.
    const dragReferenceLine = useCallback(
        (sourceIndex, targetIndex, mode, from, to, drag) => {
            const source = readyCells[sourceIndex];
            const target = readyCells[targetIndex];
            if (!engine || !source || !target) return;

            const sourceViewport = engine.getViewport(source.viewportId);
            const targetViewport = engine.getViewport(target.viewportId);
            if (!sourceViewport || !targetViewport) return;

            const camera = sourceViewport.getCamera();
            const line = referenceLineGeometry(
                camera,
                targetViewport,
                0,
                (mode === "rotate" && drag.pivot) ||
                    lineCentreOn(lineCentres[sourceIndex], camera),
            );
            if (!line) return;

            if (mode === "rotate" && !drag.pivot) {
                // Turning fixes the line's middle where it is, so it stays
                // put once the line has turned
                drag.pivot = line.point;
                setLineCentres((prev) => ({
                    ...prev,
                    [sourceIndex]: line.point,
                }));
            }

            if (mode === "centre") {
                // Carry the middle of the line with the pointer: across the
                // line moves the plane, along it slides the middle
                const delta = add(
                    targetViewport.canvasToWorld(to),
                    targetViewport.canvasToWorld(from),
                    -1,
                );
                const shift = dot(delta, camera.viewPlaneNormal);
                sourceViewport.setCamera({
                    focalPoint: add(
                        camera.focalPoint,
                        camera.viewPlaneNormal,
                        shift,
                    ),
                    position: add(
                        camera.position,
                        camera.viewPlaneNormal,
                        shift,
                    ),
                });
                // From the latest centre, in case moves arrive faster than
                // renders
                setLineCentres((prev) => ({
                    ...prev,
                    [sourceIndex]: add(
                        lineCentreOn(prev[sourceIndex], camera) || line.point,
                        delta,
                    ),
                }));
            } else if (mode === "move") {
                // Shift the plane along its own normal by however far the
                // pointer moved across it
                const shift = dot(
                    add(
                        targetViewport.canvasToWorld(to),
                        targetViewport.canvasToWorld(from),
                        -1,
                    ),
                    camera.viewPlaneNormal,
                );
                sourceViewport.setCamera({
                    focalPoint: add(
                        camera.focalPoint,
                        camera.viewPlaneNormal,
                        shift,
                    ),
                    position: add(
                        camera.position,
                        camera.viewPlaneNormal,
                        shift,
                    ),
                });
            } else {
                // Turn the plane about the target's line of sight, through
                // the middle of the line, by the angle the pointer swept
                const [cx, cy] = line.centre;
                const sweep =
                    Math.atan2(to[1] - cy, to[0] - cx) -
                    Math.atan2(from[1] - cy, from[0] - cx);
                const axis = targetViewport.getCamera().viewPlaneNormal;

                // Which way round the axis matches the pointer depends on
                // how the target is oriented, so try a small turn and see
                const probe = targetViewport.worldToCanvas(
                    add(line.point, rotateAbout(line.direction, axis, 0.01), 50),
                );
                const along = targetViewport.worldToCanvas(
                    add(line.point, line.direction, 50),
                );
                const probeSweep =
                    Math.atan2(probe[1] - cy, probe[0] - cx) -
                    Math.atan2(along[1] - cy, along[0] - cx);
                const angle = Math.sin(probeSweep) >= 0 ? sweep : -sweep;

                const turn = (worldPoint) =>
                    add(
                        line.point,
                        rotateAbout(
                            add(worldPoint, line.point, -1),
                            axis,
                            angle,
                        ),
                    );
                sourceViewport.setCamera({
                    focalPoint: turn(camera.focalPoint),
                    position: turn(camera.position),
                    viewUp: rotateAbout(camera.viewUp, axis, angle),
                });
            }

            sourceViewport.render();
        },
        [engine, readyCells, lineCentres],
    );

    const resetViews = () => {
        if (!engine) return;
        setCellSlabs({});
        setLineCentres({});
        Object.values(readyCells).forEach((info) => {
            const viewport = engine.getViewport(info.viewportId);
            if (!viewport) return;
            if (info.view === VOLUME_3D_VIEW) {
                // Back to the starting angle, keeping its colouring
                viewport.resetCamera();
                viewport.render();
                return;
            }
            if (info.view !== "stack") {
                viewport.setBlendMode(Enums.BlendModes.COMPOSITE);
            }
            viewport.resetProperties();
            viewport.resetCamera();
            viewport.render();
        });
    };

    return (
        <div style={pageStyle}>
            <div style={toolbarStyle}>
                <div style={toolbarGroupStyle}>
                    {onClose && (
                        <button onClick={onClose} style={btnStyle}>
                            ← Back
                        </button>
                    )}
                    <strong style={{ alignSelf: "center" }}>OR View</strong>
                    <span style={{ alignSelf: "center" }}>
                        {patient ? patientLabel(patient) : "Loading patient…"}
                    </span>
                    <button onClick={onChangePatient} style={btnStyle}>
                        Change patient
                    </button>
                </div>

                <div style={toolbarGroupStyle}>
                    {TOOLS.map((tool) => (
                        <button
                            key={tool.name}
                            onClick={() => setActiveTool(tool.name)}
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

                <div style={toolbarGroupStyle}>
                    <label style={fieldStyle}>
                        Rows
                        <select
                            value={rows}
                            onChange={(e) =>
                                resizeGrid(Number(e.target.value), cols)
                            }
                            style={selectStyle}
                        >
                            {Array.from({ length: MAX_GRID }, (_, i) => (
                                <option key={i + 1} value={i + 1}>
                                    {i + 1}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label style={fieldStyle}>
                        Columns
                        <select
                            value={cols}
                            onChange={(e) =>
                                resizeGrid(rows, Number(e.target.value))
                            }
                            style={selectStyle}
                        >
                            {Array.from({ length: MAX_GRID }, (_, i) => (
                                <option key={i + 1} value={i + 1}>
                                    {i + 1}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label style={fieldStyle}>
                        <input
                            type="checkbox"
                            checked={showReferenceLines}
                            onChange={(e) =>
                                setShowReferenceLines(e.target.checked)
                            }
                        />
                        Reference lines
                    </label>
                    <label style={fieldStyle}>
                        <input
                            type="checkbox"
                            checked={showSliceThickness}
                            disabled={!showReferenceLines}
                            onChange={(e) =>
                                setShowSliceThickness(e.target.checked)
                            }
                        />
                        Slice thickness
                    </label>
                    <button onClick={resetViews} style={btnStyle}>
                        Reset
                    </button>
                </div>
            </div>

            {error && <p style={{ color: "red", margin: "0.5rem" }}>{error}</p>}

            <div
                style={{
                    ...gridStyle,
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                }}
            >
                {cells.map((content, index) => (
                    <OrViewCell
                        key={index}
                        index={index}
                        content={
                            content && ownStudyIds?.has(content.studyId)
                                ? content
                                : null
                        }
                        engine={engine}
                        active={index === activeCell}
                        referenceLines={referenceLines[index]}
                        slab={cellSlabs[index] || DEFAULT_SLAB}
                        onSlabChange={setCellSlab}
                        onDragReferenceLine={dragReferenceLine}
                        cutOptions={cutOptionsFor(index)}
                        studies={studies}
                        studySeries={studySeries}
                        loadStudySeries={loadStudySeries}
                        getSeries={getSeries}
                        getVolume={getVolume}
                        onActivate={setActiveCell}
                        onReady={handleCellReady}
                        onChange={setCellContent}
                        onUpdate={updateCell}
                    />
                ))}
            </div>
        </div>
    );
}

function OrViewCell({
    index,
    content,
    engine,
    active,
    referenceLines,
    slab,
    studies,
    studySeries,
    loadStudySeries,
    getSeries,
    getVolume,
    onActivate,
    onReady,
    onChange,
    onUpdate,
    onSlabChange,
    onDragReferenceLine,
    cutOptions,
}) {
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const [info, setInfo] = useState({});
    const [details, setDetails] = useState(null);
    const [picking, setPicking] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    // Whether a 3D cell's volume is showing yet
    const [volume3DReady, setVolume3DReady] = useState(false);

    const elementRef = useRef(null);
    const lineDragRef = useRef(null);
    // The 3D preset and opacity shift chosen for this cell, read when its
    // volume is first rendered without that load waiting on them
    const look3DRef = useRef({
        preset: content?.preset || null,
        shift: content?.shift || 0,
    });

    // Pointer position on this cell's canvas
    const canvasPoint = (evt) => {
        const rect = elementRef.current.getBoundingClientRect();
        return [evt.clientX - rect.left, evt.clientY - rect.top];
    };

    const startLineDrag = (evt, line, mode) => {
        evt.preventDefault();
        evt.stopPropagation();
        evt.currentTarget.setPointerCapture(evt.pointerId);
        lineDragRef.current = {
            sourceIndex: line.sourceIndex,
            mode,
            last: canvasPoint(evt),
        };
    };

    const moveLineDrag = (evt) => {
        const drag = lineDragRef.current;
        if (!drag) return;

        const point = canvasPoint(evt);
        onDragReferenceLine(
            drag.sourceIndex,
            index,
            drag.mode,
            drag.last,
            point,
            drag,
        );
        drag.last = point;
    };

    const endLineDrag = () => {
        lineDragRef.current = null;
    };

    const seriesId = content?.seriesId;
    const view = content?.view;

    // Show the chosen series in this cell's viewport
    useEffect(() => {
        const element = elementRef.current;
        if (!engine || !seriesId || !element) return;

        let isCancelled = false;
        const viewportId = viewportIdForCell(index);
        const viewDef = VIEWS.find((v) => v.id === view) || VIEWS[0];
        const isVolume = viewDef.id !== "stack";
        const is3D = Boolean(viewDef.is3D);

        // Shown instead by the render below
        if (isVolume && getShouldUseCPURendering()) return;

        engine.enableElement({
            viewportId,
            type: is3D
                ? Enums.ViewportType.VOLUME_3D
                : isVolume
                  ? Enums.ViewportType.ORTHOGRAPHIC
                  : Enums.ViewportType.STACK,
            element,
            defaultOptions: {
                background: [0, 0, 0],
                ...(viewDef.orientation
                    ? { orientation: viewDef.orientation }
                    : {}),
            },
        });
        const viewport = engine.getViewport(viewportId);

        // A 3D cell has its own tools: turn, pan, zoom and the crop box
        const toolGroup3DId = toolGroup3DIdFor(engine, index);
        if (is3D) {
            createVolume3DToolGroup(toolGroup3DId).addViewport(
                viewportId,
                engine.id,
            );
        }

        const patchInfo = (patch) => setInfo((prev) => ({ ...prev, ...patch }));
        const onStackImage = (evt) =>
            patchInfo({ index: evt.detail.imageIdIndex });
        const onVolumeImage = (evt) =>
            patchInfo({
                index: evt.detail.imageIndex,
                count: evt.detail.numberOfSlices,
            });
        const onVoi = (evt) => {
            const { lower, upper } = evt.detail.range;
            patchInfo({
                windowWidth: upper - lower,
                windowCenter: (upper + lower) / 2,
            });
        };
        const onContextMenu = (evt) => evt.preventDefault();
        element.addEventListener(Enums.Events.STACK_NEW_IMAGE, onStackImage);
        element.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, onVolumeImage);
        element.addEventListener(Enums.Events.VOI_MODIFIED, onVoi);
        element.addEventListener("contextmenu", onContextMenu);

        const resizeObserver = new ResizeObserver(() => {
            if (!isCancelled) engine.resize(true, true);
        });
        resizeObserver.observe(element);

        (async () => {
            setError("");
            setInfo({});
            setDetails(null);
            setVolume3DReady(false);
            setStatus("Loading…");

            const series = await getSeries(seriesId);
            if (isCancelled) return;
            setDetails(series);
            if (!series.imageIds.length) throw new Error("Series has no images");

            if (isVolume) {
                const volumeId = await getVolume(
                    seriesId,
                    series.imageIds,
                    (loaded) => {
                        if (!isCancelled) {
                            setStatus(
                                `Loading slices ${loaded} / ${series.imageIds.length}`,
                            );
                        }
                    },
                );
                if (isCancelled) return;
                if (is3D) {
                    setStatus("Rendering volume…");
                    await showVolume3D(
                        viewport,
                        volumeId,
                        look3DRef.current.preset ||
                            volume3DPresetsFor(series.modality)[0].id,
                        look3DRef.current.shift,
                    );
                    if (isCancelled) return;
                    setVolume3DReady(true);
                } else {
                    await viewport.setVolumes([{ volumeId }]);
                }
            } else {
                await viewport.setStack(series.imageIds, 0);
            }
            if (isCancelled) return;
            viewport.render();

            // A rendered volume has no slices or window to report
            if (!is3D) {
                const range = viewport.getProperties()?.voiRange;
                patchInfo({
                    index: viewport.getSliceIndex(),
                    count: viewport.getNumberOfSlices(),
                    ...(range
                        ? {
                              windowWidth: range.upper - range.lower,
                              windowCenter: (range.upper + range.lower) / 2,
                          }
                        : {}),
                });
            }
            setStatus("");

            onReady(index, {
                viewportId,
                element,
                seriesId,
                view: viewDef.id,
                sliceThickness: series.sliceThickness,
                // Cells can only be cross-referenced inside one patient
                // coordinate system
                frameOfReferenceUID:
                    metaData.get("imagePlaneModule", series.imageIds[0])
                        ?.frameOfReferenceUID || null,
            });
        })().catch((err) => {
            if (isCancelled) return;
            console.error("Failed to load cell:", err);
            setStatus("");
            setError(err.message || "Failed to load series");
        });

        // Cleanup
        return () => {
            isCancelled = true;
            resizeObserver.disconnect();
            element.removeEventListener(
                Enums.Events.STACK_NEW_IMAGE,
                onStackImage,
            );
            element.removeEventListener(
                Enums.Events.VOLUME_NEW_IMAGE,
                onVolumeImage,
            );
            element.removeEventListener(Enums.Events.VOI_MODIFIED, onVoi);
            element.removeEventListener("contextmenu", onContextMenu);
            onReady(index, null);
            // The engine is already gone when the whole page is closing
            if (!engine.hasBeenDestroyed) {
                // Detach from its tools first so none of them tries to draw
                // on a viewport that no longer exists
                if (is3D) {
                    ToolGroupManager.destroyToolGroup(toolGroup3DId);
                } else {
                    ToolGroupManager.getToolGroupForViewport(
                        viewportId,
                        engine.id,
                    )?.removeViewports(engine.id, viewportId);
                }
                engine.disableElement(viewportId);
            } else if (is3D) {
                ToolGroupManager.destroyToolGroup(toolGroup3DId);
            }
        };
    }, [engine, index, seriesId, view, getSeries, getVolume, onReady]);

    // A 3D cell's settings, kept with the cell in the layout: its rendering
    // preset (else the first for the series' modality), opacity shift,
    // crop box, and the plane it is cut along
    const presets3D = volume3DPresetsFor(details?.modality);
    const settings3D = {
        preset: content?.preset || presets3D[0].id,
        shift: content?.shift || 0,
        crop: Boolean(content?.crop),
        cut: content?.cut ?? null,
        cutFlip: Boolean(content?.cutFlip),
    };
    const shiftRange3D = opacityShiftRange(details?.modality);
    const { preset: preset3D, shift: shift3D, crop: crop3D } = settings3D;

    // Recolour the volume whenever another preset or shift is chosen
    useEffect(() => {
        look3DRef.current = { preset: content?.preset || null, shift: shift3D };
        if (!volume3DReady) return;
        const viewport = engine?.getViewport(viewportIdForCell(index));
        if (viewport) applyVolumePreset(viewport, preset3D, shift3D);
    }, [engine, index, volume3DReady, content?.preset, preset3D, shift3D]);

    // The crop box in the 3D view. Turning it off frees the volume's
    // clipping for a cut again, which the OR view puts back on its next
    // update.
    useEffect(() => {
        if (!volume3DReady || !engine) return;
        const toolGroup = ToolGroupManager.getToolGroup(
            toolGroup3DIdFor(engine, index),
        );
        const viewport = engine.getViewport(viewportIdForCell(index));
        if (!toolGroup || !viewport) return;
        setVolume3DCropping(toolGroup, viewport, crop3D);
        viewport.render();
    }, [engine, index, volume3DReady, crop3D]);

    const viewLabel = VIEWS.find((v) => v.id === view)?.label;
    const isVolume = Boolean(view) && view !== "stack";
    const is3D = view === VOLUME_3D_VIEW;
    const shownError =
        isVolume && getShouldUseCPURendering() ? MPR_UNAVAILABLE_MESSAGE : error;
    const sliceCount = info.count || 0;
    // Window presets are in Hounsfield units, so greyscale CT only
    const isCT =
        details?.modality === "CT" &&
        (details.instances[0]?.metadata?.samplesPerPixel ?? 1) === 1;

    const getViewport = () => engine?.getViewport(viewportIdForCell(index));

    const showSlice = (sliceIndex) => {
        const element = elementRef.current;
        if (!element || sliceIndex < 0 || sliceIndex >= sliceCount) return;

        setInfo((prev) => ({ ...prev, index: sliceIndex }));
        csUtils
            .jumpToSlice(element, { imageIndex: sliceIndex })
            .catch((err) => console.error("Failed to change slice:", err));
    };

    const changeSlab = (patch) => {
        const viewport = getViewport();
        if (!viewport) return;

        const next = { ...slab, ...patch };
        applySlabToViewport(viewport, next);
        onSlabChange(index, next);
    };

    const changeWindow = (width, center) => {
        const viewport = getViewport();
        if (viewport) applyWindowToViewport(viewport, width, center);
    };
    const study = details?.study || {};
    // Text overlays, one entry per line; empty values are skipped
    const seriesLines = details
        ? [
              [
                  details.seriesNumber && `Series ${details.seriesNumber}`,
                  details.modality,
                  details.bodyPartExamined,
              ],
              [details.protocolName],
              [
                  `${details.instances.length} images`,
                  details.sliceThickness &&
                      `${Number(Number(details.sliceThickness).toFixed(3))} mm thick`,
              ],
              [
                  is3D
                      ? volume3DLabel(
                            presets3D,
                            settings3D,
                            shiftRange3D,
                            cutOptions,
                        )
                      : slabLabel(slab),
              ],
          ]
        : [];
    const studyLines = details
        ? [
              [study.patientName],
              [study.patientID, study.patientSex],
              [study.studyDescription],
              [study.studyDate?.slice(0, 10)],
              [study.institutionName],
          ]
        : [];
    const renderLines = (lines) =>
        lines
            .map((parts) => parts.filter(Boolean).join(" · "))
            .filter(Boolean)
            .map((line, i) => <div key={i}>{line}</div>);
    const showPicker = !content || picking;

    return (
        <div
            data-or-cell={index}
            style={{
                ...cellStyle,
                borderColor: active ? "#89b4fa" : "#313244",
            }}
            onPointerDownCapture={() => onActivate(index)}
            onWheelCapture={() => onActivate(index)}
        >
            <div style={cellBodyStyle} data-viewport-body>
                <div ref={elementRef} style={viewportStyle} />

                {referenceLines?.length > 0 && (
                    <svg style={lineOverlayStyle}>
                        {referenceLines.map((line) => (
                            <g key={line.key}>
                                {line.faces?.map((face, i) => (
                                    <line
                                        key={i}
                                        {...face}
                                        stroke={line.color}
                                        strokeWidth="1"
                                        strokeDasharray="4 4"
                                        opacity="0.8"
                                    />
                                ))}
                                <line
                                    x1={line.x1}
                                    y1={line.y1}
                                    x2={line.x2}
                                    y2={line.y2}
                                    stroke={line.color}
                                    strokeWidth={line.active ? 2.5 : 1.25}
                                />
                                {line.handles && (
                                    <>
                                        {/* Wide invisible grip for moving the plane */}
                                        <line
                                            x1={line.x1}
                                            y1={line.y1}
                                            x2={line.x2}
                                            y2={line.y2}
                                            stroke="transparent"
                                            strokeWidth="12"
                                            style={lineGripStyle}
                                            onPointerDown={(evt) =>
                                                startLineDrag(evt, line, "move")
                                            }
                                            onPointerMove={moveLineDrag}
                                            onPointerUp={endLineDrag}
                                            onPointerCancel={endLineDrag}
                                        />
                                        {/* The line's middle, which it turns
                                            about; drag it anywhere */}
                                        <circle
                                            cx={line.centre[0]}
                                            cy={line.centre[1]}
                                            r="6"
                                            fill="none"
                                            stroke={line.color}
                                            strokeWidth="2"
                                        />
                                        <circle
                                            cx={line.centre[0]}
                                            cy={line.centre[1]}
                                            r="1.5"
                                            fill={line.color}
                                        />
                                        <circle
                                            cx={line.centre[0]}
                                            cy={line.centre[1]}
                                            r="9"
                                            fill="transparent"
                                            style={lineCentreStyle}
                                            onPointerDown={(evt) =>
                                                startLineDrag(evt, line, "centre")
                                            }
                                            onPointerMove={moveLineDrag}
                                            onPointerUp={endLineDrag}
                                            onPointerCancel={endLineDrag}
                                        />
                                        {/* Which cell this section belongs to */}
                                        <text
                                            x={line.handles[0][0] + 9}
                                            y={line.handles[0][1] - 8}
                                            fill={line.color}
                                            style={lineLabelStyle}
                                        >
                                            {line.label}
                                        </text>
                                        {line.handles.map(([x, y], i) => (
                                            <circle
                                                key={i}
                                                cx={x}
                                                cy={y}
                                                r="5"
                                                fill={line.color}
                                                stroke="#000"
                                                style={lineHandleStyle}
                                                onPointerDown={(evt) =>
                                                    startLineDrag(
                                                        evt,
                                                        line,
                                                        "rotate",
                                                    )
                                                }
                                                onPointerMove={moveLineDrag}
                                                onPointerUp={endLineDrag}
                                                onPointerCancel={endLineDrag}
                                            />
                                        ))}
                                    </>
                                )}
                            </g>
                        ))}
                    </svg>
                )}

                {content && (
                    <>
                        <div
                            style={{
                                ...overlayStyle,
                                top: 6,
                                left: 8,
                                color: content.color || overlayStyle.color,
                            }}
                        >
                            {cellName(content, index)} · {content.label}
                            {viewLabel ? ` · ${viewLabel}` : ""}
                            <div style={detailLinesStyle}>
                                {renderLines(seriesLines)}
                            </div>
                        </div>
                        <div style={studyOverlayStyle}>
                            {renderLines(studyLines)}
                        </div>
                        <div style={{ ...overlayStyle, bottom: 6, left: 8 }}>
                            {info.count > 0 &&
                                `Slice ${(info.index ?? 0) + 1} / ${info.count}`}
                        </div>
                        <div style={{ ...overlayStyle, bottom: 6, right: 8 }}>
                            {info.windowWidth !== undefined &&
                                `W ${Math.round(info.windowWidth)} / L ${Math.round(info.windowCenter)}`}
                        </div>
                        <div style={cellButtonsStyle}>
                            <button
                                onClick={() => setSettingsOpen((open) => !open)}
                                style={
                                    settingsOpen
                                        ? smallActiveBtnStyle
                                        : smallBtnStyle
                                }
                                aria-expanded={settingsOpen}
                            >
                                Settings
                            </button>
                            <button
                                onClick={() => setPicking(true)}
                                style={smallBtnStyle}
                            >
                                Change
                            </button>
                            <button
                                onClick={() => onChange(index, null)}
                                style={smallBtnStyle}
                                aria-label={`Clear cell ${index + 1}`}
                            >
                                ✕
                            </button>
                        </div>
                    </>
                )}

                {(status || shownError) && !showPicker && (
                    <div style={statusStyle}>
                        <span style={shownError ? { color: "#f38ba8" } : null}>
                            {shownError || status}
                        </span>
                    </div>
                )}

                {showPicker && (
                    <CellPicker
                        index={index}
                        content={content}
                        studies={studies}
                        studySeries={studySeries}
                        loadStudySeries={loadStudySeries}
                        onCancel={content ? () => setPicking(false) : null}
                        onPick={(next) => {
                            setPicking(false);
                            onChange(index, next);
                        }}
                    />
                )}
            </div>

            {content && settingsOpen && (
                <div style={cellSettingsStyle}>
                    {/* A rendered volume has no slices to step through */}
                    {!is3D && (
                    <div style={sliderRowStyle}>
                        <button
                            onClick={() => showSlice((info.index ?? 0) - 1)}
                            style={smallBtnStyle}
                            disabled={(info.index ?? 0) <= 0}
                            aria-label={`Previous slice in cell ${index + 1}`}
                        >
                            ‹
                        </button>
                        <input
                            type="range"
                            min="0"
                            max={Math.max(0, sliceCount - 1)}
                            value={info.index ?? 0}
                            onChange={(e) => showSlice(parseInt(e.target.value))}
                            disabled={sliceCount <= 1}
                            style={{ flex: 1, minWidth: 0 }}
                            aria-label={`Cell ${index + 1} slice`}
                        />
                        <button
                            onClick={() => showSlice((info.index ?? 0) + 1)}
                            style={smallBtnStyle}
                            disabled={(info.index ?? 0) >= sliceCount - 1}
                            aria-label={`Next slice in cell ${index + 1}`}
                        >
                            ›
                        </button>
                    </div>
                    )}
                    <div style={identityRowStyle}>
                        <label style={identityFieldStyle}>
                            Label
                            <input
                                type="text"
                                value={content.name || ""}
                                maxLength={MAX_NAME_LENGTH}
                                placeholder={String(index + 1)}
                                onChange={(e) =>
                                    onUpdate(index, { name: e.target.value })
                                }
                                style={identityInputStyle}
                                aria-label={`Cell ${index + 1} label`}
                            />
                        </label>
                        <label style={identityFieldStyle}>
                            Line colour
                            <input
                                type="color"
                                value={content.color || CELL_COLORS[0]}
                                onChange={(e) =>
                                    onUpdate(index, { color: e.target.value })
                                }
                                style={colorInputStyle}
                                aria-label={`Cell ${index + 1} line colour`}
                            />
                        </label>
                    </div>
                    {is3D ? (
                        <Volume3DSettings
                            label={`Cell ${index + 1}`}
                            presets={presets3D}
                            shiftRange={shiftRange3D}
                            cutOptions={cutOptions}
                            settings={settings3D}
                            onChange={(patch) => onUpdate(index, patch)}
                        />
                    ) : (
                        <ViewportSettings
                            label={`Cell ${index + 1}`}
                            isVolume={isVolume}
                            isCT={isCT}
                            slab={slab}
                            windowWidth={info.windowWidth}
                            windowCenter={info.windowCenter}
                            onSlabChange={changeSlab}
                            onWindowChange={changeWindow}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

function CellPicker({
    index,
    content,
    studies,
    studySeries,
    loadStudySeries,
    onCancel,
    onPick,
}) {
    const [studyId, setStudyId] = useState(content?.studyId || "");
    const [seriesId, setSeriesId] = useState(content?.seriesId || "");
    const [view, setView] = useState(content?.view || "stack");

    useEffect(() => {
        if (studyId) loadStudySeries(studyId);
    }, [studyId, loadStudySeries]);

    const seriesList = studySeries[studyId];
    const series = seriesList?.find((s) => s.id === seriesId);
    // Only series that form a regular volume can be shown as MPR planes
    const availableViews = VIEWS.filter(
        (v) => v.id === "stack" || series?.is3DCapable,
    );
    const chosenView = availableViews.some((v) => v.id === view)
        ? view
        : "stack";

    return (
        <div style={pickerStyle} onDoubleClick={(e) => e.stopPropagation()}>
            <strong>Cell {index + 1}</strong>

            <select
                value={studyId}
                onChange={(e) => {
                    setStudyId(e.target.value);
                    setSeriesId("");
                }}
                style={pickerSelectStyle}
                aria-label={`Cell ${index + 1} study`}
            >
                <option value="">
                    {!studies
                        ? "Loading studies…"
                        : studies.length
                          ? "Select study…"
                          : "This patient has no studies"}
                </option>
                {(studies || []).map((study) => (
                    <option key={study.id} value={study.id}>
                        {study.studyDescription || "No description"} (
                        {study.studyDate?.slice(0, 10) || "no date"})
                    </option>
                ))}
            </select>

            <select
                value={seriesId}
                onChange={(e) => setSeriesId(e.target.value)}
                disabled={!seriesList}
                style={pickerSelectStyle}
                aria-label={`Cell ${index + 1} series`}
            >
                <option value="">
                    {studyId && !seriesList
                        ? "Loading series…"
                        : "Select series…"}
                </option>
                {(seriesList || []).map((s) => (
                    <option key={s.id} value={s.id}>
                        {s.seriesNumber} · {s.seriesDescription || "No description"}{" "}
                        ({s.instanceCount || 0} images
                        {s.is3DCapable ? ", MPR" : ""})
                    </option>
                ))}
            </select>

            <select
                value={chosenView}
                onChange={(e) => setView(e.target.value)}
                disabled={!series}
                style={pickerSelectStyle}
                aria-label={`Cell ${index + 1} view`}
            >
                {availableViews.map((v) => (
                    <option key={v.id} value={v.id}>
                        {v.label}
                    </option>
                ))}
            </select>

            <div style={{ display: "flex", gap: 8 }}>
                <button
                    onClick={() =>
                        onPick({
                            studyId,
                            seriesId,
                            view: chosenView,
                            label:
                                series.seriesDescription ||
                                `Series ${series.seriesNumber}`,
                        })
                    }
                    disabled={!series}
                    style={activeBtnStyle}
                >
                    Load
                </button>
                {onCancel && (
                    <button onClick={onCancel} style={btnStyle}>
                        Cancel
                    </button>
                )}
            </div>
        </div>
    );
}

const pageStyle = {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    fontFamily: "monospace",
    background: "#11111b",
    color: "#cdd6f4",
};

const chooserStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    width: "100%",
    maxWidth: 560,
    margin: "3rem auto",
    padding: "0 1rem",
    boxSizing: "border-box",
};

const toolbarStyle = {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "0.75rem",
    padding: "0.5rem 0.75rem",
    background: "#1e1e2e",
    borderBottom: "1px solid #313244",
};

const toolbarGroupStyle = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.5rem",
};

const fieldStyle = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: "0.9em",
};

const gridStyle = {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gap: 4,
    padding: 4,
};

const cellStyle = {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    background: "#000",
    border: "2px solid #313244",
    borderRadius: 4,
    overflow: "hidden",
};

// The image area of a cell; its settings panel (when open) sits below it
const cellBodyStyle = {
    position: "relative",
    flex: 1,
    minHeight: 0,
};

const cellSettingsStyle = {
    background: "#181825",
};

const sliderRowStyle = {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.3rem 0.5rem",
};

const identityRowStyle = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.3rem 0.5rem 0",
    fontSize: "0.85em",
};

const identityFieldStyle = {
    display: "flex",
    alignItems: "center",
    gap: 6,
};

const identityInputStyle = {
    width: 150,
    padding: "2px 6px",
    border: "1px solid #555",
    borderRadius: 4,
    background: "#313244",
    color: "#cdd6f4",
    fontFamily: "inherit",
    fontSize: "inherit",
};

const colorInputStyle = {
    width: 36,
    height: 22,
    padding: 0,
    border: "1px solid #555",
    borderRadius: 4,
    background: "none",
    cursor: "pointer",
};

const viewportStyle = {
    position: "absolute",
    inset: 0,
};

const lineOverlayStyle = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
};

// Parts of a reference line that take the pointer (the overlay itself lets
// everything through to the viewport underneath)
const lineGripStyle = {
    pointerEvents: "stroke",
    cursor: "move",
};

const lineLabelStyle = {
    pointerEvents: "none",
    fontSize: 12,
    fontWeight: "bold",
    paintOrder: "stroke",
    stroke: "#000",
    strokeWidth: 3,
};

const lineHandleStyle = {
    pointerEvents: "all",
    cursor: "grab",
};

const lineCentreStyle = {
    pointerEvents: "all",
    cursor: "move",
};

const overlayStyle = {
    position: "absolute",
    pointerEvents: "none",
    color: "#f9e2af",
    fontSize: "0.85em",
    textShadow: "0 0 3px #000",
};

// Secondary lines under a cell's title
const detailLinesStyle = {
    color: "#cdd6f4",
    fontSize: "0.9em",
};

// Patient and study details, under the cell's buttons
const studyOverlayStyle = {
    ...overlayStyle,
    top: 32,
    right: 8,
    maxWidth: "55%",
    textAlign: "right",
    color: "#cdd6f4",
    fontSize: "0.75em",
    overflowWrap: "anywhere",
};

const cellButtonsStyle = {
    position: "absolute",
    top: 4,
    right: 4,
    display: "flex",
    gap: 4,
};

const statusStyle = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.6)",
    pointerEvents: "none",
};

const pickerStyle = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    padding: "0.75rem",
    background: "rgba(17, 17, 27, 0.95)",
};

const selectStyle = {
    padding: "4px 6px",
    border: "1px solid #555",
    borderRadius: 4,
    background: "#313244",
    color: "#cdd6f4",
    fontFamily: "inherit",
};

const pickerSelectStyle = {
    ...selectStyle,
    width: "100%",
    maxWidth: 420,
};

const btnStyle = {
    padding: "6px 14px",
    cursor: "pointer",
    border: "1px solid #555",
    borderRadius: 4,
    background: "#313244",
    color: "#cdd6f4",
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
    padding: "2px 8px",
    fontSize: "0.85em",
    opacity: 0.85,
};

const smallActiveBtnStyle = {
    ...smallBtnStyle,
    border: "1px solid #89b4fa",
    background: "#89b4fa",
    color: "#1e1e2e",
    opacity: 1,
};
