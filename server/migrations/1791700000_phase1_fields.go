package migrations

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/models/schema"
)

// Adds the fields the DICOM upload pipeline writes (counts, status, geometry,
// per-instance metadata). Without them PocketBase silently drops the values.
var phase1Fields = map[string][]string{
	"studies": {
		`{"system": false, "id": "p1st000", "name": "patientBirthDate", "type": "text", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "pattern": ""}}`,
		`{"system": false, "id": "p1st001", "name": "patientSex", "type": "text", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "pattern": ""}}`,
		`{"system": false, "id": "p1st002", "name": "seriesCount", "type": "number", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "noDecimal": false}}`,
		`{"system": false, "id": "p1st003", "name": "instanceCount", "type": "number", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "noDecimal": false}}`,
		`{"system": false, "id": "p1st004", "name": "totalSize", "type": "number", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "noDecimal": false}}`,
		`{"system": false, "id": "p1st005", "name": "uploadStatus", "type": "text", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "pattern": ""}}`,
		`{"system": false, "id": "p1st006", "name": "isAnonymized", "type": "bool", "required": false, "presentable": false, "unique": false, "options": {}}`,
	},
	"series": {
		`{"system": false, "id": "p1se000", "name": "instanceCount", "type": "number", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "noDecimal": false}}`,
		`{"system": false, "id": "p1se001", "name": "pixelSpacing", "type": "json", "required": false, "presentable": false, "unique": false, "options": {"maxSize": 2000000}}`,
		`{"system": false, "id": "p1se002", "name": "imageOrientation", "type": "json", "required": false, "presentable": false, "unique": false, "options": {"maxSize": 2000000}}`,
		`{"system": false, "id": "p1se003", "name": "sliceSpacing", "type": "number", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "noDecimal": false}}`,
		`{"system": false, "id": "p1se004", "name": "is3DCapable", "type": "bool", "required": false, "presentable": false, "unique": false, "options": {}}`,
		`{"system": false, "id": "p1se005", "name": "processingStatus", "type": "text", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "pattern": ""}}`,
	},
	"instances": {
		`{"system": false, "id": "p1in000", "name": "sliceLocation", "type": "number", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "noDecimal": false}}`,
		`{"system": false, "id": "p1in001", "name": "imagePosition", "type": "json", "required": false, "presentable": false, "unique": false, "options": {"maxSize": 2000000}}`,
		`{"system": false, "id": "p1in002", "name": "windowCenter", "type": "number", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "noDecimal": false}}`,
		`{"system": false, "id": "p1in003", "name": "windowWidth", "type": "number", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "noDecimal": false}}`,
		`{"system": false, "id": "p1in004", "name": "rescaleIntercept", "type": "number", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "noDecimal": false}}`,
		`{"system": false, "id": "p1in005", "name": "rescaleSlope", "type": "number", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "noDecimal": false}}`,
		`{"system": false, "id": "p1in006", "name": "fileSize", "type": "number", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "noDecimal": false}}`,
		`{"system": false, "id": "p1in007", "name": "transferSyntax", "type": "text", "required": false, "presentable": false, "unique": false, "options": {"min": null, "max": null, "pattern": ""}}`,
		`{"system": false, "id": "p1in008", "name": "metadata", "type": "json", "required": false, "presentable": false, "unique": false, "options": {"maxSize": 2000000}}`,
	},
}

func init() {
	m.Register(func(db dbx.Builder) error {
		dao := daos.New(db)

		for name, defs := range phase1Fields {
			collection, err := dao.FindCollectionByNameOrId(name)
			if err != nil {
				return err
			}

			for _, def := range defs {
				field := &schema.SchemaField{}
				if err := json.Unmarshal([]byte(def), field); err != nil {
					return err
				}
				if collection.Schema.GetFieldByName(field.Name) != nil {
					continue
				}
				collection.Schema.AddField(field)
			}

			if err := dao.SaveCollection(collection); err != nil {
				return err
			}
		}

		return nil
	}, func(db dbx.Builder) error {
		dao := daos.New(db)

		for name, defs := range phase1Fields {
			collection, err := dao.FindCollectionByNameOrId(name)
			if err != nil {
				return err
			}

			for _, def := range defs {
				field := &schema.SchemaField{}
				if err := json.Unmarshal([]byte(def), field); err != nil {
					return err
				}
				collection.Schema.RemoveField(field.Id)
			}

			if err := dao.SaveCollection(collection); err != nil {
				return err
			}
		}

		return nil
	})
}
