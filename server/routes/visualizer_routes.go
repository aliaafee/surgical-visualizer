package routes

import (
	"net/http"

	"github.com/labstack/echo/v5"
	"github.com/pocketbase/pocketbase/core"
)

// RegisterVisualizerRoutes registers visualizer API routes
func RegisterVisualizerRoutes(e *core.ServeEvent) error {
	// GET /api/visualizer/hello - Simple hello endpoint
	e.Router.GET("/api/visualizer/hello", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"message": "Hello from custom route!",
			"status":  "success",
		})
	})

	// GET /api/visualizer/info - Get application info
	e.Router.GET("/api/visualizer/info", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"app":     "Surgical Visualizer",
			"version": "1.0.0",
			"type":    "DICOM 3D Rendering Backend",
		})
	})

	// POST /api/visualizer/echo - Echo back the request body
	e.Router.POST("/api/visualizer/echo", func(c echo.Context) error {
		var data map[string]interface{}
		if err := c.Bind(&data); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{
				"error": "Invalid JSON",
			})
		}

		return c.JSON(http.StatusOK, map[string]interface{}{
			"received": data,
			"message":  "Echo successful",
		})
	})

	// GET /api/visualizer/health - Health check endpoint
	e.Router.GET("/api/visualizer/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"status":  "healthy",
			"service": "surgical-visualizer-server",
		})
	})

	// GET /api/visualizer/dicom/info/:studyId - Example parameterized route
	e.Router.GET("/api/visualizer/dicom/info/:studyId", func(c echo.Context) error {
		studyId := c.PathParam("studyId")
		
		// In a real app, you would fetch from database here
		return c.JSON(http.StatusOK, map[string]interface{}{
			"studyId":     studyId,
			"message":     "This would fetch DICOM study info",
			"placeholder": true,
		})
	})

	return nil
}
