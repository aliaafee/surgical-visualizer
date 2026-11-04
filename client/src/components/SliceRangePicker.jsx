import { useState } from "react";
import {
    MIN_VOLUME_SLICES,
    normalizeSliceRange,
    sliceRangeCount,
} from "@/lib/slice-range";

// Chooses whether a volume is built from the whole series or part of it:
// a run of slices, optionally taking only every nth one. Reports the
// normalized range (null for the whole series) through onChange.
export default function SliceRangePicker({ total, value, onChange, idPrefix }) {
    const initial = normalizeSliceRange(value, total);
    const [partial, setPartial] = useState(Boolean(initial));
    const [draft, setDraft] = useState(
        initial || { start: 1, end: total, step: 1 },
    );

    if (total < MIN_VOLUME_SLICES + 1) return null;

    const report = (nextPartial, nextDraft) =>
        onChange(nextPartial ? normalizeSliceRange(nextDraft, total) : null);

    const setPart = (nextPartial) => {
        setPartial(nextPartial);
        report(nextPartial, draft);
    };

    const setField = (field, raw) => {
        const next = { ...draft, [field]: raw };
        setDraft(next);
        report(partial, next);
    };

    // Typed values are tidied once the field is left
    const tidy = () => {
        const r = normalizeSliceRange(draft, total) || {
            start: 1,
            end: total,
            step: 1,
        };
        setDraft(r);
    };

    const range = normalizeSliceRange(partial ? draft : null, total);
    const count = sliceRangeCount(range, total);
    const shown = range || { start: 1, end: total, step: 1 };
    const name = `${idPrefix || "slices"}-extent`;

    return (
        <fieldset style={fieldsetStyle}>
            <legend style={legendStyle}>Slices to load</legend>
            <label style={rowStyle}>
                <input
                    type="radio"
                    name={name}
                    checked={!partial}
                    onChange={() => setPart(false)}
                />
                Whole series ({total})
            </label>
            <label style={rowStyle}>
                <input
                    type="radio"
                    name={name}
                    checked={partial}
                    onChange={() => setPart(true)}
                />
                Part of the series
            </label>

            {partial && (
                <div style={partStyle}>
                    <div style={rowStyle}>
                        <span style={fieldLabelStyle}>From</span>
                        <input
                            type="range"
                            min={1}
                            max={total}
                            value={shown.start}
                            onChange={(e) => setField("start", e.target.value)}
                            onMouseUp={tidy}
                            onKeyUp={tidy}
                            style={sliderStyle}
                            aria-label="First slice"
                        />
                        <input
                            type="number"
                            min={1}
                            max={total - 1}
                            value={draft.start}
                            onChange={(e) => setField("start", e.target.value)}
                            onBlur={tidy}
                            style={numberStyle}
                            aria-label="First slice number"
                        />
                    </div>
                    <div style={rowStyle}>
                        <span style={fieldLabelStyle}>To</span>
                        <input
                            type="range"
                            min={1}
                            max={total}
                            value={shown.end}
                            onChange={(e) => setField("end", e.target.value)}
                            onMouseUp={tidy}
                            onKeyUp={tidy}
                            style={sliderStyle}
                            aria-label="Last slice"
                        />
                        <input
                            type="number"
                            min={2}
                            max={total}
                            value={draft.end}
                            onChange={(e) => setField("end", e.target.value)}
                            onBlur={tidy}
                            style={numberStyle}
                            aria-label="Last slice number"
                        />
                    </div>
                    <div style={rowStyle}>
                        <span style={fieldLabelStyle}>Every</span>
                        <input
                            type="number"
                            min={1}
                            max={Math.max(1, shown.end - shown.start)}
                            value={draft.step}
                            onChange={(e) => setField("step", e.target.value)}
                            onBlur={tidy}
                            style={numberStyle}
                            aria-label="Take every nth slice"
                        />
                        <span>slice(s)</span>
                    </div>
                </div>
            )}

            <div style={summaryStyle}>
                Loads {count} of {total} slices
                {count < total &&
                    ` (about ${Math.round((count / total) * 100)}% of the memory)`}
            </div>
        </fieldset>
    );
}

const fieldsetStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    margin: 0,
    padding: "8px 10px",
    border: "1px solid #45475a",
    borderRadius: 4,
    minWidth: 0,
};

const legendStyle = {
    padding: "0 4px",
    color: "#a6adc8",
    fontSize: "0.85em",
};

const rowStyle = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
};

const partStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingLeft: 22,
};

const fieldLabelStyle = {
    width: 42,
    flexShrink: 0,
};

const sliderStyle = {
    flex: 1,
    minWidth: 0,
};

const numberStyle = {
    width: 64,
    background: "#181825",
    color: "#cdd6f4",
    border: "1px solid #45475a",
    borderRadius: 3,
    padding: "2px 4px",
    fontFamily: "inherit",
};

const summaryStyle = {
    color: "#a6adc8",
    fontSize: "0.85em",
};
