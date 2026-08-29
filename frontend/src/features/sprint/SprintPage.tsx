import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarClock, CheckCircle2, Hourglass, ListPlus, PlayCircle, X } from "lucide-react";
import { api } from "../../api/client";
import type { SprintDetail, Task } from "../../api/types";
import { Modal, PageSpinner, PriorityBadge, AreaChip, ProgressBar, Spinner, Toggle, useToast, EmptyState, ConfirmDialog, cn } from "../../components/ui";
import { fmtDuration, fmtEstimateLogged, hmOf, parseDurationInput, STATUS_FA } from "../../lib/format";
import TaskDetailDrawer from "../tasks/TaskDetailDrawer";

const COLUMNS: { status: Task["status"]; label: string; icon: JSX.Element }[] = [
  { status: "open", label: "باز", icon: <ListPlus size={16} /> },
  { status: "in_progress", label: "در حال انجام", icon: <PlayCircle size={16} /> },
  { status: "closed", label: "انجام شد", icon: <CheckCircle2 size={16} /> },
];

function TaskCard({
  task,
  source,
  onOpen,
  onRemove,
  dragging,
}: {
  task: Task;
  source: string;
  onOpen: () => void;
  onRemove?: () => void;
  dragging: boolean;
}) {
  return (
    <div
      onClick={() => !dragging && onOpen()}
      className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-indigo-500/60"
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="text-sm font-semibold leading-6">{task.title}</div>
        {onRemove && (
          <button
            className="btn-ghost !p-1 text-slate-400 hover:!text-red-500"
            title="خروج از اسپرینت"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <X size={15} />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {task.issue_key && <span className="chip tnum bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{task.issue_key}</span>}
        <AreaChip name={task.project_name ?? task.area_name} color={task.area_color} />
        <PriorityBadge priority={task.priority} />
        {source === "carry_over" && <span className="chip bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">انتقال‌یافته</span>}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="tnum">{fmtEstimateLogged(task.logged_minutes, task.estimate_minutes)}</span>
        {task.subtask_total > 0 && (
          <span className="tnum">
            {task.subtask_done}/{task.subtask_total} زیرتسک
          </span>
        )}
      </div>
    </div>
  );
}

function DraggableTask({ task, source, closed, onOpen, onRemove }: { task: Task; source: string; closed: boolean; onOpen: () => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: closed, data: { from: task.status } });
  return (
    <div ref={setNodeRef} {...(closed ? {} : listeners)} {...(closed ? {} : attributes)} className={isDragging ? "opacity-40" : ""}>
      <TaskCard task={task} source={source} onOpen={onOpen} onRemove={closed ? undefined : onRemove} dragging={isDragging} />
    </div>
  );
}

function Column({
  status,
  label,
  icon,
  members,
  closed,
  onOpenTask,
  onRemoveTask,
}: {
  status: Task["status"];
  label: string;
  icon: JSX.Element;
  members: { source: string; task: Task }[];
  closed: boolean;
  onOpenTask: (t: Task) => void;
  onRemoveTask: (t: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: closed });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[200px] flex-col gap-2 rounded-2xl border p-3 transition ${
        isOver && !closed
          ? "border-indigo-400 bg-indigo-50/60 dark:bg-indigo-500/10"
          : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60"
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300">
        {icon}
        {label}
        <span className="chip bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{members.length}</span>
      </div>
      {members.map(({ source, task }) => (
        <DraggableTask key={task.id} task={task} source={source} closed={closed} onOpen={() => onOpenTask(task)} onRemove={() => onRemoveTask(task)} />
      ))}
      {members.length === 0 && <div className="py-6 text-center text-xs text-slate-400">—</div>}
    </div>
  );
}

function AddTasksModal({ open, onClose, sprint }: { open: boolean; onClose: () => void; sprint: SprintDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Task[]>([]);
  const [step, setStep] = useState<"select" | "estimate">("select");
  const [estimates, setEstimates] = useState<Record<string, string>>({});

  const { data, isFetching } = useQuery({
    queryKey: ["task-picker", q],
    queryFn: () => api<{ items: Task[]; total: number }>("/v1/tasks", { params: { q: q || undefined, limit: 50 } }),
    enabled: open,
  });

  const memberIds = new Set(sprint.members.map((m) => m.task.id));
  const candidates = (data?.items ?? []).filter((t) => !memberIds.has(t.id) && t.status !== "closed");

  const add = useMutation({
    mutationFn: () =>
      api(`/v1/sprints/${sprint.id}/tasks`, {
        method: "POST",
        body: {
          items: selected.map((t) => ({
            task_id: t.id,
            estimate_minutes: estimates[t.id] ? parseDurationInput(estimates[t.id]) : undefined,
          })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprint"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.push("تسک‌ها به اسپرینت اضافه شدند.");
      setSelected([]);
      setEstimates({});
      setStep("select");
      onClose();
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const close = () => {
    setStep("select");
    setSelected([]);
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={step === "select" ? "افزودن تسک به اسپرینت" : "برآورد تسک‌ها"} wide>
      {step === "select" ? (
        <>
          <input className="input mb-3" placeholder="جستجوی تسک…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="mb-4 max-h-80 space-y-1.5 overflow-y-auto">
            {isFetching && <Spinner />}
            {candidates.map((t) => {
              const idx = selected.findIndex((s) => s.id === t.id);
              const checked = idx >= 0;
              return (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-2.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSelected((prev) => (checked ? prev.filter((s) => s.id !== t.id) : [...prev, t]))
                    }
                    className="h-4 w-4 accent-indigo-600"
                  />
                  <span className="flex-1 font-medium">{t.title}</span>
                  {t.issue_key && <span className="chip tnum shrink-0 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t.issue_key}</span>}
                  <AreaChip name={t.project_name ?? t.area_name} color={t.area_color} />
                  {t.estimate_minutes && <span className="tnum text-xs text-slate-400">{fmtDuration(t.estimate_minutes)}</span>}
                </label>
              );
            })}
            {!isFetching && candidates.length === 0 && (
              <div className="py-8 text-center text-sm text-slate-400">تسکی برای افزودن پیدا نشد.</div>
            )}
          </div>
          <div className="flex justify-start gap-2">
            <button className="btn-primary" disabled={selected.length === 0} onClick={() => setStep("estimate")}>
              ادامه ({selected.length})
            </button>
            <button className="btn-secondary" onClick={close}>
              انصراف
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-4 space-y-2">
            {selected.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
                <span className="flex-1 truncate text-sm font-medium">{t.title}</span>
                <input
                  className="input tnum !w-24 text-center"
                  placeholder="2:15"
                  value={estimates[t.id] ?? hmOf(t.estimate_minutes)}
                  onChange={(e) => setEstimates((prev) => ({ ...prev, [t.id]: e.target.value }))}
                  inputMode="numeric"
                />
                <span className="text-xs text-slate-400">ساعت:دقیقه</span>
              </div>
            ))}
          </div>
          <div className="flex justify-start gap-2">
            <button className="btn-primary" disabled={add.isPending} onClick={() => add.mutate()}>
              {add.isPending ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : "افزودن"}
            </button>
            <button className="btn-secondary" onClick={() => setStep("select")}>
              بازگشت
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function CloseSprintModal({ open, onClose, sprint }: { open: boolean; onClose: () => void; sprint: SprintDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const unfinished = sprint.members.filter((m) => m.task.status !== "closed");
  const [decisions, setDecisions] = useState<Record<string, "carry_over" | "backlog" | "close">>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const actionOf = (id: string) => decisions[id] ?? "carry_over";

  const closeSprint = useMutation({
    mutationFn: () =>
      api(`/v1/sprints/${sprint.id}/close`, {
        method: "POST",
        body: {
          decisions: unfinished.map((m) => ({ task_id: m.task.id, action: actionOf(m.task.id) })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.push("اسپرینت بسته شد و گزارش هفتگی ساخته شد.");
      onClose();
      navigate(`/reports?sprint=${sprint.id}`);
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const ACTIONS: { key: "carry_over" | "backlog" | "close"; label: string }[] = [
    { key: "carry_over", label: "انتقال" },
    { key: "backlog", label: "بک‌لاگ" },
    { key: "close", label: "بستن" },
  ];

  return (
    <>
      <Modal open={open} onClose={onClose} title="بستن اسپرینت" wide>
        <div className="mb-4 grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
            <div className="tnum text-lg font-extrabold">{fmtDuration(sprint.logged_minutes)}</div>
            <div className="text-xs text-slate-500">ثبت‌شده</div>
          </div>
          <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
            <div className="tnum text-lg font-extrabold">{sprint.count_closed}</div>
            <div className="text-xs text-slate-500">انجام‌شده</div>
          </div>
          <div className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
            <div className="tnum text-lg font-extrabold">{unfinished.length}</div>
            <div className="text-xs text-slate-500">ناتمام</div>
          </div>
        </div>

        {unfinished.length === 0 ? (
          <div className="mb-4 text-sm text-slate-500">همه تسک‌های این اسپرینت انجام شده‌اند. 🎉</div>
        ) : (
          <div className="mb-4 space-y-2">
            <div className="text-xs text-slate-500">برای هر تسک ناتمام تصمیم بگیرید:</div>
            {unfinished.map(({ task }) => (
              <div key={task.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
                <span className="flex-1 truncate text-sm font-medium">{task.title}</span>
                <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs dark:border-slate-600">
                  {ACTIONS.map((a) => (
                    <button
                      key={a.key}
                      className={cn(
                        "px-2.5 py-1.5 transition",
                        actionOf(task.id) === a.key
                          ? "bg-indigo-600 text-white"
                          : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                      )}
                      onClick={() => setDecisions((prev) => ({ ...prev, [task.id]: a.key }))}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-start gap-2">
          <button className="btn-primary" disabled={closeSprint.isPending} onClick={() => setConfirmOpen(true)}>
            بستن اسپرینت و ساخت گزارش
          </button>
          <button className="btn-secondary" onClick={onClose}>
            انصراف
          </button>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="بستن اسپرینت"
        message="گزارش هفتگی ساخته می‌شود و عضویت‌ها نهایی می‌شوند. مطمئن هستید؟"
        confirmLabel="بستن اسپرینت"
        onConfirm={() => closeSprint.mutate()}
      />
    </>
  );
}

export default function SprintPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: sprint, isLoading } = useQuery({
    queryKey: ["sprint", "current"],
    queryFn: () => api<SprintDetail>("/v1/sprints/current"),
  });
  const [addOpen, setAddOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Task | null>(null);
  const draggingRef = { current: false };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const byStatus = useMemo(() => {
    const map: Record<string, { source: string; task: Task }[]> = { open: [], in_progress: [], closed: [] };
    for (const m of sprint?.members ?? []) {
      (map[m.task.status] ??= []).push({ source: m.source, task: m.task });
    }
    return map;
  }, [sprint]);

  const changeStatus = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) =>
      api(`/v1/tasks/${taskId}`, { method: "PATCH", body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sprint"] }),
    onError: (e) => {
      toast.push((e as Error).message, "error");
      qc.invalidateQueries({ queryKey: ["sprint"] });
    },
  });

  const removeMember = useMutation({
    mutationFn: (task: Task) => api(`/v1/sprints/${sprint!.id}/tasks/${task.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprint"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.push("تسک از اسپرینت خارج شد.");
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const reopen = useMutation({
    mutationFn: () => api(`/v1/sprints/${sprint!.id}/reopen`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprint"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.push("اسپرینت بازگشایی شد؛ اکنون می‌توانید تغییرات را اعمال کنید.");
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const onDragEnd = (e: DragEndEvent) => {
    if (sprint?.status === "closed") return;
    const from = (e.active.data.current as { from?: string } | undefined)?.from;
    const to = e.over?.id as string | undefined;
    if (from && to && from !== to) {
      changeStatus.mutate({ taskId: String(e.active.id), status: to });
    }
  };

  if (isLoading || !sprint) return <PageSpinner />;

  const closed = sprint.status === "closed";
  const progressMax = Math.max(sprint.estimate_minutes, sprint.logged_minutes, 1);

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="card mb-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2">
              <span className="page-title">{sprint.name}</span>
              {closed && <span className="chip bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300">بسته‌شده</span>}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                <CalendarClock size={15} />
                {fmtDuration(sprint.logged_minutes)} ثبت‌شده
                {sprint.billable_minutes > 0 && ` (${fmtDuration(sprint.billable_minutes)} قابل‌فاکتور)`}
              </span>
              <span className="flex items-center gap-1">
                <Hourglass size={15} />
                برآورد {fmtDuration(sprint.estimate_minutes)}
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 size={15} />
                {sprint.count_closed} انجام‌شده
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            {closed ? (
              <button className="btn-secondary" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
                بازگشایی اسپرینت
              </button>
            ) : (
              <>
                <button className="btn-secondary" onClick={() => setCloseOpen(true)}>
                  بستن اسپرینت
                </button>
                <button className="btn-primary" onClick={() => setAddOpen(true)}>
                  افزودن تسک
                </button>
              </>
            )}
          </div>
        </div>
        {closed && (
          <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            این اسپرینت بسته شده است؛ افزودن تسک و تغییر وضعیت‌ها غیرفعال است. اگر اصلاحی لازم دارید، بازگشایی کنید.
          </div>
        )}
        <div className="mt-4">
          <ProgressBar value={sprint.logged_minutes} max={progressMax} />
          <div className="mt-1 flex justify-between text-xs text-slate-400">
            <span>پیشرفت نسبت به برآورد</span>
            <span className="tnum">
              {fmtDuration(sprint.logged_minutes)} / {fmtDuration(Math.max(sprint.estimate_minutes, 0))}
            </span>
          </div>
        </div>
      </div>

      {sprint.members.length === 0 ? (
        <EmptyState
          icon={<ListPlus size={36} />}
          title={closed ? "این اسپرینت بسته شده است" : "اسپرینت این هفته خالی است"}
          hint={
            closed
              ? "برای افزودن تسک یا اصلاح، ابتدا اسپرینت را بازگشایی کنید."
              : "تسک‌ها را از بک‌لاگ (همه تسک‌ها) به این هفته اضافه کنید؛ هنگام افزودن می‌توانید برآوردشان را تنظیم کنید."
          }
          action={
            !closed ? (
              <button className="btn-primary mt-2" onClick={() => setAddOpen(true)}>
                افزودن تسک
              </button>
            ) : undefined
          }
        />
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="grid gap-3 md:grid-cols-3">
            {COLUMNS.map((col) => (
              <Column
                key={col.status}
                status={col.status}
                label={col.label}
                icon={col.icon}
                members={byStatus[col.status] ?? []}
                closed={closed}
                onOpenTask={(t) => !draggingRef.current && setDetailTaskId(t.id)}
                onRemoveTask={(t) => setRemoveTarget(t)}
              />
            ))}
          </div>
        </DndContext>
      )}

      <AddTasksModal open={addOpen} onClose={() => setAddOpen(false)} sprint={sprint} />
      <CloseSprintModal open={closeOpen} onClose={() => setCloseOpen(false)} sprint={sprint} />
      {detailTaskId && <TaskDetailDrawer taskId={detailTaskId} onClose={() => setDetailTaskId(null)} />}
      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title="خروج از اسپرینت"
        message={`«${removeTarget?.title}» از اسپرینت این هفته خارج می‌شود و اگر باز باشد به بک‌لاگ برمی‌گردد.`}
        onConfirm={() => removeTarget && removeMember.mutate(removeTarget)}
      />
    </main>
  );
}

export { STATUS_FA };
