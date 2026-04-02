package main

import (
	"log"
	"net/http"
	"os"

	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"

	"surgical-visualizer-server/hooks"
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
	app.OnBeforeServe().Add(func(e *core.ServeEvent) error {
		// Serve static files from pb_public directory
		e.Router.GET("/*", echo.StaticDirectoryHandler(os.DirFS("./pb_public"), false))
		return nil
	})

	// Log startup message
	app.OnBeforeServe().Add(func(e *core.ServeEvent) error {
		log.Println("🏥 Surgical Visualizer Backend Started")
		log.Printf("📍 Admin UI: http://127.0.0.1:8090/_/")
		log.Printf("📍 API: http://127.0.0.1:8090/api/")
		return nil
	})

	// Custom route example
	app.OnBeforeServe().Add(func(e *core.ServeEvent) error {
		e.Router.GET("/api/hello", func(c echo.Context) error {
			return c.JSON(http.StatusOK, map[string]string{
				"message": "Hello from Surgical Visualizer!",
			})
		})
		return nil
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
