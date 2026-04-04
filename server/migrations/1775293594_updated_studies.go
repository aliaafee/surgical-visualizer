package migrations

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/models/schema"
)

func init() {
	m.Register(func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("0lrm72emnqjvjsg")
		if err != nil {
			return err
		}

		// add
		new_patientID := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "xna3mphw",
			"name": "patientID",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_patientID); err != nil {
			return err
		}
		collection.Schema.AddField(new_patientID)

		// add
		new_patientName := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "lvindnxv",
			"name": "patientName",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_patientName); err != nil {
			return err
		}
		collection.Schema.AddField(new_patientName)

		// add
		new_accessionNumber := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "jfb1n8zq",
			"name": "accessionNumber",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_accessionNumber); err != nil {
			return err
		}
		collection.Schema.AddField(new_accessionNumber)

		// add
		new_referringPhysician := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "ixvxj7rm",
			"name": "referringPhysician",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_referringPhysician); err != nil {
			return err
		}
		collection.Schema.AddField(new_referringPhysician)

		// add
		new_institutionName := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "0guexgdj",
			"name": "institutionName",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_institutionName); err != nil {
			return err
		}
		collection.Schema.AddField(new_institutionName)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("0lrm72emnqjvjsg")
		if err != nil {
			return err
		}

		// remove
		collection.Schema.RemoveField("xna3mphw")

		// remove
		collection.Schema.RemoveField("lvindnxv")

		// remove
		collection.Schema.RemoveField("jfb1n8zq")

		// remove
		collection.Schema.RemoveField("ixvxj7rm")

		// remove
		collection.Schema.RemoveField("0guexgdj")

		return dao.SaveCollection(collection)
	})
}
