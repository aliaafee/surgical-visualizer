import { useState } from "react";
import {
    PROJECTIONS,
    MAX_SLAB_THICKNESS,
    CT_PRESETS,
} from "@/lib/viewport-settings";

// Per-viewport controls: projection and slab thickness (volume viewports
// only) and window width/level. `label` names the viewport for screen readers.
export default function ViewportSettings({
    label,
    isVolume,
    isCT,
    slab,
    windowWidth,
    windowCenter,
    onSlabChange,
    onWindowChange,
}) {
    return (
        <div style={settingsStyle} onDoubleClick={(e) => e.stopPropagation()}>
            {isVolume && (
                <div style={settingsRowStyle}>
                    <label style={fieldStyle}>
                        Projection
                        <select
                            value={slab.projection}
                            onChange={(e) =>
                                onSlabChange({ projection: e.target.value })
                            }
                            style={fieldInputStyle}
                        >
                            {PROJECTIONS.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label style={{ ...fieldStyle, flex: 1, minWidth: 120 }}>
                        Thickness
                        <input
                            type="range"
                            min="1"
                            max={MAX_SLAB_THICKNESS}
                            step="1"
                            value={slab.thickness}
                            disabled={slab.projection === "none"}
                            onChange={(e) =>
                                onSlabChange({
                                    thickness: Number(e.target.value),
                                })
                            }
                            style={{ flex: 1, minWidth: 0 }}
                        />
                        <span style={{ minWidth: 52 }}>
                            {slab.projection === "none"
                                ? "—"
                                : `${slab.thickness} mm`}
                        </span>
                    </label>
                </div>
            )}
            <div style={settingsRowStyle}>
                {isCT && (
                    <label style={fieldStyle}>
                        Window
                        <select
                            value=""
                            onChange={(e) => {
                                const preset = CT_PRESETS[e.target.value];
                                if (preset) {
                                    onWindowChange(preset.width, preset.center);
                                }
                            }}
                            style={fieldInputStyle}
                        >
                            <option value="">Preset…</option>
                            {CT_PRESETS.map((preset, i) => (
                                <option key={preset.label} value={i}>
                                    {preset.label}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                <label style={fieldStyle}>
                    W
                    <NumberField
                        label={`${label} window width`}
                        value={windowWidth}
                        min={1}
                        onCommit={(width) => onWindowChange(width, windowCenter)}
                    />
                </label>
                <label style={fieldStyle}>
                    L
                    <NumberField
                        label={`${label} window level`}
                        value={windowCenter}
                        onCommit={(center) => onWindowChange(windowWidth, center)}
                    />
                </label>
            </div>
        </div>
    );
}

// Number input that only applies its value on Enter or when leaving the field,
// so half-typed numbers are never sent to the viewport
function NumberField({ label, value, min, onCommit }) {
    const [draft, setDraft] = useState(null);

    const commit = () => {
        if (draft === null) return;
        const number = parseFloat(draft);
        setDraft(null);
        if (Number.isNaN(number)) return;
        if (min !== undefined && number < min) return;
        onCommit(number);
    };

    return (
        <input
            type="number"
            aria-label={label}
            value={draft ?? (value === undefined ? "" : Math.round(value))}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === "Enter") commit();
            }}
            style={{ ...fieldInputStyle, width: 72 }}
        />
    );
}

const settingsStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    padding: "0.5rem",
    background: "#181825",
    borderTop: "1px solid #313244",
    fontSize: "0.85em",
};

const settingsRowStyle = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.75rem",
};

const fieldStyle = {
    display: "flex",
    alignItems: "center",
    gap: 6,
};

const fieldInputStyle = {
    padding: "2px 6px",
    border: "1px solid #555",
    borderRadius: 4,
    background: "#313244",
    color: "#cdd6f4",
    fontFamily: "inherit",
    fontSize: "inherit",
};
