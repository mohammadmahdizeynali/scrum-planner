import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DatePicker, { type DateObject } from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import DateObjectCtor from "react-date-object";
import { Archive, ArchiveRestore, ArchiveX, ListTodo, ListPlus, Pencil, Plus, Search } from "lucide-react";
import { api } from "../../api/client";
import type { Area, Project, RetentionResponse, Task, TaskDetail, TaskListResponse } from "../../api/types";
import {
  AreaChip,
  BlockedBadge,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  PageSpinner,
  PriorityBadge,
  StatusBadge,
  TypeBadge,
  useToast,
} from "../../components/ui";
import { faDueLabel, fmtDuration, gregorianYMD, PRIORITY_FA, STATUS_FA } from "../../lib/format";
import { DurationInput } from "../../components/ui";
import TaskDetailDrawer from "./TaskDetailDrawer";

export default function AllTasksPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();

  const filters = {
    q: params.get("q") ?? "",
    area_id: params.get("area_id") ?? "",
    project_id: params.get("project_id") ?? "",
    status: params.get("status") ?? "",
    priority: params.get("priority") ?? "",
    tag_id: params.get("tag_id") ?? "",
    standalone: params.get("standalone") === "1",
    archived: params.get("archived") === "1",
    due: params.get("due") === "1",
    sort: params.get("sort") ?? "updated",
  };
  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k === "area_id") next.delete("project_id");
    setParams(next, { replace: true });
  };

  const { data: areas } = useQuery({ queryKey: ["areas"], queryFn: () => api<Area[]>("/v1/areas") });
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/v1/projects", { params: { include_closed: true } }) });
  const { data: tags } = useQuery({ queryKey: ["tags"], queryFn: () => api<{ id: string; name: string }[]>("/v1/tags") });

  const { data, isLoading } = useQuery({
    queryKey: ["tasks", filters],
    queryFn: () =>
      api<TaskListResponse>("/v1/tasks", {
        params: {
          q: filters.q || undefined,
          area_id: filters.area_id || undefined,
          project_id: filters.project_id || undefined,
          status: filters.status || undefined,
          priority: filters.priority || undefined,
          tag_id: filters.tag_id || undefined,
          standalone: filters.standalone ? true : undefined,
          archived: filters.archived ? true : undefined,
          due_within_days: filters.due ? 7 : undefined,
          sort: filters.sort,
          limit: 300,
        },
      }),
  });

  const [quickTitle, setQuickTitle] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  const quickAdd = useMutation({
    mutationFn: () => api("/v1/tasks", { method: "POST", body: { title: quickTitle.trim() } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setQuickTitle("");
      toast.push("تسک مستقل در بک‌لاگ ساخته شد.");
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const deleteTask = useMutation({
    mutationFn: (id: string) => api(`/v1/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.push("تسک حذف شد.");
    },
  });

  const archiveTask = useMutation({
    mutationFn: (t: Task) => api(`/v1/tasks/${t.id}/archive`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["sprint"] });
      toast.push("تسک بایگانی شد — از بخش آرشیو قابل بازگردانی است.");
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const restoreTask = useMutation({
    mutationFn: (t: Task) => api(`/v1/tasks/${t.id}/restore`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.push("تسک از آرشیو بازگردانده شد.");
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const [retentionChecked, setRetentionChecked] = useState<Set<string>>(new Set());
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const { data: retention } = useQuery({
    queryKey: ["retention"],
    queryFn: () => api<RetentionResponse>("/v1/tasks/retention"),
  });

  const purge = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api(`/v1/tasks/${id}`, { method: "DELETE" }))),
    onSuccess: (_d, ids) => {
      qc.invalidateQueries({ queryKey: ["retention"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.push(`${ids.length} تسک برای همیشه حذف شد.`);
      setRetentionChecked(new Set());
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const toggleRetention = (id: string) =>
    setRetentionChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addToSprint = useMutation({
    mutationFn: (t: Task) =>
      api("/v1/sprints/current/tasks", { method: "POST", body: { items: [{ task_id: t.id }] } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["sprint"] });
      toast.push("به اسپرینت جاری اضافه شد.");
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const items = data?.items ?? [];
  const hasFilters = Object.values(filters).some((v) => v && v !== "updated");
  // Eligible for the current sprint: not already in an active sprint, not closed, not archived.
  const sprintEligible = (t: Task) => !t.active_sprint_id && t.status !== "closed" && !t.archived;

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">انبار</h1>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setFilter("sort", filters.sort === "manual" ? "updated" : "manual")}>
            {filters.sort === "manual" ? "ترتیب: دستی" : "ترتیب: آخرین تغییر"}
          </button>
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> تسک جدید
          </button>
        </div>
      </div>

      <form
        className="card mb-4 flex flex-wrap items-center gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (quickTitle.trim()) quickAdd.mutate();
        }}
      >
        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input !ps-9" placeholder="جستجو در عنوان و کلید تسک…" value={filters.q} onChange={(e) => setFilter("q", e.target.value)} />
        </div>
        <select className="input !w-auto min-w-[9rem]" value={filters.area_id} onChange={(e) => setFilter("area_id", e.target.value)}>
          <option value="">همه مسیرها</option>
          {(areas ?? []).map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select className="input !w-auto min-w-[9rem]" value={filters.project_id} onChange={(e) => setFilter("project_id", e.target.value)}>
          <option value="">همه پروژه‌ها</option>
          {(projects ?? [])
            .filter((p) => !filters.area_id || p.area_id === filters.area_id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.parent_project_id ? "↳ " : ""}{p.name}
              </option>
            ))}
        </select>
        <select className="input !w-auto min-w-[9rem]" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">همه وضعیت‌ها</option>
          {Object.entries(STATUS_FA).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select className="input !w-auto min-w-[9rem]" value={filters.priority} onChange={(e) => setFilter("priority", e.target.value)}>
          <option value="">همه اولویت‌ها</option>
          {Object.entries(PRIORITY_FA).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select className="input !w-auto min-w-[9rem]" value={filters.tag_id} onChange={(e) => setFilter("tag_id", e.target.value)}>
          <option value="">همه برچسب‌ها</option>
          {(tags ?? []).map((t) => (
            <option key={t.id} value={t.id}>#{t.name}</option>
          ))}
        </select>
        <button
          type="button"
          className={`chip cursor-pointer ${filters.standalone ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
          onClick={() => setFilter("standalone", filters.standalone ? "" : "1")}
        >
          فقط مستقل‌ها
        </button>
        <button
          type="button"
          className={`chip cursor-pointer ${filters.archived ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
          onClick={() => setFilter("archived", filters.archived ? "" : "1")}
        >
          آرشیو
        </button>
        <button
          type="button"
          className={`chip cursor-pointer ${filters.due ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
          onClick={() => setFilter("due", filters.due ? "" : "1")}
        >
          مهلت ۷ روز آینده
        </button>
        {hasFilters && (
          <button type="button" className="text-xs text-indigo-600 dark:text-indigo-400" onClick={() => setParams({}, { replace: true })}>
            پاک‌کردن فیلترها
          </button>
        )}
        <div className="flex w-full items-center gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          <input
            className="input flex-1"
            placeholder="افزودن سریع تسک مستقل… (Enter)"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
          />
          <button className="btn-primary" disabled={!quickTitle.trim() || quickAdd.isPending}>
            افزودن
          </button>
        </div>
      </form>

      {isLoading ? (
        <PageSpinner />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ListTodo size={36} />}
          title="تسکی پیدا نشد"
          hint={hasFilters ? "فیلترها را تغییر دهید یا پاک کنید." : "اولین تسک را با فرم بالا بسازید."}
        />
      ) : (
        <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
          {items.map((t) => (
            <div
              key={t.id}
              className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-3 transition hover:bg-slate-50 sm:flex-nowrap sm:gap-3 sm:px-4 dark:hover:bg-slate-800/60"
              onClick={() => setDetailTaskId(t.id)}
            >
              <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                <div className="flex items-center gap-1.5">
                  {t.issue_key && <span className="chip tnum shrink-0 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t.issue_key}</span>}
                  <span className="truncate text-sm font-semibold">{t.title}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <AreaChip name={t.project_name ?? t.area_name} color={t.area_color} />
                  <TypeBadge type={t.task_type} />
                  <BlockedBadge blocked={t.is_blocked} />
                  {t.archived && <span className="chip bg-slate-100 text-slate-400 dark:bg-slate-800">بایگانی</span>}
                  {t.tags.map((tag) => (
                    <span key={tag.id} className="chip bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                      #{tag.name}
                    </span>
                  ))}
                </div>
              </div>
              {(t.due_date || t.due_time) && (
                <span className="tnum hidden text-xs text-slate-400 sm:block">{faDueLabel(t.due_date, t.due_time)}</span>
              )}
              <StatusBadge status={t.status} />
              <PriorityBadge priority={t.priority} />
              <span className="tnum hidden w-28 text-end text-xs text-slate-500 sm:block dark:text-slate-400">
                {t.task_type === "todo" ? "—" : `${fmtDuration(t.logged_minutes)}${t.estimate_minutes ? ` / ${fmtDuration(t.estimate_minutes)}` : ""}`}
              </span>
              {!filters.archived && sprintEligible(t) && (
                <button
                  className="btn-ghost !p-1.5 text-slate-400 hover:!text-indigo-500"
                  title="افزودن به اسپرینت جاری"
                  onClick={(e) => {
                    e.stopPropagation();
                    addToSprint.mutate(t);
                  }}
                >
                  <ListPlus size={16} />
                </button>
              )}
              {!filters.archived && (
                <button
                  className="btn-ghost hidden !p-1.5 text-slate-400 hover:!text-indigo-500 sm:block"
                  title="ویرایش سریع"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditTask(t);
                  }}
                >
                  <Pencil size={15} />
                </button>
              )}
              {filters.archived ? (
                <button
                  className="btn-ghost !p-1.5 text-slate-400 hover:!text-indigo-500"
                  title="بازگردانی از آرشیو"
                  onClick={(e) => {
                    e.stopPropagation();
                    restoreTask.mutate(t);
                  }}
                >
                  <ArchiveRestore size={16} />
                </button>
              ) : (
                <button
                  className="btn-ghost !p-1.5 text-slate-400 hover:!text-indigo-500"
                  title="بایگانی"
                  onClick={(e) => {
                    e.stopPropagation();
                    archiveTask.mutate(t);
                  }}
                >
                  <Archive size={16} />
                </button>
              )}
              <button
                className="btn-ghost !p-1.5 text-slate-400 hover:!text-red-500"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(t);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card mt-4 p-4">
        <h3 className="flex items-center gap-2 font-bold">
          <ArchiveX size={17} className="text-amber-500" />
          پاک‌سازی قدیمی‌ها
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
          تسک‌های بسته‌شده تا <b>{retention?.cutoff_label ?? "سه ماه پیش"}</b> (سه ماه پیش).
          هیچ‌چیز خودکار حذف نمی‌شود — انتخاب کن و با تأیید، برای همیشه پاک کن (زمان‌های ثبت‌شده‌شان هم پاک می‌شود).
        </p>
        {retention && retention.candidates.length > 0 && (
          <>
            <div className="mt-2 space-y-1">
              {retention.candidates.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-2.5 text-sm dark:border-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={retentionChecked.has(c.id)}
                    onChange={() => toggleRetention(c.id)}
                    className="h-4 w-4 accent-red-500"
                  />
                  {c.issue_key && (
                    <span className="chip tnum bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {c.issue_key}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                  <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {c.closed_month}
                  </span>
                  {c.archived && (
                    <span className="chip bg-slate-100 text-slate-400 dark:bg-slate-800">بایگانی</span>
                  )}
                  {c.logged_minutes > 0 && (
                    <span className="tnum text-xs text-slate-400">{fmtDuration(c.logged_minutes)}</span>
                  )}
                </label>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                className="btn-danger"
                disabled={retentionChecked.size === 0 || purge.isPending}
                onClick={() => setPurgeConfirm(true)}
              >
                حذف دائمی ({retentionChecked.size})
              </button>
            </div>
          </>
        )}
        {retention && retention.candidates.length === 0 && (
          <div className="mt-1 text-xs text-slate-400">هنوز تسکی برای پاک‌سازی نرسیده است.</div>
        )}
      </div>

      <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} areas={areas ?? []} projects={projects ?? []} />
      {editTask && <EditTaskModal key={editTask.id} task={editTask} areas={areas ?? []} projects={projects ?? []} onClose={() => setEditTask(null)} />}
      {detailTaskId && <TaskDetailDrawer taskId={detailTaskId} onClose={() => setDetailTaskId(null)} />}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="حذف تسک"
        message={`«${deleteTarget?.title}» برای همیشه حذف می‌شود (به همراه زمان‌های ثبت‌شده‌شان).`}
        onConfirm={() => deleteTarget && deleteTask.mutate(deleteTarget.id)}
      />
      <ConfirmDialog
        open={purgeConfirm}
        onClose={() => setPurgeConfirm(false)}
        title="حذف دائمی قدیمی‌ها"
        message={`${retentionChecked.size} تسک به‌همراه زمان‌های ثبت‌شده‌شان برای همیشه حذف می‌شوند. این کار برگشت‌پذیر نیست.`}
        confirmLabel="حذف دائمی"
        onConfirm={() => purge.mutate([...retentionChecked])}
      />
    </main>
  );
}

/** Category picker: standalone / area-task / project / subproject — shared by create & edit. */
function ScopeSelect({
  areas,
  projects,
  value,
  onChange,
}: {
  areas: Area[];
  projects: Project[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">مستقل (بدون دسته)</option>
      {areas.map((a) => {
        const tops = projects.filter((p) => p.area_id === a.id && !p.parent_project_id);
        return (
          <optgroup key={a.id} label={a.name}>
            <option value={a.id}>{a.name} (تسک مسیر)</option>
            {tops.flatMap((p) => [
              <option key={p.id} value={`p:${p.id}`}>
                ↳ {p.name}
              </option>,
              ...projects
                .filter((sp) => sp.parent_project_id === p.id)
                .map((sp) => (
                  <option key={sp.id} value={`p:${sp.id}`}>
                    ↳↳ {sp.name}
                  </option>
                )),
            ])}
          </optgroup>
        );
      })}
    </select>
  );
}

function scopeToIds(scope: string): { area_id?: string; project_id?: string; to_standalone?: boolean } {
  if (scope.startsWith("p:")) return { project_id: scope.slice(2) };
  if (scope) return { area_id: scope };
  return { to_standalone: true };
}

const emptyForm = {
  title: "",
  scope: "",
  task_type: "timed" as "todo" | "timed",
  estimate: null as number | null,
  priority: "medium",
  dueDate: null as DateObject | null,
  dueTime: "",
  description: "",
};

function CreateTaskModal({
  open,
  onClose,
  areas,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  areas: Area[];
  projects: Project[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [keepOpen, setKeepOpen] = useState(false);

  // Fresh form every time the modal opens — no stale category/type leaks.
  useEffect(() => {
    if (open) {
      setForm({ ...emptyForm });
      setKeepOpen(false);
    }
  }, [open]);

  const submit = useMutation({
    mutationFn: (thenAnother: boolean) => {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        priority: form.priority,
        task_type: form.task_type,
        description: form.description,
      };
      if (form.estimate && form.task_type === "timed") body.estimate_minutes = form.estimate;
      Object.assign(body, scopeToIds(form.scope));
      if (form.dueDate && form.dueDate.isValid) {
        body.due_date = gregorianYMD(form.dueDate.toDate());
        if (form.dueTime) body.due_time = form.dueTime;
      }
      setKeepOpen(thenAnother);
      return api("/v1/tasks", { method: "POST", body });
    },
    onSuccess: (_d, thenAnother: boolean) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      if (thenAnother) {
        // Create-Another: keep useful context (category, type, priority), clear the rest.
        toast.push("تسک ساخته شد — تسک بعدی؟");
        setForm((f) => ({
          ...f,
          title: "",
          estimate: null,
          dueDate: null,
          dueTime: "",
          description: "",
        }));
      } else {
        toast.push("تسک ساخته شد.");
        setForm({ ...emptyForm });
        onClose();
      }
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  return (
    <Modal open={open} onClose={onClose} title="تسک جدید">
      <div className="space-y-3">
        <Field label="دسته" hint="اول دسته را انتخاب کن، بعد عنوان تسک را بنویس.">
          <ScopeSelect areas={areas} projects={projects} value={form.scope} onChange={(v) => setForm({ ...form, scope: v })} />
        </Field>
        <Field label="عنوان">
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="نوع تسک" hint={form.task_type === "todo" ? "فقط انجام‌شدن مهم است" : "زمان و جزئیات مهم است"}>
            <select
              className="input"
              value={form.task_type}
              onChange={(e) => setForm({ ...form, task_type: e.target.value as "todo" | "timed" })}
            >
              <option value="timed">زمان‌دار</option>
              <option value="todo">فقط انجام (To-Do)</option>
            </select>
          </Field>
          <Field label="اولویت">
            <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Task["priority"] })}>
              {Object.entries(PRIORITY_FA).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
        </div>
        {form.task_type === "timed" && (
          <Field label="برآورد">
            <DurationInput minutes={form.estimate} onChangeMinutes={(v) => setForm({ ...form, estimate: v })} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="مهلت" hint="اختیاری">
            <DatePicker
              calendar={persian}
              locale={persian_fa}
              value={form.dueDate}
              onChange={(d: DateObject | null) => setForm({ ...form, dueDate: d && d.isValid ? d : null })}
              inputClass="input tnum"
              placeholder="بدون مهلت"
              editable={false}
              format="YYYY/MM/DD"
            />
          </Field>
          <Field label="ساعت مهلت">
            <input
              type="time"
              className="input tnum"
              value={form.dueTime}
              onChange={(e) => setForm({ ...form, dueTime: e.target.value })}
              disabled={!form.dueDate}
            />
          </Field>
        </div>
        <Field label="توضیحات">
          <textarea className="input min-h-[60px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="flex flex-wrap justify-start gap-2 pt-1">
          <button className="btn-primary" disabled={!form.title.trim() || submit.isPending} onClick={() => submit.mutate(false)}>
            ساخت تسک
          </button>
          <button className="btn-secondary" disabled={!form.title.trim() || submit.isPending} onClick={() => submit.mutate(true)}>
            ساخت و تسک بعدی +
          </button>
          <button className="btn-secondary" onClick={onClose}>
            انصراف
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Explicit edit modal with a single Save Changes action (warehouse quick edit). */
function EditTaskModal({
  task,
  areas,
  projects,
  onClose,
}: {
  task: Task;
  areas: Area[];
  projects: Project[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: detail } = useQuery({
    queryKey: ["task", task.id],
    queryFn: () => api<TaskDetail>(`/v1/tasks/${task.id}`),
  });

  const [form, setForm] = useState(() => ({
    title: task.title,
    scope: task.project_id ? `p:${task.project_id}` : task.area_id ?? "",
    task_type: task.task_type,
    estimate: task.estimate_minutes,
    priority: task.priority,
    status: task.status,
    description: "",
    dueDate: task.due_date
      ? (() => {
          const [y, m, d] = task.due_date.split("-").map(Number);
          return new DateObjectCtor(new Date(y, m - 1, d));
        })()
      : null,
    dueTime: task.due_time ? task.due_time.slice(0, 5) : "",
  }));
  useEffect(() => {
    if (detail && form.description === "") setForm((f) => ({ ...f, description: detail.description }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        priority: form.priority,
        status: form.status,
        task_type: form.task_type,
        description: form.description,
        ...scopeToIds(form.scope),
      };
      if (form.task_type === "timed" && form.estimate) body.estimate_minutes = form.estimate;
      else body.clear_estimate = true;
      if (form.dueDate && form.dueDate.isValid) {
        body.due_date = gregorianYMD(form.dueDate.toDate());
        if (form.dueTime) body.due_time = form.dueTime;
        else body.clear_due_time = true;
      } else {
        body.clear_due_date = true;
      }
      return api(`/v1/tasks/${task.id}`, { method: "PATCH", body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task", task.id] });
      qc.invalidateQueries({ queryKey: ["sprint"] });
      toast.push("تغییرات ذخیره شد.");
      onClose();
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  return (
    <Modal open onClose={onClose} title="ویرایش تسک">
      <div className="space-y-3">
        <Field label="عنوان">
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="دسته">
          <ScopeSelect areas={areas} projects={projects} value={form.scope} onChange={(v) => setForm({ ...form, scope: v })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="نوع تسک">
            <select
              className="input"
              value={form.task_type}
              onChange={(e) => setForm({ ...form, task_type: e.target.value as "todo" | "timed" })}
            >
              <option value="timed">زمان‌دار</option>
              <option value="todo">فقط انجام (To-Do)</option>
            </select>
          </Field>
          <Field label="وضعیت">
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Task["status"] })}>
              {Object.entries(STATUS_FA).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="اولویت">
            <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Task["priority"] })}>
              {Object.entries(PRIORITY_FA).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          {form.task_type === "timed" && (
            <Field label="برآورد">
              <DurationInput minutes={form.estimate} onChangeMinutes={(v) => setForm({ ...form, estimate: v })} />
            </Field>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="مهلت">
            <DatePicker
              calendar={persian}
              locale={persian_fa}
              value={form.dueDate}
              onChange={(d: DateObject | null) => setForm({ ...form, dueDate: d && d.isValid ? d : null })}
              inputClass="input tnum"
              placeholder="بدون مهلت"
              editable={false}
              format="YYYY/MM/DD"
            />
          </Field>
          <Field label="ساعت مهلت">
            <input
              type="time"
              className="input tnum"
              value={form.dueTime}
              onChange={(e) => setForm({ ...form, dueTime: e.target.value })}
              disabled={!form.dueDate}
            />
          </Field>
        </div>
        <Field label="توضیحات">
          <textarea className="input min-h-[60px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="flex justify-start gap-2 pt-1">
          <button className="btn-primary" disabled={!form.title.trim() || save.isPending} onClick={() => save.mutate()}>
            ذخیره تغییرات
          </button>
          <button className="btn-secondary" onClick={onClose}>
            انصراف
          </button>
        </div>
      </div>
    </Modal>
  );
}
