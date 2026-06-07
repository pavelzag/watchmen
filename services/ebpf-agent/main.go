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

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go -cc clang -cflags "-O2 -g -Wall -Werror" execsnoop bpf/execsnoop.bpf.c -- -I./bpf

const eventTypeExec = "process_exec"

var version = "dev"

type bpfEvent struct {
	PID      uint64
	PPID     uint64
	UID      uint32
	Comm     [16]byte
	Filename [256]byte
}

type telemetryEvent struct {
	Type      string    `json:"type"`
	Timestamp time.Time `json:"timestamp"`
	Hostname  string    `json:"hostname"`
	PID       uint64    `json:"pid"`
	PPID      uint64    `json:"ppid"`
	UID       uint32    `json:"uid"`
	Comm      string    `json:"comm"`
	Filename  string    `json:"filename"`
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

	var objs execsnoopObjects
	if err := loadExecsnoopObjects(&objs, nil); err != nil {
		return fmt.Errorf("load eBPF objects: %w", err)
	}
	defer objs.Close()

	tp, err := link.Tracepoint("syscalls", "sys_enter_execve", objs.HandleExec, nil)
	if err != nil {
		return fmt.Errorf("attach sys_enter_execve tracepoint: %w", err)
	}
	defer tp.Close()

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
		client:      &http.Client{Timeout: 5 * time.Second},
		url:         endpoint,
		agentID:     getenv("WATCHMEN_AGENT_ID", ""),
		agentSecret: getenv("WATCHMEN_AGENT_SECRET", ""),
	}

	log.Printf("watchmen eBPF agent started version=%s host=%s endpoint=%q", version, host, endpoint)

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

func decodeEvent(raw []byte, hostname string) (telemetryEvent, error) {
	var event bpfEvent
	if len(raw) < int(unsafe.Sizeof(event)) {
		return telemetryEvent{}, fmt.Errorf("sample too small: got %d bytes", len(raw))
	}

	if err := binary.Read(bytes.NewReader(raw), binary.LittleEndian, &event); err != nil {
		return telemetryEvent{}, err
	}

	return telemetryEvent{
		Type:      eventTypeExec,
		Timestamp: time.Now().UTC(),
		Hostname:  hostname,
		PID:       event.PID,
		PPID:      event.PPID,
		UID:       event.UID,
		Comm:      cString(event.Comm[:]),
		Filename:  cString(event.Filename[:]),
	}, nil
}

func (s sender) send(ctx context.Context, event telemetryEvent) error {
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
	return strings.TrimSpace(string(raw))
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
