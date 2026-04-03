# DICOM Upload & Processing API Plan

## Phase 1: Database Setup

Create PocketBase collections via the Admin UI or migrations:

1. `studies` — one record per DICOM study
2. `series` — child of studies
3. `instances` — child of series, holds the actual `.dcm` files

Set API rules as defined in `DATABASE_SCHEMA.md`. The `instances.dicomFile` field stores the raw file; PocketBase handles storage automatically.

---

## Phase 2: File Structure

Add to `server/`:

```
routes/
  dicom_routes.go      # upload + fetch endpoints
dicom/
  parser.go            # go-dicom parsing logic
  processor.go         # metadata extraction, thumbnail generation
```

---

## Phase 3: Endpoints

| Method | Path                                                   | Purpose                       |
| ------ | ------------------------------------------------------ | ----------------------------- |
| `POST` | `/api/visualizer/dicom/upload`                         | Accept multipart `.dcm` files |
| `GET`  | `/api/visualizer/dicom/studies`                        | List studies for auth'd user  |
| `GET`  | `/api/visualizer/dicom/studies/:studyId`               | Study detail + series list    |
| `GET`  | `/api/visualizer/dicom/series/:seriesId`               | Series detail + instance list |
| `GET`  | `/api/visualizer/dicom/instances/:instanceId/metadata` | Raw DICOM tags as JSON        |
| `GET`  | `/api/visualizer/dicom/instances/:instanceId/file`     | Serve raw `.dcm` file         |

---

## Phase 4: Upload Handler Logic

The `POST /upload` handler should:

1. Parse `multipart/form-data` — accept multiple files in one request
2. For each file, use `github.com/suyashkumar/dicom` to parse it:
    - Extract `StudyInstanceUID`, `SeriesInstanceUID`, `SOPInstanceUID`
    - Extract patient metadata, modality, window center/width, etc.
3. **Upsert** records: find-or-create Study → find-or-create Series → create Instance
4. Save the raw `.dcm` file to the Instance's `dicomFile` field via PocketBase's file API
5. Update `uploadStatus` on the Study record (`pending → processing → complete`)
6. Return a summary JSON with created study/series/instance IDs

---

## Phase 5: PocketBase Hook for Post-Processing

In a new `hooks/dicom_hooks.go`, register `OnRecordAfterCreateRequest` for the `instances` collection to:

- Trigger thumbnail generation (extract middle slice, encode as PNG)
- Update the parent Series `processingStatus` to `ready` once all instances are stored
- Update `instanceCount` and `seriesCount` on parent records

---

## Phase 6: Dependencies

```bash
go get github.com/suyashkumar/dicom
```

This is the most maintained go-dicom library. It handles parsing tags, pixel data, and transfer syntax negotiation.

---

## Implementation Order

1. Add `go-dicom` dependency
2. Write `dicom/parser.go` — pure parsing, no PocketBase coupling
3. Implement the upload endpoint with study/series/instance upsert logic
4. Create collections in PocketBase Admin UI and verify records are created correctly
5. Add the metadata and file-serve endpoints
6. Add post-create hooks for thumbnail generation and count updates

> The upload endpoint is the critical path — everything else (viewer, 3D rendering) depends on having well-structured records in the DB.
