# Database Schema - Surgical Visualizer

## Overview

This document defines the PocketBase collections schema for the Surgical Visualizer application. PocketBase uses a NoSQL-like approach with collections (similar to tables) that can have relations between them.

---

## Collections

### 1. Users Collection (Built-in)

PocketBase provides a built-in `users` collection with authentication. We'll extend it with custom fields.

**Extended Fields:**
- `role` (select): "admin", "doctor", "technician", "viewer"
- `institution` (text): Medical institution name
- `specialization` (text): Medical specialization
- `licenseNumber` (text): Medical license number (optional)
- `avatar` (file): Profile picture

**Settings:**
- Auth enabled: Yes
- Email verification: Required
- Password reset: Enabled

---

### 2. Studies Collection

Represents a DICOM study (typically a complete imaging session for a patient).

**Fields:**

| Field Name | Type | Required | Options | Description |
|------------|------|----------|---------|-------------|
| `studyInstanceUID` | text | Yes | Unique | DICOM Study Instance UID |
| `patientID` | text | Yes | - | Patient identifier (can be anonymized) |
| `patientName` | text | No | - | Patient name (can be anonymized) |
| `patientBirthDate` | date | No | - | Patient date of birth |
| `patientSex` | select | No | M, F, O | Patient sex |
| `studyDate` | date | Yes | - | Date the study was performed |
| `studyTime` | text | No | - | Time the study was performed (HH:MM:SS) |
| `studyDescription` | text | No | - | Description of the study |
| `modality` | text | Yes | - | Primary modality (CT, MR, XR, etc.) |
| `accessionNumber` | text | No | - | Accession number from RIS/PACS |
| `referringPhysician` | text | No | - | Name of referring physician |
| `institutionName` | text | No | - | Name of the institution |
| `owner` | relation | Yes | → users | User who uploaded the study |
| `sharedWith` | relation | No | → users (multiple) | Users with shared access |
| `tags` | json | No | - | Custom tags array |
| `isAnonymized` | bool | Yes | Default: false | Whether patient data is anonymized |
| `uploadStatus` | select | Yes | pending, processing, complete, error | Upload/processing status |
| `totalSize` | number | No | - | Total size in bytes |
| `seriesCount` | number | No | - | Number of series in study |
| `instanceCount` | number | No | - | Total number of instances |

**Indexes:**
- `studyInstanceUID` (unique)
- `patientID`
- `owner`
- `studyDate`

**API Rules:**
- List: `@request.auth.id != "" && (owner = @request.auth.id || sharedWith.id ?= @request.auth.id)`
- View: `@request.auth.id != "" && (owner = @request.auth.id || sharedWith.id ?= @request.auth.id)`
- Create: `@request.auth.id != "" && @request.data.owner = @request.auth.id`
- Update: `@request.auth.id != "" && owner = @request.auth.id`
- Delete: `@request.auth.id != "" && owner = @request.auth.id`

---

### 3. Series Collection

Represents a DICOM series (a set of images acquired with the same parameters).

**Fields:**

| Field Name | Type | Required | Options | Description |
|------------|------|----------|---------|-------------|
| `seriesInstanceUID` | text | Yes | Unique | DICOM Series Instance UID |
| `study` | relation | Yes | → studies | Parent study |
| `seriesNumber` | number | Yes | - | Series number within study |
| `seriesDescription` | text | No | - | Description of the series |
| `modality` | text | Yes | - | Modality (CT, MR, XR, etc.) |
| `bodyPartExamined` | text | No | - | Body part examined |
| `protocolName` | text | No | - | Acquisition protocol name |
| `seriesDate` | date | No | - | Date series was acquired |
| `seriesTime` | text | No | - | Time series was acquired |
| `instanceCount` | number | Yes | - | Number of instances in series |
| `rows` | number | No | - | Image rows (height) |
| `columns` | number | No | - | Image columns (width) |
| `sliceThickness` | number | No | - | Slice thickness in mm |
| `pixelSpacing` | json | No | - | [row_spacing, col_spacing] in mm |
| `imageOrientation` | json | No | - | Image orientation patient array |
| `frameOfReference` | text | No | - | Frame of Reference UID |
| `thumbnail` | file | No | - | Generated thumbnail image |
| `is3DCapable` | bool | Yes | Default: false | Whether suitable for 3D rendering |
| `processingStatus` | select | Yes | pending, processing, ready, error | Processing status |

**Indexes:**
- `seriesInstanceUID` (unique)
- `study`
- `modality`

**API Rules:**
- Inherit from parent study access rules
- List/View: `@request.auth.id != "" && (study.owner = @request.auth.id || study.sharedWith.id ?= @request.auth.id)`

---

### 4. Instances Collection

Represents individual DICOM instances (images/slices).

**Fields:**

| Field Name | Type | Required | Options | Description |
|------------|------|----------|---------|-------------|
| `sopInstanceUID` | text | Yes | Unique | DICOM SOP Instance UID |
| `series` | relation | Yes | → series | Parent series |
| `instanceNumber` | number | Yes | - | Instance number within series |
| `dicomFile` | file | Yes | MaxSize: 50MB | Original DICOM file |
| `imagePosition` | json | No | - | Image Position Patient [x, y, z] |
| `sliceLocation` | number | No | - | Slice location in mm |
| `acquisitionNumber` | number | No | - | Acquisition number |
| `contentDate` | date | No | - | Content date |
| `contentTime` | text | No | - | Content time |
| `windowCenter` | number | No | - | Default window center |
| `windowWidth` | number | No | - | Default window width |
| `rescaleIntercept` | number | No | - | Rescale intercept |
| `rescaleSlope` | number | No | - | Rescale slope |
| `metadata` | json | No | - | Additional DICOM metadata |
| `fileSize` | number | Yes | - | File size in bytes |
| `transferSyntax` | text | No | - | Transfer Syntax UID |

**Indexes:**
- `sopInstanceUID` (unique)
- `series`
- `instanceNumber`

**API Rules:**
- Inherit from parent series/study access rules
- List/View: `@request.auth.id != "" && (series.study.owner = @request.auth.id || series.study.sharedWith.id ?= @request.auth.id)`

---

### 5. Sessions Collection

Represents saved viewing/rendering sessions for collaboration and persistence.

**Fields:**

| Field Name | Type | Required | Options | Description |
|------------|------|----------|---------|-------------|
| `name` | text | Yes | - | Session name |
| `description` | text | No | - | Session description |
| `study` | relation | Yes | → studies | Associated study |
| `series` | relation | No | → series (multiple) | Series included in session |
| `owner` | relation | Yes | → users | Session creator |
| `sharedWith` | relation | No | → users (multiple) | Users with access |
| `viewportConfig` | json | Yes | - | Viewport configuration |
| `transferFunctions` | json | No | - | Transfer function settings |
| `measurements` | json | No | - | Saved measurements |
| `annotations` | json | No | - | Saved annotations |
| `clippingPlanes` | json | No | - | Clipping plane settings |
| `cameraPosition` | json | No | - | Camera position and orientation |
| `renderingPreset` | select | No | CT_Bone, CT_Soft, MRI_Brain, CT_Angio, Custom | Rendering preset used |
| `thumbnail` | file | No | - | Session screenshot |
| `isPublic` | bool | Yes | Default: false | Whether publicly accessible |
| `lastModified` | date | Yes | Auto | Last modification timestamp |

**Indexes:**
- `owner`
- `study`
- `lastModified`

**API Rules:**
- List: `@request.auth.id != "" && (owner = @request.auth.id || sharedWith.id ?= @request.auth.id || isPublic = true)`
- View: Same as List
- Create: `@request.auth.id != "" && @request.data.owner = @request.auth.id`
- Update: `@request.auth.id != "" && owner = @request.auth.id`
- Delete: `@request.auth.id != "" && owner = @request.auth.id`

---

### 6. Annotations Collection

Represents annotations on DICOM images or 3D volumes.

**Fields:**

| Field Name | Type | Required | Options | Description |
|------------|------|----------|---------|-------------|
| `session` | relation | No | → sessions | Associated session (optional) |
| `study` | relation | Yes | → studies | Associated study |
| `series` | relation | No | → series | Associated series |
| `instance` | relation | No | → instances | Associated instance |
| `author` | relation | Yes | → users | Annotation creator |
| `annotationType` | select | Yes | point, line, arrow, rectangle, ellipse, polygon, freehand, text | Annotation type |
| `coordinates` | json | Yes | - | Annotation coordinates |
| `text` | text | No | - | Text content |
| `color` | text | No | Default: #FF0000 | Annotation color (hex) |
| `strokeWidth` | number | No | Default: 2 | Line width in pixels |
| `visible` | bool | Yes | Default: true | Visibility state |
| `locked` | bool | Yes | Default: false | Whether locked from editing |
| `metadata` | json | No | - | Additional metadata |

**Indexes:**
- `study`
- `session`
- `author`

**API Rules:**
- List/View: Inherit from study access
- Create: `@request.auth.id != "" && @request.data.author = @request.auth.id`
- Update: `@request.auth.id != "" && author = @request.auth.id`
- Delete: `@request.auth.id != "" && author = @request.auth.id`

---

### 7. Measurements Collection

Represents measurements performed on DICOM data.

**Fields:**

| Field Name | Type | Required | Options | Description |
|------------|------|----------|---------|-------------|
| `session` | relation | No | → sessions | Associated session |
| `study` | relation | Yes | → studies | Associated study |
| `series` | relation | Yes | → series | Associated series |
| `author` | relation | Yes | → users | Measurement creator |
| `measurementType` | select | Yes | distance, angle, area, volume, hounsfield | Measurement type |
| `value` | number | Yes | - | Measured value |
| `unit` | text | Yes | - | Unit of measurement (mm, degrees, mm², mm³, HU) |
| `points` | json | Yes | - | Measurement points coordinates |
| `label` | text | No | - | Custom label |
| `notes` | text | No | - | Additional notes |
| `timestamp` | date | Yes | Auto | When measurement was taken |

**Indexes:**
- `study`
- `session`
- `author`

**API Rules:**
- List/View: Inherit from study access
- Create: `@request.auth.id != "" && @request.data.author = @request.auth.id`
- Update: `@request.auth.id != "" && author = @request.auth.id`
- Delete: `@request.auth.id != "" && author = @request.auth.id`

---

### 8. Segmentations Collection

Represents segmentation data for organs, tumors, or regions of interest.

**Fields:**

| Field Name | Type | Required | Options | Description |
|------------|------|----------|---------|-------------|
| `name` | text | Yes | - | Segmentation name |
| `series` | relation | Yes | → series | Source series |
| `study` | relation | Yes | → studies | Parent study |
| `author` | relation | Yes | → users | Segmentation creator |
| `segmentationType` | select | Yes | manual, threshold, region_growing, ai_auto | Segmentation method |
| `anatomyType` | text | No | - | Anatomy being segmented (e.g., "liver", "tumor") |
| `color` | text | Yes | Default: #00FF00 | Display color (hex) |
| `opacity` | number | Yes | Default: 0.5 | Opacity (0-1) |
| `maskData` | file | No | MaxSize: 100MB | Binary mask data (compressed) |
| `meshData` | file | No | MaxSize: 50MB | 3D mesh file (STL/OBJ) |
| `volume` | number | No | - | Calculated volume in mm³ |
| `surfaceArea` | number | No | - | Calculated surface area in mm² |
| `parameters` | json | No | - | Segmentation parameters used |
| `processingStatus` | select | Yes | draft, processing, complete, error | Processing status |

**Indexes:**
- `study`
- `series`
- `author`

**API Rules:**
- List/View: Inherit from study access
- Create: `@request.auth.id != "" && @request.data.author = @request.auth.id`
- Update: `@request.auth.id != "" && author = @request.auth.id`
- Delete: `@request.auth.id != "" && author = @request.auth.id`

---

### 9. Exports Collection

Tracks exported files (meshes, images, reports).

**Fields:**

| Field Name | Type | Required | Options | Description |
|------------|------|----------|---------|-------------|
| `study` | relation | Yes | → studies | Source study |
| `exportType` | select | Yes | image, mesh_stl, mesh_obj, mesh_ply, measurements_csv, report_pdf, dicom | Export type |
| `format` | text | Yes | - | File format |
| `fileName` | text | Yes | - | Export file name |
| `file` | file | Yes | - | Exported file |
| `author` | relation | Yes | → users | User who created export |
| `fileSize` | number | Yes | - | File size in bytes |
| `parameters` | json | No | - | Export parameters |
| `timestamp` | date | Yes | Auto | Export timestamp |
| `downloadCount` | number | Yes | Default: 0 | Number of downloads |

**Indexes:**
- `study`
- `author`
- `timestamp`

**API Rules:**
- List/View: Inherit from study access
- Create: `@request.auth.id != "" && @request.data.author = @request.auth.id`
- Delete: `@request.auth.id != "" && author = @request.auth.id`

---

### 10. AuditLog Collection

Tracks important system events for compliance and debugging.

**Fields:**

| Field Name | Type | Required | Options | Description |
|------------|------|----------|---------|-------------|
| `user` | relation | No | → users | User who performed action (null for system) |
| `action` | select | Yes | create, update, delete, view, download, share, export | Action type |
| `resourceType` | select | Yes | study, series, instance, session, export | Resource affected |
| `resourceId` | text | Yes | - | ID of the resource |
| `ipAddress` | text | No | - | IP address of user |
| `userAgent` | text | No | - | Browser/client user agent |
| `details` | json | No | - | Additional action details |
| `timestamp` | date | Yes | Auto | When action occurred |
| `success` | bool | Yes | - | Whether action succeeded |
| `errorMessage` | text | No | - | Error message if failed |

**Indexes:**
- `user`
- `timestamp`
- `resourceType`
- `action`

**API Rules:**
- List/View: `@request.auth.role = "admin"` (admin only)
- Create: System only (via hooks)
- Update/Delete: Disabled

---

## Relationships Diagram

```
users
  ├─→ studies (owner)
  ├─→ studies (sharedWith - many)
  ├─→ sessions (owner)
  ├─→ sessions (sharedWith - many)
  ├─→ annotations (author)
  ├─→ measurements (author)
  ├─→ segmentations (author)
  └─→ exports (author)

studies
  ├─→ series (one-to-many)
  ├─→ sessions (one-to-many)
  ├─→ annotations (one-to-many)
  ├─→ measurements (one-to-many)
  ├─→ segmentations (one-to-many)
  └─→ exports (one-to-many)

series
  ├─→ instances (one-to-many)
  ├─→ annotations (one-to-many)
  ├─→ measurements (one-to-many)
  └─→ segmentations (one-to-many)

instances
  └─→ annotations (one-to-many)

sessions
  ├─→ annotations (one-to-many)
  └─→ measurements (one-to-many)
```

---

## Data Migration Strategy

### Initial Setup

1. Create collections in PocketBase Admin UI or via migrations
2. Set up indexes for performance
3. Configure API rules for security
4. Set up file storage limits

### Sample Migration Code (Go)

```go
// pb_migrations/1710000000_initial_setup.go
package migrations

import (
    "github.com/pocketbase/dbx"
    "github.com/pocketbase/pocketbase/daos"
    m "github.com/pocketbase/pocketbase/migrations"
    "github.com/pocketbase/pocketbase/models/schema"
)

func init() {
    m.Register(func(db dbx.Builder) error {
        dao := daos.New(db)
        
        // Create Studies collection
        collection := &models.Collection{
            Name: "studies",
            Type: models.CollectionTypeBase,
            Schema: schema.NewSchema(
                &schema.SchemaField{
                    Name:     "studyInstanceUID",
                    Type:     schema.FieldTypeText,
                    Required: true,
                    Unique:   true,
                },
                &schema.SchemaField{
                    Name:     "patientID",
                    Type:     schema.FieldTypeText,
                    Required: true,
                },
                // ... more fields
            ),
        }
        
        return dao.SaveCollection(collection)
    }, func(db dbx.Builder) error {
        // Rollback
        dao := daos.New(db)
        collection, _ := dao.FindCollectionByNameOrId("studies")
        return dao.DeleteCollection(collection)
    })
}
```

---

## Performance Considerations

### Indexing Strategy
- Index all foreign keys (relations)
- Index frequently queried fields (studyDate, modality, owner)
- Unique indexes on DICOM UIDs

### File Storage
- DICOM files stored in `pb_data/storage/`
- Organize by collection/record/field
- Automatic cleanup on record deletion
- Consider file size limits per collection

### Query Optimization
- Use eager loading for related records
- Implement pagination for large datasets
- Cache frequently accessed data on frontend
- Use PocketBase real-time subscriptions for live updates

### Backup Strategy
- Regular backups of SQLite database file
- Backup file storage directory
- Automated backup schedule (daily recommended)
- Test restore procedures regularly

---

## Security Considerations

### Access Control
- All collections protected by authentication
- Owner-based access for studies
- Sharing mechanism via relations
- Admin-only access for audit logs

### Data Anonymization
- `isAnonymized` flag on studies
- DICOM tag stripping hooks
- Patient data encryption at rest (optional)

### HIPAA Compliance
- Audit logging for all data access
- Secure file transmission (HTTPS)
- User authentication required
- Role-based access control
- Data retention policies

---

## Future Enhancements

### Additional Collections
- **Templates**: Rendering/report templates
- **Protocols**: Standard imaging protocols
- **Reports**: Generated diagnostic reports
- **Notifications**: User notification system
- **ActivityFeed**: User activity tracking
- **Bookmarks**: Saved views/studies

### Schema Extensions
- Multi-tenant support (Organizations)
- Advanced AI model metadata
- DICOM SR (Structured Reports) support
- DICOM worklist integration
- HL7 FHIR resource mapping

---

*Last Updated: March 30, 2026*
