import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import type { Area, Project } from "../../api/types";
import { ConfirmDialog, EmptyState, Field, Modal, PageSpinner, Toggle, useToast } from "../../components/ui";

const PALETTE = ["#6366f1", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6"];

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
  const prefixLocked = !!area && !!area.key_prefix && area.task_count > 0;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        color,
        billable_default: billable,
        key_prefix: keyPrefix.trim() ? keyPrefix.trim().toUpperCase() : null,
      };
      return area
        ? api(`/v1/areas/${area.id}`, { method: "PATCH", body })
        : api("/v1/areas", { method: "POST", body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["areas"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.push(area ? "حوزه ویرایش شد." : "حوزه ساخته شد.");
      onClose();
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  return (
    <Modal open={open} onClose={onClose} title={area ? "ویرایش حوزه" : "حوزه جدید"}>
      <div className="space-y-3">
        <Field label="نام حوزه">
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلا: دانشگاه" />
        </Field>
        <Field
          label="کلید تسک‌ها (پیشوند)"
          hint={prefixLocked ? "این حوزه تسک کلیددار دارد؛ برای حفظ هویت کلیدها (مثل SBU-001) قابل تغییر نیست." : "حروف لاتین، مثلا SBU → کلید تسک‌ها: SBU-001، SBU-002 …"}
        >
          <input
            className="input tnum"
            value={keyPrefix}
            onChange={(e) => setKeyPrefix(e.target.value.toUpperCase())}
            placeholder="SBU"
            disabled={prefixLocked}
            maxLength={10}
          />
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
        <Toggle checked={billable} onChange={setBillable} label="ثبت زمان‌های این حوزه به‌طور پیش‌فرض قابل‌صدور فاکتور باشند" />
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

function ProjectFormModal({ open, onClose, area }: { open: boolean; onClose: () => void; area: Area }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: () => api("/v1/projects", { method: "POST", body: { area_id: area.id, name: name.trim() } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["areas"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.push("پروژه ساخته شد.");
      setName("");
      onClose();
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });
  return (
    <Modal open={open} onClose={onClose} title={`پروژه جدید در «${area.name}»`}>
      <Field label="نام پروژه">
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلا: درس ساختمان داده" />
      </Field>
      <div className="mt-4 flex justify-start gap-2">
        <button className="btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          ساخت
        </button>
        <button className="btn-secondary" onClick={onClose}>انصراف</button>
      </div>
    </Modal>
  );
}

function AreaTaskModal({ open, onClose, area }: { open: boolean; onClose: () => void; area: Area }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const save = useMutation({
    mutationFn: () => api("/v1/tasks", { method: "POST", body: { title: title.trim(), area_id: area.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.push("تسک حوزه‌ای ساخته شد.");
      setTitle("");
      onClose();
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });
  return (
    <Modal open={open} onClose={onClose} title={`تسک حوزه‌ای برای «${area.name}»`}>
      <Field label="عنوان">
        <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
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
      toast.push("حوزه حذف شد.");
      onClose();
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  return (
    <Modal open={open} onClose={onClose} title={`حذف حوزه «${area?.name}»`}>
      <div className="space-y-3 text-sm">
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <input type="radio" checked={mode === "move"} onChange={() => setMode("move")} className="mt-1 accent-indigo-600" />
          <span>
            <b>انتقال محتوا</b> — پروژه‌ها و تسک‌های حوزه‌ای به حوزه دیگری منتقل می‌شوند.
            <select className="input mt-2" value={target} onChange={(e) => setTarget(e.target.value)} disabled={mode !== "move"}>
              <option value="">حوزه مقصد…</option>
              {targets.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <input type="radio" checked={mode === "purge"} onChange={() => setMode("purge")} className="mt-1 accent-red-600" />
          <span>
            <b>حذف کامل</b> — همه پروژه‌ها، تسک‌ها و زمان‌های ثبت‌شده این حوزه برای همیشه پاک می‌شوند.
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
  const { data: projects } = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/v1/projects") });

  const [editArea, setEditArea] = useState<Area | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectArea, setProjectArea] = useState<Area | null>(null);
  const [taskArea, setTaskArea] = useState<Area | null>(null);
  const [deleteArea, setDeleteArea] = useState<Area | null>(null);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);

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

  return (
    <main className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="page-title">حوزه‌ها</h1>
        <button className="btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> حوزه جدید
        </button>
      </div>

      {(areas ?? []).length === 0 ? (
        <EmptyState
          icon={<Boxes size={36} />}
          title="هنوز حوزه‌ای نساخته‌اید"
          hint="حوزه‌ها دسته‌های اصلی زندگی شما هستند — مثلا دانشگاه، فریلنسری یا زندگی شخصی. هر حوزه می‌تواند چند پروژه (درس یا مشتری) داشته باشد."
          action={
            <button className="btn-primary mt-2" onClick={() => setCreateOpen(true)}>
              ساخت اولین حوزه
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(areas ?? []).map((a) => {
            const areaProjects = (projects ?? []).filter((p) => p.area_id === a.id);
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
                        {a.task_count} تسک
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
                  {areaProjects.map((p) => (
                    <div key={p.id} className="group flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                      <FolderPlus size={14} className="text-slate-400" />
                      <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
                      <span className="tnum text-xs text-slate-400">{p.task_count} تسک</span>
                      <button
                        className="btn-ghost !p-1 opacity-0 transition group-hover:opacity-100 hover:!text-red-500"
                        onClick={() => setDeleteProject(p)}
                        title="حذف پروژه"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {areaProjects.length === 0 && <div className="px-1 text-xs text-slate-400">هنوز پروژه‌ای ندارد.</div>}
                </div>

                <div className="mt-3 flex gap-2">
                  <button className="btn-secondary flex-1 !py-1.5 text-xs" onClick={() => setProjectArea(a)}>
                    <Plus size={13} /> پروژه
                  </button>
                  <button className="btn-secondary flex-1 !py-1.5 text-xs" onClick={() => setTaskArea(a)}>
                    <Plus size={13} /> تسک حوزه‌ای
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
            منتقل شوند به سطح حوزه
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
