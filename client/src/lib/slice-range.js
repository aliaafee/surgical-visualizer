// A part of a series to load as a volume: slices `start` to `end` (1-based,
// inclusive, in instance order), taking every `step`th one. null means the
// whole series.

// A volume needs at least this many slices
export const MIN_VOLUME_SLICES = 2;

// The range made valid for a series of `total` slices; null when it covers
// the whole series
export function normalizeSliceRange(range, total) {
    if (!range || total < MIN_VOLUME_SLICES) return null;
    const int = (value, fallback) => {
        const n = Math.round(Number(value));
        return Number.isFinite(n) ? n : fallback;
    };
    const start = Math.min(Math.max(1, int(range.start, 1)), total - 1);
    const end = Math.min(Math.max(start + 1, int(range.end, total)), total);
    const step = Math.min(Math.max(1, int(range.step, 1)), end - start);
    if (start === 1 && end === total && step === 1) return null;
    return { start, end, step };
}

// How many slices a range takes from a series of `total`
export function sliceRangeCount(range, total) {
    const r = normalizeSliceRange(range, total);
    if (!r) return total;
    return Math.floor((r.end - r.start) / r.step) + 1;
}

// The items (image IDs, instances…) a range takes from the series' list
export function selectSlices(items, range) {
    const r = normalizeSliceRange(range, items.length);
    if (!r) return items;
    const picked = [];
    for (let i = r.start - 1; i < r.end; i += r.step) picked.push(items[i]);
    return picked;
}

// Distinguishes the volumes built from different parts of one series
export function sliceRangeKey(range, total) {
    const r = normalizeSliceRange(range, total);
    return r ? `${r.start}-${r.end}-${r.step}` : "all";
}

// e.g. "slices 20–180, every 2nd (81 of 240)"; empty for the whole series
export function sliceRangeLabel(range, total) {
    const r = normalizeSliceRange(range, total);
    if (!r) return "";
    const every = r.step > 1 ? `, every ${ordinal(r.step)}` : "";
    return `slices ${r.start}–${r.end}${every} (${sliceRangeCount(r, total)} of ${total})`;
}

function ordinal(n) {
    const tens = n % 100;
    if (tens >= 11 && tens <= 13) return `${n}th`;
    return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}
