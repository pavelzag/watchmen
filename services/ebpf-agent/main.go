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

	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
	"github.com/cilium/ebpf/rlimit"

	"watchmen/ebpf-agent/enrich"
)

//go:generate ./scripts/generate-bpf.sh

const (
	eventTypeHTTPReq        = "http_request"
	eventTypeHTTPResp       = "http_response"
	eventTypeFlow           = "tcp_flow"
	eventDataLen            = 1024
	// legacyEventSize is the ringbuf sample size produced by bindings
	// predating the tuple/cgroup fields (pid+uid+type+comm+data).
	legacyEventSize = 8 + 4 + 4 + 16 + eventDataLen
	defaultDropPathPrefixes = "/api/agents/events,/api/agents/k8s/register,/v1.,/_ping,/health,/readyz"
	defaultDropCommPrefixes = "watchmen-ebpf,dockerd,containerd,kubelet"
)

var version = "dev"

// bpfEvent mirrors struct event in bpf/http_trace.bpf.c. Field order and
// the explicit Pad match the C layout (cgroup_id needs 8-byte alignment);
// unsafe.Sizeof must equal 64 + eventDataLen.
type bpfEvent struct {
	PID        uint64
	UID        uint32
	Type       uint32
	Comm       [16]byte
	Saddr      uint32
	Daddr      uint32
	Sport      uint16
	Dport      uint16
	Family     uint16
	Pad        uint16
	CgroupID   uint64
	SockCookie uint64
	Data       [eventDataLen]byte
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
	// Socket tuple + container identity (#1 enrichment). SourceIP is the
	// observed local address; DestIP/DestPort identify the peer. Empty when
	// the kernel did not supply them (old bindings, non-IPv4).
	SourceIP    string `json:"sourceIp,omitempty"`
	SourcePort  uint16 `json:"sourcePort,omitempty"`
	DestIP      string `json:"destIp,omitempty"`
	DestPort    uint16 `json:"destPort,omitempty"`
	Family      string `json:"family,omitempty"`
	CgroupID    uint64 `json:"cgroupId,omitempty"`
	SockCookie  uint64 `json:"sockCookie,omitempty"`
	ContainerID string `json:"containerId,omitempty"`
}

type sender struct {
	client           *http.Client
	url              string
	agentID          string
	agentSecret      string
	dropPathPrefixes []string
	dropCommPrefixes []string
	sendResponses    bool
	redactSecrets    bool
	truncateIPs      bool
	omitRawData      bool
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
	if getenv("WATCHMEN_SKIP_MEMLOCK", "") == "1" {
		log.Print("skip memlock limit setup because WATCHMEN_SKIP_MEMLOCK=1")
	} else if err := rlimit.RemoveMemlock(); err != nil {
		if isUnsupportedMemlockDetection(err) {
			log.Printf("continue after unsupported memlock limit setup: %v", err)
		} else {
			return fmt.Errorf("remove memlock limit: %w", err)
		}
	}

	// Load the collection manually (instead of the generated
	// http_traceObjects struct) so the tuple kprobes stay optional: with
	// pre-regeneration bindings the programs are simply absent and the
	// agent runs in degraded HTTP-only mode. Regenerate on the Linux VM
	// with ./scripts/generate-bpf.sh to enable them.
	spec, err := loadHttp_trace()
	if err != nil {
		return fmt.Errorf("load eBPF spec: %w", err)
	}
	coll, err := ebpf.NewCollection(spec)
	if err != nil {
		return fmt.Errorf("load eBPF objects: %w", err)
	}
	defer coll.Close()

	httpProg, ok := coll.Programs["trace_http_write"]
	if !ok {
		return fmt.Errorf("eBPF program trace_http_write not found; regenerate bindings with ./scripts/generate-bpf.sh")
	}
	tpWrite, err := link.AttachRawTracepoint(link.RawTracepointOptions{
		Name:    "sys_enter",
		Program: httpProg,
	})
	if err != nil {
		return fmt.Errorf("attach raw sys_enter tracepoint: %w", err)
	}
	defer tpWrite.Close()

	// Tuple kprobes are best-effort: missing programs mean old bindings,
	// and a failed attach (e.g. restricted kernel) must not kill HTTP tracing.
	for _, probe := range []struct{ prog, symbol string }{
		{"trace_tcp_sendmsg", "tcp_sendmsg"},
		{"trace_tcp_recvmsg", "tcp_recvmsg"},
		{"trace_tcp_connect", "tcp_connect"},
	} {
		prog, ok := coll.Programs[probe.prog]
		if !ok {
			log.Printf("tuple probe %s absent (regenerate bindings on Linux VM to enable); continuing HTTP-only", probe.prog)
			continue
		}
		kp, err := link.Kprobe(probe.symbol, prog, nil)
		if err != nil {
			log.Printf("attach kprobe %s: %v; continuing HTTP-only", probe.symbol, err)
			continue
		}
		defer kp.Close()
		log.Printf("tuple probe attached: kprobe/%s", probe.symbol)
	}

	eventsMap, ok := coll.Maps["events"]
	if !ok {
		return fmt.Errorf("eBPF map events not found")
	}
	reader, err := ringbuf.NewReader(eventsMap)
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
		client:           &http.Client{Timeout: 15 * time.Second},
		url:              endpoint,
		agentID:          getenv("WATCHMEN_AGENT_ID", ""),
		agentSecret:      getenv("WATCHMEN_AGENT_SECRET", ""),
		dropPathPrefixes: splitList(getenv("WATCHMEN_DROP_PATH_PREFIXES", defaultDropPathPrefixes)),
		dropCommPrefixes: splitList(getenv("WATCHMEN_DROP_COMM_PREFIXES", defaultDropCommPrefixes)),
		sendResponses:    getenv("WATCHMEN_SEND_RESPONSES", "") == "1",
		redactSecrets:    getenv("WATCHMEN_REDACT_SECRETS", "1") != "0",
		truncateIPs:      getenv("WATCHMEN_TRUNCATE_IPS", "") == "1",
		omitRawData:      getenv("WATCHMEN_OMIT_RAW_DATA", "") == "1",
	}

	flows := enrich.NewCache()
	procRoot := getenv("WATCHMEN_HOST_PROC", "/proc")
	containers := make(map[uint64]string)

	prune := time.NewTicker(time.Minute)
	defer prune.Stop()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-prune.C:
				flows.Prune()
				containers = make(map[uint64]string)
			}
		}
	}()

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

		// Join the two kernel streams: flow events refresh the per-pid
		// tuple, HTTP events consume it when their own tuple is empty.
		if event.Type == eventTypeFlow {
			flows.Remember(event.PID, flowOf(event))
		} else if event.SourceIP == "" {
			if f, ok := flows.Lookup(event.PID); ok {
				event.SourceIP = f.SourceIP
				event.SourcePort = f.SourcePort
				event.DestIP = f.DestIP
				event.DestPort = f.DestPort
				event.Family = f.Family
				if event.CgroupID == 0 {
					event.CgroupID = f.CgroupID
				}
				if event.SockCookie == 0 {
					event.SockCookie = f.SockCookie
				}
			}
		}
		if event.CgroupID != 0 && event.ContainerID == "" {
			cached, ok := containers[event.PID]
			if !ok {
				cached = enrich.ReadContainerID(procRoot, event.PID)
				containers[event.PID] = cached
			}
			event.ContainerID = cached
		}

		if out.shouldDrop(event) {
			if verbose {
				log.Printf("drop self/noisy event comm=%q method=%q path=%q status=%q", event.Comm, event.Method, event.Path, event.Status)
			}
			continue
		}

		if err := out.send(ctx, event); err != nil && verbose {
			log.Printf("send event: %v", err)
		}
	}
}

func isUnsupportedMemlockDetection(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "function not implemented") ||
		strings.Contains(msg, "operation not supported")
}

func decodeEvent(raw []byte, hostname string) (httpEvent, error) {
	fullSize := int(unsafe.Sizeof(bpfEvent{}))
	if len(raw) < legacyEventSize {
		return httpEvent{}, fmt.Errorf("sample too small: got %d bytes", len(raw))
	}

	// Old bindings emit the legacy layout (data at a different offset),
	// so legacy samples need their own struct: zero-padding the tail
	// would misread HTTP bytes as tuple fields.
	if len(raw) < fullSize {
		var legacy legacyBpfEvent
		if err := binary.Read(bytes.NewReader(raw), binary.LittleEndian, &legacy); err != nil {
			return httpEvent{}, err
		}
		var event bpfEvent
		event.PID = legacy.PID
		event.UID = legacy.UID
		event.Type = legacy.Type
		event.Comm = legacy.Comm
		event.Data = legacy.Data
		return finalizeEvent(event, hostname), nil
	}

	var event bpfEvent
	if err := binary.Read(bytes.NewReader(raw), binary.LittleEndian, &event); err != nil {
		return httpEvent{}, err
	}
	return finalizeEvent(event, hostname), nil
}

// legacyBpfEvent is the ringbuf layout emitted by bindings predating the
// tuple/cgroup fields.
type legacyBpfEvent struct {
	PID  uint64
	UID  uint32
	Type uint32
	Comm [16]byte
	Data [eventDataLen]byte
}

func finalizeEvent(event bpfEvent, hostname string) httpEvent {
	eventType := eventTypeHTTPReq
	switch event.Type {
	case 1:
		eventType = eventTypeHTTPResp
	case 2:
		eventType = eventTypeFlow
	}

	dataStr := strings.TrimSpace(cString(event.Data[:]))

	h := httpEvent{
		Type:       eventType,
		Timestamp:  time.Now().UTC().Format(time.RFC3339Nano),
		Hostname:   hostname,
		PID:        event.PID,
		UID:        event.UID,
		Comm:       cString(event.Comm[:]),
		Data:       dataStr,
		SourceIP:   enrich.FormatIPv4(event.Saddr),
		SourcePort: event.Sport,
		DestIP:     enrich.FormatIPv4(event.Daddr),
		DestPort:   event.Dport,
		Family:     enrich.FamilyName(event.Family),
		CgroupID:   event.CgroupID,
		SockCookie: event.SockCookie,
	}

	switch event.Type {
	case 0:
		if parts := strings.SplitN(dataStr, " ", 3); len(parts) >= 2 {
			h.Method = parts[0]
			h.Path = parts[1]
		}
	case 1:
		if parts := strings.SplitN(dataStr, " ", 3); len(parts) >= 2 {
			h.Status = parts[1]
		}
	}

	return h
}

// flowOf converts a decoded flow event into a cache entry.
func flowOf(event httpEvent) enrich.Flow {
	return enrich.Flow{
		SourceIP:   event.SourceIP,
		SourcePort: event.SourcePort,
		DestIP:     event.DestIP,
		DestPort:   event.DestPort,
		Family:     event.Family,
		CgroupID:   event.CgroupID,
		SockCookie: event.SockCookie,
	}
}

func (s sender) shouldDrop(event httpEvent) bool {
	if event.Type == eventTypeHTTPResp && !s.sendResponses {
		return true
	}
	for _, prefix := range s.dropCommPrefixes {
		if strings.HasPrefix(event.Comm, prefix) {
			return true
		}
	}
	for _, prefix := range s.dropPathPrefixes {
		if strings.HasPrefix(event.Path, prefix) {
			return true
		}
	}
	return false
}

func (s sender) sanitize(event httpEvent) httpEvent {
	if s.truncateIPs {
		event.SourceIP = enrich.TruncateIPv4(event.SourceIP)
		event.DestIP = enrich.TruncateIPv4(event.DestIP)
	}
	if s.redactSecrets {
		event.Path = enrich.RedactPathQuerySecrets(event.Path)
		event.Data = enrich.RedactHTTPPayload(event.Data)
	}
	if s.omitRawData {
		event.Data = ""
	}
	return event
}

func (s sender) send(ctx context.Context, event httpEvent) error {
	event = s.sanitize(event)
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

func splitList(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
