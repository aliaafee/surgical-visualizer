package routes

import (
	"bytes"
	"testing"

	"github.com/suyashkumar/dicom"
	"github.com/suyashkumar/dicom/pkg/tag"
	"github.com/suyashkumar/dicom/pkg/uid"
)

func mustElement(t *testing.T, tg tag.Tag, data any) *dicom.Element {
	t.Helper()
	elem, err := dicom.NewElement(tg, data)
	if err != nil {
		t.Fatalf("NewElement(%v): %v", tg, err)
	}
	return elem
}

func testDICOMFile(t *testing.T) []byte {
	t.Helper()

	nested := []*dicom.Element{
		mustElement(t, tag.PatientName, []string{"Nested^Name"}),
		mustElement(t, tag.Modality, []string{"CT"}),
	}

	dataset := dicom.Dataset{Elements: []*dicom.Element{
		mustElement(t, tag.MediaStorageSOPClassUID, []string{"1.2.840.10008.5.1.4.1.1.2"}),
		mustElement(t, tag.MediaStorageSOPInstanceUID, []string{"1.2.3.4.5"}),
		mustElement(t, tag.TransferSyntaxUID, []string{uid.ExplicitVRLittleEndian}),
		mustElement(t, tag.AccessionNumber, []string{"ACC123"}),
		mustElement(t, tag.Modality, []string{"CT"}),
		mustElement(t, tag.InstitutionName, []string{"General Hospital"}),
		mustElement(t, tag.ReferringPhysicianName, []string{"Doctor^Who"}),
		mustElement(t, tag.ReferencedPatientSequence, [][]*dicom.Element{nested}),
		mustElement(t, tag.PatientName, []string{"Doe^Jane"}),
		mustElement(t, tag.PatientID, []string{"MRN0001"}),
		mustElement(t, tag.PatientBirthDate, []string{"19800101"}),
		mustElement(t, tag.PatientSex, []string{"F"}),
		mustElement(t, tag.StudyInstanceUID, []string{"1.2.3"}),
		mustElement(t, tag.SeriesInstanceUID, []string{"1.2.3.4"}),
		mustElement(t, tag.Rows, []int{2}),
		mustElement(t, tag.Columns, []int{2}),
	}}

	var buf bytes.Buffer
	if err := dicom.Write(&buf, dataset); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}
	return buf.Bytes()
}

func TestAnonymizeDICOM(t *testing.T) {
	original := testDICOMFile(t)

	anonymized, err := anonymizeDICOM(original)
	if err != nil {
		t.Fatalf("anonymizeDICOM: %v", err)
	}

	for _, secret := range []string{"Doe", "Jane", "MRN0001", "19800101", "ACC123", "General Hospital", "Doctor", "Nested"} {
		if bytes.Contains(anonymized, []byte(secret)) {
			t.Errorf("anonymized file still contains %q", secret)
		}
	}

	dataset, err := dicom.Parse(bytes.NewReader(anonymized), int64(len(anonymized)), nil)
	if err != nil {
		t.Fatalf("anonymized file does not parse: %v", err)
	}

	pseudonym := pseudonymFor("1.2.3")
	expect := map[tag.Tag]string{
		tag.PatientName:           pseudonym,
		tag.PatientID:             pseudonym,
		tag.PatientBirthDate:      "",
		tag.AccessionNumber:       "",
		tag.PatientSex:            "F",
		tag.Modality:              "CT",
		tag.StudyInstanceUID:      "1.2.3",
		tag.SeriesInstanceUID:     "1.2.3.4",
		tagPatientIdentityRemoved: "YES",
	}
	for tg, want := range expect {
		if _, err := dataset.FindElementByTag(tg); err != nil {
			t.Errorf("tag %v missing after anonymization", tg)
			continue
		}
		if got := getStringDICOMTag(dataset, tg); got != want {
			t.Errorf("tag %v = %q, want %q", tg, got, want)
		}
	}

	if _, err := dataset.FindElementByTag(tag.InstitutionName); err == nil {
		t.Errorf("InstitutionName should have been removed")
	}
	if got := parseIntDICOMTag(dataset, tag.Rows); got != 2 {
		t.Errorf("Rows = %d, want 2", got)
	}

	// Anonymizing twice must give the same identity.
	again, err := anonymizeDICOM(anonymized)
	if err != nil {
		t.Fatalf("second anonymizeDICOM: %v", err)
	}
	if !bytes.Equal(again, anonymized) {
		t.Errorf("anonymization is not idempotent")
	}
}

func TestVolumeGeometry(t *testing.T) {
	axial := []float64{1, 0, 0, 0, 1, 0}
	stack := func(n int, spacing float64) []sliceGeometry {
		slices := make([]sliceGeometry, 0, n)
		for i := 0; i < n; i++ {
			slices = append(slices, sliceGeometry{
				Rows: 512, Columns: 512, SamplesPerPixel: 1,
				Orientation: axial,
				Position:    []float64{-100, -100, float64(i) * spacing},
			})
		}
		return slices
	}

	if ok, spacing := volumeGeometry(stack(40, 0.625)); !ok || spacing < 0.62 || spacing > 0.63 {
		t.Errorf("regular stack: got (%v, %v), want (true, 0.625)", ok, spacing)
	}

	if ok, _ := volumeGeometry(stack(minVolumeSlices-1, 1)); ok {
		t.Errorf("too few slices should not be a volume")
	}

	color := stack(40, 1)
	for i := range color {
		color[i].SamplesPerPixel = 3
	}
	if ok, _ := volumeGeometry(color); ok {
		t.Errorf("RGB slices should not be a volume")
	}

	gap := stack(40, 1)
	gap[20].Position = []float64{-100, -100, 25}
	if ok, _ := volumeGeometry(gap); ok {
		t.Errorf("unevenly spaced slices should not be a volume")
	}

	mixed := stack(40, 1)
	mixed[5].Orientation = []float64{1, 0, 0, 0, 0, -1}
	if ok, _ := volumeGeometry(mixed); ok {
		t.Errorf("mixed orientations should not be a volume")
	}

	noPosition := stack(40, 1)
	noPosition[3].Position = nil
	if ok, _ := volumeGeometry(noPosition); ok {
		t.Errorf("slices without a position should not be a volume")
	}
}
