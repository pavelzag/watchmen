package enrich

import "strings"

var sensitiveQueryKeys = map[string]bool{
	"token":         true,
	"sig":           true,
	"signature":     true,
	"key":           true,
	"api_key":       true,
	"apikey":        true,
	"jwt":           true,
	"code":          true,
	"secret":        true,
	"password":      true,
	"passwd":        true,
	"auth":          true,
	"access_token":  true,
	"refresh_token": true,
	"id_token":      true,
}

var sensitiveHeaderNames = []string{
	"authorization",
	"proxy-authorization",
	"cookie",
	"set-cookie",
	"x-api-key",
	"x-watchmen-agent-secret",
	"x-auth-token",
}

func TruncateIPv4(ip string) string {
	if ip == "" {
		return ""
	}
	parts := strings.Split(ip, ".")
	if len(parts) != 4 {
		return ip
	}
	return parts[0] + "." + parts[1] + "." + parts[2] + ".0"
}

func RedactPathQuerySecrets(rawPath string) string {
	qIdx := strings.IndexByte(rawPath, '?')
	if qIdx == -1 {
		return rawPath
	}
	base := rawPath[:qIdx]
	query := rawPath[qIdx+1:]
	pairs := strings.Split(query, "&")
	for i, pair := range pairs {
		eqIdx := strings.IndexByte(pair, '=')
		if eqIdx <= 0 {
			continue
		}
		key := strings.ToLower(pair[:eqIdx])
		if sensitiveQueryKeys[key] {
			pairs[i] = pair[:eqIdx] + "=REDACTED"
		}
	}
	return base + "?" + strings.Join(pairs, "&")
}

func RedactHTTPPayload(raw string) string {
	if raw == "" {
		return ""
	}
	lines := strings.Split(raw, "\n")
	for i, line := range lines {
		trimmed := strings.TrimRight(line, "\r")
		if i == 0 {
			parts := strings.SplitN(trimmed, " ", 3)
			if len(parts) >= 2 && strings.Contains(parts[1], "?") {
				parts[1] = RedactPathQuerySecrets(parts[1])
				lines[i] = strings.Join(parts, " ")
				continue
			}
		}
		colonIdx := strings.IndexByte(trimmed, ':')
		if colonIdx > 0 {
			name := strings.ToLower(strings.TrimSpace(trimmed[:colonIdx]))
			for _, sensitive := range sensitiveHeaderNames {
				if name == sensitive {
					lines[i] = trimmed[:colonIdx] + ": REDACTED"
					break
				}
			}
		}
	}
	return strings.Join(lines, "\n")
}
