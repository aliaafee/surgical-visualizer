import { defineConfig } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src/"),
        },
    },
    plugins: [react(), tailwindcss()],

    // Cornerstone's DICOM image loader spawns its decode worker via
    // new URL(..., import.meta.url), which breaks if the dep is pre-bundled.
    // Its CommonJS deps (codecs, dicom-parser) still need pre-bundling.
    optimizeDeps: {
        exclude: ["@cornerstonejs/dicom-image-loader"],
        include: [
            "dicom-parser",
            "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-charls/decodewasmjs",
            "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs",
            "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-openjpeg/decodewasmjs",
            "@cornerstonejs/dicom-image-loader > @cornerstonejs/codec-openjph/wasmjs",
        ],
    },
    worker: {
        format: "es",
    },

    build: {
        outDir: "../server/pb_public",
        emptyOutDir: true,
    },
});
