import dicomParser from "dicom-parser";
import { pb } from "@/lib/pb";

export async function fetchPatients(options = {}) {
    return pb.send("/api/visualizer/patients", options);
}

export async function createPatient(patient) {
    return pb.send("/api/visualizer/patients", {
        method: "POST",
        body: patient,
    });
}

// How a patient is named in pickers, e.g. "Jane Doe · ID 1234 · 2 studies"
export function patientLabel(patient) {
    return [
        patient.name,
        patient.patientID && `ID ${patient.patientID}`,
        patient.birthDate && `born ${patient.birthDate}`,
        patient.studyCount != null &&
            `${patient.studyCount} ${patient.studyCount === 1 ? "study" : "studies"}`,
    ]
        .filter(Boolean)
        .join(" · ");
}

// DICOM YYYYMMDD as YYYY-MM-DD, the way the server stores dates
function formatDicomDate(value) {
    return /^\d{8}$/.test(value)
        ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
        : value;
}

// The patient details in the first readable DICOM file among `files`, to
// prefill a new patient. Null when none of them can be read.
export async function readPatientFromFiles(files, maxTries = 5) {
    for (const file of files.slice(0, maxTries)) {
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            // Stop before the pixel data; only the header is needed
            const dataSet = dicomParser.parseDicom(bytes, {
                untilTag: "x7fe00010",
            });
            const read = (tag) => (dataSet.string(tag) || "").trim();
            return {
                // Person names separate their parts with ^
                name: read("x00100010").replace(/\^+/g, " ").trim(),
                patientID: read("x00100020"),
                birthDate: formatDicomDate(read("x00100030")),
                sex: read("x00100040"),
            };
        } catch {
            // Not a DICOM file (e.g. DICOMDIR or a stray file); try the next
        }
    }
    return null;
}
