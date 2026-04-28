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
		new_instanceNumber := &schema.SchemaField{}
		if err := json.Unmarshal([]byte(`{
			"system": false,
			"id": "jlgycysp",
			"name": "instanceNumber",
			"type": "number",
			"required": false,
			"presentable": false,
			"unique": false,
			"options": {
				"min": null,
				"max": null,
				"noDecimal": false
			}
		}`), new_instanceNumber); err != nil {
			return err
		}
		collection.Schema.AddField(new_instanceNumber)

		return dao.SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("5zafe0a8mm32sl2")
		if err != nil {
			return err
		}

		// remove
		collection.Schema.RemoveField("jlgycysp")

		return dao.SaveCollection(collection)
	})
}
