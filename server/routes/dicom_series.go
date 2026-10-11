package routes

import (
	"bytes"
	"fmt"
	"io"
	"math"
	"sort"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/models"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/suyashkumar/dicom"
	"github.com/suyashkumar/dicom/pkg/tag"
)

// ─── Series post-processing ───────────────────────────────────────────────────

// A series needs at least this many slices to be offered as a volume.
const minVolumeSlices = 10

// sliceGeometry is the per-instance information needed to decide whether a
// series forms a regular 3D volume.
type sliceGeometry struct {
	Rows            int       `json:"rows"`
	Columns         int       `json:"columns"`
	SamplesPerPixel int       `json:"samplesPerPixel"`
	Orientation     []float64 `json:"imageOrientation"`
	Position        []float64 `json:"imagePosition"`
	PixelSpacing    []float64 `json:"pixelSpacing"`
}

// applyInstanceFields copies the per-instance DICOM attributes onto the record.
func applyInstanceFields(inst *models.Record, dataset dicom.Dataset, fileSize int) {
	inst.Set("instanceNumber", parseIntDICOMTag(dataset, tag.InstanceNumber))
	inst.Set("sliceLocation", parseFloatDICOMTag(dataset, tag.SliceLocation))
	inst.Set("imagePosition", parseFloatsDICOMTag(dataset, tag.ImagePositionPatient))
	inst.Set("windowCenter", parseFloatDICOMTag(dataset, tag.WindowCenter))
	inst.Set("windowWidth", parseFloatDICOMTag(dataset, tag.WindowWidth))
	inst.Set("rescaleIntercept", parseFloatDICOMTag(dataset, tag.RescaleIntercept))
	inst.Set("rescaleSlope", parseFloatDICOMTag(dataset, tag.RescaleSlope))
	inst.Set("fileSize", fileSize)
	inst.Set("transferSyntax", getStringDICOMTag(dataset, tag.TransferSyntaxUID))
	inst.Set("metadata", buildMetadata(dataset))
}

// readStoredFile loads a whole file from PocketBase storage.
func readStoredFile(fsys *filesystem.System, fileKey string) ([]byte, error) {
	r, err := fsys.GetFile(fileKey)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(r)
}

// finalizeSeries recomputes the derived series fields (instance count,
// geometry, whether it can be viewed as a volume) from its instances and marks
// it ready. Instances stored before these attributes were recorded are
// re-read from their DICOM file first.
func finalizeSeries(app *pocketbase.PocketBase, fsys *filesystem.System, series *models.Record) error {
	instances, err := app.Dao().FindRecordsByFilter(
		"instances", "series = {:id}", "instanceNumber", 0, 0,
		dbx.Params{"id": series.Id},
	)
	if err != nil {
		return err
	}

	slices := make([]sliceGeometry, 0, len(instances))
	for _, inst := range instances {
		var geom sliceGeometry
		_ = inst.UnmarshalJSONField("metadata", &geom)

		if geom.Rows == 0 {
			fileKey := fmt.Sprintf("%s/%s/%s", inst.Collection().Id, inst.Id, inst.GetString("dicomFile"))
			fileBytes, err := readStoredFile(fsys, fileKey)
			if err != nil {
				return fmt.Errorf("instance %s: failed to read file: %w", inst.Id, err)
			}
			dataset, err := dicom.Parse(bytes.NewReader(fileBytes), int64(len(fileBytes)), nil, dicom.SkipPixelData())
			if err != nil {
				return fmt.Errorf("instance %s: invalid DICOM file: %w", inst.Id, err)
			}
			applyInstanceFields(inst, dataset, len(fileBytes))
			if err := app.Dao().SaveRecord(inst); err != nil {
				return fmt.Errorf("instance %s: failed to save: %w", inst.Id, err)
			}
			_ = inst.UnmarshalJSONField("metadata", &geom)
		}

		slices = append(slices, geom)
	}

	series.Set("instanceCount", len(instances))
	if len(slices) > 0 {
		first := slices[0]
		series.Set("rows", first.Rows)
		series.Set("columns", first.Columns)
		series.Set("pixelSpacing", first.PixelSpacing)
		series.Set("imageOrientation", first.Orientation)
	}

	is3D, spacing := volumeGeometry(slices)
	series.Set("is3DCapable", is3D)
	series.Set("sliceSpacing", spacing)
	series.Set("processingStatus", "ready")

	return app.Dao().SaveRecord(series)
}

// volumeGeometry reports whether the slices form a regular volume: enough
// single-channel slices of the same size and orientation, evenly spaced along
// the slice normal. It also returns that spacing in mm.
func volumeGeometry(slices []sliceGeometry) (bool, float64) {
	if len(slices) < minVolumeSlices {
		return false, 0
	}

	first := slices[0]
	if len(first.Orientation) != 6 {
		return false, 0
	}
	row, col := first.Orientation[0:3], first.Orientation[3:6]
	normal := []float64{
		row[1]*col[2] - row[2]*col[1],
		row[2]*col[0] - row[0]*col[2],
		row[0]*col[1] - row[1]*col[0],
	}

	distances := make([]float64, 0, len(slices))
	for _, s := range slices {
		if s.SamplesPerPixel != 1 || s.Rows != first.Rows || s.Columns != first.Columns {
			return false, 0
		}
		if len(s.Orientation) != 6 || len(s.Position) != 3 {
			return false, 0
		}
		for i := range s.Orientation {
			if math.Abs(s.Orientation[i]-first.Orientation[i]) > 1e-3 {
				return false, 0
			}
		}
		distances = append(distances, s.Position[0]*normal[0]+s.Position[1]*normal[1]+s.Position[2]*normal[2])
	}

	sort.Float64s(distances)
	gaps := make([]float64, 0, len(distances)-1)
	for i := 1; i < len(distances); i++ {
		gaps = append(gaps, distances[i]-distances[i-1])
	}
	sorted := append([]float64(nil), gaps...)
	sort.Float64s(sorted)
	median := sorted[len(sorted)/2]
	if median < 1e-4 {
		return false, 0
	}
	for _, gap := range gaps {
		if math.Abs(gap-median) > 0.1*median {
			return false, 0
		}
	}

	return true, median
}

// refreshStudyStats recomputes the study-level counts from its series and
// instances and marks the upload complete.
func refreshStudyStats(app *pocketbase.PocketBase, studyId string) error {
	study, err := app.Dao().FindRecordById("studies", studyId)
	if err != nil {
		return err
	}

	seriesList, err := app.Dao().FindRecordsByFilter(
		"series", "study = {:id}", "", 0, 0, dbx.Params{"id": studyId},
	)
	if err != nil {
		return err
	}

	instanceCount := 0
	for _, s := range seriesList {
		instanceCount += s.GetInt("instanceCount")
	}

	var totalSize float64
	err = app.Dao().DB().
		NewQuery("SELECT COALESCE(SUM(i.fileSize), 0) FROM instances i JOIN series s ON i.series = s.id WHERE s.study = {:id}").
		Bind(dbx.Params{"id": studyId}).
		Row(&totalSize)
	if err != nil {
		return err
	}

	study.Set("seriesCount", len(seriesList))
	study.Set("instanceCount", instanceCount)
	study.Set("totalSize", totalSize)
	study.Set("uploadStatus", "complete")
	return app.Dao().SaveRecord(study)
}

// BackfillSeries finalizes every series that has not been processed yet, e.g.
// data uploaded before series post-processing existed.
func BackfillSeries(app *pocketbase.PocketBase) {
	pending, err := app.Dao().FindRecordsByFilter(
		"series", "processingStatus != 'ready'", "", 0, 0,
	)
	if err != nil {
		app.Logger().Error("Series backfill: failed to list series", "error", err)
		return
	}
	if len(pending) == 0 {
		return
	}

	fsys, err := app.NewFilesystem()
	if err != nil {
		app.Logger().Error("Series backfill: filesystem unavailable", "error", err)
		return
	}
	defer fsys.Close()

	app.Logger().Info("Series backfill: processing", "series", len(pending))

	studies := map[string]bool{}
	for _, series := range pending {
		if err := finalizeSeries(app, fsys, series); err != nil {
			app.Logger().Error("Series backfill: failed", "seriesId", series.Id, "error", err)
			continue
		}
		studies[series.GetString("study")] = true
	}
	for studyId := range studies {
		if err := refreshStudyStats(app, studyId); err != nil {
			app.Logger().Error("Series backfill: failed to refresh study", "studyId", studyId, "error", err)
		}
	}

	app.Logger().Info("Series backfill: done")
}
