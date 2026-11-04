import { useState, useEffect } from "react";
import { pb } from "@/lib/pb";
import LoginPage from "./components/LoginPage";
import PatientsPage from "./components/PatientsPage";
import PatientPage from "./components/PatientPage";
import DicomViewer from "./components/DicomViewer";
import DicomUploadTest from "./components/DicomUploadTest";
import OrView from "./components/OrView";

// Pages, chosen by the URL hash so they survive a refresh and the browser's
// back button works:
//   #/                                    patients
//   #/patients/<id>                       a patient's studies
//   #/patients/<id>/view/<series>/<mode>  a series in the viewer
//   #/or, #/or/<patient id>               the OR view
//   #/test                                the original upload test page
function parseHash(hash) {
    const parts = hash
        .replace(/^#\/?/, "")
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);

    if (parts[0] === "patients" && parts[1]) {
        if (parts[2] === "view" && parts[3]) {
            return {
                page: "viewer",
                patientId: parts[1],
                seriesId: parts[3],
                mode: parts[4] === "mpr" ? "mpr" : "stack",
            };
        }
        return { page: "patient", patientId: parts[1] };
    }
    if (parts[0] === "or") return { page: "or", patientId: parts[1] || null };
    if (parts[0] === "test") return { page: "test" };
    return { page: "patients" };
}

function go(...parts) {
    window.location.hash = `/${parts.map(encodeURIComponent).join("/")}`;
}

function App() {
    const [hash, setHash] = useState(window.location.hash);
    const [loggedIn, setLoggedIn] = useState(pb.authStore.isValid);

    useEffect(() => {
        const onHashChange = () => setHash(window.location.hash);
        window.addEventListener("hashchange", onHashChange);
        return () => window.removeEventListener("hashchange", onHashChange);
    }, []);

    // Signing in or out anywhere (including an expired session) switches
    // between the login page and the app
    useEffect(
        () => pb.authStore.onChange(() => setLoggedIn(pb.authStore.isValid)),
        [],
    );

    const route = parseHash(hash);

    // The test page has its own login form
    if (route.page === "test") {
        return <DicomUploadTest onOpenOrView={(id) => (id ? go("or", id) : go("or"))} />;
    }

    if (!loggedIn) return <LoginPage />;

    switch (route.page) {
        case "patient":
            return (
                <PatientPage
                    key={route.patientId}
                    patientId={route.patientId}
                    onBack={() => go()}
                    onViewSeries={(seriesId, mode) =>
                        go("patients", route.patientId, "view", seriesId, mode)
                    }
                    onOpenOrView={() => go("or", route.patientId)}
                />
            );
        case "viewer":
            return (
                <DicomViewer
                    key={`${route.seriesId}-${route.mode}`}
                    seriesId={route.seriesId}
                    mode={route.mode}
                    onClose={() => go("patients", route.patientId)}
                />
            );
        case "or":
            return (
                <OrView
                    // A different patient starts a fresh OR view
                    key={route.patientId || ""}
                    patientId={route.patientId}
                    onChoosePatient={(id) => (id ? go("or", id) : go("or"))}
                    onClose={() =>
                        route.patientId ? go("patients", route.patientId) : go()
                    }
                />
            );
        default:
            return <PatientsPage onOpenPatient={(id) => go("patients", id)} />;
    }
}

export default App;
