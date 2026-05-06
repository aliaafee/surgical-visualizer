import { pb } from "@/lib/pb";
import dicomParser from "dicom-parser";

export function pbImageLoader(imageId) {
    const instanceId = imageId.replace("pburi:", "");

    console.log("Loading image with ID:", instanceId);

    const promise = new Promise(async (resolve, reject) => {
        try {
            const record = await pb.collection("instances").getOne(instanceId);
            console.log("Fetched record from PocketBase:", record);

            const pbFileUrl = pb.files.getURL(record, record.dicomFile);

            console.log("Constructed PocketBase file URL:", pbFileUrl);

            console.log("Received response from PocketBase:", data);

            // Fetch the file from PocketBase using the instance ID
            const fileUrl = `http://127.0.0.1:8090/api/visualizer/dicom/instances/${instanceId}/file`;
            console.log("Fetching file from URL:", fileUrl);

            const response = await fetch(fileUrl, {
                headers: {
                    Authorization: pb.authStore.token
                        ? `Bearer ${pb.authStore.token}`
                        : "",
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Get the binary data as ArrayBuffer
            const arrayBuffer = await response.arrayBuffer();
            console.log(
                "Received file, size:",
                arrayBuffer.byteLength,
                "bytes",
            );

            // Parse DICOM data from arrayBuffer using dicom-parser
            const byteArray = new Uint8Array(arrayBuffer);
            const dataSet = dicomParser.parseDicom(byteArray);

            // Extract DICOM metadata
            const rows = dataSet.uint16("x00280010");
            const columns = dataSet.uint16("x00280011");
            const bitsAllocated = dataSet.uint16("x00280100");
            const bitsStored = dataSet.uint16("x00280101");
            const pixelRepresentation = dataSet.uint16("x00280103");
            const samplesPerPixel = dataSet.uint16("x00280002") || 1;

            console.log("DICOM Metadata:", {
                rows,
                columns,
                bitsAllocated,
                bitsStored,
                pixelRepresentation,
                samplesPerPixel,
            });

            // Extract rescale slope and intercept
            const slope = dataSet.floatString("x00281053") || 1;
            const intercept = dataSet.floatString("x00281052") || 0;

            // Extract window center and width
            const windowCenter = dataSet.floatString("x00281050") || 40;
            const windowWidth = dataSet.floatString("x00281051") || 400;

            console.log("Window/Level:", {
                windowCenter,
                windowWidth,
                slope,
                intercept,
            });

            // Extract pixel spacing
            const pixelSpacingString = dataSet.string("x00280030");
            let rowPixelSpacing = 1;
            let columnPixelSpacing = 1;
            if (pixelSpacingString) {
                const spacingValues = pixelSpacingString.split("\\");
                rowPixelSpacing = parseFloat(spacingValues[0]) || 1;
                columnPixelSpacing = parseFloat(spacingValues[1]) || 1;
            }

            // Extract pixel data
            const pixelDataElement = dataSet.elements.x7fe00010;
            if (!pixelDataElement) {
                throw new Error("Pixel data element not found");
            }

            console.log("Pixel data element:", {
                dataOffset: pixelDataElement.dataOffset,
                length: pixelDataElement.length,
            });

            let pixelData;

            if (bitsAllocated === 16) {
                const isSigned = pixelRepresentation === 1;
                if (isSigned) {
                    pixelData = new Int16Array(
                        byteArray.buffer,
                        pixelDataElement.dataOffset,
                        pixelDataElement.length / 2,
                    );
                } else {
                    pixelData = new Uint16Array(
                        byteArray.buffer,
                        pixelDataElement.dataOffset,
                        pixelDataElement.length / 2,
                    );
                }
            } else {
                pixelData = new Uint8Array(
                    byteArray.buffer,
                    pixelDataElement.dataOffset,
                    pixelDataElement.length,
                );
            }

            console.log("Pixel data extracted:", {
                length: pixelData.length,
                expected: rows * columns,
                sample: pixelData.slice(0, 10),
            });

            // Calculate min/max pixel values from actual data
            let minPixelValue = pixelData[0];
            let maxPixelValue = pixelData[0];
            for (let i = 0; i < pixelData.length; i++) {
                if (pixelData[i] < minPixelValue) minPixelValue = pixelData[i];
                if (pixelData[i] > maxPixelValue) maxPixelValue = pixelData[i];
            }

            console.log("Actual pixel value range:", {
                minPixelValue,
                maxPixelValue,
            });

            // Use actual pixel range for window/level if the DICOM values don't match
            let finalWindowCenter = windowCenter;
            let finalWindowWidth = windowWidth;

            // If window settings are outside actual pixel range, recalculate
            if (
                windowCenter > maxPixelValue * 2 ||
                windowCenter < minPixelValue
            ) {
                finalWindowCenter = (maxPixelValue + minPixelValue) / 2;
                finalWindowWidth = maxPixelValue - minPixelValue;
                console.log("Recalculated window/level based on actual data:", {
                    finalWindowCenter,
                    finalWindowWidth,
                });
            }

            const image = {
                imageId: imageId,
                minPixelValue: minPixelValue,
                maxPixelValue: maxPixelValue,
                slope: slope,
                intercept: intercept,
                windowCenter: finalWindowCenter,
                windowWidth: finalWindowWidth,
                rows: rows,
                columns: columns,
                height: rows,
                width: columns,
                color: samplesPerPixel > 1,
                rgba: false,
                columnPixelSpacing: columnPixelSpacing,
                rowPixelSpacing: rowPixelSpacing,
                invert: false,
                sizeInBytes: pixelDataElement.length,
                getPixelData: () => pixelData,
            };

            console.log("Created image object:", image);

            resolve(image);
        } catch (err) {
            console.error("Failed to load image:", err);
            reject(err);
        }
    });

    return {
        promise,
    };
}
