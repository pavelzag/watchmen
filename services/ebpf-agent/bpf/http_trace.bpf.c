//go:build ignore

#include "vmlinux.h"
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

#define TASK_COMM_LEN 16
#define DATA_LEN 1024

#define EVENT_HTTP_REQ  0
#define EVENT_HTTP_RESP 1
#define EVENT_FLOW      2

#define AF_INET 2
/* Per-socket throttle: at most one flow event per socket per second. */
#define FLOW_THROTTLE_NS (1000000000ULL)

struct event {
	__u64 pid;
	__u32 uid;
	__u32 type;
	char comm[TASK_COMM_LEN];
	/* L4 tuple. IPv4 only for now; family records AF_INET/AF_INET6 and
	 * saddr/daddr stay zero for other families (see submit_flow_event). */
	__u32 saddr;
	__u32 daddr;
	__u16 sport;  /* host byte order (matches skc_num) */
	__u16 dport;  /* host byte order (converted from skc_dport) */
	__u16 family;
	__u16 __pad;
	/* Kernel container identity: cgroup id of the process. Userspace maps
	 * this to container/pod; the raw id alone already groups by container. */
	__u64 cgroup_id;
	/* Flow id (FNV-1a of the tuple): lets userspace join HTTP events with
	 * their flow and (later) pair request/response for latency. */
	__u64 sock_cookie;
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

/* L4 tuple -> last emit time. Throttles one busy connection to a single flow
 * event per second so steady traffic cannot flood the ring buffer.
 * bpf_get_socket_cookie would be the natural key, but the verifier forbids
 * it in kprobe programs — the tuple identifies the flow just as well. */
struct flow_key {
	__u32 saddr;
	__u32 daddr;
	__u16 sport;
	__u16 dport;
};

struct {
	__uint(type, BPF_MAP_TYPE_LRU_HASH);
	__uint(max_entries, 1024);
	__type(key, struct flow_key);
	__type(value, __u64);
} last_flow SEC(".maps");

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

static __always_inline int submit_http_event(const char *data, int len, __u32 event_type)
{
	if (event_type == EVENT_HTTP_REQ && !is_http_req(data, len))
		return 0;
	if (event_type == EVENT_HTTP_RESP && !is_http_resp(data, len))
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
	event->type = event_type;
	/* No socket here: sys_enter sees a user buffer and an fd, not the
	 * struct sock, so the tuple stays zero. The tcp_sendmsg/recvmsg
	 * kprobes below supply the tuple; userspace joins on pid. */
	event->saddr = 0;
	event->daddr = 0;
	event->sport = 0;
	event->dport = 0;
	event->family = 0;
	event->cgroup_id = bpf_get_current_cgroup_id();
	event->sock_cookie = 0;
	__builtin_memcpy(event->data, data, DATA_LEN);
	bpf_ringbuf_submit(event, 0);
	return 0;
}

/* FNV-1a over the 12 key bytes. Stable per flow, so userspace reuses it as
 * the sock_cookie join id (never zero: zero means "unknown"). */
static __always_inline __u64 flow_hash(struct flow_key *key)
{
	__u64 h = 14695981039346656037ULL;
	__u8 *p = (__u8 *)key;
#pragma unroll
	for (int i = 0; i < 12; i++) {
		h ^= p[i];
		h *= 1099511628211ULL;
	}
	return h ? h : 1;
}

/* Skip our own forwarding traffic so the agent does not observe itself. */
static __always_inline int is_self_comm(const char *comm)
{
	return comm[0] == 'w' && comm[1] == 'a' && comm[2] == 't' && comm[3] == 'c' &&
	    comm[4] == 'h' && comm[5] == 'm' && comm[6] == 'e' && comm[7] == 'n' &&
	    comm[8] == '-' && comm[9] == 'e' && comm[10] == 'b' && comm[11] == 'p' &&
	    comm[12] == 'f' && comm[13] == '-';
}

static __always_inline int submit_flow_event(struct sock *sk)
{
	char comm[TASK_COMM_LEN];
	struct flow_key key = {};
	__u16 family = 0;
	__u32 saddr = 0, daddr = 0;
	__u16 sport = 0, dport = 0;
	__u64 cookie, *last, now;

	bpf_get_current_comm(&comm, sizeof(comm));
	if (is_self_comm(comm))
		return 0;

	/* CO-RE reads: field offsets are relocated at load time, so this
	 * survives kernel struct changes. Byte order notes:
	 * skc_rcv_saddr/skc_daddr are network order (format bytes as-is),
	 * skc_num is host order, skc_dport is network order. */
	bpf_core_read(&family, sizeof(family), &sk->__sk_common.skc_family);
	if (family == AF_INET) {
		bpf_core_read(&saddr, sizeof(saddr), &sk->__sk_common.skc_rcv_saddr);
		bpf_core_read(&daddr, sizeof(daddr), &sk->__sk_common.skc_daddr);
		bpf_core_read(&sport, sizeof(sport), &sk->__sk_common.skc_num);
		bpf_core_read(&dport, sizeof(dport), &sk->__sk_common.skc_dport);
		dport = __builtin_bswap16(dport);
	}
	/* Non-IPv4: family is still recorded, addresses stay zero. Parsing
	 * struct in6_addr is left as a follow-up exercise. */

	if (family == AF_INET) {
		key.saddr = saddr;
		key.daddr = daddr;
		key.sport = sport;
		key.dport = dport;
	} else {
		/* No stable address to key on: fold the socket pointer in so
		 * distinct sockets don't share one throttle slot. */
		key.saddr = (__u32)(__u64)sk;
		key.daddr = (__u32)(((__u64)sk) >> 32);
	}
	cookie = flow_hash(&key);

	now = bpf_ktime_get_ns();
	last = bpf_map_lookup_elem(&last_flow, &key);
	if (last && now - *last < FLOW_THROTTLE_NS)
		return 0;
	bpf_map_update_elem(&last_flow, &key, &now, BPF_ANY);

	struct event *event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
	if (!event) return 0;

	event->pid = bpf_get_current_pid_tgid() >> 32;
	event->uid = bpf_get_current_uid_gid();
	__builtin_memcpy(event->comm, comm, sizeof(event->comm));
	event->type = EVENT_FLOW;
	event->saddr = saddr;
	event->daddr = daddr;
	event->sport = sport;
	event->dport = dport;
	event->family = family;
	event->cgroup_id = bpf_get_current_cgroup_id();
	event->sock_cookie = cookie;
	__builtin_memset(event->data, 0, DATA_LEN);
	bpf_ringbuf_submit(event, 0);
	return 0;
}

SEC("kprobe/tcp_sendmsg")
int trace_tcp_sendmsg(struct pt_regs *ctx)
{
	struct sock *sk = (struct sock *)PT_REGS_PARM1(ctx);
	if (!sk)
		return 0;
	return submit_flow_event(sk);
}

SEC("kprobe/tcp_recvmsg")
int trace_tcp_recvmsg(struct pt_regs *ctx)
{
	struct sock *sk = (struct sock *)PT_REGS_PARM1(ctx);
	if (!sk)
		return 0;
	return submit_flow_event(sk);
}

/* Fires during connection setup, before the first request bytes are sent.
 * This closes the fresh-connection race: sys_enter sees request bytes at
 * syscall entry (before tcp_sendmsg runs), so without this probe the first
 * request on a new connection never finds a cached tuple. The 4-tuple is
 * already assigned when tcp_connect runs (port selected, peer set). */
SEC("kprobe/tcp_connect")
int trace_tcp_connect(struct pt_regs *ctx)
{
	struct sock *sk = (struct sock *)PT_REGS_PARM1(ctx);
	if (!sk)
		return 0;
	return submit_flow_event(sk);
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
	const long syscall_read = 0;
	const long syscall_write = 1;
	const long syscall_readv = 19;
	const long syscall_sendto = 44;
	const long syscall_recvfrom = 45;
	const long syscall_writev = 20;
	const long syscall_sendmsg = 46;
	const long syscall_recvmsg = 47;
#elif defined(__TARGET_ARCH_arm64)
	unsigned long arg1 = BPF_CORE_READ(regs, regs[1]);
	unsigned long arg2 = BPF_CORE_READ(regs, regs[2]);
	const long syscall_read = 63;
	const long syscall_write = 64;
	const long syscall_readv = 65;
	const long syscall_sendto = 206;
	const long syscall_writev = 66;
	const long syscall_recvfrom = 207;
	const long syscall_sendmsg = 211;
	const long syscall_recvmsg = 212;
#else
	return 0;
#endif

	if (!data) return 0;

	if (id == syscall_read || id == syscall_recvfrom) {
		const void *buf = (const void *)arg1;
		unsigned long count = arg2;
		if (count < 3 || count > 65536 || !buf) return 0;
		read_len = count < DATA_LEN ? (int)count : DATA_LEN;
		bpf_probe_read_user(data, read_len, buf);
		return submit_http_event(data, read_len, EVENT_HTTP_REQ);
	}

	if (id == syscall_write || id == syscall_sendto) {
		const void *buf = (const void *)arg1;
		unsigned long count = arg2;
		if (count < 3 || count > 65536 || !buf) return 0;
		read_len = count < DATA_LEN ? (int)count : DATA_LEN;
		bpf_probe_read_user(data, read_len, buf);
		return submit_http_event(data, read_len, is_http_req(data, read_len) ? EVENT_HTTP_REQ : EVENT_HTTP_RESP);
	}

	if (id == syscall_readv || id == syscall_writev) {
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
		if (id == syscall_readv)
			return submit_http_event(data, read_len, EVENT_HTTP_REQ);
		return submit_http_event(data, read_len, is_http_req(data, read_len) ? EVENT_HTTP_REQ : EVENT_HTTP_RESP);
	}

	if (id == syscall_recvmsg || id == syscall_sendmsg) {
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
		if (id == syscall_recvmsg)
			return submit_http_event(data, read_len, EVENT_HTTP_REQ);
		return submit_http_event(data, read_len, is_http_req(data, read_len) ? EVENT_HTTP_REQ : EVENT_HTTP_RESP);
	}

	return 0;
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
