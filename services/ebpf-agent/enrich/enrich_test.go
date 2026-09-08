package enrich

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFormatIPv4(t *testing.T) {
	// 1.2.3.4 stored network-order as 0x04030201 on little endian.
	if got := FormatIPv4(0x04030201); got != "1.2.3.4" {
		t.Fatalf("FormatIPv4 = %q, want 1.2.3.4", got)
	}
	if got := FormatIPv4(0); got != "" {
		t.Fatalf("FormatIPv4(0) = %q, want empty", got)
	}
	// 127.0.0.1
	if got := FormatIPv4(0x0100007f); got != "127.0.0.1" {
		t.Fatalf("FormatIPv4 loopback = %q", got)
	}
}

func TestFamilyName(t *testing.T) {
	if FamilyName(2) != "ipv4" || FamilyName(10) != "ipv6" || FamilyName(0) != "" {
		t.Fatal("unexpected family labels")
	}
}

func TestParseContainerID(t *testing.T) {
	id := "ad8b5c2e1f9a4b6c8d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e"
	cases := map[string]string{
		"11:memory:/docker/" + id:                                 id,
		"0::/kubepods/burstable/pod123/docker-" + id + ".scope":   id,
		"0::/kubepods.slice/kubepods-burstable.slice/containerd-" + id + ".scope": id,
		"0::/init.scope":   "",
		"":                 "",
		"not-a-cgroup":     "",
	}
	for input, want := range cases {
		if got := ParseContainerID(input); got != want {
			t.Fatalf("ParseContainerID(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestReadContainerID(t *testing.T) {
	id := "ad8b5c2e1f9a4b6c8d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e"
	procRoot := t.TempDir()
	pidDir := filepath.Join(procRoot, "4242")
	if err := os.MkdirAll(pidDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pidDir, "cgroup"), []byte("0::/docker/"+id+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := ReadContainerID(procRoot, 4242); got != id {
		t.Fatalf("ReadContainerID = %q, want %q", got, id)
	}
	if got := ReadContainerID(procRoot, 9999); got != "" {
		t.Fatalf("ReadContainerID missing pid = %q, want empty", got)
	}
}

func TestCacheLookupTTL(t *testing.T) {
	c := NewCache()
	c.Remember(100, Flow{SourceIP: "10.0.0.7", DestPort: 80})
	if _, ok := c.Lookup(100); !ok {
		t.Fatal("fresh flow should hit")
	}
	// Force expiry by backdating.
	c.mu.Lock()
	f := c.flows[100]
	f.SeenAt = time.Now().Add(-FlowTTL - time.Second)
	c.flows[100] = f
	c.mu.Unlock()
	if _, ok := c.Lookup(100); ok {
		t.Fatal("expired flow should miss")
	}
	if _, ok := c.Lookup(999); ok {
		t.Fatal("unknown pid should miss")
	}
}

func TestCachePrune(t *testing.T) {
	c := NewCache()
	c.Remember(1, Flow{})
	c.mu.Lock()
	f := c.flows[1]
	f.SeenAt = time.Now().Add(-FlowTTL - time.Second)
	c.flows[1] = f
	c.mu.Unlock()
	c.Prune()
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.flows) != 0 {
		t.Fatal("prune should drop expired entries")
	}
}
