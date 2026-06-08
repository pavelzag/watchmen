//go:build ignore

#include "vmlinux.h"
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

#define AF_INET 2
#define TASK_COMM_LEN 16
#define DATA_LEN 256

#define EVENT_HTTP_REQ  0
#define EVENT_HTTP_RESP 1

struct event {
	__u64 pid;
	__u32 uid;
	__u32 type;
	__u32 src_ip;
	__u32 dst_ip;
	__u16 src_port;
	__u16 dst_port;
	char comm[TASK_COMM_LEN];
	char data[DATA_LEN];
};

struct {
	__uint(type, BPF_MAP_TYPE_RINGBUF);
	__uint(max_entries, 1 << 24);
} events SEC(".maps");

struct {
	__uint(type, BPF_MAP_TYPE_HASH);
	__uint(max_entries, 65536);
	__type(key, __u64);        // tid
	__type(value, __u32[4]);   // dst_ip, dst_port, src_ip, src_port
} conn_map SEC(".maps");

static __always_inline int is_http_request(const char *data, int len) {
	if (len < 4) return 0;
	char c0, c1, c2, c3;
	bpf_probe_read_kernel(&c0, 1, &data[0]);
	bpf_probe_read_kernel(&c1, 1, &data[1]);
	bpf_probe_read_kernel(&c2, 1, &data[2]);
	bpf_probe_read_kernel(&c3, 1, &data[3]);
	if (c0 == 'G' && c1 == 'E' && c2 == 'T') return 1;
	if (c0 == 'P' && c1 == 'O' && c2 == 'S' && c3 == 'T') return 1;
	if (c0 == 'P' && c1 == 'U' && c2 == 'T') return 1;
	if (c0 == 'D' && c1 == 'E' && c2 == 'L') return 1;
	if (c0 == 'P' && c1 == 'A' && c2 == 'T' && c3 == 'C') return 1;
	if (c0 == 'H' && c1 == 'E' && c2 == 'A' && c3 == 'D') return 1;
	if (c0 == 'O' && c1 == 'P' && c2 == 'T' && c3 == 'I') return 1;
	return 0;
}

static __always_inline int is_http_response(const char *data, int len) {
	if (len < 5) return 0;
	char c0, c1, c2, c3, c4;
	bpf_probe_read_kernel(&c0, 1, &data[0]);
	bpf_probe_read_kernel(&c1, 1, &data[1]);
	bpf_probe_read_kernel(&c2, 1, &data[2]);
	bpf_probe_read_kernel(&c3, 1, &data[3]);
	bpf_probe_read_kernel(&c4, 1, &data[4]);
	return (c0 == 'H' && c1 == 'T' && c2 == 'T' && c3 == 'P' && c4 == '/');
}

SEC("kprobe/tcp_sendmsg")
int trace_http_send(struct pt_regs *ctx)
{
	struct sock *sk = (struct sock *)PT_REGS_PARM1(ctx);
	struct msghdr *msg = (struct msghdr *)PT_REGS_PARM2(ctx);

	// Only IPv4
	u16 family;
	bpf_probe_read_kernel(&family, sizeof(family), &sk->__sk_common.skc_family);
	if (family != AF_INET) return 0;

	// Read a small data sample from the message to check for HTTP
	struct iov_iter iter;
	if (bpf_probe_read_kernel(&iter, sizeof(iter), &msg->msg_iter)) return 0;

	// Only trace iovec-based writes (typical userspace sendmsg/writev)
	// On newer kernels iter_type is the first byte of the union
	u8 iter_type;
	bpf_probe_read_kernel(&iter_type, sizeof(iter_type), &iter.iter_type);
	if (iter_type != 1) return 0; // ITER_IOVEC == 1

	// Read the iovec pointer from the union
	// The union field name varies by kernel; try common offsets
	const struct iovec *iov;
	bpf_probe_read_kernel(&iov, sizeof(iov), &iter.__iov);

	struct iovec iov_buf;
	if (bpf_probe_read_kernel(&iov_buf, sizeof(iov_buf), iov)) return 0;
	if (iov_buf.iov_len < 4) return 0;

	char sample[32];
	int read_len = iov_buf.iov_len < 32 ? iov_buf.iov_len : 32;
	bpf_probe_read_user(&sample, read_len, iov_buf.iov_base);

	if (!is_http_request(sample, read_len) && !is_http_response(sample, read_len))
		return 0;

	struct event *event;
	event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
	if (!event) return 0;

	event->pid = bpf_get_current_pid_tgid() >> 32;
	event->uid = bpf_get_current_uid_gid();
	bpf_get_current_comm(&event->comm, sizeof(event->comm));

	event->type = is_http_request(sample, read_len) ? EVENT_HTTP_REQ : EVENT_HTTP_RESP;

	bpf_probe_read_kernel(&event->src_ip, sizeof(event->src_ip), &sk->__sk_common.skc_rcv_saddr);
	bpf_probe_read_kernel(&event->dst_ip, sizeof(event->dst_ip), &sk->__sk_common.skc_daddr);
	bpf_probe_read_kernel(&event->src_port, sizeof(event->src_port), &sk->__sk_common.skc_num);
	bpf_probe_read_kernel(&event->dst_port, sizeof(event->dst_port), &sk->__sk_common.skc_dport);

	// Read HTTP data (request line / status line + headers prefix)
	int data_len = iov_buf.iov_len < DATA_LEN ? iov_buf.iov_len : DATA_LEN;
	bpf_probe_read_user(&event->data, data_len, iov_buf.iov_base);

	bpf_ringbuf_submit(event, 0);
	return 0;
}

SEC("kprobe/tcp_recvmsg")
int trace_http_recv(struct pt_regs *ctx)
{
	struct sock *sk = (struct sock *)PT_REGS_PARM1(ctx);
	struct msghdr *msg = (struct msghdr *)PT_REGS_PARM2(ctx);

	u16 family;
	bpf_probe_read_kernel(&family, sizeof(family), &sk->__sk_common.skc_family);
	if (family != AF_INET) return 0;

	struct iov_iter iter;
	if (bpf_probe_read_kernel(&iter, sizeof(iter), &msg->msg_iter)) return 0;

	u8 iter_type;
	bpf_probe_read_kernel(&iter_type, sizeof(iter_type), &iter.iter_type);
	if (iter_type != 1) return 0;

	const struct iovec *iov;
	bpf_probe_read_kernel(&iov, sizeof(iov), &iter.__iov);

	struct iovec iov_buf;
	if (bpf_probe_read_kernel(&iov_buf, sizeof(iov_buf), iov)) return 0;
	if (iov_buf.iov_len < 5) return 0;

	char sample[32];
	int read_len = iov_buf.iov_len < 32 ? iov_buf.iov_len : 32;
	bpf_probe_read_user(&sample, read_len, iov_buf.iov_base);

	if (!is_http_response(sample, read_len) && !is_http_request(sample, read_len))
		return 0;

	struct event *event;
	event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
	if (!event) return 0;

	event->pid = bpf_get_current_pid_tgid() >> 32;
	event->uid = bpf_get_current_uid_gid();
	bpf_get_current_comm(&event->comm, sizeof(event->comm));

	event->type = is_http_response(sample, read_len) ? EVENT_HTTP_RESP : EVENT_HTTP_REQ;

	bpf_probe_read_kernel(&event->src_ip, sizeof(event->src_ip), &sk->__sk_common.skc_rcv_saddr);
	bpf_probe_read_kernel(&event->dst_ip, sizeof(event->dst_ip), &sk->__sk_common.skc_daddr);
	bpf_probe_read_kernel(&event->src_port, sizeof(event->src_port), &sk->__sk_common.skc_num);
	bpf_probe_read_kernel(&event->dst_port, sizeof(event->dst_port), &sk->__sk_common.skc_dport);

	int data_len = iov_buf.iov_len < DATA_LEN ? iov_buf.iov_len : DATA_LEN;
	bpf_probe_read_user(&event->data, data_len, iov_buf.iov_base);

	bpf_ringbuf_submit(event, 0);
	return 0;
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
