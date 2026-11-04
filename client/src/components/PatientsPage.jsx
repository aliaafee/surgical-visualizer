import { useEffect, useMemo, useState } from "react";
import AppHeader from "./AppHeader";
import UploadDialog from "./UploadDialog";
import { fetchPatients } from "@/lib/patients";
import {
    colors,
    contentStyle,
    errorTextStyle,
    inputStyle,
    mutedStyle,
    pageStyle,
    panelStyle,
    primaryBtnStyle,
} from "@/lib/ui-styles";

const NO_AUTO_CANCEL = { requestKey: null };

// Every patient, searchable by name, patient ID or birth date. Uploading
// from here creates a new patient for the files.
export default function PatientsPage({ onOpenPatient }) {
    const [patients, setPatients] = useState(null);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        let isCancelled = false;
        fetchPatients(NO_AUTO_CANCEL)
            .then((data) => {
                if (!isCancelled) setPatients(data);
            })
            .catch((err) => {
                if (!isCancelled) setError(err.message || "Failed to fetch patients");
            });
        return () => {
            isCancelled = true;
        };
    }, []);

    const shown = useMemo(() => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (!patients || !words.length) return patients;
        // Every word typed has to appear somewhere in the patient's details
        return patients.filter((patient) => {
            const haystack = [patient.name, patient.patientID, patient.birthDate]
                .join(" ")
                .toLowerCase();
            return words.every((word) => haystack.includes(word));
        });
    }, [patients, query]);

    return (
        <div style={pageStyle}>
            <AppHeader />
            <main style={contentStyle}>
                <div style={titleRowStyle}>
                    <h1 style={{ margin: 0, fontSize: "1.4rem" }}>Patients</h1>
                    <button style={primaryBtnStyle} onClick={() => setUploading(true)}>
                        Upload
                    </button>
                </div>

                <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name, patient ID or birth date"
                    style={{ ...inputStyle, width: "100%", marginBottom: "1rem" }}
                    aria-label="Search patients"
                    autoFocus
                />

                {error && <p style={errorTextStyle}>{error}</p>}
                {!patients && !error && <p style={mutedStyle}>Loading patients…</p>}
                {patients?.length === 0 && (
                    <p style={mutedStyle}>
                        No patients yet. Use Upload to add the first one.
                    </p>
                )}
                {patients?.length > 0 && shown.length === 0 && (
                    <p style={mutedStyle}>No patients match “{query}”.</p>
                )}

                {shown?.length > 0 && (
                    <ul style={listStyle}>
                        {shown.map((patient) => (
                            <li key={patient.id}>
                                <button
                                    style={rowStyle}
                                    onClick={() => onOpenPatient(patient.id)}
                                >
                                    <span style={{ fontWeight: "bold" }}>
                                        {patient.name}
                                    </span>
                                    <span style={detailsStyle}>
                                        {[
                                            patient.patientID && `ID ${patient.patientID}`,
                                            patient.birthDate && `born ${patient.birthDate}`,
                                            patient.sex,
                                        ]
                                            .filter(Boolean)
                                            .join(" · ") || "No details"}
                                    </span>
                                    <span style={countStyle}>
                                        {patient.studyCount}{" "}
                                        {patient.studyCount === 1 ? "study" : "studies"}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </main>

            {uploading && (
                <UploadDialog
                    onClose={() => setUploading(false)}
                    onDone={(patientId) => onOpenPatient(patientId)}
                />
            )}
        </div>
    );
}

const titleRowStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "1rem",
};

const listStyle = {
    ...panelStyle,
    listStyle: "none",
    margin: 0,
    padding: 0,
    overflow: "hidden",
};

const rowStyle = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: "0.25rem 1rem",
    width: "100%",
    padding: "0.75rem 1rem",
    border: "none",
    borderBottom: `1px solid ${colors.border}`,
    background: "transparent",
    color: colors.text,
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
};

const detailsStyle = {
    ...mutedStyle,
    flex: 1,
    minWidth: 0,
};

const countStyle = {
    ...mutedStyle,
    whiteSpace: "nowrap",
};
