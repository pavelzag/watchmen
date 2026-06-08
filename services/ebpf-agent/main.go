package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
	"github.com/cilium/ebpf/rlimit"
)

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -cflags "-O2 -g -Wall -Werror" http_trace bpf/http_trace.bpf.c -- -I./bpf

const (
	eventTypeHTTPReq  = "http_request"
	eventTypeHTTPResp = "http_response"
	eventDataLen      = 256
)

var version = "dev"

type bpfEvent struct {
	PID  uint64
	UID  uint32
	Type uint32
	Comm [16]byte
	Data [eventDataLen]byte
}

type httpEvent struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	Hostname  string `json:"hostname"`
	PID       uint64 `json:"pid"`
	UID       uint32 `json:"uid"`
	Comm      string `json:"comm"`
	Method    string `json:"method,omitempty"`
	Path      string `json:"path,omitempty"`
	Status    string `json:"status,omitempty"`
	Data      string `json:"data"`
}

type sender struct {
	client      *http.Client
	url         string
	agentID     string
	agentSecret string
}

func main() {
	var endpoint string
	var verbose bool

	flag.StringVar(&endpoint, "endpoint", getenv("WATCHMEN_ENDPOINT", ""), "optional HTTP endpoint that receives JSON events")
	flag.BoolVar(&verbose, "verbose", getenv("WATCHMEN_VERBOSE", "") == "1", "log event forwarding errors")
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, endpoint, verbose); err != nil {
		log.Fatalf("agent stopped: %v", err)
	}
}

func run(ctx context.Context, endpoint string, verbose bool) error {
	if err := rlimit.RemoveMemlock(); err != nil {
		return fmt.Errorf("remove memlock limit: %w", err)
	}

	var objs http_traceObjects
	if err := loadHttp_traceObjects(&objs, nil); err != nil {
		return fmt.Errorf("load eBPF objects: %w", err)
	}
	defer objs.Close()

	tpWrite, err := link.Tracepoint("syscalls", "sys_enter_write", objs.TraceHttpWrite, nil)
	if err != nil {
		return fmt.Errorf("attach sys_enter_write tracepoint: %w", err)
	}
	defer tpWrite.Close()

	tpSendto, err := link.Tracepoint("syscalls", "sys_enter_sendto", objs.TraceHttpSendto, nil)
	if err != nil {
		return fmt.Errorf("attach sys_enter_sendto tracepoint: %w", err)
	}
	defer tpSendto.Close()

	tpSendmsg, err := link.Tracepoint("syscalls", "sys_enter_sendmsg", objs.TraceHttpSendmsg, nil)
	if err != nil {
		return fmt.Errorf("attach sys_enter_sendmsg tracepoint: %w", err)
	}
	defer tpSendmsg.Close()

	tpWritev, err := link.Tracepoint("syscalls", "sys_enter_writev", objs.TraceHttpWritev, nil)
	if err != nil {
		return fmt.Errorf("attach sys_enter_writev tracepoint: %w", err)
	}
	defer tpWritev.Close()

	reader, err := ringbuf.NewReader(objs.Events)
	if err != nil {
		return fmt.Errorf("open ring buffer: %w", err)
	}
	defer reader.Close()

	go func() {
		<-ctx.Done()
		_ = reader.Close()
	}()

	host, err := os.Hostname()
	if err != nil {
		host = "unknown"
	}

	out := sender{
		client:      &http.Client{Timeout: 15 * time.Second},
		url:         endpoint,
		agentID:     getenv("WATCHMEN_AGENT_ID", ""),
		agentSecret: getenv("WATCHMEN_AGENT_SECRET", ""),
	}

	log.Printf("watchmen HTTP trace agent started version=%s host=%s endpoint=%q", version, host, endpoint)

	for {
		record, err := reader.Read()
		if err != nil {
			if errors.Is(err, ringbuf.ErrClosed) || ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("read ring buffer: %w", err)
		}

		event, err := decodeEvent(record.RawSample, host)
		if err != nil {
			if verbose {
				log.Printf("drop malformed event: %v", err)
			}
			continue
		}

		if err := out.send(ctx, event); err != nil && verbose {
			log.Printf("send event: %v", err)
		}
	}
}

func decodeEvent(raw []byte, hostname string) (httpEvent, error) {
	var event bpfEvent
	if len(raw) < int(unsafe.Sizeof(event)) {
		return httpEvent{}, fmt.Errorf("sample too small: got %d bytes", len(raw))
	}

	if err := binary.Read(bytes.NewReader(raw), binary.LittleEndian, &event); err != nil {
		return httpEvent{}, err
	}

	eventType := eventTypeHTTPReq
	if event.Type == 1 {
		eventType = eventTypeHTTPResp
	}

	dataStr := strings.TrimSpace(cString(event.Data[:]))

	h := httpEvent{
		Type:      eventType,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Hostname:  hostname,
		PID:       event.PID,
		UID:       event.UID,
		Comm:      cString(event.Comm[:]),
		Data:      dataStr,
	}

	if event.Type == 0 {
		if parts := strings.SplitN(dataStr, " ", 3); len(parts) >= 2 {
			h.Method = parts[0]
			h.Path = parts[1]
		}
	} else {
		if parts := strings.SplitN(dataStr, " ", 3); len(parts) >= 2 {
			h.Status = parts[1]
		}
	}

	return h, nil
}

func (s sender) send(ctx context.Context, event httpEvent) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	if s.url == "" {
		fmt.Println(string(payload))
		return nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.agentID != "" {
		req.Header.Set("X-Watchmen-Agent-Id", s.agentID)
	}
	if s.agentSecret != "" {
		req.Header.Set("X-Watchmen-Agent-Secret", s.agentSecret)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("unexpected response status: %s", resp.Status)
	}

	return nil
}

func cString(raw []byte) string {
	if idx := bytes.IndexByte(raw, 0); idx >= 0 {
		raw = raw[:idx]
	}
	return string(raw)
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
