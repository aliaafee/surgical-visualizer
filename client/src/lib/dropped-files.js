// Collects the files from a drop event, descending into dropped directories.
export async function collectDroppedFiles(dataTransfer) {
    const entries = Array.from(dataTransfer.items || [])
        .filter((item) => item.kind === "file")
        .map((item) => item.webkitGetAsEntry?.())
        .filter(Boolean);

    // Browsers without the entries API only expose top-level files
    if (entries.length === 0) {
        return Array.from(dataTransfer.files || []);
    }

    const files = [];
    await Promise.all(entries.map((entry) => walkEntry(entry, files)));
    return files;
}

async function walkEntry(entry, files) {
    if (entry.isFile) {
        files.push(await new Promise((resolve, reject) => entry.file(resolve, reject)));
        return;
    }

    if (entry.isDirectory) {
        const reader = entry.createReader();
        // readEntries returns the directory in batches until it yields none
        for (;;) {
            const batch = await new Promise((resolve, reject) =>
                reader.readEntries(resolve, reject),
            );
            if (batch.length === 0) break;
            await Promise.all(batch.map((child) => walkEntry(child, files)));
        }
    }
}
