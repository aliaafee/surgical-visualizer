import { useState, useRef } from "react";

const API_BASE = "http://127.0.0.1:8090";

export default function DicomUploadTest() {
    const [token, setToken] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [authError, setAuthError] = useState("");

    const [uploading, setUploading] = useState(false);
    const [uploadResult, setUploadResult] = useState(null);
    const [uploadError, setUploadError] = useState("");

    const [studies, setStudies] = useState(null);
    const [studiesError, setStudiesError] = useState("");

    const fileInputRef = useRef(null);

    async function login(e) {
        e.preventDefault();
        setAuthError("");
        try {
            const res = await fetch(
                `${API_BASE}/api/collections/users/auth-with-password`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ identity: email, password }),
                },
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Login failed");
            setToken(data.token);
        } catch (err) {
            setAuthError(err.message);
        }
    }

    async function upload(e) {
        e.preventDefault();
        const files = fileInputRef.current?.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        setUploadResult(null);
        setUploadError("");

        const form = new FormData();
        for (const file of files) {
            form.append("files", file);
        }

        try {
            const res = await fetch(`${API_BASE}/api/visualizer/dicom/upload`, {
                method: "POST",
                headers: { Authorization: token },
                body: form,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Upload failed");
            setUploadResult(data);
        } catch (err) {
            setUploadError(err.message);
        } finally {
            setUploading(false);
        }
    }

    async function fetchStudies() {
        setStudiesError("");
        setStudies(null);
        try {
            const res = await fetch(
                `${API_BASE}/api/visualizer/dicom/studies`,
                {
                    headers: { Authorization: token },
                },
            );
            const data = await res.json();
            if (!res.ok)
                throw new Error(data.error || "Failed to fetch studies");
            setStudies(data);
        } catch (err) {
            setStudiesError(err.message);
        }
    }

    return (
        <div
            style={{
                fontFamily: "monospace",
                maxWidth: 720,
                margin: "2rem auto",
                padding: "0 1rem",
            }}
        >
            <h1>DICOM Upload Test</h1>

            {/* ── Auth ── */}
            <section style={{ marginBottom: "2rem" }}>
                <h2>1. Authenticate</h2>
                {token ? (
                    <p style={{ color: "green" }}>
                        Logged in. Token: <code>{token.slice(0, 20)}…</code>
                        <button style={btnStyle} onClick={() => setToken("")}>
                            Logout
                        </button>
                    </p>
                ) : (
                    <form
                        onSubmit={login}
                        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                    >
                        <input
                            placeholder="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            style={inputStyle}
                            type="email"
                            required
                        />
                        <input
                            placeholder="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            style={inputStyle}
                            type="password"
                            required
                        />
                        <button type="submit" style={btnStyle}>
                            Login
                        </button>
                        {authError && (
                            <span style={{ color: "red" }}>{authError}</span>
                        )}
                    </form>
                )}
            </section>

            {/* ── Upload ── */}
            <section style={{ marginBottom: "2rem" }}>
                <h2>2. Upload DICOM Files</h2>
                <form
                    onSubmit={upload}
                    style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                    }}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".dcm,application/dicom"
                        multiple
                        disabled={!token}
                    />
                    <button
                        type="submit"
                        style={btnStyle}
                        disabled={!token || uploading}
                    >
                        {uploading ? "Uploading…" : "Upload"}
                    </button>
                </form>
                {uploadError && <p style={{ color: "red" }}>{uploadError}</p>}
                {uploadResult && (
                    <div style={resultBoxStyle}>
                        <strong>Upload result:</strong>
                        <pre>{JSON.stringify(uploadResult, null, 2)}</pre>
                    </div>
                )}
            </section>

            {/* ── Studies list ── */}
            <section>
                <h2>3. List Studies</h2>
                <button
                    style={btnStyle}
                    disabled={!token}
                    onClick={fetchStudies}
                >
                    Fetch Studies
                </button>
                {studiesError && <p style={{ color: "red" }}>{studiesError}</p>}
                {studies && (
                    <div style={resultBoxStyle}>
                        <strong>{studies.length} study/studies found:</strong>
                        <pre>{JSON.stringify(studies, null, 2)}</pre>
                    </div>
                )}
            </section>
        </div>
    );
}

const btnStyle = {
    padding: "6px 14px",
    cursor: "pointer",
    border: "1px solid #555",
    borderRadius: 4,
    background: "#1e1e2e",
    color: "#cdd6f4",
};

const inputStyle = {
    padding: "6px 10px",
    border: "1px solid #555",
    borderRadius: 4,
    background: "#1e1e2e",
    color: "#cdd6f4",
};

const resultBoxStyle = {
    marginTop: "1rem",
    padding: "1rem",
    background: "#1e1e2e",
    color: "#cdd6f4",
    borderRadius: 6,
    overflowX: "auto",
};
