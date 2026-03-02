# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ─── Stage 2: Build the Next.js app ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# next.config.ts sets output: "standalone" — this produces .next/standalone/server.js
RUN npm run build

# ─── Stage 3: Production runtime (minimal image) ─────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user to run the app
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

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
