# Cornerstone.js DICOM Viewer Setup

## Installation

To use the DICOM viewer, install the required Cornerstone.js packages:

```bash
cd client
npm install @cornerstonejs/core @cornerstonejs/dicom-image-loader @cornerstonejs/tools dicom-parser
```

## Components

### DicomViewer

A component that displays DICOM series using Cornerstone.js stack viewport.

**Props:**

- `seriesId` (string): The ID of the series to display
- `onClose` (function): Callback when the close button is clicked

**Features:**

- Loads and displays DICOM images in a stack
- Navigation controls (Previous/Next buttons and slider)
- Displays series metadata (modality, dimensions, pixel spacing)
- Automatic sorting by instance number

### DicomUploadTest

Updated to include series viewing functionality.

**New Features:**

- "View Series" buttons for each series in the studies list
- Switches to full-screen viewer when a series is selected
- Better formatted studies/series display

## Usage

The viewer is integrated into the upload test component. After uploading DICOM files:

1. Click "Fetch Studies" to see all studies
2. Each study shows its series with metadata
3. Click "View Series" on any series to open the viewer
4. Use Previous/Next buttons or slider to navigate through images
5. Click "Close" to return to the studies list

## API Endpoints Used

- `GET /api/visualizer/dicom/series/:seriesId` - Fetch series metadata and instances
- `GET /api/visualizer/dicom/instances/:instanceId/file` - Download DICOM file

## Technical Details

### Image Loading

The viewer uses the WADO-URI scheme to load DICOM files:

```javascript
const imageId = `wadouri:${wadoUriRoot}/api/visualizer/dicom/instances/${instanceId}/file?token=${authToken}`;
```

### Viewport Configuration

- Type: Stack Viewport (2D image stack)
- Background: Black
- Automatic rendering on stack change

### Authentication

The viewer automatically includes the PocketBase auth token in image requests.

## Troubleshooting

### Images not loading

- Verify you're logged in (check auth token)
- Check browser console for CORS or network errors
- Ensure DICOM files are properly uploaded and have valid pixel data

### Performance issues

- Large series (100+ images) may take time to load
- Consider implementing:
    - Progressive loading
    - Image caching
    - Viewport prefetching
    - Web worker configuration

### Build errors

If you see module resolution errors, ensure all Cornerstone packages are installed:

```bash
npm install --save @cornerstonejs/core @cornerstonejs/dicom-image-loader @cornerstonejs/tools dicom-parser
```

## Future Enhancements

Consider adding:

- Window/Level adjustment tools
- Zoom and pan controls
- Measurement tools (length, angle, ROI)
- MPR (Multi-planar reconstruction)
- 3D volume rendering
- Annotation and markup
- Image export functionality
- Thumbnail preview
- Keyboard shortcuts for navigation
