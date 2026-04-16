import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensureBackgroundTasksTable, sql } from "@/lib/db";
import type { AnyBackgroundTask } from "@/lib/tasks/types";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureBackgroundTasksTable();
    const result = await sql`
      SELECT task_data
      FROM user_background_tasks
      WHERE user_email = ${email} AND dismissed = FALSE
      ORDER BY updated_at DESC
      LIMIT 100
    `;

    return NextResponse.json({
      tasks: result.rows.map((row) => row.task_data as AnyBackgroundTask),
    });
  } catch (error) {
    console.error("[api/tasks] GET error:", error);
    return NextResponse.json({ error: "Failed to load tasks." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as { tasks?: AnyBackgroundTask[]; task?: AnyBackgroundTask };
    const tasks = Array.isArray(body.tasks)
      ? body.tasks
      : body.task
        ? [body.task]
        : [];
    await ensureBackgroundTasksTable();

    for (const task of tasks) {
      await sql`
        INSERT INTO user_background_tasks (user_email, task_id, task_kind, task_status, task_data, dismissed, updated_at, created_at)
        VALUES (
          ${email},
          ${task.id},
          ${task.kind},
          ${task.status},
          ${JSON.stringify(task)},
          FALSE,
          ${task.updatedAt},
          ${task.createdAt}
        )
        ON CONFLICT (user_email, task_id) DO UPDATE
          SET task_kind = EXCLUDED.task_kind,
              task_status = EXCLUDED.task_status,
              task_data = EXCLUDED.task_data,
              dismissed = FALSE,
              updated_at = EXCLUDED.updated_at
      `;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/tasks] POST error:", error);
    return NextResponse.json({ error: "Failed to save tasks." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { ids?: string[]; clearAll?: boolean; clearFinished?: boolean };
    await ensureBackgroundTasksTable();

    if (body.clearAll) {
      await sql`
        UPDATE user_background_tasks
        SET dismissed = TRUE, updated_at = NOW()
        WHERE user_email = ${email}
      `;
      return NextResponse.json({ ok: true });
    }

    if (body.clearFinished) {
      await sql`
        UPDATE user_background_tasks
        SET dismissed = TRUE, updated_at = NOW()
        WHERE user_email = ${email}
          AND task_status IN ('completed', 'failed')
      `;
      return NextResponse.json({ ok: true });
    }

    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "No task ids supplied." }, { status: 400 });
    }

    for (const id of ids) {
      await sql`
        UPDATE user_background_tasks
        SET dismissed = TRUE, updated_at = NOW()
        WHERE user_email = ${email}
          AND task_id = ${id}
      `;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/tasks] DELETE error:", error);
    return NextResponse.json({ error: "Failed to update tasks." }, { status: 500 });
  }
}
