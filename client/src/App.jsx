import { useState, useEffect } from "react";
import DicomUploadTest from "./components/DicomUploadTest";
import OrView from "./components/OrView";

const OR_VIEW_HASH = "#/or";

function App() {
    const [hash, setHash] = useState(window.location.hash);

    // The page is chosen by the URL hash, so it survives a refresh
    useEffect(() => {
        const onHashChange = () => setHash(window.location.hash);
        window.addEventListener("hashchange", onHashChange);
        return () => window.removeEventListener("hashchange", onHashChange);
    }, []);

    if (hash === OR_VIEW_HASH) {
        return <OrView onClose={() => (window.location.hash = "")} />;
    }

    return (
        <DicomUploadTest
            onOpenOrView={() => (window.location.hash = OR_VIEW_HASH)}
        />
    );
}

export default App;
