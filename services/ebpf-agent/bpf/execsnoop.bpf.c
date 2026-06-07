//go:build ignore

#include "vmlinux.h"
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

#define TASK_COMM_LEN 16
#define FILENAME_LEN 256

struct event {
	__u64 pid;
	__u64 ppid;
	__u32 uid;
	char comm[TASK_COMM_LEN];
	char filename[FILENAME_LEN];
};

struct {
	__uint(type, BPF_MAP_TYPE_RINGBUF);
	__uint(max_entries, 1 << 24);
} events SEC(".maps");

SEC("tracepoint/syscalls/sys_enter_execve")
int handle_exec(struct trace_event_raw_sys_enter *ctx)
{
	struct event *event;
	struct task_struct *task;
	const char *filename = (const char *)ctx->args[0];

	event = bpf_ringbuf_reserve(&events, sizeof(*event), 0);
	if (!event) {
		return 0;
	}

	task = (struct task_struct *)bpf_get_current_task();
	event->pid = bpf_get_current_pid_tgid() >> 32;
	event->uid = bpf_get_current_uid_gid();
	event->ppid = BPF_CORE_READ(task, real_parent, tgid);

	bpf_get_current_comm(&event->comm, sizeof(event->comm));
	bpf_probe_read_user_str(&event->filename, sizeof(event->filename), filename);

	bpf_ringbuf_submit(event, 0);
	return 0;
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
