import { useState } from "react";
import {
    createPatient,
    patientLabel,
    readPatientFromFiles,
} from "@/lib/patients";

const EMPTY_PATIENT = { name: "", patientID: "", birthDate: "", sex: "" };

// Choose one of `patients`, or create a new one. `files` (optional) are DICOM
// files the new patient's details can be filled in from.
export default function PatientPicker({
    patients,
    selectedId,
    onSelect,
    onCreated,
    files = [],
    disabled = false,
    allowCreate = true,
}) {
    const [creating, setCreating] = useState(false);
    const [draft, setDraft] = useState(EMPTY_PATIENT);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const startCreating = async () => {
        setError("");
        setCreating(true);
        setDraft(EMPTY_PATIENT);
        if (files.length) {
            const fromFiles = await readPatientFromFiles(files);
            if (fromFiles) setDraft(fromFiles);
        }
    };

    const fillFromFiles = async () => {
        const fromFiles = await readPatientFromFiles(files);
        if (fromFiles) {
            setDraft(fromFiles);
        } else {
            setError("None of the chosen files could be read as DICOM");
        }
    };

    const save = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        try {
            const patient = await createPatient(draft);
            setCreating(false);
            onCreated(patient);
        } catch (err) {
            setError(err.response?.error || err.message);
        } finally {
            setSaving(false);
        }
    };

    const field = (key, label, props = {}) => (
        <label style={fieldStyle}>
            {label}
            <input
                value={draft[key]}
                onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [key]: e.target.value }))
                }
                style={inputStyle}
                disabled={saving}
                {...props}
            />
        </label>
    );

    if (creating) {
        return (
            <form onSubmit={save} style={formStyle}>
                {field("name", "Name *", { required: true, autoFocus: true })}
                {field("patientID", "Patient ID")}
                {field("birthDate", "Birth date", {
                    placeholder: "YYYY-MM-DD",
                })}
                {field("sex", "Sex", { placeholder: "M, F or O", size: 6 })}
                <div style={rowStyle}>
                    <button type="submit" style={btnStyle} disabled={saving}>
                        {saving ? "Saving…" : "Create patient"}
                    </button>
                    {files.length > 0 && (
                        <button
                            type="button"
                            style={btnStyle}
                            onClick={fillFromFiles}
                            disabled={saving}
                        >
                            Fill from chosen files
                        </button>
                    )}
                    <button
                        type="button"
                        style={btnStyle}
                        onClick={() => setCreating(false)}
                        disabled={saving}
                    >
                        Cancel
                    </button>
                </div>
                {error && <span style={{ color: "red" }}>{error}</span>}
            </form>
        );
    }

    return (
        <div style={rowStyle}>
            <select
                value={selectedId || ""}
                onChange={(e) =>
                    onSelect(
                        patients.find((p) => p.id === e.target.value) || null,
                    )
                }
                style={inputStyle}
                disabled={disabled || !patients}
            >
                <option value="">
                    {!patients
                        ? "Loading patients…"
                        : patients.length
                          ? "Choose a patient…"
                          : "No patients yet"}
                </option>
                {patients?.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                        {patientLabel(patient)}
                    </option>
                ))}
            </select>
            {allowCreate && (
                <button
                    type="button"
                    style={btnStyle}
                    onClick={startCreating}
                    disabled={disabled}
                >
                    New patient
                </button>
            )}
        </div>
    );
}

const rowStyle = {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
};

const formStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    alignItems: "flex-start",
};

const fieldStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    fontSize: "0.9em",
};

const inputStyle = {
    padding: "6px 10px",
    border: "1px solid #555",
    borderRadius: 4,
    background: "#1e1e2e",
    color: "#cdd6f4",
    maxWidth: "100%",
};

const btnStyle = {
    padding: "6px 14px",
    cursor: "pointer",
    border: "1px solid #555",
    borderRadius: 4,
    background: "#1e1e2e",
    color: "#cdd6f4",
};
