package main

import (
	"strings"
	"testing"
)

func TestSenderSanitizePrivacy(t *testing.T) {
	s := sender{
		redactSecrets: true,
		truncateIPs:   true,
		omitRawData:   false,
	}

	ev := httpEvent{
		Type:     eventTypeHTTPReq,
		Method:   "GET",
		Path:     "/preview?token=secret123&page=home&sig=abc999",
		SourceIP: "203.0.113.42",
		DestIP:   "10.52.0.2",
		Data:     "GET /preview?token=secret123&page=home&sig=abc999 HTTP/1.1\r\nHost: cms.theinsite.dev\r\nAuthorization: Bearer top-secret-jwt\r\nCookie: sid=xyz\r\n",
	}

	got := s.sanitize(ev)

	if got.SourceIP != "203.0.113.0" {
		t.Fatalf("expected truncated SourceIP 203.0.113.0, got %q", got.SourceIP)
	}
	if got.DestIP != "10.52.0.0" {
		t.Fatalf("expected truncated DestIP 10.52.0.0, got %q", got.DestIP)
	}
	if got.Path != "/preview?token=REDACTED&page=home&sig=REDACTED" {
		t.Fatalf("unexpected redacted Path: %q", got.Path)
	}
	if strings.Contains(got.Data, "top-secret-jwt") || strings.Contains(got.Data, "sid=xyz") || strings.Contains(got.Data, "secret123") || strings.Contains(got.Data, "abc999") {
		t.Fatalf("expected secrets redacted from Data, got: %q", got.Data)
	}
	if !strings.Contains(got.Data, "Authorization: REDACTED") || !strings.Contains(got.Data, "Cookie: REDACTED") {
		t.Fatalf("expected redacted header placeholders in Data, got: %q", got.Data)
	}
}

func TestSenderSanitizeOmitRawData(t *testing.T) {
	s := sender{
		redactSecrets: true,
		omitRawData:   true,
	}
	ev := httpEvent{
		Path: "/api/items?key=123",
		Data: "GET /api/items?key=123 HTTP/1.1\r\n",
	}
	got := s.sanitize(ev)
	if got.Data != "" {
		t.Fatalf("expected Data omitted when omitRawData=true, got %q", got.Data)
	}
	if got.Path != "/api/items?key=REDACTED" {
		t.Fatalf("unexpected Path: %q", got.Path)
	}
}
