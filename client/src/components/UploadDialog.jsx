import { useEffect, useRef, useState } from "react";
import { collectDroppedFiles } from "@/lib/dropped-files";
import { createPatient, readPatientFromFiles } from "@/lib/patients";
import { uploadDicomFiles } from "@/lib/upload";
import {
    btnStyle,
    colors,
    errorTextStyle,
    inputStyle,
    mutedStyle,
    panelStyle,
    primaryBtnStyle,
} from "@/lib/ui-styles";

const EMPTY_PATIENT = { name: "", patientID: "", birthDate: "", sex: "" };

// Uploads DICOM files to `patient`, or without one first creates the patient
// (its details filled in from the chosen files until edited by hand).
// `onDone(patientId)` is called once the files are in.
export default function UploadDialog({ patient: givenPatient, onClose, onDone }) {
    const [patient, setPatient] = useState(givenPatient || null);
    const [draft, setDraft] = useState(EMPTY_PATIENT);
    const [draftEdited, setDraftEdited] = useState(false);
    const [files, setFiles] = useState([]);
    const [anonymize, setAnonymize] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState("");
    const [error, setError] = useState("");
    const [result, setResult] = useState(null);

    const folderInputRef = useRef(null);
    const fileInputRef = useRef(null);

    // Close on Escape, unless that would abandon an upload in progress
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape" && !busy) onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [busy, onClose]);

    const chooseFiles = async (chosen) => {
        setFiles(chosen);
        setResult(null);
        setError("");
        if (!patient && !draftEdited && chosen.length) {
            const fromFiles = await readPatientFromFiles(chosen);
            if (fromFiles) setDraft(fromFiles);
        }
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        setDragActive(false);
        if (busy) return;
        try {
            chooseFiles(await collectDroppedFiles(e.dataTransfer));
        } catch (err) {
            setError(`Could not read the dropped files: ${err.message}`);
        }
    };

    const editDraft = (key, value) => {
        setDraftEdited(true);
        setDraft((prev) => ({ ...prev, [key]: value }));
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!files.length) return;
        setBusy(true);
        setError("");
        setResult(null);

        let target = patient;
        try {
            if (!target) {
                setProgress("Creating patient…");
                target = await createPatient(draft);
                // Kept even if the upload then fails, so a retry goes to
                // the same patient rather than creating another
                setPatient(target);
            }

            const uploaded = await uploadDicomFiles(files, {
                patientId: target.id,
                anonymize,
                onProgress: (sent, total) =>
                    setProgress(`Uploading ${sent} of ${total} files…`),
            });
            setResult(uploaded);
            setFiles([]);
            if (folderInputRef.current) folderInputRef.current.value = "";
            if (fileInputRef.current) fileInputRef.current.value = "";
            if (!uploaded.errors.length) onDone(target.id);
        } catch (err) {
            setError(err.response?.error || err.message || "Upload failed");
        } finally {
            setBusy(false);
            setProgress("");
        }
    };

    const field = (key, label, props = {}) => (
        <label style={fieldStyle}>
            {label}
            <input
                value={draft[key]}
                onChange={(e) => editDraft(key, e.target.value)}
                style={inputStyle}
                disabled={busy}
                {...props}
            />
        </label>
    );

    return (
        <div
            style={backdropStyle}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget && !busy) onClose();
            }}
        >
            <form
                onSubmit={submit}
                style={dialogStyle}
                role="dialog"
                aria-modal="true"
                aria-labelledby="upload-dialog-title"
            >
                <h2 id="upload-dialog-title" style={{ margin: 0 }}>
                    {patient ? `Upload study for ${patient.name}` : "New patient"}
                </h2>

                {!patient && (
                    <>
                        <p style={{ ...mutedStyle, margin: 0 }}>
                            Uploaded studies are filed under a patient. Choose
                            the files first and the details are filled in from
                            them.
                        </p>
                        <div style={fieldGridStyle}>
                            {field("name", "Name *", { required: true })}
                            {field("patientID", "Patient ID")}
                            {field("birthDate", "Birth date", {
                                placeholder: "YYYY-MM-DD",
                            })}
                            {field("sex", "Sex", { placeholder: "M, F or O" })}
                        </div>
                    </>
                )}

                <div
                    onDragOver={(e) => {
                        e.preventDefault();
                        if (!busy) setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    style={{
                        ...dropZoneStyle,
                        borderColor: dragActive ? colors.accent : colors.borderStrong,
                        background: dragActive ? colors.border : colors.raised,
                    }}
                >
                    <p style={{ margin: 0 }}>
                        Drop DICOM files or folders here, or
                    </p>
                    <div style={rowStyle}>
                        <button
                            type="button"
                            style={btnStyle}
                            onClick={() => folderInputRef.current?.click()}
                            disabled={busy}
                        >
                            Choose folder
                        </button>
                        <button
                            type="button"
                            style={btnStyle}
                            onClick={() => fileInputRef.current?.click()}
                            disabled={busy}
                        >
                            Choose files
                        </button>
                    </div>
                    <input
                        ref={folderInputRef}
                        type="file"
                        multiple
                        webkitdirectory=""
                        directory=""
                        hidden
                        onChange={(e) => chooseFiles(Array.from(e.target.files))}
                    />
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".dcm,application/dicom"
                        multiple
                        hidden
                        onChange={(e) => chooseFiles(Array.from(e.target.files))}
                    />
                    <p style={{ ...mutedStyle, margin: 0 }}>
                        {files.length
                            ? `${files.length} file(s) ready to upload`
                            : "No files chosen"}
                    </p>
                </div>

                <label style={checkboxStyle}>
                    <input
                        type="checkbox"
                        checked={anonymize}
                        onChange={(e) => setAnonymize(e.target.checked)}
                        disabled={busy}
                    />
                    Anonymize patient data in the files before storing
                </label>

                {progress && <p style={{ margin: 0, color: colors.accent }}>{progress}</p>}
                {error && <p style={errorTextStyle}>{error}</p>}
                {result && (
                    <div style={resultStyle}>
                        <p style={{ margin: 0 }}>
                            {result.filesProcessed} file(s) stored in{" "}
                            {result.series.length} series.
                        </p>
                        {result.errors.length > 0 && (
                            <>
                                <p style={errorTextStyle}>
                                    {result.errors.length} file(s) were not
                                    stored:
                                </p>
                                <ul style={errorListStyle}>
                                    {result.errors.slice(0, 20).map((msg, i) => (
                                        <li key={i}>{msg}</li>
                                    ))}
                                    {result.errors.length > 20 && (
                                        <li>…and {result.errors.length - 20} more</li>
                                    )}
                                </ul>
                            </>
                        )}
                    </div>
                )}

                <div style={{ ...rowStyle, justifyContent: "flex-end" }}>
                    {result?.errors.length > 0 && patient ? (
                        <button
                            type="button"
                            style={btnStyle}
                            onClick={() => onDone(patient.id)}
                        >
                            Done
                        </button>
                    ) : (
                        <button
                            type="button"
                            style={btnStyle}
                            onClick={onClose}
                            disabled={busy}
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        type="submit"
                        style={primaryBtnStyle}
                        disabled={busy || !files.length}
                    >
                        {busy
                            ? "Working…"
                            : patient
                              ? "Upload"
                              : "Create patient and upload"}
                    </button>
                </div>
            </form>
        </div>
    );
}

const backdropStyle = {
    position: "fixed",
    inset: 0,
    zIndex: 10,
    display: "grid",
    placeItems: "center",
    padding: 16,
    background: "rgba(0, 0, 0, 0.6)",
    overflowY: "auto",
};

const dialogStyle = {
    ...panelStyle,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    width: "100%",
    maxWidth: 560,
    padding: "1.25rem",
    boxSizing: "border-box",
    color: colors.text,
    fontFamily: "monospace",
};

const fieldGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "0.5rem",
};

const fieldStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: "0.9em",
};

const dropZoneStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    padding: "1rem",
    border: "2px dashed",
    borderRadius: 6,
};

const rowStyle = {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
};

const checkboxStyle = {
    display: "flex",
    alignItems: "center",
    gap: 6,
};

const resultStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "0.75rem",
    background: colors.raised,
    borderRadius: 4,
};

const errorListStyle = {
    margin: 0,
    paddingLeft: "1.25rem",
    maxHeight: 160,
    overflowY: "auto",
    fontSize: "0.85em",
    color: colors.error,
};
