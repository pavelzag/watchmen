package enrich

import (
	"strings"
	"testing"
)

func TestPrivacyHelpers(t *testing.T) {
	if got := TruncateIPv4("203.0.113.42"); got != "203.0.113.0" {
		t.Fatalf("expected 203.0.113.0, got %q", got)
	}
	if got := RedactPathQuerySecrets("/preview?token=secret123&page=home&sig=abc999"); got != "/preview?token=REDACTED&page=home&sig=REDACTED" {
		t.Fatalf("unexpected redacted path: %q", got)
	}
	raw := "GET /preview?token=secret123&page=home HTTP/1.1\r\nHost: cms.theinsite.dev\r\nAuthorization: Bearer top-secret-jwt\r\nCookie: sid=xyz\r\n"
	got := RedactHTTPPayload(raw)
	if strings.Contains(got, "top-secret-jwt") || strings.Contains(got, "sid=xyz") || strings.Contains(got, "secret123") {
		t.Fatalf("expected secrets redacted, got %q", got)
	}
	if !strings.Contains(got, "Authorization: REDACTED") || !strings.Contains(got, "Cookie: REDACTED") {
		t.Fatalf("expected header redaction placeholders, got %q", got)
	}
}
