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
	// Hook: OnRecordAfterCreateRequest - triggers after any record is created
	app.OnRecordAfterCreateRequest().Add(func(e *core.RecordCreateEvent) error {
		log.Printf("✨ New record created in collection: %s (ID: %s)", 
			e.Record.Collection().Name, 
			e.Record.Id,
		)
		return nil
	})

	// Hook: OnRecordAfterUpdateRequest - triggers after any record is updated
	app.OnRecordAfterUpdateRequest().Add(func(e *core.RecordUpdateEvent) error {
		log.Printf("🔄 Record updated in collection: %s (ID: %s)", 
			e.Record.Collection().Name, 
			e.Record.Id,
		)
		return nil
	})

	// Hook: OnRecordAfterDeleteRequest - triggers after any record is deleted
	app.OnRecordAfterDeleteRequest().Add(func(e *core.RecordDeleteEvent) error {
		log.Printf("🗑️  Record deleted from collection: %s (ID: %s)", 
			e.Record.Collection().Name, 
			e.Record.Id,
		)
		return nil
	})

	// Hook: OnRecordAuthRequest - triggers on authentication requests
	app.OnRecordAuthRequest().Add(func(e *core.RecordAuthEvent) error {
		log.Printf("🔐 Auth request for: %s", e.Record.Email())
		return nil
	})

	// Hook: OnFileDownloadRequest - triggers on file downloads
	app.OnFileDownloadRequest().Add(func(e *core.FileDownloadEvent) error {
		log.Printf("📥 File download: %s from record %s", 
			e.ServedName, 
			e.Record.Id,
		)
		return nil
	})

	// Hook: OnModelAfterCreate - triggers when a collection is created
	app.OnModelAfterCreate().Add(func(e *core.ModelEvent) error {
		if e.Model.TableName() == "_collections" {
			log.Printf("📚 New collection created")
		}
		return nil
	})

	// Hook: OnBeforeServe - triggers before the app starts serving
	app.OnBeforeServe().Add(func(e *core.ServeEvent) error {
		log.Println("🚀 Server is about to start...")
		return nil
	})

	log.Println("✅ Test hooks registered successfully")
}
