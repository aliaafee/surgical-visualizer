import { useState, useRef } from "react";
import DicomViewer from "./DicomViewer";
import { pb } from "@/lib/pb";
import { collectDroppedFiles } from "@/lib/dropped-files";

function formatSize(bytes) {
    if (!bytes) return "";
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
    return `${(bytes / 1e6).toFixed(1)} MB`;
}

export default function DicomUploadTest() {
    const [loggedIn, setLoggedIn] = useState(pb.authStore.isValid);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [authError, setAuthError] = useState("");

    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState("");
    const [uploadResult, setUploadResult] = useState(null);
    const [uploadError, setUploadError] = useState("");
    const [pendingFiles, setPendingFiles] = useState([]);
    const [anonymize, setAnonymize] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [anonymizingStudyId, setAnonymizingStudyId] = useState(null);

    const [studies, setStudies] = useState(null);
    const [studiesError, setStudiesError] = useState("");

    const [selectedStudyId, setSelectedStudyId] = useState(null);
    const [selectedStudyData, setSelectedStudyData] = useState(null);
    const [loadingStudy, setLoadingStudy] = useState(false);

    const [viewingSeriesId, setViewingSeriesId] = useState(null);
    const [viewingMode, setViewingMode] = useState("stack");

    const fileInputRef = useRef(null);

    async function login(e) {
        e.preventDefault();
        setAuthError("");
        try {
            await pb.collection("users").authWithPassword(email, password);
            setLoggedIn(true);
        } catch (err) {
            setAuthError(err.message);
        }
    }

    function logout() {
        pb.authStore.clear();
        setLoggedIn(false);
    }

    const CHUNK_SIZE = 10;

    async function handleDrop(e) {
        e.preventDefault();
        setDragActive(false);
        if (!loggedIn || uploading) return;

        try {
            const files = await collectDroppedFiles(e.dataTransfer);
            setPendingFiles(files);
            if (fileInputRef.current) fileInputRef.current.value = "";
        } catch (err) {
            setUploadError(`Could not read dropped files: ${err.message}`);
        }
    }

    async function upload(e) {
        e.preventDefault();
        const files = pendingFiles;
        if (files.length === 0) return;

        setUploading(true);
        setUploadResult(null);
        setUploadError("");
        setUploadProgress("");

        const merged = {
            studyId: "",
            studyInstanceUID: "",
            series: [],
            instances: [],
            filesProcessed: 0,
            errors: [],
        };
        const seenSeriesIds = new Set();

        try {
            const chunks = [];
            for (let i = 0; i < files.length; i += CHUNK_SIZE) {
                chunks.push(files.slice(i, i + CHUNK_SIZE));
            }

            for (let i = 0; i < chunks.length; i++) {
                setUploadProgress(
                    `Uploading chunk ${i + 1} of ${chunks.length}…`,
                );
                const form = new FormData();
                for (const file of chunks[i]) {
                    form.append("files", file);
                }
                if (anonymize) form.append("anonymize", "true");
                const data = await pb.send("/api/visualizer/dicom/upload", {
                    method: "POST",
                    body: form,
                });

                if (data.studyId) merged.studyId = data.studyId;
                if (data.studyInstanceUID)
                    merged.studyInstanceUID = data.studyInstanceUID;
                for (const s of data.series ?? []) {
                    if (!seenSeriesIds.has(s.id)) {
                        seenSeriesIds.add(s.id);
                        merged.series.push(s);
                    }
                }
                merged.instances.push(...(data.instances ?? []));
                merged.filesProcessed += data.filesProcessed ?? 0;
                merged.errors.push(...(data.errors ?? []));
            }

            setUploadResult(merged);
            setPendingFiles([]);
            if (fileInputRef.current) fileInputRef.current.value = "";
            fetchStudies();
        } catch (err) {
            setUploadError(err.message);
        } finally {
            setUploading(false);
            setUploadProgress("");
        }
    }

    async function fetchStudies() {
        setStudiesError("");
        setStudies(null);
        setSelectedStudyId(null);
        setSelectedStudyData(null);
        try {
            const data = await pb.send("/api/visualizer/dicom/studies", {});
            console.log("Fetched studies:", data);
            setStudies(data);
        } catch (err) {
            setStudiesError(err.message);
        }
    }

    async function handleSelectStudy(studyId) {
        if (selectedStudyId === studyId) {
            // Toggle off if clicking the same study
            setSelectedStudyId(null);
            setSelectedStudyData(null);
            return;
        }

        setSelectedStudyId(studyId);
        setLoadingStudy(true);
        try {
            const data = await pb.send(
                `/api/visualizer/dicom/studies/${studyId}`,
                {},
            );
            console.log("Fetched study details:", data);
            setSelectedStudyData(data);
        } catch (err) {
            console.error("Failed to fetch study details:", err);
            setStudiesError(err.message);
        } finally {
            setLoadingStudy(false);
        }
    }

    async function handleAnonymizeStudy(study) {
        const confirmed = window.confirm(
            `Anonymize "${study.studyDescription || "this study"}"?\n\n` +
                "Patient details are permanently removed from every stored file. " +
                "This cannot be undone. Text burned into images is not removed.",
        );
        if (!confirmed) return;

        setStudiesError("");
        setAnonymizingStudyId(study.id);
        try {
            await pb.send(
                `/api/visualizer/dicom/studies/${study.id}/anonymize`,
                { method: "POST" },
            );
            await fetchStudies();
        } catch (err) {
            const details = err.response?.errors?.slice(0, 3).join("; ");
            setStudiesError(
                `Anonymization failed: ${details || err.message}`,
            );
        } finally {
            setAnonymizingStudyId(null);
        }
    }

    // mode is "stack" (slice by slice) or "mpr" (multi-planar)
    function handleViewSeries(seriesId, mode) {
        setViewingMode(mode);
        setViewingSeriesId(seriesId);
    }

    function handleCloseViewer() {
        setViewingSeriesId(null);
    }

    if (viewingSeriesId) {
        return (
            <DicomViewer
                seriesId={viewingSeriesId}
                mode={viewingMode}
                onClose={handleCloseViewer}
            />
        );
    }

    return (
        <div
            style={{
                fontFamily: "monospace",
                maxWidth: 720,
                margin: "2rem auto",
                padding: "0 1rem",
            }}
        >
            <h1>DICOM Upload Test</h1>

            {/* ── Auth ── */}
            <section style={{ marginBottom: "2rem" }}>
                <h2>1. Authenticate</h2>
                {loggedIn ? (
                    <p style={{ color: "green" }}>
                        Logged in as <code>{pb.authStore.record?.email}</code>
                        <button style={btnStyle} onClick={logout}>
                            Logout
                        </button>
                    </p>
                ) : (
                    <form
                        onSubmit={login}
                        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                    >
                        <input
                            placeholder="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            style={inputStyle}
                            type="email"
                            required
                        />
                        <input
                            placeholder="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            style={inputStyle}
                            type="password"
                            required
                        />
                        <button type="submit" style={btnStyle}>
                            Login
                        </button>
                        {authError && (
                            <span style={{ color: "red" }}>{authError}</span>
                        )}
                    </form>
                )}
            </section>

            {/* ── Upload ── */}
            <section style={{ marginBottom: "2rem" }}>
                <h2>2. Upload DICOM Files or Directories</h2>
                <form
                    onSubmit={upload}
                    style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                    }}
                >
                    <div
                        onDragOver={(e) => {
                            e.preventDefault();
                            if (loggedIn && !uploading) setDragActive(true);
                        }}
                        onDragLeave={() => setDragActive(false)}
                        onDrop={handleDrop}
                        style={{
                            ...dropZoneStyle,
                            borderColor: dragActive ? "#89b4fa" : "#555",
                            background: dragActive ? "#313244" : "#1e1e2e",
                            opacity: loggedIn ? 1 : 0.5,
                        }}
                    >
                        <p style={{ margin: "0 0 0.5rem" }}>
                            Drag and drop DICOM files or folders here, or
                            choose a folder:
                        </p>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".dcm,application/dicom"
                            multiple
                            webkitdirectory=""
                            directory=""
                            disabled={!loggedIn || uploading}
                            onChange={(e) =>
                                setPendingFiles(Array.from(e.target.files))
                            }
                        />
                        {pendingFiles.length > 0 && (
                            <p style={{ margin: "0.5rem 0 0" }}>
                                {pendingFiles.length} file(s) ready to upload
                            </p>
                        )}
                    </div>
                    <label
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={anonymize}
                            onChange={(e) => setAnonymize(e.target.checked)}
                            disabled={!loggedIn || uploading}
                        />
                        Anonymize patient data before storing
                    </label>
                    <button
                        type="submit"
                        style={btnStyle}
                        disabled={
                            !loggedIn || uploading || pendingFiles.length === 0
                        }
                    >
                        {uploading ? "Uploading…" : "Upload"}
                    </button>
                </form>
                {uploadProgress && (
                    <p style={{ color: "#cba6f7" }}>{uploadProgress}</p>
                )}
                {uploadError && <p style={{ color: "red" }}>{uploadError}</p>}
                {uploadResult && (
                    <div style={resultBoxStyle}>
                        <strong>Upload result:</strong>
                        <pre>{JSON.stringify(uploadResult, null, 2)}</pre>
                    </div>
                )}
            </section>

            {/* ── Studies list ── */}
            <section>
                <h2>3. List Studies</h2>
                <button
                    style={btnStyle}
                    disabled={!loggedIn}
                    onClick={fetchStudies}
                >
                    Fetch Studies
                </button>
                {studiesError && <p style={{ color: "red" }}>{studiesError}</p>}
                {studies && (
                    <div style={resultBoxStyle}>
                        <strong>{studies.length} study/studies found:</strong>
                        {studies.map((study, idx) => (
                            <div key={study.id} style={studyBoxStyle}>
                                <div
                                    onClick={() => handleSelectStudy(study.id)}
                                    style={{
                                        cursor: "pointer",
                                        padding: "0.5rem",
                                        borderRadius: "4px",
                                        background:
                                            selectedStudyId === study.id
                                                ? "#313244"
                                                : "transparent",
                                    }}
                                >
                                    <h3 style={{ margin: 0 }}>
                                        {selectedStudyId === study.id
                                            ? "▼"
                                            : "▶"}{" "}
                                        Study {idx + 1}:{" "}
                                        {study.studyDescription ||
                                            "No description"}
                                    </h3>
                                    <p style={{ margin: "4px 0" }}>
                                        <strong>Patient:</strong>{" "}
                                        {study.patientName || "Unknown"}
                                        {" | "}
                                        <strong>Date:</strong>{" "}
                                        {study.studyDate?.slice(0, 10) ||
                                            "Unknown"}
                                    </p>
                                    <p
                                        style={{
                                            margin: "4px 0",
                                            fontSize: "0.9em",
                                            color: "#a6adc8",
                                        }}
                                    >
                                        {study.seriesCount || 0} series ·{" "}
                                        {study.instanceCount || 0} images
                                        {study.totalSize
                                            ? ` · ${formatSize(study.totalSize)}`
                                            : ""}
                                        {study.isAnonymized && " · Anonymized"}
                                    </p>
                                </div>
                                {!study.isAnonymized && (
                                    <button
                                        style={{
                                            ...btnStyle,
                                            marginTop: "0.5rem",
                                        }}
                                        disabled={
                                            anonymizingStudyId !== null
                                        }
                                        onClick={() =>
                                            handleAnonymizeStudy(study)
                                        }
                                    >
                                        {anonymizingStudyId === study.id
                                            ? "Anonymizing…"
                                            : "Anonymize study"}
                                    </button>
                                )}

                                {selectedStudyId === study.id && (
                                    <div style={{ marginTop: "1rem" }}>
                                        {loadingStudy ? (
                                            <p
                                                style={{
                                                    color: "#cba6f7",
                                                    padding: "1rem",
                                                }}
                                            >
                                                Loading series...
                                            </p>
                                        ) : selectedStudyData &&
                                          selectedStudyData.series &&
                                          selectedStudyData.series.length >
                                              0 ? (
                                            <>
                                                <p>
                                                    <strong>
                                                        Series (
                                                        {
                                                            selectedStudyData
                                                                .series.length
                                                        }
                                                        ):
                                                    </strong>
                                                </p>
                                                {selectedStudyData.series.map(
                                                    (series) => (
                                                        <div
                                                            key={series.id}
                                                            style={
                                                                seriesBoxStyle
                                                            }
                                                        >
                                                            <div>
                                                                <strong>
                                                                    {series.seriesDescription ||
                                                                        "No description"}
                                                                </strong>
                                                                <br />
                                                                <span
                                                                    style={{
                                                                        fontSize:
                                                                            "0.9em",
                                                                        color: "#a6adc8",
                                                                    }}
                                                                >
                                                                    {
                                                                        series.modality
                                                                    }{" "}
                                                                    -{" "}
                                                                    {series.instanceCount ||
                                                                        0}{" "}
                                                                    images
                                                                    {series.is3DCapable &&
                                                                        " - multi-planar"}
                                                                </span>
                                                            </div>
                                                            <div
                                                                style={{
                                                                    display:
                                                                        "flex",
                                                                    gap: 8,
                                                                }}
                                                            >
                                                                <button
                                                                    style={
                                                                        viewBtnStyle
                                                                    }
                                                                    onClick={() =>
                                                                        handleViewSeries(
                                                                            series.id,
                                                                            "stack",
                                                                        )
                                                                    }
                                                                >
                                                                    View Series
                                                                </button>
                                                                {series.is3DCapable && (
                                                                    <button
                                                                        style={
                                                                            viewBtnStyle
                                                                        }
                                                                        onClick={() =>
                                                                            handleViewSeries(
                                                                                series.id,
                                                                                "mpr",
                                                                            )
                                                                        }
                                                                    >
                                                                        Open in
                                                                        MPR
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ),
                                                )}
                                            </>
                                        ) : (
                                            <p
                                                style={{
                                                    padding: "1rem",
                                                    color: "#a6adc8",
                                                }}
                                            >
                                                No series found for this study.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

const btnStyle = {
    padding: "6px 14px",
    cursor: "pointer",
    border: "1px solid #555",
    borderRadius: 4,
    background: "#1e1e2e",
    color: "#cdd6f4",
};

const dropZoneStyle = {
    flexBasis: "100%",
    padding: "1rem",
    border: "2px dashed #555",
    borderRadius: 6,
    color: "#cdd6f4",
};

const inputStyle = {
    padding: "6px 10px",
    border: "1px solid #555",
    borderRadius: 4,
    background: "#1e1e2e",
    color: "#cdd6f4",
};

const resultBoxStyle = {
    marginTop: "1rem",
    padding: "1rem",
    background: "#1e1e2e",
    color: "#cdd6f4",
    borderRadius: 6,
    overflowX: "auto",
};

const studyBoxStyle = {
    marginTop: "1rem",
    padding: "1rem",
    background: "#181825",
    borderRadius: 4,
};

const seriesBoxStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0.75rem",
    marginTop: "0.5rem",
    background: "#1e1e2e",
    borderRadius: 4,
    border: "1px solid #313244",
};

const viewBtnStyle = {
    padding: "6px 14px",
    cursor: "pointer",
    border: "1px solid #89b4fa",
    borderRadius: 4,
    background: "#1e1e2e",
    color: "#89b4fa",
    fontWeight: "bold",
    transition: "all 0.2s",
};
