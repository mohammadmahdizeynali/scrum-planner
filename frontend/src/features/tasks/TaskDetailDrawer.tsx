import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DatePicker, { type DateObject } from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import DateObjectCtor from "react-date-object";
import { Trash2, X, Plus } from "lucide-react";
import { api } from "../../api/client";
import type { Area, Project, TaskDetail } from "../../api/types";
import { ConfirmDialog, Field, PriorityBadge, Spinner, Toggle, useToast } from "../../components/ui";
import {
  faDate,
  fmtDuration,
  fmtEstimateLogged,
  hmOf,
  parseDurationInput,
  PRIORITY_FA,
  STATUS_FA,
  gregorianYMD,
} from "../../lib/format";
import { utcToZonedParts } from "../../lib/tz";

function useMeTz(): string {
  const { data } = useQueryCachedUser();
  return data?.timezone ?? "Asia/Tehran";
}

function useQueryCachedUser() {
  return useQuery<{ timezone: string }>({
    queryKey: ["me"],
    queryFn: () => api("/v1/auth/me"),
    staleTime: 60_000,
  });
}

export default function TaskDetailDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const tz = useMeTz();
  const { data: task } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api<TaskDetail>(`/v1/tasks/${taskId}`),
  });
  const { data: areas } = useQuery({ queryKey: ["areas"], queryFn: () => api<Area[]>("/v1/areas") });
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/v1/projects") });
  const { data: tags } = useQuery({ queryKey: ["tags"], queryFn: () => api<{ id: string; name: string }[]>("/v1/tags") });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [preview, setPreview] = useState<{ time_entries: number; logged_minutes: number } | null>(null);
  const [newSubtask, setNewSubtask] = useState("");
  const [quickLog, setQuickLog] = useState<{ date: DateObject | null; start: string; end: string; note: string; billable: boolean | null }>({
    date: null,
    start: "09:00",
    end: "10:00",
    note: "",
    billable: null,
  });

  useEffect(() => {
    if (task && quickLog.billable === null) {
      setQuickLog((q) => ({ ...q, billable: task.area_billable_default ?? false }));
    }
  }, [task?.id, task?.area_billable_default]);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/v1/tasks/${taskId}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["sprint"] });
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const deleteTask = useMutation({
    mutationFn: () => api(`/v1/tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.push("تسک حذف شد.");
      onClose();
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const addSubtask = useMutation({
    mutationFn: () => api(`/v1/tasks/${taskId}/subtasks`, { method: "POST", body: { title: newSubtask } }),
    onSuccess: () => {
      setNewSubtask("");
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const toggleSubtask = useMutation({
    mutationFn: (s: { id: string; done: boolean }) => api(`/v1/subtasks/${s.id}`, { method: "PATCH", body: { done: s.done } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const deleteSubtask = useMutation({
    mutationFn: (id: string) => api(`/v1/subtasks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const createEntry = useMutation({
    mutationFn: () => {
      const date = quickLog.date?.toDate() ?? new Date();
      const [sh, sm] = quickLog.start.split(":").map(Number);
      const [eh, em] = quickLog.end.split(":").map(Number);
      const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), sh, sm);
      const endDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), eh, em);
      const iso = (d: Date) => {
        const off = -d.getTimezoneOffset();
        const sign = off >= 0 ? "+" : "-";
        const abs = Math.abs(off);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
      };
      return api("/v1/time-entries", {
        method: "POST",
        body: {
          task_id: taskId,
          start_at: iso(startDate),
          end_at: iso(endDate),
          note: quickLog.note || null,
          billable: quickLog.billable,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["sprint"] });
      toast.push("زمان ثبت شد.");
      setQuickLog((q) => ({ ...q, note: "" }));
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const deleteEntry = useMutation({
    mutationFn: (id: string) => api(`/v1/time-entries/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      qc.invalidateQueries({ queryKey: ["entries"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["sprint"] });
    },
  });

  const openDelete = async () => {
    const p = await api<{ time_entries: number; logged_minutes: number }>(`/v1/tasks/${taskId}/delete-preview`);
    setPreview(p);
    setDeleteOpen(true);
  };

  if (!task) {
    return createPortal(
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
        <div className="absolute inset-y-0 end-0 flex w-full max-w-md items-center justify-center bg-white dark:bg-slate-900">
          <Spinner className="h-8 w-8" />
        </div>
      </div>,
      document.body
    );
  }

  const recurrenceLabel = (rule: NonNullable<TaskDetail["recurrence_rule"]>) => {
    if (rule.kind === "every_n_days") return `هر ${rule.n} روز`;
    if (rule.kind === "weekly") {
      const names = ["دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه", "شنبه", "یک‌شنبه"];
      return "هر " + (rule.weekdays ?? []).map((w) => names[w]).join(" و ");
    }
    if (rule.kind === "monthly_jalali") return `ماهانه در روز ${rule.day} شمسی`;
    return "تکرارشونده";
  };

  const duePickerValue = task.due_date
    ? (() => {
        const [y, m, d] = task.due_date.split("-").map(Number);
        return new DateObjectCtor(new Date(y, m - 1, d));
      })()
    : null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="absolute inset-y-0 end-0 w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl shadow-slate-900/20 animate-[modal-in_.2s_ease-out] dark:bg-slate-900">
        <div className="mb-4 flex items-start justify-between gap-2">
          <input
            className="w-full rounded-lg bg-transparent text-lg font-extrabold outline-none hover:bg-slate-100 focus:bg-slate-100 dark:hover:bg-slate-800 dark:focus:bg-slate-800"
            defaultValue={task.title}
            onBlur={(e) => e.target.value !== task.title && patch.mutate({ title: e.target.value })}
          />
          <button className="btn-ghost !p-1.5" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          <Field label="وضعیت">
            <select className="input" value={task.status} onChange={(e) => patch.mutate({ status: e.target.value })}>
              {Object.entries(STATUS_FA).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="اولویت">
            <select className="input" value={task.priority} onChange={(e) => patch.mutate({ priority: e.target.value })}>
              {Object.entries(PRIORITY_FA).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="دسته">
            <select
              className="input"
              value={task.project_id ?? task.area_id ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") patch.mutate({ to_standalone: true });
                else if (v.startsWith("p:")) patch.mutate({ project_id: v.slice(2) });
                else patch.mutate({ area_id: v });
              }}
            >
              <option value="">مستقل (بدون دسته)</option>
              {(areas ?? []).map((a) => (
                <optgroup key={a.id} label={a.name}>
                  <option value={a.id}>{a.name} (تسک حوزه‌ای)</option>
                  {(projects ?? [])
                    .filter((p) => p.area_id === a.id)
                    .map((p) => (
                      <option key={p.id} value={`p:${p.id}`}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="برآورد (ساعت:دقیقه)">
            <input
              className="input tnum"
              inputMode="numeric"
              placeholder="2:15"
              defaultValue={hmOf(task.estimate_minutes)}
              onBlur={(e) => {
                const v = parseDurationInput(e.target.value);
                if (v === null) {
                  if (task.estimate_minutes) patch.mutate({ clear_estimate: true });
                } else if (v !== task.estimate_minutes) {
                  patch.mutate({ estimate_minutes: v });
                }
              }}
            />
          </Field>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {task.issue_key && <span className="chip tnum bg-indigo-50 font-bold text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">{task.issue_key}</span>}
          <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 tnum">
            {fmtEstimateLogged(task.logged_minutes, task.estimate_minutes)}
          </span>
          {task.memberships.map((m) => (
            <span key={m.sprint_id} className="chip bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
              {m.sprint_name}
              {m.source === "carry_over" && " (انتقالی)"}
            </span>
          ))}
          {task.tags.map((t) => (
            <span key={t.id} className="chip bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
              #{t.name}
              <button
                onClick={() => patch.mutate({ tag_ids: task.tags.filter((x) => x.id !== t.id).map((x) => x.id) })}
                className="ms-0.5 hover:text-red-500"
              >
                ×
              </button>
            </span>
          ))}
          <div className="relative">
            <select
              className="chip cursor-pointer bg-slate-100 text-slate-600 outline-none dark:bg-slate-800 dark:text-slate-300"
              value=""
              onChange={(e) => {
                if (e.target.value) patch.mutate({ tag_ids: [...task.tags.map((t) => t.id), e.target.value] });
              }}
            >
              <option value="">+ برچسب</option>
              {(tags ?? [])
                .filter((t) => !task.tags.some((x) => x.id === t.id))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    #{t.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="mb-4 space-y-2">
          <Field label="توضیحات">
            <textarea
              className="input min-h-[70px]"
              defaultValue={task.description}
              onBlur={(e) => e.target.value !== task.description && patch.mutate({ description: e.target.value })}
              placeholder="این تسک درباره چیست؟"
            />
          </Field>
          <Field label="یادداشت‌ها">
            <textarea
              className="input min-h-[70px]"
              defaultValue={task.notes}
              onBlur={(e) => e.target.value !== task.notes && patch.mutate({ notes: e.target.value })}
              placeholder="یادداشت‌های کاری…"
            />
          </Field>
        </div>

        {/* due date + recurrence */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Field label="مهلت">
            <DatePicker
              calendar={persian}
              locale={persian_fa}
              value={duePickerValue}
              onChange={(d: DateObject | null) => {
                if (d && d.isValid) patch.mutate({ due_date: gregorianYMD(d.toDate()) });
                else patch.mutate({ clear_due_date: true });
              }}
              inputClass="input tnum"
              placeholder="بدون مهلت"
              editable={false}
              format="YYYY/MM/DD"
            />
          </Field>
          <Field label="تکرار">
            <select
              className="input"
              value={task.recurrence_rule?.kind ?? ""}
              onChange={(e) => {
                const k = e.target.value;
                patch.mutate({
                  recurrence_rule: k === "" ? null : k === "weekly" ? { kind: "weekly", weekdays: [5] } : k === "every_n_days" ? { kind: "every_n_days", n: 7 } : { kind: "monthly_jalali", day: 1 },
                });
              }}
            >
              <option value="">بدون تکرار</option>
              <option value="every_n_days">هر چند روز</option>
              <option value="weekly">هفتگی</option>
              <option value="monthly_jalali">ماهانه (شمسی)</option>
            </select>
          </Field>
        </div>
        {task.recurrence_rule && (
          <div className="mb-4 flex items-center justify-between rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
            <span>
              {recurrenceLabel(task.recurrence_rule)}
              {task.recurrence_rule.kind === "every_n_days" && (
                <input
                  className="input tnum mx-2 !w-14 !py-1 text-center"
                  defaultValue={task.recurrence_rule.n}
                  onBlur={(e) => patch.mutate({ recurrence_rule: { kind: "every_n_days", n: parseInt(e.target.value, 10) || 7 } })}
                />
              )}
              {task.recurrence_rule.kind === "weekly" && (
                <span className="mx-2 inline-flex gap-1">
                  {[0, 1, 2, 3, 4, 5, 6].map((w) => {
                    const names = ["د", "س", "چ", "پ", "ج", "ش", "ی"];
                    const active = task.recurrence_rule?.weekdays?.includes(w);
                    return (
                      <button
                        key={w}
                        className={`h-6 w-6 rounded-lg text-[11px] ${active ? "bg-violet-600 text-white" : "bg-white dark:bg-slate-800"}`}
                        onClick={() => {
                          const cur = task.recurrence_rule?.weekdays ?? [];
                          const next = active ? cur.filter((x) => x !== w) : [...cur, w];
                          patch.mutate({ recurrence_rule: { kind: "weekly", weekdays: next.length ? next : [5] } });
                        }}
                      >
                        {names[w]}
                      </button>
                    );
                  })}
                </span>
              )}
              {task.recurrence_rule.kind === "monthly_jalali" && (
                <input
                  className="input tnum mx-2 !w-14 !py-1 text-center"
                  defaultValue={task.recurrence_rule.day}
                  onBlur={(e) => patch.mutate({ recurrence_rule: { kind: "monthly_jalali", day: parseInt(e.target.value, 10) || 1 } })}
                />
              )}
            </span>
            <span className="text-slate-400">با بستن، تسک بعدی ساخته می‌شود</span>
          </div>
        )}

        {/* subtasks */}
        <div className="mb-4">
          <div className="mb-1.5 text-xs font-medium text-slate-500">چک‌لیست</div>
          <div className="space-y-1.5">
            {task.subtasks.map((st) => (
              <div key={st.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60">
                <input
                  type="checkbox"
                  checked={st.done}
                  onChange={() => toggleSubtask.mutate({ id: st.id, done: !st.done })}
                  className="h-4 w-4 accent-emerald-600"
                />
                <span className={`flex-1 text-sm ${st.done ? "text-slate-400 line-through" : ""}`}>{st.title}</span>
                <button className="btn-ghost !p-1" onClick={() => deleteSubtask.mutate(st.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <input
              className="input"
              placeholder="افزودن زیرتسک…"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && newSubtask.trim() && addSubtask.mutate()}
            />
            <button className="btn-secondary" onClick={() => newSubtask.trim() && addSubtask.mutate()}>
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* time entries */}
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-500">
            <span>زمان‌های ثبت‌شده</span>
            <span className="tnum">{fmtDuration(task.logged_minutes)}</span>
          </div>
          <div className="space-y-1.5">
            {task.entries.map((e) => {
              const parts = utcToZonedParts(new Date(e.start_at), tz);
              return (
                <div key={e.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-800/60">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.area_color ?? "#94a3b8" }} />
                  <span className="w-24 shrink-0">{faDate({ y: parts.y, m: parts.m, d: parts.d }, { withYear: false })}</span>
                  <span className="tnum flex-1 text-slate-500">
                    {String(parts.h).padStart(2, "0")}:{String(parts.min).padStart(2, "0")} · {fmtDuration(e.minutes)}
                  </span>
                  {e.billable && <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">فاکتور</span>}
                  <button className="btn-ghost !p-1" onClick={() => deleteEntry.mutate(e.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
            {task.entries.length === 0 && <div className="text-xs text-slate-400">هنوز زمانی ثبت نشده.</div>}
          </div>

          <div className="mt-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div className="mb-2 text-xs font-semibold">ثبت سریع زمان</div>
            <div className="flex flex-wrap items-center gap-2">
              <DatePicker
                calendar={persian}
                locale={persian_fa}
                value={quickLog.date}
                onChange={(d: DateObject | null) => setQuickLog((q) => ({ ...q, date: d }))}
                inputClass="input tnum !w-32"
                placeholder="امروز"
                format="YYYY/MM/DD"
                editable={false}
              />
              <input type="time" className="input tnum !w-28" value={quickLog.start} onChange={(e) => setQuickLog((q) => ({ ...q, start: e.target.value }))} />
              <span className="text-slate-400">تا</span>
              <input type="time" className="input tnum !w-28" value={quickLog.end} onChange={(e) => setQuickLog((q) => ({ ...q, end: e.target.value }))} />
              <Toggle
                checked={quickLog.billable ?? false}
                onChange={(v) => setQuickLog((q) => ({ ...q, billable: v }))}
                label="فاکتور"
              />
            </div>
            <div className="mt-2 flex gap-1.5">
              <input
                className="input"
                placeholder="یادداشت (اختیاری)"
                value={quickLog.note}
                onChange={(e) => setQuickLog((q) => ({ ...q, note: e.target.value }))}
              />
              <button className="btn-primary shrink-0" disabled={createEntry.isPending} onClick={() => createEntry.mutate()}>
                ثبت
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
          <button className="text-sm text-red-500 hover:text-red-600" onClick={openDelete}>
            حذف تسک
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="حذف تسک"
        message={
          preview && preview.logged_minutes > 0
            ? `این تسک ${fmtDuration(preview.logged_minutes)} زمان ثبت‌شده دارد که با حذف تسک، از همه گزارش‌ها پاک می‌شود. مطمئن هستید؟`
            : "این تسک برای همیشه حذف می‌شود. مطمئن هستید؟"
        }
        onConfirm={() => deleteTask.mutate()}
      />
    </div>,
    document.body
  );
}
