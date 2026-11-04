package routes

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v5"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/models"
)

// RegisterPatientRoutes registers patient routes under /api/visualizer/patients.
// A patient is the parent of the studies uploaded for them.
func RegisterPatientRoutes(app *pocketbase.PocketBase, e *core.ServeEvent) error {
	auth := apis.RequireRecordAuth()

	e.Router.GET("/api/visualizer/patients", handleListPatients(app), auth)
	e.Router.POST("/api/visualizer/patients", handleCreatePatient(app), auth)
	e.Router.GET("/api/visualizer/patients/:patientId", handleGetPatient(app), auth)

	return nil
}

func handleListPatients(app *pocketbase.PocketBase) echo.HandlerFunc {
	return func(c echo.Context) error {
		patients, err := app.Dao().FindRecordsByFilter("patients", "1=1", "name", 0, 0)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch patients"})
		}

		// Study counts for every patient in one query
		var counts []struct {
			Patient string `db:"patient"`
			Count   int    `db:"count"`
		}
		if err := app.Dao().DB().
			Select("patient", "COUNT(*) AS count").
			From("studies").
			GroupBy("patient").
			All(&counts); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to count studies"})
		}
		studyCounts := map[string]int{}
		for _, row := range counts {
			studyCounts[row.Patient] = row.Count
		}

		result := make([]map[string]interface{}, 0, len(patients))
		for _, p := range patients {
			summary := patientSummary(p)
			summary["studyCount"] = studyCounts[p.Id]
			result = append(result, summary)
		}
		return c.JSON(http.StatusOK, result)
	}
}

func handleCreatePatient(app *pocketbase.PocketBase) echo.HandlerFunc {
	return func(c echo.Context) error {
		var body struct {
			Name      string `json:"name"`
			PatientID string `json:"patientID"`
			BirthDate string `json:"birthDate"`
			Sex       string `json:"sex"`
			Notes     string `json:"notes"`
		}
		if err := c.Bind(&body); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		}
		body.Name = strings.TrimSpace(body.Name)
		if body.Name == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "a patient needs a name"})
		}

		collection, err := app.Dao().FindCollectionByNameOrId("patients")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "patients collection not found"})
		}

		record := models.NewRecord(collection)
		record.Set("name", body.Name)
		record.Set("patientID", strings.TrimSpace(body.PatientID))
		record.Set("birthDate", strings.TrimSpace(body.BirthDate))
		record.Set("sex", strings.TrimSpace(body.Sex))
		record.Set("notes", strings.TrimSpace(body.Notes))
		if err := app.Dao().SaveRecord(record); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to save patient"})
		}

		summary := patientSummary(record)
		summary["studyCount"] = 0
		return c.JSON(http.StatusOK, summary)
	}
}

func handleGetPatient(app *pocketbase.PocketBase) echo.HandlerFunc {
	return func(c echo.Context) error {
		patient, err := app.Dao().FindRecordById("patients", c.PathParam("patientId"))
		if err != nil {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "patient not found"})
		}

		studies, err := app.Dao().FindRecordsByFilter(
			"studies", "patient = {:id}", "-studyDate", 0, 0,
			dbx.Params{"id": patient.Id},
		)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to fetch studies"})
		}

		studyResult := make([]map[string]interface{}, 0, len(studies))
		for _, s := range studies {
			studyResult = append(studyResult, studySummary(s))
		}

		result := patientSummary(patient)
		result["studyCount"] = len(studies)
		result["studies"] = studyResult
		return c.JSON(http.StatusOK, result)
	}
}

func patientSummary(p *models.Record) map[string]interface{} {
	return map[string]interface{}{
		"id":        p.Id,
		"name":      p.GetString("name"),
		"patientID": p.GetString("patientID"),
		"birthDate": p.GetString("birthDate"),
		"sex":       p.GetString("sex"),
		"notes":     p.GetString("notes"),
		"created":   p.GetString("created"),
	}
}
