package migrations

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/daos"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/models"
)

func init() {
	m.Register(func(db dbx.Builder) error {
		jsonData := `{
			"id": "5zafe0a8mm32sl2",
			"created": "2026-04-03 05:33:00.367Z",
			"updated": "2026-04-03 05:33:00.367Z",
			"name": "instances",
			"type": "base",
			"system": false,
			"schema": [
				{
					"system": false,
					"id": "2ww2o7jx",
					"name": "series",
					"type": "relation",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {
						"collectionId": "80gcrj7if95edbl",
						"cascadeDelete": false,
						"minSelect": null,
						"maxSelect": 1,
						"displayFields": null
					}
				},
				{
					"system": false,
					"id": "qcmm0pja",
					"name": "sopInstanceUID",
					"type": "text",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {
						"min": null,
						"max": null,
						"pattern": ""
					}
				},
				{
					"system": false,
					"id": "vqefwxmc",
					"name": "dicomFile",
					"type": "file",
					"required": false,
					"presentable": false,
					"unique": false,
					"options": {
						"mimeTypes": [],
						"thumbs": [],
						"maxSelect": 1,
						"maxSize": 5242880,
						"protected": false
					}
				}
			],
			"indexes": [],
			"listRule": null,
			"viewRule": null,
			"createRule": null,
			"updateRule": null,
			"deleteRule": null,
			"options": {}
		}`

		collection := &models.Collection{}
		if err := json.Unmarshal([]byte(jsonData), &collection); err != nil {
			return err
		}

		return daos.New(db).SaveCollection(collection)
	}, func(db dbx.Builder) error {
		dao := daos.New(db);

		collection, err := dao.FindCollectionByNameOrId("5zafe0a8mm32sl2")
		if err != nil {
			return err
		}

		return dao.DeleteCollection(collection)
	})
}
