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

		collection, err := dao.FindCollectionByNameOrId("5zafe0a8mm32sl2")
		if err != nil {
			return err
		}

		// add
		new_imageType := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "igzg9ngo",
			"name": "imageType",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_imageType); err != nil {
			return err
		}
		collection.Schema.AddField(new_imageType)

		// add
		new_acquisitionDate := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "rgzwtr1v",
			"name": "acquisitionDate",
			"type": "date",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": "",
				"max": ""
			}
		}`), new_acquisitionDate); err != nil {
			return err
		}
		collection.Schema.AddField(new_acquisitionDate)

		// add
		new_acquisitionTime := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "kfx2n5wz",
			"name": "acquisitionTime",
			"type": "date",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": "",
				"max": ""
			}
		}`), new_acquisitionTime); err != nil {
			return err
		}
		collection.Schema.AddField(new_acquisitionTime)

		// add
		new_kvp := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "rf9wdytj",
			"name": "kvp",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_kvp); err != nil {
			return err
		}
		collection.Schema.AddField(new_kvp)

		// add
		new_convolutionKernel := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "6kbmqved",
			"name": "convolutionKernel",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_convolutionKernel); err != nil {
			return err
		}
		collection.Schema.AddField(new_convolutionKernel)

		// add
		new_bitsAllocated := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "xzqok4qb",
			"name": "bitsAllocated",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_bitsAllocated); err != nil {
			return err
		}
		collection.Schema.AddField(new_bitsAllocated)

		// add
		new_bitsStored := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "jjn6uaqh",
			"name": "bitsStored",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_bitsStored); err != nil {
			return err
		}
		collection.Schema.AddField(new_bitsStored)

		// add
		new_pixelRepresentation := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "7xlzaqhh",
			"name": "pixelRepresentation",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_pixelRepresentation); err != nil {
			return err
		}
		collection.Schema.AddField(new_pixelRepresentation)

		// add
		new_photometricInterpretation := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "vhq92wno",
			"name": "photometricInterpretation",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_photometricInterpretation); err != nil {
			return err
		}
		collection.Schema.AddField(new_photometricInterpretation)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("5zafe0a8mm32sl2")
		if err != nil {
			return err
		}

		// remove
		collection.Schema.RemoveField("igzg9ngo")

		// remove
		collection.Schema.RemoveField("rgzwtr1v")

		// remove
		collection.Schema.RemoveField("kfx2n5wz")

		// remove
		collection.Schema.RemoveField("rf9wdytj")

		// remove
		collection.Schema.RemoveField("6kbmqved")

		// remove
		collection.Schema.RemoveField("xzqok4qb")

		// remove
		collection.Schema.RemoveField("jjn6uaqh")

		// remove
		collection.Schema.RemoveField("7xlzaqhh")

		// remove
		collection.Schema.RemoveField("vhq92wno")

		return dao.SaveCollection(collection)
	})
}
