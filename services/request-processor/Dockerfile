# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -o processor .

# Final stage
FROM alpine:latest

WORKDIR /app
COPY --from=builder /app/processor .

EXPOSE 8080

CMD ["./processor"]
