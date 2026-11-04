// Styles shared by the app's pages (login, patients, a patient's studies,
// the upload dialog), in the same dark palette as the viewers

export const colors = {
    page: "#11111b",
    panel: "#1e1e2e",
    raised: "#181825",
    border: "#313244",
    borderStrong: "#555",
    text: "#cdd6f4",
    muted: "#a6adc8",
    accent: "#89b4fa",
    error: "#f38ba8",
    success: "#a6e3a1",
};

export const pageStyle = {
    minHeight: "100vh",
    background: colors.page,
    color: colors.text,
    fontFamily: "monospace",
};

export const contentStyle = {
    maxWidth: 960,
    margin: "0 auto",
    padding: "1.5rem 16px",
    boxSizing: "border-box",
};

export const btnStyle = {
    padding: "6px 14px",
    cursor: "pointer",
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: 4,
    background: colors.panel,
    color: colors.text,
    fontFamily: "inherit",
};

export const primaryBtnStyle = {
    ...btnStyle,
    border: `1px solid ${colors.accent}`,
    color: colors.accent,
    fontWeight: "bold",
};

export const inputStyle = {
    padding: "6px 10px",
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: 4,
    background: colors.panel,
    color: colors.text,
    fontFamily: "inherit",
    boxSizing: "border-box",
    maxWidth: "100%",
};

export const panelStyle = {
    background: colors.panel,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
};

export const mutedStyle = { color: colors.muted };

export const errorTextStyle = { color: colors.error, margin: 0 };
