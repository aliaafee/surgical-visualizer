import { useState, useRef } from "react";
import PocketBase from "pocketbase";
import DicomViewer from "./DicomViewer";

const pb = new PocketBase("http://127.0.0.1:8090");

export default function DicomUploadTest() {
    const [loggedIn, setLoggedIn] = useState(pb.authStore.isValid);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [authError, setAuthError] = useState("");

    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState("");
    const [uploadResult, setUploadResult] = useState(null);
    const [uploadError, setUploadError] = useState("");

    const [studies, setStudies] = useState(null);
    const [studiesError, setStudiesError] = useState("");

    const [selectedStudyId, setSelectedStudyId] = useState(null);
    const [selectedStudyData, setSelectedStudyData] = useState(null);
    const [loadingStudy, setLoadingStudy] = useState(false);

    const [viewingSeriesId, setViewingSeriesId] = useState(null);

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

    async function upload(e) {
        e.preventDefault();
        const files = Array.from(fileInputRef.current?.files ?? []);
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

    function handleViewSeries(seriesId) {
        setViewingSeriesId(seriesId);
    }

    function handleCloseViewer() {
        setViewingSeriesId(null);
    }

    if (viewingSeriesId) {
        return (
            <DicomViewer
                seriesId={viewingSeriesId}
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
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".dcm,application/dicom"
                        multiple
                        webkitdirectory=""
                        directory=""
                        disabled={!loggedIn}
                    />
                    <button
                        type="submit"
                        style={btnStyle}
                        disabled={!loggedIn || uploading}
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
                                        {study.studyDate || "Unknown"}
                                    </p>
                                </div>

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
                                                                    {
                                                                        series.instanceCount
                                                                    }{" "}
                                                                    images
                                                                </span>
                                                            </div>
                                                            <button
                                                                style={
                                                                    viewBtnStyle
                                                                }
                                                                onClick={() =>
                                                                    handleViewSeries(
                                                                        series.id,
                                                                    )
                                                                }
                                                            >
                                                                View Series
                                                            </button>
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
