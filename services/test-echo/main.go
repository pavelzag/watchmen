package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// responseRecorder wraps ResponseWriter to capture the status code.
type responseRecorder struct {
	http.ResponseWriter
	status int
}

func (rr *responseRecorder) WriteHeader(code int) {
	rr.status = code
	rr.ResponseWriter.WriteHeader(code)
}

// logMiddleware logs every non-health request: caller IP, method, path, body, status, duration.
func logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}

		start := time.Now()

		// Capture request body for mutating methods (restore it for the actual handler).
		var bodySnip string
		if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch {
			raw, _ := io.ReadAll(io.LimitReader(r.Body, 512))
			bodySnip = strings.TrimSpace(string(raw))
			r.Body = io.NopCloser(bytes.NewReader(raw))
		}

		// Resolve caller IP (respect X-Forwarded-For from load balancer).
		ip := r.RemoteAddr
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			ip = strings.TrimSpace(strings.Split(xff, ",")[0])
		}

		rr := &responseRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rr, r)

		ms := time.Since(start).Milliseconds()
		if bodySnip != "" {
			log.Printf("[req] %s  %s %s  →  %d  (%dms)  body=%s", ip, r.Method, r.URL.Path, rr.status, ms, bodySnip)
		} else {
			log.Printf("[req] %s  %s %s  →  %d  (%dms)", ip, r.Method, r.URL.Path, rr.status, ms)
		}
	})
}

var db *sql.DB

type Item struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Value     string    `json:"value"`
	CreatedAt time.Time `json:"created_at"`
}

func connectDB() {
	dsn := os.Getenv("DB_DSN")
	if dsn == "" {
		log.Println("[db] DB_DSN not set — running without database")
		return
	}

	var err error
	for i := range 5 {
		db, err = sql.Open("mysql", dsn)
		if err == nil {
			err = db.Ping()
		}
		if err == nil {
			log.Println("[db] connected")
			break
		}
		log.Printf("[db] attempt %d failed: %v", i+1, err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Printf("[db] could not connect: %v", err)
		db = nil
		return
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS items (
		id         BIGINT AUTO_INCREMENT PRIMARY KEY,
		name       VARCHAR(255) NOT NULL,
		value      TEXT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		log.Printf("[db] migrate error: %v", err)
	}
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
	hostname, _ := os.Hostname()
	dbStatus := "connected"
	if db == nil {
		dbStatus = "not configured"
	}
	json.NewEncoder(w).Encode(map[string]any{
		"service":   "wm-echo",
		"version":   "1.0.0",
		"hostname":  hostname,
		"db_status": dbStatus,
	})
}

func handleGetItems(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": "database not configured"})
		return
	}

	rows, err := db.QueryContext(r.Context(), `SELECT id, name, value, created_at FROM items ORDER BY id DESC LIMIT 20`)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	items := []Item{}
	for rows.Next() {
		var it Item
		if err := rows.Scan(&it.ID, &it.Name, &it.Value, &it.CreatedAt); err == nil {
			items = append(items, it)
		}
	}
	json.NewEncoder(w).Encode(map[string]any{"items": items, "count": len(items)})
}

func handlePostItem(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": "database not configured"})
		return
	}

	var body struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "body must be JSON with 'name' field"})
		return
	}

	res, err := db.ExecContext(r.Context(), `INSERT INTO items (name, value) VALUES (?, ?)`, body.Name, body.Value)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	id, _ := res.LastInsertId()

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{"id": id, "name": body.Name, "value": body.Value, "created": true})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "ok")
}

type Route struct {
	Method      string `json:"method"`
	Path        string `json:"path"`
	Description string `json:"description"`
	Body        any    `json:"body,omitempty"`
}

func handleRoutes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(map[string]any{
		"service": "wm-echo",
		"version": "1.0.0",
		"routes": []Route{
			{Method: "GET", Path: "/", Description: "Service info, hostname and DB status"},
			{Method: "GET", Path: "/items", Description: "Fetch last 20 items from database"},
			{Method: "POST", Path: "/items", Description: "Insert a new item", Body: map[string]string{"name": "string (required)", "value": "string"}},
			{Method: "GET", Path: "/health", Description: "Liveness probe — returns 200 ok"},
			{Method: "GET", Path: "/routes", Description: "This route list"},
		},
	})
}

func main() {
	connectDB()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /", handleRoot)
	mux.HandleFunc("GET /items", handleGetItems)
	mux.HandleFunc("POST /items", handlePostItem)
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("GET /routes", handleRoutes)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("[server] listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, logMiddleware(mux)))
}
