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

// Controls for a 3D (volume-rendered) viewport. `settings` holds
//   preset   which transfer function colours the volume
//   shift    how far its opacity ramp is moved (volume units)
//   crop     whether the crop box is on
//   cut      id of the plane the volume is cut along, or null
//   cutFlip  whether the cut keeps the other side
// and `onChange(patch)` changes some of them. `presets` and `cutOptions`
// are { id, label }; `shiftRange` is { max, step, unit }. The crop box and a
// cut can't both be on, so turning one on turns the other off.
export function Volume3DSettings({
    label,
    presets,
    shiftRange,
    cutOptions,
    settings,
    onChange,
}) {
    const { preset, shift, crop, cut, cutFlip } = settings;
    const unit = shiftRange.unit ? ` ${shiftRange.unit}` : "";

    return (
        <div style={settingsStyle} onDoubleClick={(e) => e.stopPropagation()}>
            <div style={settingsRowStyle}>
                <label style={fieldStyle}>
                    Rendering
                    <select
                        value={preset}
                        onChange={(e) => onChange({ preset: e.target.value })}
                        style={fieldInputStyle}
                        aria-label={`${label} rendering preset`}
                    >
                        {presets.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label style={{ ...fieldStyle, flex: 1, minWidth: 160 }}>
                    Opacity shift
                    <input
                        type="range"
                        min={-shiftRange.max}
                        max={shiftRange.max}
                        step={shiftRange.step}
                        value={shift}
                        onChange={(e) =>
                            onChange({ shift: Number(e.target.value) })
                        }
                        style={{ flex: 1, minWidth: 0 }}
                        aria-label={`${label} opacity shift`}
                    />
                    <span style={{ minWidth: 64 }}>
                        {shift > 0 ? "+" : ""}
                        {shift}
                        {unit}
                    </span>
                    <button
                        type="button"
                        onClick={() => onChange({ shift: 0 })}
                        disabled={!shift}
                        style={fieldInputStyle}
                    >
                        0
                    </button>
                </label>
            </div>
            <div style={settingsRowStyle}>
                <label style={fieldStyle}>
                    <input
                        type="checkbox"
                        checked={crop}
                        onChange={(e) =>
                            onChange(
                                e.target.checked
                                    ? { crop: true, cut: null }
                                    : { crop: false },
                            )
                        }
                    />
                    Crop box
                </label>
                <label style={fieldStyle}>
                    Cut along
                    <select
                        value={cut ?? ""}
                        onChange={(e) =>
                            onChange(
                                e.target.value
                                    ? { cut: e.target.value, crop: false }
                                    : { cut: null },
                            )
                        }
                        disabled={!cutOptions.length}
                        style={fieldInputStyle}
                        aria-label={`${label} cut along plane`}
                    >
                        <option value="">
                            {cutOptions.length ? "No cut" : "No planes to cut along"}
                        </option>
                        {cutOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label style={fieldStyle}>
                    <input
                        type="checkbox"
                        checked={cutFlip}
                        disabled={!cut}
                        onChange={(e) => onChange({ cutFlip: e.target.checked })}
                    />
                    Keep other side
                </label>
            </div>
            {(crop || cut) && (
                <p style={noteStyle}>
                    {crop
                        ? "Drag a sphere to move that side or corner of the box; drag elsewhere to turn the volume, or with Shift to turn the box."
                        : "The cut follows the plane as it moves. The crop box and a cut can't be on together."}
                </p>
            )}
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

const noteStyle = {
    margin: 0,
    color: "#a6adc8",
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
