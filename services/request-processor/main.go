package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

type RequestPayload struct {
	ID        string                 `json:"id"`
	Source    string                 `json:"source"`
	Data      map[string]interface{} `json:"data"`
	Timestamp string                 `json:"timestamp"`
}

type TraceStep struct {
	Component string    `json:"component"`
	Action    string    `json:"action"`
	Time      time.Time `json:"time"`
	Status    string    `json:"status"`
}

type ResponsePayload struct {
	RequestID string                 `json:"request_id"`
	Original  map[string]interface{} `json:"original_data"`
	Processed map[string]interface{} `json:"processed_data"`
	Trace     []TraceStep            `json:"trace"`
	Message   string                 `json:"message"`
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	log.Printf("[%s] Health check from %s", time.Now().Format(time.RFC3339), r.RemoteAddr)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":    "UP",
		"service":   "watchmen-processor",
		"timestamp": time.Now().Format(time.RFC3339),
	})
}

func processHandler(w http.ResponseWriter, r *http.Request) {
	log.Printf("[%s] Incoming request: %s %s", time.Now().Format(time.RFC3339), r.Method, r.URL.Path)

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req RequestPayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Error decoding JSON: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("Processing request %s from source %s", req.ID, req.Source)

	trace := []TraceStep{
		{Component: "API Gateway", Action: "Request Received", Time: time.Now(), Status: "Success"},
		{Component: "Load Balancer", Action: "Forwarding to CloudRun", Time: time.Now().Add(50 * time.Millisecond), Status: "Success"},
	}

	// Transform data
	processed := make(map[string]interface{})
	for k, v := range req.Data {
		processed[k] = v
	}
	processed["_watchmen_processed"] = true
	processed["server_id"] = "watchmen-processor-7f4b"

	trace = append(trace, TraceStep{Component: "CloudRun Service", Action: "Applying Business Logic", Time: time.Now().Add(150 * time.Millisecond), Status: "Success"})

	// Simulate DB write
	trace = append(trace, TraceStep{Component: "Cloud SQL", Action: "Persisting Record", Time: time.Now().Add(250 * time.Millisecond), Status: "Success"})

	resp := ResponsePayload{
		RequestID: req.ID,
		Original:  req.Data,
		Processed: processed,
		Trace:     trace,
		Message:   fmt.Sprintf("Request from %s successfully processed by Watchmen", req.Source),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func main() {
	http.HandleFunc("/process", processHandler)
	http.HandleFunc("/api/health", healthHandler)
	http.HandleFunc("/health", healthHandler)

	port := "8080"
	log.Printf("Starting Watchmen Request Processor on port %s...", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}
