package main

import (
	"log"
	"os"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"

	"surgical-visualizer/hooks"
)

func main() {
	app := pocketbase.New()

	// Register migrate command with automigrate enabled during development
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		// Enable auto-creation of migration files when making collection changes
		Automigrate: true,
	})

	// Register test hooks
	hooks.RegisterTestHooks(app)

	// Serve static files from pb_public directory
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		// Serves static files from the provided public dir (if exists)
		se.Router.GET("/{path...}", apis.Static(os.DirFS("./pb_public"), false))

		return se.Next()
	})

	// Log startup message
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		log.Println("🏥 Surgical Visualizer Backend Started")
		log.Printf("📍 Admin UI: %s/_/", se.App.Settings().Meta.AppURL)
		log.Printf("📍 API: %s/api/", se.App.Settings().Meta.AppURL)
		return se.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
