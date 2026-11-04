import { useState } from "react";
import { pb } from "@/lib/pb";
import {
    errorTextStyle,
    inputStyle,
    mutedStyle,
    pageStyle,
    panelStyle,
    primaryBtnStyle,
} from "@/lib/ui-styles";

// Shown whenever nobody is signed in. Signing in updates pb.authStore, which
// the app listens to, so there is nothing to hand back.
export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const login = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
            await pb.collection("users").authWithPassword(email, password);
        } catch (err) {
            setError(
                err.status === 400
                    ? "Wrong email or password"
                    : err.message || "Could not sign in",
            );
            setBusy(false);
        }
    };

    return (
        <div style={{ ...pageStyle, display: "grid", placeItems: "center" }}>
            <form onSubmit={login} style={formStyle}>
                <h1 style={{ margin: 0, fontSize: "1.4rem" }}>
                    Surgical Visualizer
                </h1>
                <p style={{ ...mutedStyle, margin: 0 }}>Sign in to continue.</p>
                <label style={fieldStyle}>
                    Email
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        style={inputStyle}
                        autoComplete="username"
                        autoFocus
                        required
                    />
                </label>
                <label style={fieldStyle}>
                    Password
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        style={inputStyle}
                        autoComplete="current-password"
                        required
                    />
                </label>
                {error && <p style={errorTextStyle}>{error}</p>}
                <button type="submit" style={primaryBtnStyle} disabled={busy}>
                    {busy ? "Signing in…" : "Sign in"}
                </button>
            </form>
        </div>
    );
}

const formStyle = {
    ...panelStyle,
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    width: "calc(100% - 32px)",
    maxWidth: 360,
    padding: "1.5rem",
    boxSizing: "border-box",
};

const fieldStyle = {
    display: "flex",
    flexDirection: "column",
    gap: 4,
};
