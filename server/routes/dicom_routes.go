package routes

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/labstack/echo/v5"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/models"
	"github.com/suyashkumar/dicom"
	"github.com/suyashkumar/dicom/pkg/tag"
)

// RegisterDicomRoutes registers DICOM upload and query routes under /api/visualizer/dicom/.
func RegisterDicomRoutes(app *pocketbase.PocketBase, e *core.ServeEvent) error {
	auth := apis.RequireRecordAuth()

	e.Router.POST("/api/visualizer/dicom/upload", handleUpload(app), auth)
	e.Router.GET("/api/visualizer/dicom/studies", handleListStudies(app), auth)
	e.Router.GET("/api/visualizer/dicom/studies/:studyId", handleGetStudy(app), auth)
	e.Router.POST("/api/visualizer/dicom/studies/:studyId/anonymize", handleAnonymizeStudy(app), auth)
	e.Router.GET("/api/visualizer/dicom/series/:seriesId", handleGetSeries(app), auth)
	e.Router.GET("/api/visualizer/dicom/instances/:instanceId/metadata", handleGetInstanceMetadata(app), auth)
	e.Router.GET("/api/visualizer/dicom/instances/:instanceId/file", handleGetInstanceFile(app), auth)

	return nil
}

// ─── Upload ───────────────────────────────────────────────────────────────────

// handleUpload accepts one or more .dcm files under the "files" multipart field.
// For each file it: parses DICOM metadata, upserts Study/Series records, creates
// an Instance record, and persists the raw file to PocketBase storage.
// With the form value anonymize=true, identifying attributes are stripped from
// each file before anything is stored.
func handleUpload(app *pocketbase.PocketBase) echo.HandlerFunc {
	return func(c echo.Context) error {
		if err := c.Request().ParseMultipartForm(512 << 20); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "failed to parse multipart form"})
		}

		fileHeaders := c.Request().MultipartForm.File["files"]
		if len(fileHeaders) == 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "no files provided under 'files' field"})
		}

		instanceCollection, err := app.Dao().FindCollectionByNameOrId("instances")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "instances collection not found"})
		}

		anonymize := c.FormValue("anonymize") == "true"

		type instanceResult struct {
			ID            string `json:"id"`
			SOPInstanceUID string `json:"sopInstanceUID"`
		}
		type seriesResult struct {
			ID               string `json:"id"`
			SeriesInstanceUID string `json:"seriesInstanceUID"`
		}
		type uploadResult struct {
			StudyID         string           `json:"studyId"`
			StudyInstanceUID string          `json:"studyInstanceUID"`
			Series          []seriesResult   `json:"series"`
			Instances       []instanceResult `json:"instances"`
			FilesProcessed  int              `json:"filesProcessed"`
			Errors          []string         `json:"errors"`
		}

		result := uploadResult{}
		seenSeries := map[string]seriesResult{}
		seriesRecords := map[string]*models.Record{}
		seenStudies := map[string]bool{}
		var errs []string

		for _, fh := range fileHeaders {
			f, err := fh.Open()
			if err != nil {
				errs = append(errs, fmt.Sprintf("%s: failed to open: %v", fh.Filename, err))
				continue
			}
			fileBytes, err := io.ReadAll(f)
			f.Close()
			if err != nil {
				errs = append(errs, fmt.Sprintf("%s: failed to read: %v", fh.Filename, err))
				continue
			}

			dataset, err := dicom.Parse(bytes.NewReader(fileBytes), int64(len(fileBytes)), nil, dicom.SkipPixelData())
			if err != nil {
				errs = append(errs, fmt.Sprintf("%s: invalid DICOM file: %v", fh.Filename, err))
				continue
			}

			// An anonymized study must stay anonymized, and identity already
			// stored for a study can't be hidden by anonymizing later files.
			existingStudy, _ := app.Dao().FindFirstRecordByFilter(
				"studies", "studyInstanceUID = {:uid}",
				dbx.Params{"uid": getStringDICOMTag(dataset, tag.StudyInstanceUID)},
			)
			anonymizeFile := anonymize
			if existingStudy != nil {
				if anonymize && !existingStudy.GetBool("isAnonymized") {
					errs = append(errs, fmt.Sprintf("%s: study was already uploaded without anonymization; anonymize the existing study first", fh.Filename))
					continue
				}
				anonymizeFile = existingStudy.GetBool("isAnonymized")
			}

			if anonymizeFile {
				fileBytes, err = anonymizeDICOM(fileBytes)
				if err != nil {
					errs = append(errs, fmt.Sprintf("%s: anonymization failed: %v", fh.Filename, err))
					continue
				}
				dataset, err = dicom.Parse(bytes.NewReader(fileBytes), int64(len(fileBytes)), nil, dicom.SkipPixelData())
				if err != nil {
					errs = append(errs, fmt.Sprintf("%s: anonymization produced an invalid file: %v", fh.Filename, err))
					continue
				}
			}

			study, err := upsertStudy(app, dataset, anonymizeFile)
			if err != nil {
				errs = append(errs, fmt.Sprintf("%s: study error: %v", fh.Filename, err))
				continue
			}
			seenStudies[study.Id] = true
			result.StudyID = study.Id
			result.StudyInstanceUID = study.GetString("studyInstanceUID")

			series, err := upsertSeries(app, study.Id, dataset)
			if err != nil {
				errs = append(errs, fmt.Sprintf("%s: series error: %v", fh.Filename, err))
				continue
			}
			seenSeries[series.Id] = seriesResult{
				ID:                series.Id,
				SeriesInstanceUID: series.GetString("seriesInstanceUID"),
			}
			seriesRecords[series.Id] = series

			sopUID := getStringDICOMTag(dataset, tag.SOPInstanceUID)

			// Reject duplicate SOP instances.
			if existing, _ := app.Dao().FindFirstRecordByFilter(
				"instances", "sopInstanceUID = {:uid}", dbx.Params{"uid": sopUID},
			); existing != nil {
				errs = append(errs, fmt.Sprintf("%s: SOP Instance UID already exists (%s)", fh.Filename, sopUID))
				continue
			}

			filename := sanitizeFilename(sopUID) + ".dcm"

			instRecord := models.NewRecord(instanceCollection)
			instRecord.Set("sopInstanceUID", sopUID)
			instRecord.Set("series", series.Id)
			instRecord.Set("dicomFile", filename)
			applyInstanceFields(instRecord, dataset, len(fileBytes))

			if err := app.Dao().SaveRecord(instRecord); err != nil {
				errs = append(errs, fmt.Sprintf("%s: failed to save instance: %v", fh.Filename, err))
				continue
			}

			// Persist raw file to PocketBase filesystem.
			fsys, err := app.NewFilesystem()
			if err != nil {
				errs = append(errs, fmt.Sprintf("%s: filesystem unavailable: %v", fh.Filename, err))
			} else {
				fileKey := fmt.Sprintf("%s/%s/%s", instanceCollection.Id, instRecord.Id, filename)
				if uploadErr := fsys.Upload(fileBytes, fileKey); uploadErr != nil {
					errs = append(errs, fmt.Sprintf("%s: file stored in DB but upload failed: %v", fh.Filename, uploadErr))
				}
				fsys.Close()
			}

			result.Instances = append(result.Instances, instanceResult{ID: instRecord.Id, SOPInstanceUID: sopUID})
			result.FilesProcessed++
		}

		for _, sr := range seenSeries {
			result.Series = append(result.Series, sr)
		}

		// Recompute series geometry/counts and study-level counts from what is
		// actually stored, so uploads split across several requests add up.
		if len(seriesRecords) > 0 {
			fsys, err := app.NewFilesystem()
			if err != nil {
				errs = append(errs, fmt.Sprintf("series post-processing skipped, filesystem unavailable: %v", err))
			} else {
				for _, series := range seriesRecords {
					if err := finalizeSeries(app, fsys, series); err != nil {
						errs = append(errs, fmt.Sprintf("series %s: post-processing failed: %v", series.Id, err))
					}
				}
				fsys.Close()
			}
		}
		for studyId := range seenStudies {
			if err := refreshStudyStats(app, studyId); err != nil {
				errs = append(errs, fmt.Sprintf("study %s: failed to update counts: %v", studyId, err))
			}
		}

		result.Errors = errs
		return c.JSON(http.StatusOK, result)
	}
}

// ─── Read endpoints ───────────────────────────────────────────────────────────

func handleListStudies(app *pocketbase.PocketBase) echo.HandlerFunc {
	return func(c echo.Context) error {
		records, err := app.Dao().FindRecordsByFilter(
			"studies", "1=1", "-created", 0, 0,
			dbx.Params{},
		)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch studies"})
		}

		result := make([]map[string]interface{}, 0, len(records))
		for _, r := range records {
			result = append(result, map[string]interface{}{
				"id":               r.Id,
				"studyInstanceUID": r.GetString("studyInstanceUID"),
				"patientID":        r.GetString("patientID"),
				"patientName":      r.GetString("patientName"),
				"studyDate":        r.GetString("studyDate"),
				"studyDescription": r.GetString("studyDescription"),
				"modality":         r.GetString("modality"),
				"uploadStatus":     r.GetString("uploadStatus"),
				"isAnonymized":     r.GetBool("isAnonymized"),
				"seriesCount":      r.Get("seriesCount"),
				"instanceCount":    r.Get("instanceCount"),
				"totalSize":        r.Get("totalSize"),
				"created":          r.GetString("created"),
			})
		}
		return c.JSON(http.StatusOK, result)
	}
}

func handleGetStudy(app *pocketbase.PocketBase) echo.HandlerFunc {
	return func(c echo.Context) error {
		studyId := c.PathParam("studyId")

		study, err := app.Dao().FindRecordById("studies", studyId)
		if err != nil {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "study not found"})
		}

		seriesList, _ := app.Dao().FindRecordsByFilter(
			"series", "study = {:id}", "", 0, 0,
			dbx.Params{"id": studyId},
		)
		// seriesNumber is a text field, so order numerically here.
		sort.SliceStable(seriesList, func(i, j int) bool {
			return seriesList[i].GetInt("seriesNumber") < seriesList[j].GetInt("seriesNumber")
		})
		seriesResult := make([]map[string]interface{}, 0, len(seriesList))
		for _, s := range seriesList {
			seriesResult = append(seriesResult, map[string]interface{}{
				"id":                s.Id,
				"seriesInstanceUID": s.GetString("seriesInstanceUID"),
				"seriesNumber":      s.Get("seriesNumber"),
				"seriesDescription": s.GetString("seriesDescription"),
				"modality":          s.GetString("modality"),
				"bodyPartExamined":  s.GetString("bodyPartExamined"),
				"instanceCount":     s.Get("instanceCount"),
				"rows":              s.Get("rows"),
				"columns":           s.Get("columns"),
				"is3DCapable":       s.GetBool("is3DCapable"),
				"processingStatus":  s.GetString("processingStatus"),
			})
		}

		return c.JSON(http.StatusOK, map[string]interface{}{
			"id":                study.Id,
			"studyInstanceUID":  study.GetString("studyInstanceUID"),
			"patientID":         study.GetString("patientID"),
			"patientName":       study.GetString("patientName"),
			"patientBirthDate":  study.GetString("patientBirthDate"),
			"patientSex":        study.GetString("patientSex"),
			"studyDate":         study.GetString("studyDate"),
			"studyTime":         study.GetString("studyTime"),
			"studyDescription":  study.GetString("studyDescription"),
			"modality":          study.GetString("modality"),
			"accessionNumber":   study.GetString("accessionNumber"),
			"referringPhysician": study.GetString("referringPhysician"),
			"institutionName":   study.GetString("institutionName"),
			"uploadStatus":      study.GetString("uploadStatus"),
			"isAnonymized":      study.GetBool("isAnonymized"),
			"seriesCount":       study.Get("seriesCount"),
			"instanceCount":     study.Get("instanceCount"),
			"totalSize":         study.Get("totalSize"),
			"created":           study.GetString("created"),
			"series":            seriesResult,
		})
	}
}

func handleGetSeries(app *pocketbase.PocketBase) echo.HandlerFunc {
	return func(c echo.Context) error {
		seriesId := c.PathParam("seriesId")

		series, err := app.Dao().FindRecordById("series", seriesId)
		if err != nil {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "series not found"})
		}

		instances, _ := app.Dao().FindRecordsByFilter(
			"instances", "series = {:id}", "instanceNumber", 0, 0,
			dbx.Params{"id": seriesId},
		)

		instanceResult := make([]map[string]interface{}, 0, len(instances))
		for _, inst := range instances {
			instanceResult = append(instanceResult, map[string]interface{}{
				"id":             inst.Id,
				"sopInstanceUID": inst.GetString("sopInstanceUID"),
				"instanceNumber": inst.Get("instanceNumber"),
				"sliceLocation":  inst.Get("sliceLocation"),
				"imagePosition":  inst.Get("imagePosition"),
				"windowCenter":   inst.Get("windowCenter"),
				"windowWidth":    inst.Get("windowWidth"),
				"fileSize":       inst.Get("fileSize"),
				"transferSyntax": inst.GetString("transferSyntax"),
				"metadata":       inst.Get("metadata"),
			})
		}

		var studyResult map[string]interface{}
		if study, err := app.Dao().FindRecordById("studies", series.GetString("study")); err == nil {
			studyResult = map[string]interface{}{
				"id":               study.Id,
				"patientID":        study.GetString("patientID"),
				"patientName":      study.GetString("patientName"),
				"patientBirthDate": study.GetString("patientBirthDate"),
				"patientSex":       study.GetString("patientSex"),
				"studyDate":        study.GetString("studyDate"),
				"studyDescription": study.GetString("studyDescription"),
				"accessionNumber":  study.GetString("accessionNumber"),
				"institutionName":  study.GetString("institutionName"),
				"isAnonymized":     study.GetBool("isAnonymized"),
			}
		}

		return c.JSON(http.StatusOK, map[string]interface{}{
			"id":                series.Id,
			"seriesInstanceUID": series.GetString("seriesInstanceUID"),
			"seriesNumber":      series.Get("seriesNumber"),
			"seriesDescription": series.GetString("seriesDescription"),
			"modality":          series.GetString("modality"),
			"bodyPartExamined":  series.GetString("bodyPartExamined"),
			"protocolName":      series.GetString("protocolName"),
			"instanceCount":     series.Get("instanceCount"),
			"rows":              series.Get("rows"),
			"columns":           series.Get("columns"),
			"sliceThickness":    series.Get("sliceThickness"),
			"sliceSpacing":      series.Get("sliceSpacing"),
			"pixelSpacing":      series.Get("pixelSpacing"),
			"imageOrientation":  series.Get("imageOrientation"),
			"is3DCapable":       series.GetBool("is3DCapable"),
			"processingStatus":  series.GetString("processingStatus"),
			"study":             studyResult,
			"instances":         instanceResult,
		})
	}
}

func handleGetInstanceMetadata(app *pocketbase.PocketBase) echo.HandlerFunc {
	return func(c echo.Context) error {
		instanceId := c.PathParam("instanceId")

		inst, _, err := resolveInstance(app, instanceId)
		if err != nil {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "instance not found"})
		}

		return c.JSON(http.StatusOK, map[string]interface{}{
			"id":               inst.Id,
			"sopInstanceUID":   inst.GetString("sopInstanceUID"),
			"instanceNumber":   inst.Get("instanceNumber"),
			"sliceLocation":    inst.Get("sliceLocation"),
			"imagePosition":    inst.Get("imagePosition"),
			"windowCenter":     inst.Get("windowCenter"),
			"windowWidth":      inst.Get("windowWidth"),
			"rescaleIntercept": inst.Get("rescaleIntercept"),
			"rescaleSlope":     inst.Get("rescaleSlope"),
			"transferSyntax":   inst.GetString("transferSyntax"),
			"fileSize":         inst.Get("fileSize"),
			"metadata":         inst.Get("metadata"),
		})
	}
}

// handleGetInstanceFile redirects to PocketBase's built-in authenticated file endpoint.
func handleGetInstanceFile(app *pocketbase.PocketBase) echo.HandlerFunc {
	return func(c echo.Context) error {
		instanceId := c.PathParam("instanceId")

		inst, _, err := resolveInstance(app, instanceId)
		if err != nil {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "instance not found"})
		}

		filename := inst.GetString("dicomFile")
		if filename == "" {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "no file attached to this instance"})
		}

		return c.Redirect(http.StatusTemporaryRedirect,
			fmt.Sprintf("/api/files/instances/%s/%s", instanceId, filename))
	}
}

// ─── Upsert helpers ───────────────────────────────────────────────────────────

func upsertStudy(app *pocketbase.PocketBase, dataset dicom.Dataset, anonymized bool) (*models.Record, error) {
	studyUID := getStringDICOMTag(dataset, tag.StudyInstanceUID)
	if studyUID == "" {
		return nil, fmt.Errorf("missing StudyInstanceUID")
	}

	existing, err := app.Dao().FindFirstRecordByFilter(
		"studies", "studyInstanceUID = {:uid}",
		dbx.Params{"uid": studyUID},
	)
	if err == nil {
		return existing, nil
	}

	collection, err := app.Dao().FindCollectionByNameOrId("studies")
	if err != nil {
		return nil, fmt.Errorf("studies collection not found: %w", err)
	}

	record := models.NewRecord(collection)
	record.Set("studyInstanceUID", studyUID)
	record.Set("patientID", getStringDICOMTag(dataset, tag.PatientID))
	record.Set("patientName", getStringDICOMTag(dataset, tag.PatientName))
	record.Set("patientBirthDate", formatDICOMDate(getStringDICOMTag(dataset, tag.PatientBirthDate)))
	record.Set("patientSex", getStringDICOMTag(dataset, tag.PatientSex))
	record.Set("studyDate", formatDICOMDate(getStringDICOMTag(dataset, tag.StudyDate)))
	record.Set("studyTime", getStringDICOMTag(dataset, tag.StudyTime))
	record.Set("studyDescription", getStringDICOMTag(dataset, tag.StudyDescription))
	record.Set("modality", getStringDICOMTag(dataset, tag.Modality))
	record.Set("accessionNumber", getStringDICOMTag(dataset, tag.AccessionNumber))
	record.Set("referringPhysician", getStringDICOMTag(dataset, tag.ReferringPhysicianName))
	record.Set("institutionName", getStringDICOMTag(dataset, tag.InstitutionName))
	record.Set("uploadStatus", "processing")
	record.Set("isAnonymized", anonymized)
	record.Set("seriesCount", 0)
	record.Set("instanceCount", 0)

	if err := app.Dao().SaveRecord(record); err != nil {
		return nil, fmt.Errorf("failed to save study: %w", err)
	}
	return record, nil
}

func upsertSeries(app *pocketbase.PocketBase, studyID string, dataset dicom.Dataset) (*models.Record, error) {
	seriesUID := getStringDICOMTag(dataset, tag.SeriesInstanceUID)
	if seriesUID == "" {
		return nil, fmt.Errorf("missing SeriesInstanceUID")
	}

	existing, err := app.Dao().FindFirstRecordByFilter(
		"series", "seriesInstanceUID = {:uid} && study = {:study}",
		dbx.Params{"uid": seriesUID, "study": studyID},
	)
	if err == nil {
		return existing, nil
	}

	collection, err := app.Dao().FindCollectionByNameOrId("series")
	if err != nil {
		return nil, fmt.Errorf("series collection not found: %w", err)
	}

	record := models.NewRecord(collection)
	record.Set("seriesInstanceUID", seriesUID)
	record.Set("study", studyID)
	record.Set("seriesNumber", parseIntDICOMTag(dataset, tag.SeriesNumber))
	record.Set("seriesDescription", getStringDICOMTag(dataset, tag.SeriesDescription))
	record.Set("modality", getStringDICOMTag(dataset, tag.Modality))
	record.Set("bodyPartExamined", getStringDICOMTag(dataset, tag.BodyPartExamined))
	record.Set("protocolName", getStringDICOMTag(dataset, tag.ProtocolName))
	record.Set("seriesDate", formatDICOMDate(getStringDICOMTag(dataset, tag.SeriesDate)))
	record.Set("seriesTime", getStringDICOMTag(dataset, tag.SeriesTime))
	record.Set("instanceCount", 0)
	record.Set("rows", parseIntDICOMTag(dataset, tag.Rows))
	record.Set("columns", parseIntDICOMTag(dataset, tag.Columns))
	record.Set("sliceThickness", parseFloatDICOMTag(dataset, tag.SliceThickness))
	record.Set("frameOfReference", getStringDICOMTag(dataset, tag.FrameOfReferenceUID))
	record.Set("is3DCapable", false)
	record.Set("processingStatus", "pending")

	if err := app.Dao().SaveRecord(record); err != nil {
		return nil, fmt.Errorf("failed to save series: %w", err)
	}
	return record, nil
}

// ─── Utility ──────────────────────────────────────────────────────────────────

// resolveInstance fetches an instance record and its parent series.
func resolveInstance(app *pocketbase.PocketBase, instanceId string) (*models.Record, *models.Record, error) {
	inst, err := app.Dao().FindRecordById("instances", instanceId)
	if err != nil {
		return nil, nil, err
	}
	series, err := app.Dao().FindRecordById("series", inst.GetString("series"))
	if err != nil {
		return nil, nil, err
	}
	return inst, series, nil
}

// sanitizeFilename replaces characters unsafe in filenames.
func sanitizeFilename(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '.' || r == '/' || r == '\\' || r == ':' || r == ' ' {
			return '_'
		}
		return r
	}, s)
}

// formatDICOMDate converts DICOM YYYYMMDD to YYYY-MM-DD.
func formatDICOMDate(s string) string {
	s = strings.TrimSpace(s)
	if len(s) == 8 {
		return s[0:4] + "-" + s[4:6] + "-" + s[6:8]
	}
	return s
}

// buildMetadata collects supplemental DICOM tags into a JSON-serialisable map.
func buildMetadata(dataset dicom.Dataset) map[string]interface{} {
	return map[string]interface{}{
		"sopClassUID":                getStringDICOMTag(dataset, tag.SOPClassUID),
		"imageType":                  getStringDICOMTag(dataset, tag.ImageType),
		"acquisitionDate":            getStringDICOMTag(dataset, tag.AcquisitionDate),
		"acquisitionTime":            getStringDICOMTag(dataset, tag.AcquisitionTime),
		"kvp":                        getStringDICOMTag(dataset, tag.KVP),
		"convolutionKernel":          getStringDICOMTag(dataset, tag.ConvolutionKernel),
		"bitsAllocated":              parseIntDICOMTag(dataset, tag.BitsAllocated),
		"bitsStored":                 parseIntDICOMTag(dataset, tag.BitsStored),
		"pixelRepresentation":        parseIntDICOMTag(dataset, tag.PixelRepresentation),
		"photometricInterpretation":  getStringDICOMTag(dataset, tag.PhotometricInterpretation),
		"rows":                       parseIntDICOMTag(dataset, tag.Rows),
		"columns":                    parseIntDICOMTag(dataset, tag.Columns),
		"samplesPerPixel":            parseIntDICOMTag(dataset, tag.SamplesPerPixel),
		"sliceThickness":             parseFloatDICOMTag(dataset, tag.SliceThickness),
		"pixelSpacing":               parseFloatsDICOMTag(dataset, tag.PixelSpacing),
		"imageOrientation":           parseFloatsDICOMTag(dataset, tag.ImageOrientationPatient),
		"imagePosition":              parseFloatsDICOMTag(dataset, tag.ImagePositionPatient),
	}
}

// getStringDICOMTag returns the trimmed first string value for a DICOM tag, or "".
func getStringDICOMTag(dataset dicom.Dataset, t tag.Tag) string {
	elem, err := dataset.FindElementByTag(t)
	if err != nil {
		return ""
	}
	vals, ok := elem.Value.GetValue().([]string)
	if !ok || len(vals) == 0 {
		return ""
	}
	return strings.TrimSpace(vals[0])
}

// parseFloatDICOMTag returns the float64 value for a DICOM decimal string tag.
func parseFloatDICOMTag(dataset dicom.Dataset, t tag.Tag) float64 {
	s := getStringDICOMTag(dataset, t)
	if s == "" {
		return 0
	}
	v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return v
}

// parseFloatsDICOMTag returns every value of a multi-valued DICOM decimal
// string tag (e.g. ImagePositionPatient), or nil if absent or malformed.
func parseFloatsDICOMTag(dataset dicom.Dataset, t tag.Tag) []float64 {
	elem, err := dataset.FindElementByTag(t)
	if err != nil {
		return nil
	}
	vals, ok := elem.Value.GetValue().([]string)
	if !ok {
		return nil
	}
	result := make([]float64, 0, len(vals))
	for _, s := range vals {
		v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
		if err != nil {
			return nil
		}
		result = append(result, v)
	}
	return result
}

// parseIntDICOMTag returns the int value for a DICOM tag stored either as an
// integer string (IS) or as a binary integer (US/SS/UL/SL), or 0 if absent.
func parseIntDICOMTag(dataset dicom.Dataset, t tag.Tag) int {
	elem, err := dataset.FindElementByTag(t)
	if err != nil {
		return 0
	}
	if ints, ok := elem.Value.GetValue().([]int); ok {
		if len(ints) == 0 {
			return 0
		}
		return ints[0]
	}
	s := getStringDICOMTag(dataset, t)
	if s == "" {
		return 0
	}
	v, _ := strconv.Atoi(strings.TrimSpace(s))
	return v
}
