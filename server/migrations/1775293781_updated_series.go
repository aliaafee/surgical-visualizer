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

		collection, err := dao.FindCollectionByNameOrId("80gcrj7if95edbl")
		if err != nil {
			return err
		}

		// add
		new_seriesNumber := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "eby0v3ag",
			"name": "seriesNumber",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_seriesNumber); err != nil {
			return err
		}
		collection.Schema.AddField(new_seriesNumber)

		// add
		new_seriesDescription := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "6sezbbxz",
			"name": "seriesDescription",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_seriesDescription); err != nil {
			return err
		}
		collection.Schema.AddField(new_seriesDescription)

		// add
		new_modality := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "dnsnzsvy",
			"name": "modality",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_modality); err != nil {
			return err
		}
		collection.Schema.AddField(new_modality)

		// add
		new_bodyPartExamined := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "w6zmsuis",
			"name": "bodyPartExamined",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_bodyPartExamined); err != nil {
			return err
		}
		collection.Schema.AddField(new_bodyPartExamined)

		// add
		new_protocolName := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "sb6wuitg",
			"name": "protocolName",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_protocolName); err != nil {
			return err
		}
		collection.Schema.AddField(new_protocolName)

		// add
		new_seriesDate := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "9xai2tnd",
			"name": "seriesDate",
			"type": "date",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": "",
				"max": ""
			}
		}`), new_seriesDate); err != nil {
			return err
		}
		collection.Schema.AddField(new_seriesDate)

		// add
		new_seriesTime := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "3qbtlmzi",
			"name": "seriesTime",
			"type": "date",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": "",
				"max": ""
			}
		}`), new_seriesTime); err != nil {
			return err
		}
		collection.Schema.AddField(new_seriesTime)

		// add
		new_rows := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "fm2p8lak",
			"name": "rows",
			"type": "number",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"noDecimal": false
			}
		}`), new_rows); err != nil {
			return err
		}
		collection.Schema.AddField(new_rows)

		// add
		new_columns := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "tyncidhv",
			"name": "columns",
			"type": "number",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"noDecimal": false
			}
		}`), new_columns); err != nil {
			return err
		}
		collection.Schema.AddField(new_columns)

		// add
		new_sliceThickness := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "cliuy3sy",
			"name": "sliceThickness",
			"type": "number",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"noDecimal": false
			}
		}`), new_sliceThickness); err != nil {
			return err
		}
		collection.Schema.AddField(new_sliceThickness)

		// add
		new_frameOfReference := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "vvewsrfo",
			"name": "frameOfReference",
			"type": "text",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"pattern": ""
			}
		}`), new_frameOfReference); err != nil {
			return err
		}
		collection.Schema.AddField(new_frameOfReference)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("80gcrj7if95edbl")
		if err != nil {
			return err
		}

		// remove
		collection.Schema.RemoveField("eby0v3ag")

		// remove
		collection.Schema.RemoveField("6sezbbxz")

		// remove
		collection.Schema.RemoveField("dnsnzsvy")

		// remove
		collection.Schema.RemoveField("w6zmsuis")

		// remove
		collection.Schema.RemoveField("sb6wuitg")

		// remove
		collection.Schema.RemoveField("9xai2tnd")

		// remove
		collection.Schema.RemoveField("3qbtlmzi")

		// remove
		collection.Schema.RemoveField("fm2p8lak")

		// remove
		collection.Schema.RemoveField("tyncidhv")

		// remove
		collection.Schema.RemoveField("cliuy3sy")

		// remove
		collection.Schema.RemoveField("vvewsrfo")

		return dao.SaveCollection(collection)
	})
}
