import { useState, useRef, useEffect, useCallback } from "react";
import DicomViewer from "./DicomViewer";
import PatientPicker from "./PatientPicker";
import { pb } from "@/lib/pb";
import { collectDroppedFiles } from "@/lib/dropped-files";
import { fetchPatients } from "@/lib/patients";
import { uploadDicomFiles } from "@/lib/upload";

function formatSize(bytes) {
    if (!bytes) return "";
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
    return `${(bytes / 1e6).toFixed(1)} MB`;
}

export default function DicomUploadTest({ onOpenOrView }) {
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

    const [patients, setPatients] = useState(null);
    const [patient, setPatient] = useState(null);

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
        setPatients(null);
        setPatient(null);
        setStudies(null);
    }

    // Refreshes the patient list (and so the study counts in it)
    const loadPatients = useCallback(async () => {
        try {
            setPatients(await fetchPatients());
        } catch (err) {
            setStudiesError(`Failed to fetch patients: ${err.message}`);
        }
    }, []);

    useEffect(() => {
        if (loggedIn) loadPatients();
    }, [loggedIn, loadPatients]);

    const fetchStudies = useCallback(async () => {
        setStudiesError("");
        setStudies(null);
        setSelectedStudyId(null);
        setSelectedStudyData(null);
        if (!patient) return;
        try {
            const data = await pb.send(
                `/api/visualizer/dicom/studies?patient=${encodeURIComponent(patient.id)}`,
                {},
            );
            setStudies(data);
        } catch (err) {
            setStudiesError(err.message);
        }
    }, [patient]);

    // The study list always shows the chosen patient's studies
    useEffect(() => {
        fetchStudies();
    }, [fetchStudies]);

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
        if (files.length === 0 || !patient) return;

        setUploading(true);
        setUploadResult(null);
        setUploadError("");
        setUploadProgress("");

        try {
            const merged = await uploadDicomFiles(files, {
                patientId: patient.id,
                anonymize,
                onProgress: (sent, total) =>
                    setUploadProgress(`Uploaded ${sent} of ${total} files…`),
            });
            setUploadResult(merged);
            setPendingFiles([]);
            if (fileInputRef.current) fileInputRef.current.value = "";
            fetchStudies();
            loadPatients();
        } catch (err) {
            setUploadError(err.response?.error || err.message);
        } finally {
            setUploading(false);
            setUploadProgress("");
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
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                }}
            >
                <h1>DICOM Upload Test</h1>
                {onOpenOrView && (
                    <button
                        style={viewBtnStyle}
                        disabled={!loggedIn}
                        onClick={() => onOpenOrView()}
                    >
                        Open OR View
                    </button>
                )}
            </div>

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

            {/* ── Patient ── */}
            <section style={{ marginBottom: "2rem" }}>
                <h2>2. Choose a Patient</h2>
                {loggedIn ? (
                    <PatientPicker
                        patients={patients}
                        selectedId={patient?.id}
                        onSelect={setPatient}
                        onCreated={(created) => {
                            setPatients((prev) =>
                                [...(prev || []), created].sort((a, b) =>
                                    a.name.localeCompare(b.name),
                                ),
                            );
                            setPatient(created);
                        }}
                        files={pendingFiles}
                        disabled={uploading}
                    />
                ) : (
                    <p style={{ color: "#a6adc8" }}>Log in first.</p>
                )}
            </section>

            {/* ── Upload ── */}
            <section style={{ marginBottom: "2rem" }}>
                <h2>3. Upload DICOM Files or Directories</h2>
                {patient ? (
                    <p style={{ margin: "0 0 0.5rem" }}>
                        Studies will be filed under{" "}
                        <strong>{patient.name}</strong>.
                    </p>
                ) : (
                    <p style={{ margin: "0 0 0.5rem", color: "#a6adc8" }}>
                        Choose or create the patient these files belong to
                        before uploading.
                    </p>
                )}
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
                            !loggedIn ||
                            uploading ||
                            !patient ||
                            pendingFiles.length === 0
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
                <h2>
                    4. {patient ? `${patient.name}'s Studies` : "Studies"}
                </h2>
                {patient ? (
                    <button style={btnStyle} onClick={fetchStudies}>
                        Refresh
                    </button>
                ) : (
                    <p style={{ color: "#a6adc8" }}>
                        Choose a patient to see their studies.
                    </p>
                )}
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
