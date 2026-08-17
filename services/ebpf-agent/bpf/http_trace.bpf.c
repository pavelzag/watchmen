//go:build ignore

#include "vmlinux.h"
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

#define TASK_COMM_LEN 16
#define DATA_LEN 1024

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

struct {
	__uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
	__uint(max_entries, 1);
	__type(key, __u32);
	__type(value, char[DATA_LEN]);
} scratch SEC(".maps");

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
	if (data[0] == 'O' && data[1] == 'P' && data[2] == 'T' && data[3] == 'I') return 1;
	if (data[0] == 'T' && data[1] == 'R' && data[2] == 'A' && data[3] == 'C' && data[4] == 'E') return 1;
	if (data[0] == 'P' && data[1] == 'A' && data[2] == 'T' && data[3] == 'C' && data[4] == 'H') return 1;
	if (len < 7) return 0;
	if (data[0] == 'C' && data[1] == 'O' && data[2] == 'N' && data[3] == 'N' &&
	    data[4] == 'E' && data[5] == 'C' && data[6] == 'T') return 1;
	return 0;
}

static __always_inline int is_http_resp(const char *data, int len)
{
	if (len < 5) return 0;
	return data[0] == 'H' && data[1] == 'T' && data[2] == 'T' && data[3] == 'P' && data[4] == '/';
}

static __always_inline int submit_http_event(const char *data, int len)
{
	if (!is_http_req(data, len) && !is_http_resp(data, len))
		return 0;

	char comm[TASK_COMM_LEN];
	bpf_get_current_comm(&comm, sizeof(comm));
	if (comm[0] == 'w' && comm[1] == 'a' && comm[2] == 't' && comm[3] == 'c' &&
	    comm[4] == 'h' && comm[5] == 'm' && comm[6] == 'e' && comm[7] == 'n' &&
	    comm[8] == '-' && comm[9] == 'e' && comm[10] == 'b' && comm[11] == 'p' &&
	    comm[12] == 'f' && comm[13] == '-')
		return 0;

	struct event *event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
	if (!event) return 0;

	event->pid = bpf_get_current_pid_tgid() >> 32;
	event->uid = bpf_get_current_uid_gid();
	__builtin_memcpy(event->comm, comm, sizeof(event->comm));
	event->type = is_http_req(data, len) ? EVENT_HTTP_REQ : EVENT_HTTP_RESP;
	__builtin_memcpy(event->data, data, DATA_LEN);
	bpf_ringbuf_submit(event, 0);
	return 0;
}

SEC("raw_tracepoint/sys_enter")
int trace_http_write(struct bpf_raw_tracepoint_args *ctx)
{
	struct pt_regs *regs = (struct pt_regs *)ctx->args[0];
	long id = (long)ctx->args[1];
	__u32 key = 0;
	char *data = bpf_map_lookup_elem(&scratch, &key);
	int read_len = 0;

#if defined(__TARGET_ARCH_x86)
	unsigned long arg1 = BPF_CORE_READ(regs, si);
	unsigned long arg2 = BPF_CORE_READ(regs, dx);
	const long syscall_write = 1;
	const long syscall_sendto = 44;
	const long syscall_writev = 20;
	const long syscall_sendmsg = 46;
#elif defined(__TARGET_ARCH_arm64)
	unsigned long arg1 = BPF_CORE_READ(regs, regs[1]);
	unsigned long arg2 = BPF_CORE_READ(regs, regs[2]);
	const long syscall_write = 64;
	const long syscall_sendto = 206;
	const long syscall_writev = 66;
	const long syscall_sendmsg = 211;
#else
	return 0;
#endif

	if (!data) return 0;

	if (id == syscall_write || id == syscall_sendto) {
		const void *buf = (const void *)arg1;
		unsigned long count = arg2;
		if (count < 3 || count > 65536 || !buf) return 0;
		read_len = count < DATA_LEN ? (int)count : DATA_LEN;
		bpf_probe_read_user(data, read_len, buf);
		return submit_http_event(data, read_len);
	}

	if (id == syscall_writev) {
		unsigned long iov_ptr = arg1;
		int iovcnt = (int)arg2;
		if (!iov_ptr || iovcnt <= 0) return 0;

		unsigned long iov_len;
		bpf_probe_read_user(&iov_len, 8, (const void *)(iov_ptr + 8));
		if (iov_len < 3 || iov_len > 65536) return 0;

		unsigned long base;
		bpf_probe_read_user(&base, 8, (const void *)iov_ptr);
		if (!base) return 0;

		read_len = iov_len < DATA_LEN ? (int)iov_len : DATA_LEN;
		bpf_probe_read_user(data, read_len, (const void *)base);
		return submit_http_event(data, read_len);
	}

	if (id == syscall_sendmsg) {
		unsigned long msg_ptr = arg1;
		if (!msg_ptr) return 0;

		unsigned long iov_ptr;
		bpf_probe_read_user(&iov_ptr, 8, (const void *)(msg_ptr + 16));
		if (!iov_ptr) return 0;

		unsigned long iov_len;
		bpf_probe_read_user(&iov_len, 8, (const void *)(iov_ptr + 8));
		if (iov_len < 3 || iov_len > 65536) return 0;

		unsigned long base;
		bpf_probe_read_user(&base, 8, (const void *)iov_ptr);
		if (!base) return 0;

		read_len = iov_len < DATA_LEN ? (int)iov_len : DATA_LEN;
		bpf_probe_read_user(data, read_len, (const void *)base);
		return submit_http_event(data, read_len);
	}

	return 0;
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
