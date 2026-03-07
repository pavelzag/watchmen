package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
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
	Source    string                 `json:"source,omitempty"`
	Original  map[string]interface{} `json:"original_data"`
	Processed map[string]interface{} `json:"processed_data"`
	Trace     []TraceStep            `json:"trace"`
	Message   string                 `json:"message"`
	TargetURL string                 `json:"target_url,omitempty"`
}

var (
	history      []ResponsePayload
	historyMutex sync.Mutex
	maxHistory   = 10
)

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

func historyHandler(w http.ResponseWriter, r *http.Request) {
	historyMutex.Lock()
	defer historyMutex.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
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
		{Component: "GCP Cloud Armor", Action: "WAF Rule Validation: CLEAN", Time: time.Now(), Status: "Success"},
		{Component: "API Gateway", Action: "JWT Signature Verified", Time: time.Now().Add(25 * time.Millisecond), Status: "Success"},
		{Component: "API Gateway", Action: "Rate Limit Quota: OK", Time: time.Now().Add(40 * time.Millisecond), Status: "Success"},
		{Component: "Load Balancer", Action: "Round-Robin: Pod-Selected", Time: time.Now().Add(60 * time.Millisecond), Status: "Success"},
	}

	// Transform data
	processed := make(map[string]interface{})
	for k, v := range req.Data {
		processed[k] = v
	}
	processed["_watchmen_processed"] = true
	processed["server_id"] = "watchmen-processor-7f4b"

	trace = append(trace, TraceStep{Component: "GKE Pod", Action: "Business Logic Applied", Time: time.Now().Add(150 * time.Millisecond), Status: "Success"})

	// Simulate DB write
	trace = append(trace, TraceStep{Component: "Cloud SQL", Action: "Transaction Committed", Time: time.Now().Add(250 * time.Millisecond), Status: "Success"})

	resp := ResponsePayload{
		RequestID: req.ID,
		Source:    req.Source,
		Original:  req.Data,
		Processed: processed,
		Trace:     trace,
		Message:   fmt.Sprintf("Request from %s successfully processed by Watchmen", req.Source),
		TargetURL: fmt.Sprintf("http://%s%s", r.Host, r.URL.Path),
	}

	// Update History
	historyMutex.Lock()
	history = append([]ResponsePayload{resp}, history...)
	if len(history) > maxHistory {
		history = history[:maxHistory]
	}
	historyMutex.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func main() {
	http.HandleFunc("/process", processHandler)
	http.HandleFunc("/api/history", historyHandler)
	http.HandleFunc("/api/health", healthHandler)
	http.HandleFunc("/health", healthHandler)

	port := "8080"
	log.Printf("Starting Watchmen Request Processor on port %s...", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}
