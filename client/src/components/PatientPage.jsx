import { useCallback, useEffect, useState } from "react";
import AppHeader from "./AppHeader";
import UploadDialog from "./UploadDialog";
import { pb } from "@/lib/pb";
import { hasOrSession } from "@/lib/or-session";
import {
    btnStyle,
    colors,
    contentStyle,
    errorTextStyle,
    mutedStyle,
    pageStyle,
    panelStyle,
    primaryBtnStyle,
} from "@/lib/ui-styles";

const NO_AUTO_CANCEL = { requestKey: null };

function formatSize(bytes) {
    if (!bytes) return "";
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
    return `${(bytes / 1e6).toFixed(1)} MB`;
}

// One patient and their studies. Each study opens to its series, which can
// be viewed; new studies are uploaded straight to this patient.
export default function PatientPage({
    patientId,
    onBack,
    onViewSeries,
    onOpenOrView,
    onResumeOrView,
}) {
    const [patient, setPatient] = useState(null);
    const [error, setError] = useState("");
    const [uploading, setUploading] = useState(false);
    const [openStudyId, setOpenStudyId] = useState(null);
    // Series of each study opened so far, by study id
    const [studySeries, setStudySeries] = useState({});
    const [anonymizingId, setAnonymizingId] = useState(null);

    const loadPatient = useCallback(async () => {
        try {
            setPatient(
                await pb.send(
                    `/api/visualizer/patients/${encodeURIComponent(patientId)}`,
                    NO_AUTO_CANCEL,
                ),
            );
            setError("");
        } catch (err) {
            setError(
                err.status === 404
                    ? "This patient does not exist."
                    : err.message || "Failed to fetch patient",
            );
        }
    }, [patientId]);

    useEffect(() => {
        loadPatient();
    }, [loadPatient]);

    const toggleStudy = async (studyId) => {
        if (openStudyId === studyId) {
            setOpenStudyId(null);
            return;
        }
        setOpenStudyId(studyId);
        if (studySeries[studyId]) return;
        try {
            const data = await pb.send(
                `/api/visualizer/dicom/studies/${studyId}`,
                NO_AUTO_CANCEL,
            );
            setStudySeries((prev) => ({ ...prev, [studyId]: data.series || [] }));
        } catch (err) {
            setError(`Failed to fetch series: ${err.message}`);
        }
    };

    const anonymizeStudy = async (study) => {
        const confirmed = window.confirm(
            `Anonymize "${study.studyDescription || "this study"}"?\n\n` +
                "Patient details are permanently removed from every stored file " +
                "of this study. This cannot be undone. Text burned into images " +
                "is not removed.",
        );
        if (!confirmed) return;

        setAnonymizingId(study.id);
        try {
            await pb.send(`/api/visualizer/dicom/studies/${study.id}/anonymize`, {
                method: "POST",
            });
            await loadPatient();
        } catch (err) {
            const details = err.response?.errors?.slice(0, 3).join("; ");
            setError(`Anonymization failed: ${details || err.message}`);
        } finally {
            setAnonymizingId(null);
        }
    };

    const studies = patient?.studies || [];

    return (
        <div style={pageStyle}>
            <AppHeader>
                <button style={btnStyle} onClick={onBack}>
                    ← Patients
                </button>
            </AppHeader>
            <main style={contentStyle}>
                {error && <p style={{ ...errorTextStyle, marginBottom: "1rem" }}>{error}</p>}
                {!patient && !error && <p style={mutedStyle}>Loading patient…</p>}

                {patient && (
                    <>
                        <div style={titleRowStyle}>
                            <div>
                                <h1 style={{ margin: 0, fontSize: "1.4rem" }}>
                                    {patient.name}
                                </h1>
                                <p style={{ ...mutedStyle, margin: "4px 0 0" }}>
                                    {[
                                        patient.patientID && `ID ${patient.patientID}`,
                                        patient.birthDate && `born ${patient.birthDate}`,
                                        patient.sex,
                                    ]
                                        .filter(Boolean)
                                        .join(" · ") || "No details recorded"}
                                </p>
                            </div>
                            <div style={actionsStyle}>
                                <button
                                    style={btnStyle}
                                    onClick={onOpenOrView}
                                    disabled={!studies.length}
                                    title="Start the OR view with an empty grid"
                                >
                                    Open OR view
                                </button>
                                <button
                                    style={btnStyle}
                                    onClick={onResumeOrView}
                                    disabled={
                                        !studies.length || !hasOrSession(patientId)
                                    }
                                    title="Reopen the OR view as it was last left"
                                >
                                    Resume last OR session
                                </button>
                                <button
                                    style={primaryBtnStyle}
                                    onClick={() => setUploading(true)}
                                >
                                    Upload study
                                </button>
                            </div>
                        </div>

                        <h2 style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>
                            Studies ({studies.length})
                        </h2>
                        {studies.length === 0 && (
                            <p style={mutedStyle}>
                                No studies yet. Use Upload study to add one.
                            </p>
                        )}

                        <ul style={listStyle}>
                            {studies.map((study) => {
                                const open = openStudyId === study.id;
                                const series = studySeries[study.id];
                                return (
                                    <li key={study.id} style={studyStyle}>
                                        <button
                                            style={studyRowStyle}
                                            onClick={() => toggleStudy(study.id)}
                                            aria-expanded={open}
                                        >
                                            <span style={{ fontWeight: "bold" }}>
                                                {open ? "▼" : "▶"}{" "}
                                                {study.studyDescription || "No description"}
                                            </span>
                                            <span style={mutedStyle}>
                                                {[
                                                    study.studyDate?.slice(0, 10),
                                                    study.modality,
                                                    `${study.seriesCount || 0} series`,
                                                    `${study.instanceCount || 0} images`,
                                                    formatSize(study.totalSize),
                                                    study.isAnonymized && "Anonymized",
                                                ]
                                                    .filter(Boolean)
                                                    .join(" · ")}
                                            </span>
                                        </button>

                                        {open && (
                                            <div style={seriesPanelStyle}>
                                                {!series && (
                                                    <p style={mutedStyle}>Loading series…</p>
                                                )}
                                                {series?.length === 0 && (
                                                    <p style={mutedStyle}>
                                                        No series in this study.
                                                    </p>
                                                )}
                                                {series?.map((s) => (
                                                    <div key={s.id} style={seriesRowStyle}>
                                                        <div style={{ minWidth: 0 }}>
                                                            <div>
                                                                {s.seriesNumber} ·{" "}
                                                                {s.seriesDescription ||
                                                                    "No description"}
                                                            </div>
                                                            <div style={{ ...mutedStyle, fontSize: "0.9em" }}>
                                                                {s.modality} · {s.instanceCount || 0}{" "}
                                                                images
                                                                {s.is3DCapable && " · multi-planar"}
                                                            </div>
                                                        </div>
                                                        <div style={actionsStyle}>
                                                            <button
                                                                style={primaryBtnStyle}
                                                                onClick={() =>
                                                                    onViewSeries(s.id, "stack")
                                                                }
                                                            >
                                                                View
                                                            </button>
                                                            {s.is3DCapable && (
                                                                <button
                                                                    style={primaryBtnStyle}
                                                                    onClick={() =>
                                                                        onViewSeries(s.id, "mpr")
                                                                    }
                                                                >
                                                                    MPR
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                                {!study.isAnonymized && (
                                                    <button
                                                        style={{ ...btnStyle, alignSelf: "flex-start" }}
                                                        onClick={() => anonymizeStudy(study)}
                                                        disabled={anonymizingId !== null}
                                                    >
                                                        {anonymizingId === study.id
                                                            ? "Anonymizing…"
                                                            : "Anonymize study"}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                )}
            </main>

            {uploading && patient && (
                <UploadDialog
                    patient={patient}
                    onClose={() => setUploading(false)}
                    onDone={() => {
                        setUploading(false);
                        loadPatient();
                    }}
                />
            )}
        </div>
    );
}

const titleRowStyle = {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "0.75rem",
    marginBottom: "1.5rem",
};

const actionsStyle = {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
};

const listStyle = {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
};

const studyStyle = {
    ...panelStyle,
    overflow: "hidden",
};

const studyRowStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    width: "100%",
    padding: "0.75rem 1rem",
    border: "none",
    background: "transparent",
    color: colors.text,
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
};

const seriesPanelStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    padding: "0 1rem 1rem",
};

const seriesRowStyle = {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.75rem",
    background: colors.raised,
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
};
