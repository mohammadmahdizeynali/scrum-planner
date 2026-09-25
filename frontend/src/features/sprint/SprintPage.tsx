import { useEffect, useMemo, useState } from "react";
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
import {
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Columns3,
  Hourglass,
  LayoutList,
  ListPlus,
  PlayCircle,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../../api/client";
import type { CalendarEvent, SprintDetail, Task } from "../../api/types";
import { Modal, PageSpinner, PriorityBadge, AreaChip, ProgressBar, Spinner, Toggle, useToast, EmptyState, ConfirmDialog, cn, DurationInput, TypeBadge, BlockedBadge } from "../../components/ui";
import { faDate, faDueLabel, fmtDuration, fmtEstimateLogged, STATUS_FA } from "../../lib/format";
import { utcToZonedParts } from "../../lib/tz";
import TaskDetailDrawer from "../tasks/TaskDetailDrawer";
import PlanningAssistantModal from "./PlanningAssistantModal";
import type { PlanningSuggestion } from "../../api/types";

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
        <TypeBadge type={task.task_type} />
        <BlockedBadge blocked={task.is_blocked} />
        <PriorityBadge priority={task.priority} />
        {source === "carry_over" && <span className="chip bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">انتقال‌یافته</span>}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span className="tnum">{task.task_type === "todo" ? "بدون ثبت زمان" : fmtEstimateLogged(task.logged_minutes, task.estimate_minutes)}</span>
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
  const [estimates, setEstimates] = useState<Record<string, number | null>>({});

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
            estimate_minutes: estimates[t.id] ?? undefined,
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
            <button
              className="btn-primary"
              disabled={selected.length === 0}
              onClick={() => {
                setEstimates(Object.fromEntries(selected.map((t) => [t.id, t.estimate_minutes])));
                setStep("estimate");
              }}
            >
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
                <DurationInput
                  minutes={estimates[t.id] ?? null}
                  onChangeMinutes={(v) => setEstimates((prev) => ({ ...prev, [t.id]: v }))}
                />
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

// ---------------- structure view (Jira-Structure-inspired hierarchy) ----------------

interface StructureNode {
  key: string;
  label: string;
  color?: string | null;
  children: Map<string, StructureNode>;
  tasks: { source: string; task: Task }[];
}

function blankNode(key: string, label: string, color?: string | null): StructureNode {
  return { key, label, color, children: new Map(), tasks: [] };
}

function StructureBoard({
  members,
  onOpenTask,
  onRemoveTask,
}: {
  members: { source: string; task: Task }[];
  onOpenTask: (t: Task) => void;
  onRemoveTask: (t: Task) => void;
}) {
  const qc = useQueryClient();
  const changeStatus = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) =>
      api(`/v1/tasks/${taskId}`, { method: "PATCH", body: { status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprint"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  // Area → project (or parent project) → subproject → tasks
  const roots = useMemo(() => {
    const areaMap = new Map<string, StructureNode>();
    for (const m of members) {
      const t = m.task;
      const areaKey: string = t.area_id ?? (t.project_id ? "area-via-project" : "standalone");
      const areaLabel: string = t.area_name ?? (t.project_id ? (t.parent_project_name ?? t.project_name ?? "—") : "بدون مسیر");
      const areaColor = t.area_color ?? "#94a3b8";
      if (!areaMap.has(areaKey)) areaMap.set(areaKey, blankNode(areaKey, areaLabel, areaColor));
      const areaNode = areaMap.get(areaKey)!;

      let taskLeaf = areaNode;
      if (t.project_id) {
        const projectName = t.parent_project_id ? (t.parent_project_name ?? "—") : (t.project_name ?? "—");
        const subName = t.parent_project_id ? (t.project_name ?? "—") : null;
        if (!areaNode.children.has(`p:${projectName}:${t.parent_project_id ?? t.project_id}`))
          areaNode.children.set(`p:${projectName}:${t.parent_project_id ?? t.project_id}`, blankNode(`p:${projectName}:${t.parent_project_id ?? t.project_id}`, projectName));
        const projNode = areaNode.children.get(`p:${projectName}:${t.parent_project_id ?? t.project_id}`)!;
        if (subName) {
          if (!projNode.children.has(`s:${subName}:${t.project_id}`))
            projNode.children.set(`s:${subName}:${t.project_id}`, blankNode(`s:${subName}:${t.project_id}`, subName));
          taskLeaf = projNode.children.get(`s:${subName}:${t.project_id}`)!;
        } else {
          taskLeaf = projNode;
        }
      }
      taskLeaf.tasks.push(m);
    }
    return [...areaMap.values()];
  }, [members]);

  const TaskRow = ({ m }: { m: { source: string; task: Task } }) => {
    const t = m.task;
    return (
      <div
        className="flex cursor-pointer flex-wrap items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-sm shadow-sm transition hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800"
        onClick={() => onOpenTask(t)}
      >
        {t.issue_key && <span className="chip tnum bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t.issue_key}</span>}
        <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
        <TypeBadge type={t.task_type} />
        <BlockedBadge blocked={t.is_blocked} />
        {t.due_date && <span className="tnum hidden text-xs text-slate-400 sm:block">{faDueLabel(t.due_date, t.due_time)}</span>}
        {t.task_type === "timed" && (
          <span className="tnum hidden text-xs text-slate-400 sm:block">{fmtEstimateLogged(t.logged_minutes, t.estimate_minutes)}</span>
        )}
        <select
          className="input !w-auto !py-0.5 text-xs"
          value={t.status}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => changeStatus.mutate({ taskId: t.id, status: e.target.value })}
        >
          {Object.entries(STATUS_FA).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button
          className="btn-ghost !p-1 text-slate-400 hover:!text-red-500"
          title="خروج از اسپرینت"
          onClick={(e) => {
            e.stopPropagation();
            onRemoveTask(t);
          }}
        >
          <X size={13} />
        </button>
      </div>
    );
  };

  if (members.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-400">تسکی در این اسپرینت نیست.</div>;
  }

  return (
    <div className="card overflow-hidden p-0">
      {roots.map((area) => (
        <div key={area.key} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
          <div className="flex items-center gap-2 bg-slate-100 px-3 py-2 text-sm font-bold dark:bg-slate-800/70">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: area.color ?? "#94a3b8" }} />
            {area.label}
            <span className="chip bg-white text-slate-500 dark:bg-slate-900 dark:text-slate-400">{area.tasks.length}</span>
          </div>
          {[...area.children.values()].map((proj) => (
            <div key={proj.key} className="border-s-2 border-slate-200 ms-4 ps-2 dark:border-slate-700">
              <div className="flex items-center gap-1.5 px-2 py-1.5 text-[13px] font-semibold text-slate-600 dark:text-slate-300">
                <Columns3 size={13} className="text-slate-400" />
                {proj.label}
              </div>
              {[...proj.children.values()].map((sub) => (
                <div key={sub.key} className="ms-4 border-s border-slate-200 ps-2 dark:border-slate-700">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <LayoutList size={12} className="text-slate-400" />
                    {sub.label}
                  </div>
                  <div className="ms-3 space-y-1 pb-1.5">
                    {sub.tasks.map((m) => (
                      <TaskRow key={m.task.id} m={m} />
                    ))}
                  </div>
                </div>
              ))}
              {proj.tasks.length > 0 && (
                <div className="ms-4 space-y-1 pb-1.5">
                  {proj.tasks.map((m) => (
                    <TaskRow key={m.task.id} m={m} />
                  ))}
                </div>
              )}
            </div>
          ))}
          {area.tasks.length > 0 && (
            <div className="ms-4 space-y-1 px-3 pb-2">
              {area.tasks.map((m) => (
                <TaskRow key={m.task.id} m={m} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------- schedule panel: events + current/next sprint due tasks ----------------

const TZ_FALLBACK = "Asia/Tehran";

function SchedulePanel({ sprint, nextSprint }: { sprint: SprintDetail; nextSprint: SprintDetail | null }) {
  const qc = useQueryClient();
  const toast = useToast();

  const days = useMemo(() => {
    const startP = utcToZonedParts(new Date(sprint.start_at), TZ_FALLBACK);
    const out: { iso: string; y: number; m: number; d: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startP.y, startP.m - 1, startP.d + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.push({ iso, y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
    }
    return out;
  }, [sprint.start_at]);
  const fromIso = days[0]?.iso ?? "";
  const toIso = days[6]?.iso ?? "";

  const { data: events } = useQuery({
    queryKey: ["events", fromIso, toIso],
    queryFn: () => api<CalendarEvent[]>("/v1/events", { params: { from: fromIso, to: toIso } }),
    enabled: !!fromIso,
  });

  const [newTitle, setNewTitle] = useState("");
  const [newDay, setNewDay] = useState(0);
  const [newTime, setNewTime] = useState("");

  const addEvent = useMutation({
    mutationFn: () =>
      api("/v1/events", {
        method: "POST",
        body: { title: newTitle.trim(), event_date: days[newDay].iso, event_time: newTime || null },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      setNewTitle("");
      setNewTime("");
      toast.push("رویداد اضافه شد.");
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const deleteEvent = useMutation({
    mutationFn: (id: string) => api(`/v1/events/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  // Tasks with a due date inside the sprint week, per day.
  const dueTasksByDay = useMemo(() => {
    const map: Record<string, { task: Task; sprintColor: "current" | "next" }[]> = {};
    for (const d of days) map[d.iso] = [];
    const collect = (s: SprintDetail | null, which: "current" | "next") => {
      if (!s) return;
      for (const m of s.members) {
        if (m.task.due_date && m.task.due_date in map) {
          map[m.task.due_date].push({ task: m.task, sprintColor: which });
        }
      }
    };
    collect(sprint, "current");
    collect(nextSprint, "next");
    return map;
  }, [days, sprint, nextSprint]);

  return (
    <div className="card mt-4 p-4">
      <h3 className="flex items-center gap-2 font-bold">
        <CalendarClock size={17} className="text-indigo-500" />
        برنامه هفته — رویدادها و مهلت‌ها
      </h3>
      <div className="mt-2 mb-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <span className="chip bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">مهلت این اسپرینت</span>
        <span className="chip bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">مهلت اسپرینت بعد</span>
        <span className="chip bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">رویداد</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {days.map((d, i) => (
          <div key={d.iso} className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
            <div className="mb-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">{faDate({ y: d.y, m: d.m, d: d.d }, { withWeekday: true })}</div>
            <div className="space-y-1">
              {(events ?? [])
                .filter((e) => e.event_date === d.iso)
                .map((e) => (
                  <div key={e.id} className="group flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-xs dark:bg-amber-500/10">
                    {e.event_time && <span className="tnum shrink-0 font-bold text-amber-700 dark:text-amber-300">{e.event_time.slice(0, 5)}</span>}
                    <span className="min-w-0 flex-1 truncate font-medium text-amber-800 dark:text-amber-200">{e.title}</span>
                    <button
                      className="opacity-0 transition group-hover:opacity-100 hover:text-red-500"
                      onClick={() => deleteEvent.mutate(e.id)}
                      title="حذف رویداد"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              {(dueTasksByDay[d.iso] ?? []).map(({ task, sprintColor }) => (
                <div
                  key={task.id}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs ${
                    sprintColor === "current"
                      ? "bg-indigo-50 dark:bg-indigo-500/10"
                      : "bg-violet-50 dark:bg-violet-500/10"
                  }`}
                >
                  {task.issue_key && <span className="tnum shrink-0 text-slate-400">{task.issue_key}</span>}
                  <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                  {task.due_time && <span className="tnum shrink-0 text-slate-400">{task.due_time.slice(0, 5)}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* quick add event */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <CalendarPlus size={15} className="shrink-0 text-slate-400" />
        <input
          className="input min-w-[10rem] flex-1"
          placeholder="رویداد جدید (مثل جلسه، امتحان…)"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && newTitle.trim() && addEvent.mutate()}
        />
        <select className="input !w-auto" value={newDay} onChange={(e) => setNewDay(Number(e.target.value))}>
          {days.map((d, i) => (
            <option key={d.iso} value={i}>{faDate({ y: d.y, m: d.m, d: d.d }, { withYear: false, withWeekday: true })}</option>
          ))}
        </select>
        <input type="time" className="input tnum !w-28" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
        <button className="btn-primary" disabled={!newTitle.trim() || addEvent.isPending} onClick={() => addEvent.mutate()}>
          افزودن
        </button>
      </div>
      {nextSprint == null && (
        <p className="mt-2 text-[11px] text-slate-400">
          اسپرینت بعدی هنوز ساخته نشده — تسک‌های انتقالی بعد از بستن این هفته آنجا دیده می‌شوند.
        </p>
      )}
    </div>
  );
}

export default function SprintPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: sprint, isLoading } = useQuery({
    queryKey: ["sprint", "current"],
    queryFn: () => api<SprintDetail>("/v1/sprints/current"),
  });
  const { data: nextSprint } = useQuery({
    queryKey: ["sprint", "next"],
    queryFn: () => api<SprintDetail | null>("/v1/sprints/next"),
  });
  const [view, setView] = useState<"kanban" | "structure">(
    () => (localStorage.getItem("sprint-view") === "structure" ? "structure" : "kanban")
  );
  const switchView = (v: "kanban" | "structure") => {
    setView(v);
    localStorage.setItem("sprint-view", v);
  };
  const [addOpen, setAddOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Task | null>(null);
  const draggingRef = { current: false };

  // planning assistant (suggestions only — nothing auto-added)
  const { data: suggestionData } = useQuery({
    queryKey: ["suggestions"],
    queryFn: () => api<{ suggestions: PlanningSuggestion[] }>("/v1/sprints/current/suggestions"),
    enabled: !!sprint && sprint.status === "active",
  });
  const assistantSuggestions = suggestionData?.suggestions ?? [];
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantDismissed, setAssistantDismissed] = useState(false);
  useEffect(() => {
    const key = `planner-assistant-dismissed-${sprint?.id ?? ""}`;
    setAssistantDismissed(localStorage.getItem(key) === "1");
  }, [sprint?.id]);
  const dismissAssistant = () => {
    if (sprint) localStorage.setItem(`planner-assistant-dismissed-${sprint.id}`, "1");
    setAssistantDismissed(true);
  };

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
          <div className="flex flex-wrap gap-2">
            <div className="flex overflow-hidden rounded-xl border border-slate-200 text-xs dark:border-slate-700">
              <button
                className={cn("px-3 py-2 transition", view === "kanban" ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800")}
                onClick={() => switchView("kanban")}
              >
                <Columns3 size={13} className="me-1 inline" />
                کانبان
              </button>
              <button
                className={cn("px-3 py-2 transition", view === "structure" ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800")}
                onClick={() => switchView("structure")}
              >
                <LayoutList size={13} className="me-1 inline" />
                ساختار
              </button>
            </div>
            {closed ? (
              <button className="btn-secondary" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
                بازگشایی اسپرینت
              </button>
            ) : (
              <>
                {!assistantDismissed && assistantSuggestions.length > 0 && (
                  <button className="btn-secondary" onClick={() => setAssistantOpen(true)} title="دستیار برنامه‌ریزی">
                    <Sparkles size={15} className="text-indigo-500" />
                    پیشنهادها ({assistantSuggestions.length})
                  </button>
                )}
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

      {!closed && !assistantDismissed && assistantSuggestions.length > 0 && sprint.members.length === 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3.5 py-2.5 text-sm dark:border-indigo-500/30 dark:bg-indigo-500/10">
          <span>
            <Sparkles size={14} className="me-1 inline text-indigo-500" />
            برای شروع هفته <b>{assistantSuggestions.length} پیشنهاد</b> دارم — هر کدام را نخواستی، تیکش را بردار.
          </span>
          <span className="flex gap-1.5">
            <button className="btn-ghost !py-1 text-xs" onClick={dismissAssistant}>
              بی‌خیال
            </button>
            <button className="btn-primary !py-1 !px-3 text-xs" onClick={() => setAssistantOpen(true)}>
              نمایش پیشنهادها
            </button>
          </span>
        </div>
      )}

      {sprint.members.length === 0 ? (
        <EmptyState
          icon={<ListPlus size={36} />}
          title={closed ? "این اسپرینت بسته شده است" : "اسپرینت این هفته خالی است"}
          hint={
            closed
              ? "برای افزودن تسک یا اصلاح، ابتدا اسپرینت را بازگشایی کنید."
              : "تسک‌ها را از بک‌لاگ (انبار) به این هفته اضافه کنید؛ هنگام افزودن می‌توانید برآوردشان را تنظیم کنید."
          }
          action={
            !closed ? (
              <button className="btn-primary mt-2" onClick={() => setAddOpen(true)}>
                افزودن تسک
              </button>
            ) : undefined
          }
        />
      ) : view === "structure" ? (
        <StructureBoard
          members={sprint.members}
          onOpenTask={(t) => setDetailTaskId(t.id)}
          onRemoveTask={(t) => setRemoveTarget(t)}
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

      <SchedulePanel sprint={sprint} nextSprint={nextSprint ?? null} />

      <AddTasksModal open={addOpen} onClose={() => setAddOpen(false)} sprint={sprint} />
      <PlanningAssistantModal
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        sprint={sprint}
        suggestions={assistantSuggestions}
      />
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
