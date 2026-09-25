import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, CheckCircle2, FolderPlus, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import type { Area, Project } from "../../api/types";
import { ConfirmDialog, EmptyState, Field, Modal, PageSpinner, Toggle, useToast } from "../../components/ui";

const PALETTE = ["#6366f1", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6"];

const TASK_TYPE_FA: Record<string, string> = { todo: "فقط انجام", timed: "زمان‌دار" };

function AreaFormModal({
  open,
  onClose,
  area,
}: {
  open: boolean;
  onClose: () => void;
  area?: Area | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(area?.name ?? "");
  const [color, setColor] = useState(area?.color ?? PALETTE[0]);
  const [billable, setBillable] = useState(area?.billable_default ?? false);
  const [keyPrefix, setKeyPrefix] = useState(area?.key_prefix ?? "");
  const [defaultType, setDefaultType] = useState<"todo" | "timed">(area?.default_task_type ?? "timed");
  const prefixLocked = !!area && !!area.key_prefix && area.task_count > 0;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        color,
        billable_default: billable,
        key_prefix: keyPrefix.trim() ? keyPrefix.trim().toUpperCase() : null,
        default_task_type: defaultType,
      };
      return area
        ? api(`/v1/areas/${area.id}`, { method: "PATCH", body })
        : api("/v1/areas", { method: "POST", body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["areas"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.push(area ? "مسیر ویرایش شد." : "مسیر ساخته شد.");
      onClose();
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  return (
    <Modal open={open} onClose={onClose} title={area ? "ویرایش مسیر" : "مسیر جدید"}>
      <div className="space-y-3">
        <Field label="نام مسیر">
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلا: دانشگاه" />
        </Field>
        <Field
          label="کلید تسک‌ها (پیشوند)"
          hint={prefixLocked ? "این مسیر تسک کلیددار دارد؛ برای حفظ هویت کلیدها (مثل SBU-001) قابل تغییر نیست." : "۲ تا ۵ نویسه لاتین، مثلا SBU → کلید تسک‌ها: SBU-001 …"}
        >
          <input
            className="input tnum"
            value={keyPrefix}
            onChange={(e) => setKeyPrefix(e.target.value.toUpperCase())}
            placeholder="SBU"
            disabled={prefixLocked}
            maxLength={5}
          />
        </Field>
        <Field label="نوع پیش‌فرض تسک‌های این مسیر" hint="هنگام ساخت تسک می‌توانی نوع را عوض کنی؛ این فقط پیش‌فرض است.">
          <select className="input" value={defaultType} onChange={(e) => setDefaultType(e.target.value as "todo" | "timed")}>
            <option value="timed">زمان‌دار</option>
            <option value="todo">فقط انجام (To-Do)</option>
          </select>
        </Field>
        <Field label="رنگ">
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-xl transition ${color === c ? "ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-slate-900" : ""}`}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
        </Field>
        <Toggle checked={billable} onChange={setBillable} label="ثبت زمان‌های این مسیر به‌طور پیش‌فرض قابل‌صدور فاکتور باشند" />
        <div className="flex justify-start gap-2 pt-1">
          <button className="btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            ذخیره
          </button>
          <button className="btn-secondary" onClick={onClose}>
            انصراف
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Create/edit a project or subproject — name, issue key, default task type. */
function ProjectFormModal({
  open,
  onClose,
  area,
  project,
  parentProject,
}: {
  open: boolean;
  onClose: () => void;
  area: Area;
  project?: Project | null;
  parentProject?: Project | null;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(project?.name ?? "");
  const [keyPrefix, setKeyPrefix] = useState(project?.key_prefix ?? "");
  const [defaultType, setDefaultType] = useState(project?.default_task_type ?? "timed");
  const prefixLocked = !!project && !!project.key_prefix && project.task_count > 0;
  const isSub = !!(project?.parent_project_id ?? parentProject);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        area_id: area.id,
        name: name.trim(),
        key_prefix: keyPrefix.trim() ? keyPrefix.trim().toUpperCase() : null,
        default_task_type: defaultType,
      };
      if (parentProject) body.parent_project_id = parentProject.id;
      return project
        ? api(`/v1/projects/${project.id}`, { method: "PATCH", body })
        : api("/v1/projects", { method: "POST", body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["areas"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.push(project ? "پروژه ویرایش شد." : isSub ? "زیرپروژه ساخته شد." : "پروژه ساخته شد.");
      onClose();
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        project
          ? `ویرایش «${project.name}»`
          : isSub
            ? `زیرپروژه جدید در «${(parentProject ?? project)?.name}»`
            : `پروژه جدید در «${area.name}»`
      }
    >
      <div className="space-y-3">
        <Field label={isSub ? "نام زیرپروژه / درس" : "نام پروژه"}>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={isSub ? "مثلا: تحلیل چندمعیاره" : "مثلا: درس ساختمان داده"} />
        </Field>
        <Field
          label="کلید تسک‌ها (اختیاری)"
          hint={prefixLocked ? "این پروژه تسک کلیددار دارد؛ کلید برای حفظ هویت (مثل MCDA-001) قابل تغییر نیست." : "۲ تا ۵ نویسه لاتین، مثلا MCDA → کلید تسک‌ها: MCDA-001 …"}
        >
          <input
            className="input tnum"
            value={keyPrefix}
            onChange={(e) => setKeyPrefix(e.target.value.toUpperCase())}
            placeholder="MCDA"
            disabled={prefixLocked}
            maxLength={5}
          />
        </Field>
        <Field label="نوع پیش‌فرض تسک‌ها">
          <select className="input" value={defaultType} onChange={(e) => setDefaultType(e.target.value as "todo" | "timed")}>
            <option value="timed">زمان‌دار</option>
            <option value="todo">فقط انجام (To-Do)</option>
          </select>
        </Field>
        <div className="mt-4 flex justify-start gap-2">
          <button className="btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
            ذخیره
          </button>
          <button className="btn-secondary" onClick={onClose}>انصراف</button>
        </div>
      </div>
    </Modal>
  );
}

function AreaTaskModal({ open, onClose, area }: { open: boolean; onClose: () => void; area: Area }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [taskType, setTaskType] = useState<"todo" | "timed">(area.default_task_type ?? "timed");
  const save = useMutation({
    mutationFn: () => api("/v1/tasks", { method: "POST", body: { title: title.trim(), area_id: area.id, task_type: taskType } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.push("تسک مسیر ساخته شد.");
      setTitle("");
      onClose();
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });
  return (
    <Modal open={open} onClose={onClose} title={`تسک مسیر برای «${area.name}»`}>
      <div className="space-y-3">
        <Field label="عنوان">
          <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="نوع تسک">
          <select className="input" value={taskType} onChange={(e) => setTaskType(e.target.value as "todo" | "timed")}>
            <option value="timed">زمان‌دار</option>
            <option value="todo">فقط انجام (To-Do)</option>
          </select>
        </Field>
      </div>
      <div className="mt-4 flex justify-start gap-2">
        <button className="btn-primary" disabled={!title.trim() || save.isPending} onClick={() => save.mutate()}>ساخت</button>
        <button className="btn-secondary" onClick={onClose}>انصراف</button>
      </div>
    </Modal>
  );
}

function DeleteAreaModal({ open, onClose, area, projects }: { open: boolean; onClose: () => void; area: Area; projects: Project[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<"move" | "purge">("move");
  const [target, setTarget] = useState("");
  const { data: otherAreas } = useQuery({
    queryKey: ["areas"],
    queryFn: () => api<Area[]>("/v1/areas"),
    enabled: open,
  });
  const targets = (otherAreas ?? []).filter((a) => a.id !== area?.id);

  const doDelete = useMutation({
    mutationFn: () =>
      api(`/v1/areas/${area!.id}`, {
        method: "DELETE",
        params: { mode, target_area_id: mode === "move" && target ? target : undefined },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.push("مسیر حذف شد.");
      onClose();
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  return (
    <Modal open={open} onClose={onClose} title={`حذف مسیر «${area?.name}»`}>
      <div className="space-y-3 text-sm">
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <input type="radio" checked={mode === "move"} onChange={() => setMode("move")} className="mt-1 accent-indigo-600" />
          <span>
            <b>انتقال محتوا</b> — پروژه‌ها و تسک‌های مسیر به مسیر دیگری منتقل می‌شوند.
            <select className="input mt-2" value={target} onChange={(e) => setTarget(e.target.value)} disabled={mode !== "move"}>
              <option value="">مسیر مقصد…</option>
              {targets.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <input type="radio" checked={mode === "purge"} onChange={() => setMode("purge")} className="mt-1 accent-red-600" />
          <span>
            <b>حذف کامل</b> — همه پروژه‌ها، تسک‌ها و زمان‌های ثبت‌شده این مسیر برای همیشه پاک می‌شوند.
          </span>
        </label>
        <div className="flex justify-start gap-2 pt-1">
          <button className="btn-danger" disabled={mode === "move" && !target} onClick={() => doDelete.mutate()}>
            حذف
          </button>
          <button className="btn-secondary" onClick={onClose}>انصراف</button>
        </div>
      </div>
    </Modal>
  );
}

export default function AreasPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: areas, isLoading } = useQuery({ queryKey: ["areas"], queryFn: () => api<Area[]>("/v1/areas") });
  const { data: projects } = useQuery({
    queryKey: ["projects", "all"],
    queryFn: () => api<Project[]>("/v1/projects", { params: { include_closed: true } }),
  });

  const [editArea, setEditArea] = useState<Area | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectArea, setProjectArea] = useState<Area | null>(null);
  const [taskArea, setTaskArea] = useState<Area | null>(null);
  const [deleteArea, setDeleteArea] = useState<Area | null>(null);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);
  // project editing: { area, project? , parent? }
  const [projectForm, setProjectForm] = useState<{ area: Area; project?: Project | null; parent?: Project | null } | null>(null);

  const closeProject = useMutation({
    mutationFn: ({ id, close }: { id: string; close: boolean }) =>
      api(`/v1/projects/${id}/${close ? "close" : "reopen"}`, { method: "POST" }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["areas"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.push(v.close ? "پروژه بسته شد — در بخش «بسته‌شده‌ها» قابل مرور است." : "پروژه دوباره فعال شد.");
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const deleteProjectMut = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: "move" | "purge" }) =>
      api(`/v1/projects/${id}`, { method: "DELETE", params: { mode } }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.push("پروژه حذف شد.");
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const [projectDeleteMode, setProjectDeleteMode] = useState<"move" | "purge">("move");

  if (isLoading) return <PageSpinner />;

  const projectRow = (a: Area, p: Project, isSub: boolean) => {
    const subs = (projects ?? []).filter((sp) => sp.parent_project_id === p.id);
    const closed = p.closed_at != null;
    return (
      <div key={p.id}>
        <div
          className={`group flex items-center gap-2 rounded-xl px-3 py-2 ${
            isSub ? "ms-5 bg-transparent border border-slate-100 dark:border-slate-800" : "bg-slate-50 dark:bg-slate-800/60"
          } ${closed ? "opacity-60" : ""}`}
        >
          <FolderPlus size={14} className="shrink-0 text-slate-400" />
          <span className={`min-w-0 flex-1 truncate text-sm font-medium ${closed ? "line-through" : ""}`}>{p.name}</span>
          {p.key_prefix && (
            <span className="chip tnum shrink-0 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{p.key_prefix}</span>
          )}
          {closed && <span className="chip shrink-0 bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300">بسته</span>}
          <span className="tnum hidden text-xs text-slate-400 sm:block">{p.task_count} تسک</span>
          <div className="flex shrink-0 gap-0.5">
            <button
              className="btn-ghost !p-1 text-slate-400 hover:!text-emerald-500"
              title={closed ? "بازگشایی پروژه" : "بستن پروژه"}
              onClick={() => closeProject.mutate({ id: p.id, close: !closed })}
            >
              {closed ? <RotateCcw size={13} /> : <CheckCircle2 size={13} />}
            </button>
            <button
              className="btn-ghost !p-1 opacity-0 transition group-hover:opacity-100"
              title="ویرایش پروژه"
              onClick={() => setProjectForm({ area: a, project: p })}
            >
              <Pencil size={13} />
            </button>
            <button
              className="btn-ghost !p-1 opacity-0 transition group-hover:opacity-100 hover:!text-red-500"
              onClick={() => setDeleteProject(p)}
              title="حذف پروژه"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        {subs.map((sp) => projectRow(a, sp, true))}
        {!closed && !isSub && (
          <button
            className="ms-9 mt-1 flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-indigo-500 dark:hover:bg-slate-800"
            onClick={() => setProjectForm({ area: a, parent: p })}
          >
            <Plus size={11} /> زیرپروژه
          </button>
        )}
      </div>
    );
  };

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="page-title">مسیرها</h1>
        <button className="btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> مسیر جدید
        </button>
      </div>

      {(areas ?? []).length === 0 ? (
        <EmptyState
          icon={<Boxes size={36} />}
          title="هنوز مسیری نساخته‌اید"
          hint="مسیرها دسته‌های اصلی زندگی شما هستند — مثلا دانشگاه، فریلنسری یا زندگی شخصی. هر مسیر می‌تواند چند پروژه (درس یا مشتری) و زیرپروژه داشته باشد."
          action={
            <button className="btn-primary mt-2" onClick={() => setCreateOpen(true)}>
              ساخت اولین مسیر
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(areas ?? []).map((a) => {
            const topProjects = (projects ?? []).filter((p) => p.area_id === a.id && !p.parent_project_id);
            const closedCount = topProjects.filter((p) => p.closed_at != null).length;
            return (
              <div key={a.id} className="card p-5">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="h-4 w-4 rounded-full" style={{ backgroundColor: a.color }} />
                    <div>
                      <div className="flex items-center gap-1.5 font-extrabold">
                        {a.name}
                        {a.key_prefix && <span className="chip tnum bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{a.key_prefix}</span>}
                      </div>
                      <div className="text-xs text-slate-400">
                        {a.billable_default ? "پیش‌فرض قابل‌فاکتور · " : ""}
                        {a.task_count} تسک · پیش‌فرض: {TASK_TYPE_FA[a.default_task_type ?? "timed"]}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    <button className="btn-ghost !p-2" onClick={() => setEditArea(a)} title="ویرایش">
                      <Pencil size={15} />
                    </button>
                    <button className="btn-ghost !p-2 text-slate-400 hover:!text-red-500" onClick={() => setDeleteArea(a)} title="حذف">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {topProjects.map((p) => projectRow(a, p, false))}
                  {topProjects.length === 0 && <div className="px-1 text-xs text-slate-400">هنوز پروژه‌ای ندارد.</div>}
                  {closedCount > 0 && (
                    <div className="px-1 pt-1 text-[11px] text-slate-400">
                      {closedCount} پروژهٔ بسته‌شده هم در این مسیر هست (با آیکن ↺ قابل بازگشایی است).
                    </div>
                  )}
                </div>

                <div className="mt-3 flex gap-2">
                  <button className="btn-secondary flex-1 !py-1.5 text-xs" onClick={() => setProjectArea(a)}>
                    <Plus size={13} /> پروژه
                  </button>
                  <button className="btn-secondary flex-1 !py-1.5 text-xs" onClick={() => setTaskArea(a)}>
                    <Plus size={13} /> تسک مسیر
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AreaFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
      {editArea && <AreaFormModal key={editArea.id} open onClose={() => setEditArea(null)} area={editArea} />}
      {projectArea && <ProjectFormModal open onClose={() => setProjectArea(null)} area={projectArea} />}
      {projectForm && (
        <ProjectFormModal
          open
          onClose={() => setProjectForm(null)}
          area={projectForm.area}
          project={projectForm.project}
          parentProject={projectForm.parent}
        />
      )}
      {taskArea && <AreaTaskModal open onClose={() => setTaskArea(null)} area={taskArea} />}
      {deleteArea && <DeleteAreaModal open onClose={() => setDeleteArea(null)} area={deleteArea} projects={projects ?? []} />}
      <ConfirmDialog
        open={deleteProject !== null}
        onClose={() => setDeleteProject(null)}
        title={`حذف پروژه «${deleteProject?.name}»`}
        message="تسک‌هایش چه شوند؟"
        confirmLabel="حذف پروژه"
        onConfirm={() => deleteProject && deleteProjectMut.mutate({ id: deleteProject.id, mode: projectDeleteMode })}
      >
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={projectDeleteMode === "move"} onChange={() => setProjectDeleteMode("move")} className="accent-indigo-600" />
            منتقل شوند به سطح مسیر
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={projectDeleteMode === "purge"} onChange={() => setProjectDeleteMode("purge")} className="accent-red-600" />
            همراه پروژه حذف شوند (به همراه زمان‌های ثبت‌شده)
          </label>
        </div>
      </ConfirmDialog>
    </main>
  );
}
