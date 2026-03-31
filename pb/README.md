# Surgical Visualizer Backend

PocketBase-based backend for the Surgical Visualizer application.

## Getting Started

### Prerequisites

- Go 1.23 or higher
- Git

### Installation

1. **Initialize Go modules:**

   ```bash
   go mod tidy
   ```

2. **Run the application:**

   ```bash
   go run . serve
   ```

3. **Build the executable:**

   ```bash
   go build
   ```

4. **Run the built executable:**
   ```bash
   ./surgical-visualizer serve
   ```

## Project Structure

```
pb/
├── main.go                 # Application entry point
├── go.mod                  # Go module definition
├── go.sum                  # Go dependencies checksums
├── hooks/                  # Event hooks
│   └── test_hooks.go      # Test hooks (example)
├── migrations/             # Database migrations (Go)
├── pb_data/               # Database & uploaded files (gitignore)
│   ├── data.db           # Main SQLite database
│   ├── auxiliary.db      # Logs and system metadata
│   └── storage/          # Uploaded files
├── pb_migrations/         # Auto-generated migrations (gitignore)
└── pb_public/            # Static files (frontend)
```

## Available Commands

- `go run . serve` - Start the server
- `go run . migrate create "migration_name"` - Create a new migration
- `go run . migrate collections` - Generate collection snapshot
- `go run . migrate up` - Apply pending migrations
- `go run . migrate down [n]` - Revert last n migrations
- `go run . superuser create EMAIL PASSWORD` - Create superuser

## Test Hooks

The `hooks/test_hooks.go` file contains example event hooks that log various database operations:

- ✨ **OnRecordCreate** - Logs when new records are created
- 🔄 **OnRecordUpdate** - Logs when records are updated
- 🗑️ **OnRecordDelete** - Logs when records are deleted
- 🔐 **OnRecordAuthRequest** - Logs authentication attempts
- 📥 **OnFileDownloadRequest** - Logs file downloads
- 📚 **OnCollectionCreate** - Logs new collection creation

These hooks are automatically registered when the application starts.

## Development

### Auto-migration

The application has `Automigrate: true` enabled in development mode. This means:

- Any collection changes made in the Admin UI will automatically generate migration files
- Migration files are created in `pb_migrations/` directory
- These migrations are applied automatically on server start

### Creating Custom Hooks

1. Create a new file in `hooks/` directory
2. Define your hook functions
3. Register them in `main.go` by calling the registration function

Example:

```go
// hooks/dicom_hooks.go
package hooks

import (
    "github.com/pocketbase/pocketbase"
    "github.com/pocketbase/pocketbase/core"
)

func RegisterDICOMHooks(app *pocketbase.PocketBase) {
    app.OnRecordCreate("instances").BindFunc(func(e *core.RecordEvent) error {
        // Process DICOM file upload
        return e.Next()
    })
}
```

Then in `main.go`:

```go
hooks.RegisterDICOMHooks(app)
```

## API Endpoints

Once running, the following endpoints are available:

- **Admin UI:** http://127.0.0.1:8090/_/
- **API:** http://127.0.0.1:8090/api/
- **Collections:** http://127.0.0.1:8090/api/collections
- **Records:** http://127.0.0.1:8090/api/collections/{collection}/records

## Environment Variables

You can configure PocketBase using environment variables or flags:

- `PB_DATA_DIR` - Data directory (default: ./pb_data)
- `PB_MIGRATIONS_DIR` - Migrations directory (default: ./pb_migrations)
- `PB_PUBLIC_DIR` - Public files directory (default: ./pb_public)
- `PB_HOOKS_DIR` - Hooks directory for JavaScript (default: ./pb_hooks)

## Next Steps

1. Create database collections via Admin UI
2. Implement DICOM processing hooks
3. Add custom API routes for specialized operations
4. Connect frontend application
5. Configure authentication and access rules

## Resources

- [PocketBase Documentation](https://pocketbase.io/docs/)
- [Go Event Hooks](https://pocketbase.io/docs/go-event-hooks)
- [Go Migrations](https://pocketbase.io/docs/go-migrations)
- [API Rules](https://pocketbase.io/docs/api-rules-and-filters)
