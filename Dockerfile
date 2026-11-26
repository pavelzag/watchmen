# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:22-alpine AS deps

RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ─── Stage 2: Build the Next.js app ──────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app
# Exact source commit, passed by cloudbuild.yaml (or docker --build-arg).
# Baked into the client bundle so the UI can show which build is running.
ARG GIT_SHA=""
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_SKIP_BUILD_VALIDATION=1
ENV NODE_OPTIONS=--max-old-space-size=1536
ENV NEXT_PUBLIC_GIT_SHA=${GIT_SHA}

# next.config.ts sets output: "standalone" — this produces .next/standalone/server.js
RUN npm run build

# ─── Stage 3: Production runtime (minimal image) ─────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TRIVY_CACHE_DIR=/app/.trivy-cache

ARG TRIVY_VERSION=0.76.2

# Install Trivy for $0 GCP Artifact Registry vulnerability scanning (cached by digest in Postgres)
RUN apk add --no-cache ca-certificates curl \
 && arch="$(uname -m)" \
 && case "$arch" in \
      x86_64) trivy_arch="Linux-64bit" ;; \
      aarch64|arm64) trivy_arch="Linux-ARM64" ;; \
      *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_${trivy_arch}.tar.gz" \
    | tar -xz -C /usr/local/bin trivy \
 && trivy --version \
 && mkdir -p /app/.trivy-cache \
 && (trivy image --download-db-only --cache-dir /app/.trivy-cache || true) \
 && apk del curl

# Create a non-root user to run the app
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs \
 && chown -R nextjs:nodejs /app/.trivy-cache

# Copy only the standalone bundle and static assets
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# Cloud Run and most platforms inject PORT; Next.js standalone reads it automatically
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
