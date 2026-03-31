package hooks

import (
	"log"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// init is automatically called when the package is imported
func init() {
	log.Println("📦 Registering test hooks...")
}

// RegisterTestHooks registers example event hooks for testing
func RegisterTestHooks(app *pocketbase.PocketBase) {
	// Hook: OnRecordCreate - triggers before any record is created
	app.OnRecordCreate().BindFunc(func(e *core.RecordEvent) error {
		log.Printf("✨ New record created in collection: %s (ID: %s)", 
			e.Record.Collection().Name, 
			e.Record.Id,
		)
		return e.Next()
	})

	// Hook: OnRecordUpdate - triggers before any record is updated
	app.OnRecordUpdate().BindFunc(func(e *core.RecordEvent) error {
		log.Printf("🔄 Record updated in collection: %s (ID: %s)", 
			e.Record.Collection().Name, 
			e.Record.Id,
		)
		return e.Next()
	})

	// Hook: OnRecordDelete - triggers before any record is deleted
	app.OnRecordDelete().BindFunc(func(e *core.RecordEvent) error {
		log.Printf("🗑️  Record deleted from collection: %s (ID: %s)", 
			e.Record.Collection().Name, 
			e.Record.Id,
		)
		return e.Next()
	})

	// Hook: OnRecordAuthRequest - triggers on authentication requests
	app.OnRecordAuthRequest().BindFunc(func(e *core.RecordAuthEvent) error {
		log.Printf("🔐 Auth request for: %s", e.Record.Email())
		return e.Next()
	})

	// Hook: OnFileDownloadRequest - triggers on file downloads
	app.OnFileDownloadRequest().BindFunc(func(e *core.FileDownloadEvent) error {
		log.Printf("📥 File download: %s from record %s", 
			e.ServedName, 
			e.Record.Id,
		)
		return e.Next()
	})

	// Hook: OnCollectionCreate - triggers when a collection is created
	app.OnCollectionCreate().BindFunc(func(e *core.CollectionEvent) error {
		log.Printf("📚 New collection created: %s", e.Collection.Name)
		return e.Next()
	})

	log.Println("✅ Test hooks registered successfully")
}
