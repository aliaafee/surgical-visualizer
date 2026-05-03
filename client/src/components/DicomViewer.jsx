import { useState, useEffect, useRef } from "react";
import {
    RenderingEngine,
    Enums,
    init as csRenderInit,
    registerImageLoader,
} from "@cornerstonejs/core";
import PocketBase from "pocketbase";
import dicomParser from "dicom-parser";

// init({
//     maxWebWorkers: navigator.hardwareConcurrency || 1,
// });

const pb = new PocketBase("http://127.0.0.1:8090");

let isInitialized = false;

function loadImageFromPb(imageId) {
    console.log("Loading image with ID:", imageId);

    const instanceId = imageId.replace("pburi:", "");

    const promise = new Promise(async (resolve, reject) => {
        try {
            // Fetch the file from PocketBase using the instance ID
            const fileUrl = `http://127.0.0.1:8090/api/visualizer/dicom/instances/${instanceId}/file`;
            console.log("Fetching file from URL:", fileUrl);

            const response = await fetch(fileUrl, {
                headers: {
                    Authorization: pb.authStore.token
                        ? `Bearer ${pb.authStore.token}`
                        : "",
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Get the binary data as ArrayBuffer
            const arrayBuffer = await response.arrayBuffer();
            console.log(
                "Received file, size:",
                arrayBuffer.byteLength,
                "bytes",
            );

            // Parse DICOM data from arrayBuffer using dicom-parser
            const byteArray = new Uint8Array(arrayBuffer);
            const dataSet = dicomParser.parseDicom(byteArray);

            // Extract DICOM metadata
            const rows = dataSet.uint16("x00280010");
            const columns = dataSet.uint16("x00280011");
            const bitsAllocated = dataSet.uint16("x00280100");
            const bitsStored = dataSet.uint16("x00280101");
            const pixelRepresentation = dataSet.uint16("x00280103");
            const samplesPerPixel = dataSet.uint16("x00280002") || 1;

            console.log("DICOM Metadata:", {
                rows,
                columns,
                bitsAllocated,
                bitsStored,
                pixelRepresentation,
                samplesPerPixel,
            });

            // Extract rescale slope and intercept
            const slope = dataSet.floatString("x00281053") || 1;
            const intercept = dataSet.floatString("x00281052") || 0;

            // Extract window center and width
            const windowCenter = dataSet.floatString("x00281050") || 40;
            const windowWidth = dataSet.floatString("x00281051") || 400;

            console.log("Window/Level:", {
                windowCenter,
                windowWidth,
                slope,
                intercept,
            });

            // Extract pixel spacing
            const pixelSpacingString = dataSet.string("x00280030");
            let rowPixelSpacing = 1;
            let columnPixelSpacing = 1;
            if (pixelSpacingString) {
                const spacingValues = pixelSpacingString.split("\\");
                rowPixelSpacing = parseFloat(spacingValues[0]) || 1;
                columnPixelSpacing = parseFloat(spacingValues[1]) || 1;
            }

            // Extract pixel data
            const pixelDataElement = dataSet.elements.x7fe00010;
            if (!pixelDataElement) {
                throw new Error("Pixel data element not found");
            }

            console.log("Pixel data element:", {
                dataOffset: pixelDataElement.dataOffset,
                length: pixelDataElement.length,
            });

            let pixelData;

            if (bitsAllocated === 16) {
                const isSigned = pixelRepresentation === 1;
                if (isSigned) {
                    pixelData = new Int16Array(
                        byteArray.buffer,
                        pixelDataElement.dataOffset,
                        pixelDataElement.length / 2,
                    );
                } else {
                    pixelData = new Uint16Array(
                        byteArray.buffer,
                        pixelDataElement.dataOffset,
                        pixelDataElement.length / 2,
                    );
                }
            } else {
                pixelData = new Uint8Array(
                    byteArray.buffer,
                    pixelDataElement.dataOffset,
                    pixelDataElement.length,
                );
            }

            console.log("Pixel data extracted:", {
                length: pixelData.length,
                expected: rows * columns,
                sample: pixelData.slice(0, 10),
            });

            // Calculate min/max pixel values from actual data
            let minPixelValue = pixelData[0];
            let maxPixelValue = pixelData[0];
            for (let i = 0; i < pixelData.length; i++) {
                if (pixelData[i] < minPixelValue) minPixelValue = pixelData[i];
                if (pixelData[i] > maxPixelValue) maxPixelValue = pixelData[i];
            }

            console.log("Actual pixel value range:", {
                minPixelValue,
                maxPixelValue,
            });

            // Use actual pixel range for window/level if the DICOM values don't match
            let finalWindowCenter = windowCenter;
            let finalWindowWidth = windowWidth;

            // If window settings are outside actual pixel range, recalculate
            if (
                windowCenter > maxPixelValue * 2 ||
                windowCenter < minPixelValue
            ) {
                finalWindowCenter = (maxPixelValue + minPixelValue) / 2;
                finalWindowWidth = maxPixelValue - minPixelValue;
                console.log("Recalculated window/level based on actual data:", {
                    finalWindowCenter,
                    finalWindowWidth,
                });
            }

            const image = {
                imageId: imageId,
                minPixelValue: minPixelValue,
                maxPixelValue: maxPixelValue,
                slope: slope,
                intercept: intercept,
                windowCenter: finalWindowCenter,
                windowWidth: finalWindowWidth,
                rows: rows,
                columns: columns,
                height: rows,
                width: columns,
                color: samplesPerPixel > 1,
                rgba: false,
                columnPixelSpacing: columnPixelSpacing,
                rowPixelSpacing: rowPixelSpacing,
                invert: false,
                sizeInBytes: pixelDataElement.length,
                getPixelData: () => pixelData,
            };

            console.log("Created image object:", image);

            resolve(image);
        } catch (err) {
            console.error("Failed to load image:", err);
            reject(err);
        }
    });

    return {
        promise,
    };
}

async function initializeCornerstone() {
    if (isInitialized) return;

    try {
        // Initialize Cornerstone Core
        await csRenderInit();

        // Register the custom image loader for pburi scheme
        registerImageLoader("pburi", loadImageFromPb);

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
    const [currentImageDimensions, setCurrentImageDimensions] = useState({
        rows: 0,
        columns: 0,
    });

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

        // Create image IDs using pburi scheme with authentication token
        const imageIds = seriesData.instances.map((instance) => {
            // const fileUrl = `${wadoUriRoot}/api/visualizer/dicom/instances/${instance.id}/file`;
            // Include the auth token in the URL
            // const urlWithAuth = `${fileUrl}?token=${encodeURIComponent(pb.authStore.token || "")}`;
            return `pburi:${instance?.id}`;
        });

        console.log("Loading images:", imageIds.length, "imageIds");

        console.log("Image IDs:", imageIds);

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
                // Update dimensions from the loaded image
                const image = viewport.getImageData();
                if (image) {
                    setCurrentImageDimensions({
                        rows: image.dimensions[0],
                        columns: image.dimensions[1],
                    });
                }
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

            // Update dimensions
            const image = viewport.getImageData();
            if (image) {
                setCurrentImageDimensions({
                    rows: image.dimensions[0],
                    columns: image.dimensions[1],
                });
            }
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

            // Update dimensions
            const image = viewport.getImageData();
            if (image) {
                setCurrentImageDimensions({
                    rows: image.dimensions[0],
                    columns: image.dimensions[1],
                });
            }
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

        // Update dimensions
        const image = viewport.getImageData();
        if (image) {
            setCurrentImageDimensions({
                rows: image.dimensions[0],
                columns: image.dimensions[1],
            });
        }
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
                    <strong>Dimensions:</strong> {currentImageDimensions.rows} ×{" "}
                    {currentImageDimensions.columns}
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
