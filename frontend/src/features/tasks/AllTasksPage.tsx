import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListTodo, ListPlus, Plus, Search } from "lucide-react";
import { api } from "../../api/client";
import type { Area, Project, Task, TaskListResponse } from "../../api/types";
import {
  AreaChip,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  PageSpinner,
  PriorityBadge,
  StatusBadge,
  useToast,
} from "../../components/ui";
import { faDate, fmtDuration, PRIORITY_FA, STATUS_FA } from "../../lib/format";
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
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/v1/projects") });
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
          due_within_days: filters.due ? 7 : undefined,
          sort: filters.sort,
          limit: 300,
        },
      }),
  });

  const [quickTitle, setQuickTitle] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
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

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">همه تسک‌ها</h1>
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
        <select className="input !w-auto" value={filters.area_id} onChange={(e) => setFilter("area_id", e.target.value)}>
          <option value="">همه حوزه‌ها</option>
          {(areas ?? []).map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <select className="input !w-auto" value={filters.project_id} onChange={(e) => setFilter("project_id", e.target.value)}>
          <option value="">همه پروژه‌ها</option>
          {(projects ?? [])
            .filter((p) => !filters.area_id || p.area_id === filters.area_id)
            .map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
        </select>
        <select className="input !w-auto" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">همه وضعیت‌ها</option>
          {Object.entries(STATUS_FA).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select className="input !w-auto" value={filters.priority} onChange={(e) => setFilter("priority", e.target.value)}>
          <option value="">همه اولویت‌ها</option>
          {Object.entries(PRIORITY_FA).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select className="input !w-auto" value={filters.tag_id} onChange={(e) => setFilter("tag_id", e.target.value)}>
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
              className="flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
              onClick={() => setDetailTaskId(t.id)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {t.issue_key && <span className="chip tnum shrink-0 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t.issue_key}</span>}
                  <span className="truncate text-sm font-semibold">{t.title}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <AreaChip name={t.project_name ?? t.area_name} color={t.area_color} />
                  {t.tags.map((tag) => (
                    <span key={tag.id} className="chip bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                      #{tag.name}
                    </span>
                  ))}
                </div>
              </div>
              {t.due_date && <span className="tnum hidden text-xs text-slate-400 sm:block">{faDate(ymdParts(t.due_date))}</span>}
              <StatusBadge status={t.status} />
              <PriorityBadge priority={t.priority} />
              <span className="tnum hidden w-28 text-end text-xs text-slate-500 dark:text-slate-400 sm:block">
                {fmtDuration(t.logged_minutes)}
                {t.estimate_minutes ? ` / ${fmtDuration(t.estimate_minutes)}` : ""}
              </span>
              {!t.active_sprint_id && (
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

      <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} areas={areas ?? []} projects={projects ?? []} />
      {detailTaskId && <TaskDetailDrawer taskId={detailTaskId} onClose={() => setDetailTaskId(null)} />}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="حذف تسک"
        message={`«${deleteTarget?.title}» برای همیشه حذف می‌شود (به همراه زمان‌های ثبت‌شده‌اش).`}
        onConfirm={() => deleteTarget && deleteTask.mutate(deleteTarget.id)}
      />
    </main>
  );
}

function ymdParts(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

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
  const [form, setForm] = useState({
    title: "",
    scope: "",
    estimate: null as number | null,
    priority: "medium",
    description: "",
  });

  const submit = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        priority: form.priority,
        description: form.description,
      };
      if (form.estimate) body.estimate_minutes = form.estimate;
      if (form.scope.startsWith("p:")) body.project_id = form.scope.slice(2);
      else if (form.scope) body.area_id = form.scope;
      return api("/v1/tasks", { method: "POST", body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.push("تسک ساخته شد.");
      setForm({ title: "", scope: "", estimate: null, priority: "medium", description: "" });
      onClose();
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  return (
    <Modal open={open} onClose={onClose} title="تسک جدید">
      <div className="space-y-3">
        <Field label="عنوان">
          <input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="دسته">
          <select className="input" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
            <option value="">مستقل (بدون دسته)</option>
            {areas.map((a) => (
              <optgroup key={a.id} label={a.name}>
                <option value={a.id}>{a.name} (تسک حوزه‌ای)</option>
                {projects
                  .filter((p) => p.area_id === a.id)
                  .map((p) => (
                    <option key={p.id} value={`p:${p.id}`}>{p.name}</option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="برآورد">
            <DurationInput minutes={form.estimate} onChangeMinutes={(v) => setForm({ ...form, estimate: v })} />
          </Field>
          <Field label="اولویت">
            <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {Object.entries(PRIORITY_FA).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="توضیحات">
          <textarea className="input min-h-[60px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="flex justify-start gap-2 pt-1">
          <button className="btn-primary" disabled={!form.title.trim() || submit.isPending} onClick={() => submit.mutate()}>
            ساخت تسک
          </button>
          <button className="btn-secondary" onClick={onClose}>
            انصراف
          </button>
        </div>
      </div>
    </Modal>
  );
}
