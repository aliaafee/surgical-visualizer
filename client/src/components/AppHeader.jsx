import { pb } from "@/lib/pb";
import { btnStyle, colors, mutedStyle } from "@/lib/ui-styles";

// Top bar of the app's pages: page actions on the left, who is signed in
// and a way out on the right
export default function AppHeader({ children }) {
    return (
        <header style={headerStyle}>
            <div style={groupStyle}>
                <strong>Surgical Visualizer</strong>
                {children}
            </div>
            <div style={groupStyle}>
                <span style={{ ...mutedStyle, overflowWrap: "anywhere" }}>
                    {pb.authStore.record?.email}
                </span>
                <button style={btnStyle} onClick={() => pb.authStore.clear()}>
                    Log out
                </button>
            </div>
        </header>
    );
}

const headerStyle = {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.5rem 16px",
    background: colors.panel,
    borderBottom: `1px solid ${colors.border}`,
};

const groupStyle = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.75rem",
};
