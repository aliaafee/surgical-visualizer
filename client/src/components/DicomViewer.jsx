import { useState, useEffect, useRef } from "react";
import {
    RenderingEngine,
    Enums,
    init as csRenderInit,
} from "@cornerstonejs/core";
import { wadouri } from "@cornerstonejs/dicom-image-loader";
import PocketBase from "pocketbase";

const pb = new PocketBase("http://127.0.0.1:8090");

let wadoUriRoot = "http://127.0.0.1:8090";
let isInitialized = false;

async function initializeCornerstone() {
    if (isInitialized) return;

    try {
        // Initialize Cornerstone Core
        await csRenderInit();

        isInitialized = true;
        console.log("Cornerstone initialized successfully");
    } catch (err) {
        console.error("Failed to initialize Cornerstone:", err);
        throw err;
    }
}

export default function DicomViewer({ seriesId, onClose }) {
    const [seriesData, setSeriesData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [initialized, setInitialized] = useState(false);

    const viewportRef = useRef(null);
    const renderingEngineRef = useRef(null);
    const viewportIdRef = useRef("CT_STACK_VIEWPORT");

    // Initialize Cornerstone
    useEffect(() => {
        async function init() {
            if (initialized) return;
            try {
                await initializeCornerstone();
                setInitialized(true);
            } catch (err) {
                console.error("Failed to initialize Cornerstone:", err);
                setError("Failed to initialize viewer");
            }
        }
        init();
    }, [initialized]);

    // Fetch series data
    useEffect(() => {
        if (!seriesId) return;

        let isCancelled = false;

        async function fetchSeries() {
            setLoading(true);
            setError("");

            try {
                const data = await pb.send(
                    `/api/visualizer/dicom/series/${seriesId}`,
                    {
                        method: "GET",
                    },
                );

                console.log("Fetched series data:", data);

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

    // Setup viewport and render images
    useEffect(() => {
        if (
            !initialized ||
            !seriesData ||
            !viewportRef.current ||
            !seriesData.instances?.length
        ) {
            return;
        }

        const element = viewportRef.current;

        // Create image IDs using wadouri scheme with authentication token
        const imageIds = seriesData.instances.map((instance) => {
            const fileUrl = `${wadoUriRoot}/api/visualizer/dicom/instances/${instance.id}/file`;
            // Include the auth token in the URL
            const urlWithAuth = `${fileUrl}?token=${encodeURIComponent(pb.authStore.token || "")}`;
            return `wadouri:${urlWithAuth}`;
        });

        console.log("Loading images:", imageIds.length, "imageIds");

        // Create rendering engine
        const renderingEngineId = "myRenderingEngine";
        const renderingEngine = new RenderingEngine(renderingEngineId);
        renderingEngineRef.current = renderingEngine;

        const viewportId = viewportIdRef.current;
        const viewportInput = {
            viewportId,
            type: Enums.ViewportType.STACK,
            element,
            defaultOptions: {
                background: [0, 0, 0],
            },
        };

        renderingEngine.enableElement(viewportInput);

        // Get viewport and set the stack
        const viewport = renderingEngine.getViewport(viewportId);

        viewport
            .setStack(imageIds, 0)
            .then(() => {
                viewport.render();
            })
            .catch((err) => {
                console.error("Failed to set stack:", err);
                setError("Failed to load images");
            });

        // Cleanup
        return () => {
            if (renderingEngineRef.current) {
                renderingEngineRef.current.destroy();
            }
        };
    }, [initialized, seriesData]);

    // Handle image navigation
    const handlePrevImage = () => {
        if (!renderingEngineRef.current || !seriesData) return;

        const viewport = renderingEngineRef.current.getViewport(
            viewportIdRef.current,
        );
        const currentIndex = viewport.getCurrentImageIdIndex();

        if (currentIndex > 0) {
            viewport.setImageIdIndex(currentIndex - 1);
            setCurrentImageIndex(currentIndex - 1);
        }
    };

    const handleNextImage = () => {
        if (!renderingEngineRef.current || !seriesData) return;

        const viewport = renderingEngineRef.current.getViewport(
            viewportIdRef.current,
        );
        const currentIndex = viewport.getCurrentImageIdIndex();
        const maxIndex = seriesData.instances.length - 1;

        if (currentIndex < maxIndex) {
            viewport.setImageIdIndex(currentIndex + 1);
            setCurrentImageIndex(currentIndex + 1);
        }
    };

    const handleSliderChange = (e) => {
        if (!renderingEngineRef.current || !seriesData) return;

        const newIndex = parseInt(e.target.value);
        const viewport = renderingEngineRef.current.getViewport(
            viewportIdRef.current,
        );
        viewport.setImageIdIndex(newIndex);
        setCurrentImageIndex(newIndex);
    };

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
                    </p>
                </div>
                {onClose && (
                    <button onClick={onClose} style={btnStyle}>
                        Close
                    </button>
                )}
            </div>

            <div ref={viewportRef} style={viewportStyle} />

            <div style={controlsStyle}>
                <button
                    onClick={handlePrevImage}
                    style={btnStyle}
                    disabled={currentImageIndex === 0}
                >
                    Previous
                </button>

                <div style={{ flex: 1, margin: "0 1rem" }}>
                    <input
                        type="range"
                        min="0"
                        max={Math.max(
                            0,
                            (seriesData?.instances?.length || 1) - 1,
                        )}
                        value={currentImageIndex}
                        onChange={handleSliderChange}
                        style={{ width: "100%" }}
                    />
                    <p
                        style={{
                            textAlign: "center",
                            margin: "4px 0",
                            fontSize: "0.9em",
                        }}
                    >
                        Image {currentImageIndex + 1} of{" "}
                        {seriesData?.instances?.length || 0}
                    </p>
                </div>

                <button
                    onClick={handleNextImage}
                    style={btnStyle}
                    disabled={
                        currentImageIndex >=
                        (seriesData?.instances?.length || 1) - 1
                    }
                >
                    Next
                </button>
            </div>

            <div style={infoStyle}>
                <p>
                    <strong>Series:</strong> {seriesData.seriesNumber}
                </p>
                <p>
                    <strong>Instances:</strong> {seriesData.instanceCount}
                </p>
                <p>
                    <strong>Dimensions:</strong> {seriesData.rows} ×{" "}
                    {seriesData.columns}
                </p>
                {seriesData.pixelSpacing && (
                    <p>
                        <strong>Pixel Spacing:</strong>{" "}
                        {JSON.stringify(seriesData.pixelSpacing)}
                    </p>
                )}
            </div>
        </div>
    );
}

const containerStyle = {
    fontFamily: "monospace",
    maxWidth: 1200,
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

const viewportStyle = {
    width: "100%",
    height: "600px",
    background: "#000",
    borderRadius: 4,
    marginBottom: "1rem",
};

const controlsStyle = {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    marginBottom: "1rem",
    padding: "1rem",
    background: "#181825",
    borderRadius: 4,
};

const infoStyle = {
    display: "flex",
    gap: "2rem",
    padding: "1rem",
    background: "#181825",
    borderRadius: 4,
    fontSize: "0.9em",
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
