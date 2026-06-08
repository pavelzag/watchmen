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
	if (data[0] == 'G' && data[1] == 'E' && data[2] == 'T') return 1;
	if (data[0] == 'P' && data[1] == 'U' && data[2] == 'T') return 1;
	if (len < 4) return 0;
	if (data[0] == 'P' && data[1] == 'O' && data[2] == 'S' && data[3] == 'T') return 1;
	if (data[0] == 'D' && data[1] == 'E' && data[2] == 'L') return 1;
	if (data[0] == 'H' && data[1] == 'E' && data[2] == 'A' && data[3] == 'D') return 1;
	if (len < 5) return 0;
	if (data[0] == 'P' && data[1] == 'A' && data[2] == 'C' && data[3] == 'H' && data[4] == 'H') return 1;
	if (data[0] == 'O' && data[1] == 'P' && data[2] == 'T' && data[3] == 'I') return 1;
	return 0;
}

static __always_inline int is_http_resp(const char *data, int len)
{
	if (len < 5) return 0;
	return data[0] == 'H' && data[1] == 'T' && data[2] == 'T' && data[3] == 'P' && data[4] == '/';
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
	__builtin_memcpy(event->data, data, DATA_LEN);
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
	__builtin_memcpy(event->data, data, DATA_LEN);

	bpf_ringbuf_submit(event, 0);
	return 0;
}

SEC("tracepoint/syscalls/sys_enter_sendmsg")
int trace_http_sendmsg(struct trace_event_raw_sys_enter *ctx)
{
	const struct user_msghdr *msg = (const void *)ctx->args[1];
	if (!msg) return 0;

	const struct iovec *iov;
	bpf_probe_read_user(&iov, sizeof(iov), &msg->msg_iov);

	char data[DATA_LEN];
	__u64 iov_len;
	bpf_probe_read_user(&iov_len, sizeof(iov_len), &iov->iov_len);
	if (iov_len < 3 || iov_len > 65536) return 0;

	int read_len = iov_len < DATA_LEN ? (int)iov_len : DATA_LEN;
	const void *base;
	bpf_probe_read_user(&base, sizeof(base), &iov->iov_base);
	bpf_probe_read_user(data, read_len, base);

	if (!is_http_req(data, read_len) && !is_http_resp(data, read_len))
		return 0;

	struct event *event;
	event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
	if (!event) return 0;

	event->pid = bpf_get_current_pid_tgid() >> 32;
	event->uid = bpf_get_current_uid_gid();
	bpf_get_current_comm(&event->comm, sizeof(event->comm));

	event->type = is_http_req(data, read_len) ? EVENT_HTTP_REQ : EVENT_HTTP_RESP;
	__builtin_memcpy(event->data, data, DATA_LEN);

	bpf_ringbuf_submit(event, 0);
	return 0;
}

SEC("kprobe/sys_writev")
int kprobe_sys_writev(struct pt_regs *ctx)
{
#if defined(__TARGET_ARCH_x86)
	unsigned long iov_ptr = ctx->si;
	int iovcnt = (int)ctx->dx;
#else
	unsigned long iov_ptr = PT_REGS_PARM2(ctx);
	int iovcnt = (int)PT_REGS_PARM3(ctx);
#endif
	if (iovcnt <= 0 || iovcnt > 16) return 0;
	if (!iov_ptr) return 0;

	struct event *event;
	event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
	if (!event) return 0;

	event->pid = bpf_get_current_pid_tgid() >> 32;
	event->uid = bpf_get_current_uid_gid();
	bpf_get_current_comm(&event->comm, sizeof(event->comm));
	event->type = iovcnt;

	unsigned long iov_len;
	bpf_probe_read_user(&iov_len, 8, (const void *)(iov_ptr + 8));

	unsigned long base;
	bpf_probe_read_user(&base, 8, (const void *)iov_ptr);

	int data_len = iov_len < DATA_LEN ? (int)iov_len : DATA_LEN;
	if (data_len > 0 && base) {
		bpf_probe_read_user(event->data, data_len, (const void *)base);
	}

	bpf_ringbuf_submit(event, 0);
	return 0;
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
