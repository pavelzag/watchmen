//go:build ignore

#include "vmlinux.h"
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

#define TASK_COMM_LEN 16
#define DATA_LEN 256

#define EVENT_HTTP_REQ  0
#define EVENT_HTTP_RESP 1

struct event {
	__u64 pid;
	__u32 uid;
	__u32 type;
	char comm[TASK_COMM_LEN];
	char data[DATA_LEN];
};

struct {
	__uint(type, BPF_MAP_TYPE_RINGBUF);
	__uint(max_entries, 1 << 24);
} events SEC(".maps");

static __always_inline int is_http_req(const char *data, int len)
{
	if (len < 3) return 0;
	char c0, c1, c2;
	bpf_probe_read_kernel(&c0, 1, &data[0]);
	bpf_probe_read_kernel(&c1, 1, &data[1]);
	bpf_probe_read_kernel(&c2, 1, &data[2]);
	if (c0 == 'G' && c1 == 'E' && c2 == 'T') return 1;
	if (c0 == 'P' && c1 == 'U' && c2 == 'T') return 1;
	if (len < 4) return 0;
	char c3;
	bpf_probe_read_kernel(&c3, 1, &data[3]);
	if (c0 == 'P' && c1 == 'O' && c2 == 'S' && c3 == 'T') return 1;
	if (c0 == 'D' && c1 == 'E' && c2 == 'L') return 1;
	if (c0 == 'H' && c1 == 'E' && c2 == 'A' && c3 == 'D') return 1;
	if (len < 5) return 0;
	char c4;
	bpf_probe_read_kernel(&c4, 1, &data[4]);
	if (c0 == 'P' && c1 == 'A' && c2 == 'T' && c3 == 'C' && c4 == 'H') return 1;
	if (c0 == 'O' && c1 == 'P' && c2 == 'T' && c3 == 'I') return 1;
	return 0;
}

static __always_inline int is_http_resp(const char *data, int len)
{
	if (len < 5) return 0;
	char c0, c1, c2, c3, c4;
	bpf_probe_read_kernel(&c0, 1, &data[0]);
	bpf_probe_read_kernel(&c1, 1, &data[1]);
	bpf_probe_read_kernel(&c2, 1, &data[2]);
	bpf_probe_read_kernel(&c3, 1, &data[3]);
	bpf_probe_read_kernel(&c4, 1, &data[4]);
	return (c0 == 'H' && c1 == 'T' && c2 == 'T' && c3 == 'P' && c4 == '/');
}

SEC("tracepoint/syscalls/sys_enter_write")
int trace_http_write(struct trace_event_raw_sys_enter *ctx)
{
	void *buf = (void *)ctx->args[1];
	size_t count = (size_t)ctx->args[2];

	if (count < 3 || count > 65536) return 0;

	char data[DATA_LEN];
	int read_len = count < DATA_LEN ? count : DATA_LEN;
	bpf_probe_read_user(data, read_len, buf);

	if (!is_http_req(data, read_len) && !is_http_resp(data, read_len))
		return 0;

	struct event *event;
	event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
	if (!event) return 0;

	event->pid = bpf_get_current_pid_tgid() >> 32;
	event->uid = bpf_get_current_uid_gid();
	bpf_get_current_comm(&event->comm, sizeof(event->comm));

	event->type = is_http_req(data, read_len) ? EVENT_HTTP_REQ : EVENT_HTTP_RESP;
	bpf_probe_read_kernel(event->data, DATA_LEN, data);
	bpf_ringbuf_submit(event, 0);
	return 0;
}

SEC("tracepoint/syscalls/sys_enter_sendto")
int trace_http_sendto(struct trace_event_raw_sys_enter *ctx)
{
	void *buf = (void *)ctx->args[1];
	size_t count = (size_t)ctx->args[2];

	if (count < 3 || count > 65536) return 0;

	char data[DATA_LEN];
	int read_len = count < DATA_LEN ? count : DATA_LEN;
	bpf_probe_read_user(data, read_len, buf);

	if (!is_http_req(data, read_len) && !is_http_resp(data, read_len))
		return 0;

	struct event *event;
	event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
	if (!event) return 0;

	event->pid = bpf_get_current_pid_tgid() >> 32;
	event->uid = bpf_get_current_uid_gid();
	bpf_get_current_comm(&event->comm, sizeof(event->comm));

	event->type = is_http_req(data, read_len) ? EVENT_HTTP_REQ : EVENT_HTTP_RESP;
	bpf_probe_read_kernel(event->data, DATA_LEN, data);

	bpf_ringbuf_submit(event, 0);
	return 0;
}

SEC("tracepoint/syscalls/sys_enter_sendmsg")
int trace_http_sendmsg(struct trace_event_raw_sys_enter *ctx)
{
	unsigned long msg_ptr = ctx->args[1];
	if (!msg_ptr) return 0;

	unsigned long iov_ptr;
	bpf_probe_read_user(&iov_ptr, 8, (const void *)(msg_ptr + 16));

	char data[DATA_LEN];
	unsigned long iov_len;
	bpf_probe_read_user(&iov_len, 8, (const void *)(iov_ptr + 8));
	if (iov_len < 3 || iov_len > 65536) return 0;

	int read_len = iov_len < DATA_LEN ? (int)iov_len : DATA_LEN;
	unsigned long base;
	bpf_probe_read_user(&base, 8, (const void *)iov_ptr);
	bpf_probe_read_user(data, read_len, (const void *)base);

	if (!is_http_req(data, read_len) && !is_http_resp(data, read_len))
		return 0;

	struct event *event;
	event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
	if (!event) return 0;

	event->pid = bpf_get_current_pid_tgid() >> 32;
	event->uid = bpf_get_current_uid_gid();
	bpf_get_current_comm(&event->comm, sizeof(event->comm));

	event->type = is_http_req(data, read_len) ? EVENT_HTTP_REQ : EVENT_HTTP_RESP;
	bpf_probe_read_kernel(event->data, DATA_LEN, data);

	bpf_ringbuf_submit(event, 0);
	return 0;
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
