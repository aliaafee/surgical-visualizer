package migrations

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/models"
	"github.com/pocketbase/pocketbase/models/schema"
)

const patientsCollectionId = "ptnts0000000001"

// A patient groups the studies uploaded for them. Studies keep their own
// copy of the demographics read from their DICOM files; the patient's are
// entered by the user when the patient is created.
const patientsCollectionJSON = `{
	"id": "` + patientsCollectionId + `",
	"name": "patients",
	"type": "base",
	"system": false,
	"schema": [
		{"system": false, "id": "ptnt0000", "name": "name", "type": "text", "required": true, "presentable": true, "unique": false, "options": {"min": null, "max": null, "pattern": ""}},
		{"system": false, "id": "ptnt0001", "name": "patientID", "type": "text", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "pattern": ""}},
		{"system": false, "id": "ptnt0002", "name": "birthDate", "type": "text", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "pattern": ""}},
		{"system": false, "id": "ptnt0003", "name": "sex", "type": "text", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "pattern": ""}},
		{"system": false, "id": "ptnt0004", "name": "notes", "type": "text", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "pattern": ""}}
	],
	"indexes": ["CREATE INDEX idx_patients_patientID ON patients (patientID)"],
	"listRule": "@request.auth.id != \"\"",
	"viewRule": "@request.auth.id != \"\"",
	"createRule": "@request.auth.id != \"\"",
	"updateRule": "@request.auth.id != \"\"",
	"deleteRule": null,
	"options": {}
}`

const studyPatientFieldJSON = `{"system": false, "id": "ptstd000", "name": "patient", "type": "relation", "required": false, "presentable": false, "unique": false, "options": {"collectionId": "` + patientsCollectionId + `", "cascadeDelete": false, "minSelect": null, "maxSelect": 1, "displayFields": null}}`

func init() {
	m.Register(func(db dbx.Builder) error {
		dao := daos.New(db)

		patients := &models.Collection{}
		if err := json.Unmarshal([]byte(patientsCollectionJSON), patients); err != nil {
			return err
		}
		if err := dao.SaveCollection(patients); err != nil {
			return err
		}

		studies, err := dao.FindCollectionByNameOrId("studies")
		if err != nil {
			return err
		}
		field := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(studyPatientFieldJSON), field); err != nil {
			return err
		}
		studies.Schema.AddField(field)
		if err := dao.SaveCollection(studies); err != nil {
			return err
		}

		return backfillStudyPatients(dao, patients)
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		studies, err := dao.FindCollectionByNameOrId("studies")
		if err != nil {
			return err
		}
		studies.Schema.RemoveField("ptstd000")
		if err := dao.SaveCollection(studies); err != nil {
			return err
		}

		patients, err := dao.FindCollectionByNameOrId(patientsCollectionId)
		if err != nil {
			return err
		}
		return dao.DeleteCollection(patients)
	})
}

// backfillStudyPatients gives every study uploaded before patients existed a
// patient, one per distinct DICOM patient ID (falling back to the name, then
// to the study itself, when the files carry neither).
func backfillStudyPatients(dao *daos.Dao, patients *models.Collection) error {
	studies, err := dao.FindRecordsByFilter("studies", "patient = ''", "created", 0, 0)
	if err != nil {
		return err
	}

	byKey := map[string]*models.Record{}
	for _, study := range studies {
		key := study.GetString("patientID")
		if key == "" {
			key = "name:" + study.GetString("patientName")
		}
		if key == "name:" {
			key = "study:" + study.Id
		}

		patient := byKey[key]
		if patient == nil {
			patient = models.NewRecord(patients)
			name := study.GetString("patientName")
			if name == "" {
				name = study.GetString("patientID")
			}
			if name == "" {
				name = "Unknown patient"
			}
			patient.Set("name", name)
			patient.Set("patientID", study.GetString("patientID"))
			patient.Set("birthDate", study.GetString("patientBirthDate"))
			patient.Set("sex", study.GetString("patientSex"))
			if err := dao.SaveRecord(patient); err != nil {
				return err
			}
			byKey[key] = patient
		}

		study.Set("patient", patient.Id)
		if err := dao.SaveRecord(study); err != nil {
			return err
		}
	}
	return nil
}
