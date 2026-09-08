// Package enrich holds the portable half of socket-tuple enrichment.
//
// Everything here is pure Go with no Linux-only imports, so it is unit
// testable on macOS. The eBPF side (bpf/http_trace.bpf.c) supplies the raw
// numbers; this package turns them into JSON-ready values and joins the two
// kernel event streams back together:
//
//  1. sys_enter sniffing gives HTTP bytes + pid, but no socket, so its
//     tuple fields are zero.
//  2. tcp_sendmsg/recvmsg kprobes give the L4 tuple + pid, but no HTTP bytes.
//
// Cache remembers the latest flow per pid so callers can attach a tuple to
// an HTTP event observed on the same pid shortly after.
package enrich

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// FlowTTL bounds how long a remembered flow may enrich a later HTTP event.
// TCP sendmsg for a request and the userspace read of its bytes happen
// milliseconds apart; 5s tolerates scheduling delay without joining
// unrelated connections that reuse a pid.
const FlowTTL = 5 * time.Second

// Flow is one observed L4 conversation endpoint.
type Flow struct {
	SourceIP   string
	SourcePort uint16
	DestIP     string
	DestPort   uint16
	Family     string
	CgroupID   uint64
	SockCookie uint64
	SeenAt     time.Time
}

// Cache remembers the latest flow per pid. It is safe for concurrent use.
type Cache struct {
	mu    sync.Mutex
	flows map[uint64]Flow
}

// NewCache returns an empty flow cache.
func NewCache() *Cache {
	return &Cache{flows: make(map[uint64]Flow)}
}

// Remember stores the latest flow observed for pid.
func (c *Cache) Remember(pid uint64, f Flow) {
	c.mu.Lock()
	defer c.mu.Unlock()
	f.SeenAt = time.Now()
	c.flows[pid] = f
}

// Lookup returns the remembered flow for pid when it is still fresh.
func (c *Cache) Lookup(pid uint64) (Flow, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	f, ok := c.flows[pid]
	if !ok || time.Since(f.SeenAt) > FlowTTL {
		delete(c.flows, pid)
		return Flow{}, false
	}
	return f, true
}

// Prune drops expired entries. Call it periodically (e.g. once a minute)
// so long-lived pids that go quiet do not pin memory.
func (c *Cache) Prune() {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	for pid, f := range c.flows {
		if now.Sub(f.SeenAt) > FlowTTL {
			delete(c.flows, pid)
		}
	}
}

// FormatIPv4 renders a kernel __u32 IPv4 address (network byte order, as
// stored in skc_rcv_saddr/skc_daddr) as a dotted quad. The bytes are used
// as-is: no endian swap on the sender side.
func FormatIPv4(v uint32) string {
	if v == 0 {
		return ""
	}
	return fmt.Sprintf("%d.%d.%d.%d", byte(v), byte(v>>8), byte(v>>16), byte(v>>24))
}

// FamilyName maps the kernel address family to a short label.
func FamilyName(family uint16) string {
	switch family {
	case 2:
		return "ipv4"
	case 10:
		return "ipv6"
	case 0:
		return ""
	default:
		return fmt.Sprintf("af-%d", family)
	}
}

var containerIDRe = regexp.MustCompile(`[0-9a-f]{64}`)

// ParseContainerID extracts a 64-hex container id from /proc/<pid>/cgroup
// content. It handles cgroup v1 (docker/..docker-<id>.scope), cgroup v2
// (kubepods slices, containerd/docker -<id> segments), and returns "" when
// the process is not containerized or the content is unexpected.
func ParseContainerID(cgroupContent string) string {
	for _, line := range strings.Split(cgroupContent, "\n") {
		// Format: hierarchy:id:path — the path is the last field.
		idx := strings.LastIndex(line, ":")
		if idx < 0 {
			continue
		}
		if id := containerIDRe.FindString(line[idx+1:]); id != "" {
			return id
		}
	}
	return ""
}

// ReadContainerID returns the container id for pid, or "" when unavailable.
// procRoot is /proc on a host and /host/proc inside the DaemonSet (see
// WATCHMEN_HOST_PROC); keeping it a parameter keeps this testable.
func ReadContainerID(procRoot string, pid uint64) string {
	raw, err := os.ReadFile(filepath.Join(procRoot, fmt.Sprintf("%d", pid), "cgroup"))
	if err != nil {
		return ""
	}
	return ParseContainerID(string(raw))
}
