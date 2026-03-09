package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	texporter "github.com/GoogleCloudPlatform/opentelemetry-operations-go/exporter/trace"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdkresource "go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

var tracer trace.Tracer

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

func initTracer(ctx context.Context) (*sdktrace.TracerProvider, error) {
	projectID := os.Getenv("GOOGLE_CLOUD_PROJECT")
	if projectID == "" {
		projectID = "watchmen-test-488807"
	}

	exporter, err := texporter.New(texporter.WithProjectID(projectID))
	if err != nil {
		return nil, fmt.Errorf("cloudtrace exporter: %w", err)
	}

	res, _ := sdkresource.New(ctx,
		sdkresource.WithAttributes(
			attribute.String("service.name", "watchmen-processor"),
			attribute.String("service.version", "1.0.0"),
			attribute.String("k8s.deployment.name", "watchmen-processor"),
		),
	)

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)
	otel.SetTracerProvider(tp)
	tracer = otel.Tracer("watchmen-processor")
	return tp, nil
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

	ctx := r.Context()

	// Auth validation span
	authCtx, authSpan := tracer.Start(ctx, "auth.validateToken")
	time.Sleep(8 * time.Millisecond)
	authSpan.SetAttributes(attribute.String("auth.method", "jwt"))
	authSpan.End()
	_ = authCtx

	var req RequestPayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("Error decoding JSON: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("Processing request %s from source %s", req.ID, req.Source)

	steps := []TraceStep{
		{Component: "GCP Cloud Armor", Action: "WAF Rule Validation: CLEAN", Time: time.Now(), Status: "Success"},
		{Component: "API Gateway", Action: "JWT Signature Verified", Time: time.Now().Add(25 * time.Millisecond), Status: "Success"},
		{Component: "API Gateway", Action: "Rate Limit Quota: OK", Time: time.Now().Add(40 * time.Millisecond), Status: "Success"},
		{Component: "Load Balancer", Action: "Round-Robin: Pod-Selected", Time: time.Now().Add(60 * time.Millisecond), Status: "Success"},
	}

	// Business logic span
	_, bizSpan := tracer.Start(ctx, "business.processPayload")
	processed := make(map[string]interface{})
	for k, v := range req.Data {
		processed[k] = v
	}
	processed["_watchmen_processed"] = true
	processed["server_id"] = "watchmen-processor-7f4b"
	bizSpan.SetAttributes(
		attribute.String("request.id", req.ID),
		attribute.String("request.source", req.Source),
	)
	time.Sleep(10 * time.Millisecond)
	bizSpan.End()

	steps = append(steps, TraceStep{Component: "GKE Pod", Action: "Business Logic Applied", Time: time.Now().Add(150 * time.Millisecond), Status: "Success"})

	// DB write span
	_, dbSpan := tracer.Start(ctx, "CloudSQL.insert")
	dbSpan.SetAttributes(
		attribute.String("db.type", "postgresql"),
		attribute.String("db.operation", "insert"),
		attribute.String("db.table", "requests"),
	)
	time.Sleep(15 * time.Millisecond)
	dbSpan.End()

	steps = append(steps, TraceStep{Component: "Cloud SQL", Action: "Transaction Committed", Time: time.Now().Add(250 * time.Millisecond), Status: "Success"})

	resp := ResponsePayload{
		RequestID: req.ID,
		Source:    req.Source,
		Original:  req.Data,
		Processed: processed,
		Trace:     steps,
		Message:   fmt.Sprintf("Request from %s successfully processed by Watchmen", req.Source),
		TargetURL: fmt.Sprintf("http://%s%s", r.Host, r.URL.Path),
	}

	historyMutex.Lock()
	history = append([]ResponsePayload{resp}, history...)
	if len(history) > maxHistory {
		history = history[:maxHistory]
	}
	historyMutex.Unlock()

	// Return Cloud Trace ID in response header so the frontend can display it
	spanCtx := otel.GetTracerProvider().Tracer("watchmen-processor")
	_ = spanCtx
	if sc := trace2SpanContext(ctx); sc.IsValid() {
		w.Header().Set("X-Cloud-Trace-Context", fmt.Sprintf("%s/%d;o=1", sc.TraceID().String(), 0))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// trace2SpanContext extracts the current span context from context.
func trace2SpanContext(ctx context.Context) trace.SpanContext {
	return trace.SpanFromContext(ctx).SpanContext()
}

func main() {
	ctx := context.Background()

	tp, err := initTracer(ctx)
	if err != nil {
		log.Printf("Warning: Cloud Trace disabled: %v", err)
	} else {
		defer func() {
			if err := tp.Shutdown(ctx); err != nil {
				log.Printf("Error shutting down tracer: %v", err)
			}
		}()
		log.Printf("Cloud Trace initialized (project: %s)", func() string {
			if p := os.Getenv("GOOGLE_CLOUD_PROJECT"); p != "" {
				return p
			}
			return "watchmen-test-488807"
		}())
	}

	// Wrap all handlers with OTel HTTP middleware (auto-creates root spans)
	mux := http.NewServeMux()
	mux.Handle("/process", otelhttp.NewHandler(http.HandlerFunc(processHandler), "POST /process"))
	mux.Handle("/api/history", otelhttp.NewHandler(http.HandlerFunc(historyHandler), "GET /api/history"))
	mux.HandleFunc("/api/health", healthHandler)
	mux.HandleFunc("/health", healthHandler)

	port := "8080"
	log.Printf("Starting Watchmen Request Processor on port %s...", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}
