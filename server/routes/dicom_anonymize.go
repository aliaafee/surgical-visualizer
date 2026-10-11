package routes

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/labstack/echo/v5"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/suyashkumar/dicom"
	"github.com/suyashkumar/dicom/pkg/tag"
)

// ─── Anonymization ────────────────────────────────────────────────────────────
//
// Identifying attributes are replaced, blanked or removed in the DICOM file
// itself before it is stored, so neither the database nor the files served to
// the viewer carry patient identity. UIDs, study/series dates, patient sex and
// age are kept because the viewer and study organisation depend on them.
//
// Pixel data is copied through untouched, which means text burned into the
// image (e.g. scanner screenshots) is NOT removed.

// Replaced with a pseudonym derived from the StudyInstanceUID.
var anonReplaceTags = map[tag.Tag]bool{
	tag.PatientName: true,
	tag.PatientID:   true,
}

// Kept in the file but emptied (DICOM type 2 attributes).
var anonBlankTags = map[tag.Tag]bool{
	tag.PatientBirthDate:             true,
	tag.ReferringPhysicianName:       true,
	tag.AccessionNumber:              true,
	{Group: 0x0020, Element: 0x0010}: true, // StudyID
}

// Removed from the file entirely.
var anonRemoveTags = map[tag.Tag]bool{
	tag.InstitutionName:              true,
	{Group: 0x0008, Element: 0x0081}: true, // InstitutionAddress
	{Group: 0x0008, Element: 0x0092}: true, // ReferringPhysicianAddress
	{Group: 0x0008, Element: 0x0094}: true, // ReferringPhysicianTelephoneNumbers
	{Group: 0x0008, Element: 0x1010}: true, // StationName
	{Group: 0x0008, Element: 0x1040}: true, // InstitutionalDepartmentName
	{Group: 0x0008, Element: 0x1048}: true, // PhysiciansOfRecord
	{Group: 0x0008, Element: 0x1050}: true, // PerformingPhysicianName
	{Group: 0x0008, Element: 0x1060}: true, // NameOfPhysiciansReadingStudy
	{Group: 0x0008, Element: 0x1070}: true, // OperatorsName
	{Group: 0x0010, Element: 0x0021}: true, // IssuerOfPatientID
	{Group: 0x0010, Element: 0x0032}: true, // PatientBirthTime
	{Group: 0x0010, Element: 0x0050}: true, // PatientInsurancePlanCodeSequence
	{Group: 0x0010, Element: 0x1000}: true, // OtherPatientIDs
	{Group: 0x0010, Element: 0x1001}: true, // OtherPatientNames
	{Group: 0x0010, Element: 0x1002}: true, // OtherPatientIDsSequence
	{Group: 0x0010, Element: 0x1005}: true, // PatientBirthName
	{Group: 0x0010, Element: 0x1040}: true, // PatientAddress
	{Group: 0x0010, Element: 0x1060}: true, // PatientMotherBirthName
	{Group: 0x0010, Element: 0x1080}: true, // MilitaryRank
	{Group: 0x0010, Element: 0x1090}: true, // MedicalRecordLocator
	{Group: 0x0010, Element: 0x2150}: true, // CountryOfResidence
	{Group: 0x0010, Element: 0x2152}: true, // RegionOfResidence
	{Group: 0x0010, Element: 0x2154}: true, // PatientTelephoneNumbers
	{Group: 0x0010, Element: 0x2160}: true, // EthnicGroup
	{Group: 0x0010, Element: 0x2180}: true, // Occupation
	{Group: 0x0010, Element: 0x21b0}: true, // AdditionalPatientHistory
	{Group: 0x0010, Element: 0x21f0}: true, // PatientReligiousPreference
	{Group: 0x0010, Element: 0x2297}: true, // ResponsiblePerson
	{Group: 0x0010, Element: 0x4000}: true, // PatientComments
	{Group: 0x0018, Element: 0x1000}: true, // DeviceSerialNumber
	{Group: 0x0020, Element: 0x4000}: true, // ImageComments
	{Group: 0x0032, Element: 0x1032}: true, // RequestingPhysician
	{Group: 0x0040, Element: 0x0006}: true, // ScheduledPerformingPhysicianName
	{Group: 0x0040, Element: 0x0010}: true, // ScheduledStationName
	{Group: 0x0040, Element: 0x0242}: true, // PerformedStationName
	{Group: 0x0040, Element: 0x1001}: true, // RequestedProcedureID
}

var (
	tagPatientIdentityRemoved = tag.Tag{Group: 0x0012, Element: 0x0062}
	tagDeidentificationMethod = tag.Tag{Group: 0x0012, Element: 0x0063}
)

const deidentificationMethod = "Surgical Visualizer basic"

// pseudonymFor returns a stable placeholder identity for a study, so every file
// of the same study (including files uploaded in separate requests) matches.
func pseudonymFor(studyUID string) string {
	sum := sha256.Sum256([]byte(studyUID))
	return "ANON-" + strings.ToUpper(hex.EncodeToString(sum[:4]))
}

// anonymizeDICOM returns a copy of the DICOM file with identifying attributes
// replaced, blanked or removed. Pixel data bytes are passed through unchanged.
func anonymizeDICOM(fileBytes []byte) ([]byte, error) {
	dataset, err := dicom.Parse(
		bytes.NewReader(fileBytes), int64(len(fileBytes)), nil,
		dicom.SkipProcessingPixelDataValue(),
	)
	if err != nil {
		return nil, fmt.Errorf("parse: %w", err)
	}

	pseudonym := pseudonymFor(getStringDICOMTag(dataset, tag.StudyInstanceUID))

	elements, err := anonymizeElements(dataset.Elements, pseudonym)
	if err != nil {
		return nil, err
	}

	for t, value := range map[tag.Tag]string{
		tagPatientIdentityRemoved: "YES",
		tagDeidentificationMethod: deidentificationMethod,
	} {
		elem, err := dicom.NewElement(t, []string{value})
		if err != nil {
			return nil, err
		}
		elements = append(elements, elem)
	}

	// DICOM requires elements in ascending tag order.
	sort.SliceStable(elements, func(i, j int) bool {
		return elements[i].Tag.Compare(elements[j].Tag) < 0
	})
	dataset.Elements = elements

	var out bytes.Buffer
	if err := dicom.Write(&out, dataset, dicom.SkipVRVerification(), dicom.SkipValueTypeVerification()); err != nil {
		return nil, fmt.Errorf("write: %w", err)
	}
	return out.Bytes(), nil
}

// anonymizeElements applies the anonymization rules to a list of elements,
// recursing into sequences.
func anonymizeElements(elements []*dicom.Element, pseudonym string) ([]*dicom.Element, error) {
	result := make([]*dicom.Element, 0, len(elements))

	for _, elem := range elements {
		// Private tags (odd group) are vendor-defined and may hold anything.
		if elem.Tag.Group%2 == 1 {
			continue
		}
		if anonRemoveTags[elem.Tag] || elem.Tag == tagPatientIdentityRemoved || elem.Tag == tagDeidentificationMethod {
			continue
		}

		if anonReplaceTags[elem.Tag] || anonBlankTags[elem.Tag] {
			replacement := ""
			if anonReplaceTags[elem.Tag] {
				replacement = pseudonym
			}
			value, err := dicom.NewValue([]string{replacement})
			if err != nil {
				return nil, err
			}
			elem.Value = value
			result = append(result, elem)
			continue
		}

		if elem.Value != nil && elem.Value.ValueType() == dicom.Sequences {
			items, ok := elem.Value.GetValue().([]*dicom.SequenceItemValue)
			if !ok {
				return nil, fmt.Errorf("unexpected sequence value for tag %v", elem.Tag)
			}

			newItems := make([][]*dicom.Element, 0, len(items))
			for _, item := range items {
				children, err := anonymizeElements(item.GetValue().([]*dicom.Element), pseudonym)
				if err != nil {
					return nil, err
				}
				newItems = append(newItems, children)
			}

			value, err := dicom.NewValue(newItems)
			if err != nil {
				return nil, err
			}
			elem.Value = value
			// The writer always emits sequence delimiters, which is only
			// valid together with an undefined length.
			elem.ValueLength = tag.VLUndefinedLength
		}

		result = append(result, elem)
	}

	return result, nil
}

// handleAnonymizeStudy anonymizes an already uploaded study in place: every
// stored file is rewritten and the identifying database fields are cleared.
// This cannot be undone.
func handleAnonymizeStudy(app *pocketbase.PocketBase) echo.HandlerFunc {
	return func(c echo.Context) error {
		studyId := c.PathParam("studyId")

		study, err := app.Dao().FindRecordById("studies", studyId)
		if err != nil {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "study not found"})
		}

		instanceCollection, err := app.Dao().FindCollectionByNameOrId("instances")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "instances collection not found"})
		}

		seriesList, err := app.Dao().FindRecordsByFilter(
			"series", "study = {:id}", "", 0, 0, dbx.Params{"id": studyId},
		)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch series"})
		}

		fsys, err := app.NewFilesystem()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "filesystem unavailable"})
		}
		defer fsys.Close()

		processed := 0
		var errs []string

		for _, series := range seriesList {
			instances, err := app.Dao().FindRecordsByFilter(
				"instances", "series = {:id}", "", 0, 0, dbx.Params{"id": series.Id},
			)
			if err != nil {
				errs = append(errs, fmt.Sprintf("series %s: %v", series.Id, err))
				continue
			}

			for _, inst := range instances {
				fileKey := fmt.Sprintf("%s/%s/%s", instanceCollection.Id, inst.Id, inst.GetString("dicomFile"))

				fileBytes, err := readStoredFile(fsys, fileKey)
				if err != nil {
					errs = append(errs, fmt.Sprintf("instance %s: failed to read file: %v", inst.Id, err))
					continue
				}

				anonymized, err := anonymizeDICOM(fileBytes)
				if err != nil {
					errs = append(errs, fmt.Sprintf("instance %s: %v", inst.Id, err))
					continue
				}

				if err := fsys.Upload(anonymized, fileKey); err != nil {
					errs = append(errs, fmt.Sprintf("instance %s: failed to store file: %v", inst.Id, err))
					continue
				}

				inst.Set("fileSize", len(anonymized))
				if err := app.Dao().SaveRecord(inst); err != nil {
					errs = append(errs, fmt.Sprintf("instance %s: failed to update record: %v", inst.Id, err))
					continue
				}
				processed++
			}
		}

		// Only flag the study once every file has actually been rewritten.
		if len(errs) == 0 {
			pseudonym := pseudonymFor(study.GetString("studyInstanceUID"))
			study.Set("patientName", pseudonym)
			study.Set("patientID", pseudonym)
			study.Set("patientBirthDate", "")
			study.Set("accessionNumber", "")
			study.Set("referringPhysician", "")
			study.Set("institutionName", "")
			study.Set("isAnonymized", true)
			if err := app.Dao().SaveRecord(study); err != nil {
				errs = append(errs, fmt.Sprintf("failed to update study: %v", err))
			}
		}

		if err := refreshStudyStats(app, study.Id); err != nil {
			errs = append(errs, fmt.Sprintf("failed to refresh study stats: %v", err))
		}

		status := http.StatusOK
		if len(errs) > 0 {
			status = http.StatusInternalServerError
		}
		return c.JSON(status, map[string]interface{}{
			"studyId":        study.Id,
			"filesProcessed": processed,
			"isAnonymized":   len(errs) == 0,
			"errors":         errs,
		})
	}
}
