"use client";

import Link from "next/link";
import { ListTodo } from "lucide-react";
import { useTaskCenter } from "@/components/TaskCenterProvider";

export default function NavbarTasksButton() {
  const { tasks } = useTaskCenter();
  const runningCount = tasks.filter((task) => task.status === "running" || task.status === "queued").length;

  return (
    <Link
      href="/dashboard/settings?tab=tasks"
      className="flex items-center gap-1.5 px-3 py-1 text-xs uppercase tracking-widest"
      style={{
        border: "1px solid var(--border-dim)",
        color: runningCount > 0 ? "var(--green)" : "var(--text-muted)",
        background: runningCount > 0 ? "rgba(0,170,43,0.06)" : "transparent",
      }}
    >
      <ListTodo className="w-3 h-3" />
      {runningCount > 0 ? `[TASKS:${runningCount}]` : "[TASKS]"}
    </Link>
  );
}
