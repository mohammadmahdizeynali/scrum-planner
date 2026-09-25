import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------- Toast ----------------

interface Toast {
  id: number;
  message: string;
  kind: "success" | "error";
}

const ToastCtx = createContext<{ push: (message: string, kind?: Toast["kind"]) => void }>({
  push: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((message: string, kind: Toast["kind"] = "success") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 start-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "rounded-2xl border border-white/10 px-4 py-2.5 text-sm text-white shadow-xl",
              t.kind === "success" ? "bg-emerald-600" : "bg-red-600"
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

// ---------------- Modal ----------------

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] animate-[overlay-in_.15s_ease-out]" onClick={onClose} />
      <div
        className={cn(
          "relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl shadow-slate-900/20 animate-[modal-in_.18s_ease-out] dark:bg-slate-900",
          wide ? "max-w-2xl" : "max-w-md"
        )}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[15px] font-bold">{title}</h3>
          <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="بستن">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

// ---------------- Confirm ----------------

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "حذف",
  danger,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {message && <div className="mb-4 text-sm text-slate-600 dark:text-slate-300">{message}</div>}
      {children}
      <div className="mt-4 flex justify-start gap-2">
        <button
          className={danger ? "btn-danger" : "btn-primary"}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
        <button className="btn-secondary" onClick={onClose}>
          انصراف
        </button>
      </div>
    </Modal>
  );
}

// ---------------- Small bits ----------------

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600",
        className
      )}
    />
  );
}

export function PageSpinner() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900/50">
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
          {icon}
        </div>
      )}
      <div className="text-[15px] font-bold">{title}</div>
      {hint && <div className="max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">{hint}</div>}
      {action}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    high: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
    medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
    low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  };
  const labels: Record<string, string> = { high: "زیاد", medium: "متوسط", low: "کم" };
  return <span className={cn("chip", styles[priority])}>{labels[priority]}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    backlog: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
    open: "bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-300",
    in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300",
    closed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300",
  };
  const labels: Record<string, string> = {
    backlog: "بک‌لاگ",
    open: "باز",
    in_progress: "در حال انجام",
    closed: "انجام شد",
  };
  return <span className={cn("chip", styles[status])}>{labels[status]}</span>;
}

export function AreaChip({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return null;
  return (
    <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color ?? "#94a3b8" }} />
      {name}
    </span>
  );
}

const TYPE_STYLES: Record<string, string> = {
  todo: "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300",
  timed: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300",
};
const TYPE_LABELS: Record<string, string> = { todo: "فقط انجام", timed: "زمان‌دار" };

export function TypeBadge({ type }: { type: string }) {
  return <span className={cn("chip", TYPE_STYLES[type] ?? TYPE_STYLES.timed)}>{TYPE_LABELS[type] ?? type}</span>;
}

/** Small «سد شده» chip for tasks with unfinished blockers. */
export function BlockedBadge({ blocked }: { blocked: boolean }) {
  if (!blocked) return null;
  return <span className="chip bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">سد شده</span>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm"
      aria-pressed={checked}
    >
      <span
        className={cn(
          "relative inline-block h-[22px] w-10 rounded-full transition-colors",
          checked ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-md transition-all",
            checked ? "start-[20px]" : "start-0.5"
          )}
        />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}

/** Two side-by-side boxes `[ h ] [ min ]` for entering a duration — no "2:15" style anywhere. */
export function DurationInput({
  minutes,
  onChangeMinutes,
  disabled,
}: {
  minutes: number | null | undefined;
  onChangeMinutes: (v: number | null) => void;
  disabled?: boolean;
}) {
  const [hText, setHText] = useState(() => (minutes != null ? String(Math.floor(minutes / 60)) : ""));
  const [mText, setMText] = useState(() => (minutes != null ? String(minutes % 60) : ""));
  const lastEmitted = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    // sync only when the value changed from outside (not from our own emissions)
    if (minutes !== lastEmitted.current) {
      lastEmitted.current = minutes ?? null;
      setHText(minutes != null ? String(Math.floor(minutes / 60)) : "");
      setMText(minutes != null ? String(minutes % 60) : "");
    }
  }, [minutes]);

  const emit = (hS: string, mS: string) => {
    if (hS === "" && mS === "") {
      lastEmitted.current = null;
      onChangeMinutes(null);
      return;
    }
    const hv = parseInt(hS || "0", 10) || 0;
    const mv = parseInt(mS || "0", 10) || 0;
    const total = hv * 60 + Math.min(59, Math.max(0, mv));
    lastEmitted.current = total;
    onChangeMinutes(total > 0 ? total : null);
  };

  return (
    <span className="inline-flex items-center gap-1.5" dir="ltr">
      <input
        className="input tnum !w-14 !px-2 text-center"
        inputMode="numeric"
        aria-label="ساعت"
        placeholder="0"
        value={hText}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 3);
          setHText(v);
          emit(v, mText);
        }}
      />
      <span className="text-xs text-slate-400">h</span>
      <input
        className="input tnum !w-16 !px-2 text-center"
        inputMode="numeric"
        aria-label="دقیقه"
        placeholder="0"
        value={mText}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value.replace(/\D/g, "").slice(0, 2);
          const v = raw === "" ? "" : String(Math.min(59, parseInt(raw, 10) || 0));
          setMText(v);
          emit(hText, v);
        }}
      />
      <span className="text-xs text-slate-400">min</span>
    </span>
  );
}

export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800", className)}>
      <div
        className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-gradient-to-l from-emerald-500 to-emerald-400" : "bg-gradient-to-l from-indigo-600 to-indigo-400")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
