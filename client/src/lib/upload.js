import { pb } from "@/lib/pb";

// Files sent per request, so a large study doesn't go up in one huge body
const CHUNK_SIZE = 10;

// Uploads DICOM files to a patient in chunks and merges the per-chunk
// results. `onProgress(sentFiles, totalFiles)` is called after each chunk.
export async function uploadDicomFiles(
    files,
    { patientId, anonymize = false, onProgress } = {},
) {
    const merged = {
        studyIds: [],
        series: [],
        instances: [],
        filesProcessed: 0,
        errors: [],
    };
    const seenStudyIds = new Set();
    const seenSeriesIds = new Set();

    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
        const chunk = files.slice(i, i + CHUNK_SIZE);
        const form = new FormData();
        for (const file of chunk) form.append("files", file);
        form.append("patient", patientId);
        if (anonymize) form.append("anonymize", "true");

        const data = await pb.send("/api/visualizer/dicom/upload", {
            method: "POST",
            body: form,
        });

        if (data.studyId && !seenStudyIds.has(data.studyId)) {
            seenStudyIds.add(data.studyId);
            merged.studyIds.push(data.studyId);
        }
        for (const s of data.series ?? []) {
            if (!seenSeriesIds.has(s.id)) {
                seenSeriesIds.add(s.id);
                merged.series.push(s);
            }
        }
        merged.instances.push(...(data.instances ?? []));
        merged.filesProcessed += data.filesProcessed ?? 0;
        merged.errors.push(...(data.errors ?? []));

        onProgress?.(Math.min(i + chunk.length, files.length), files.length);
    }

    return merged;
}
