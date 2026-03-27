FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod .
COPY *.go .
RUN go mod tidy && CGO_ENABLED=0 go build -o test-echo .

FROM alpine:latest

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /app/test-echo .

EXPOSE 8080

CMD ["./test-echo"]
