import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api } from "../../api/client";
import type { PlanningSuggestion, SprintDetail } from "../../api/types";
import { AreaChip, Modal, Spinner, useToast } from "../../components/ui";
import { DurationInput } from "../../components/ui";
import { fmtDuration, fmtEstimateLogged } from "../../lib/format";

const REASON_FA: Record<string, { label: string; cls: string }> = {
  overdue: { label: "سررسید گذشته", cls: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300" },
  due_this_week: { label: "مهلت این هفته", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300" },
  logged_last_week: { label: "هفتهٔ پیش وقت گذاشتی", cls: "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300" },
  recurring: { label: "تکرارشونده", cls: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300" },
};

/**
 * Planning assistant — suggestions only. Confirming uses the normal
 * add-tasks endpoint; nothing is added without the user's explicit confirm,
 * and the sprint stays fully editable during the week.
 */
export default function PlanningAssistantModal({
  open,
  onClose,
  sprint,
  suggestions,
}: {
  open: boolean;
  onClose: () => void;
  sprint: SprintDetail;
  suggestions: PlanningSuggestion[];
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [estimates, setEstimates] = useState<Record<string, number | null>>({});

  useEffect(() => {
    if (open) {
      setChecked(new Set(suggestions.map((s) => s.task.id)));
      setEstimates(
        Object.fromEntries(suggestions.map((s) => [s.task.id, s.task.estimate_minutes]))
      );
    }
  }, [open, suggestions]);

  const add = useMutation({
    mutationFn: () =>
      api(`/v1/sprints/${sprint.id}/tasks`, {
        method: "POST",
        body: {
          items: suggestions
            .filter((s) => checked.has(s.task.id))
            .map((s) => ({
              task_id: s.task.id,
              estimate_minutes: estimates[s.task.id] ?? undefined,
            })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprint"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["suggestions"] });
      toast.push("به اسپرینت اضافه شد.");
      onClose();
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const n = checked.size;

  return (
    <Modal open={open} onClose={onClose} title={
      <span className="flex items-center gap-1.5">
        <Sparkles size={16} className="text-indigo-500" />
        دستیار برنامه‌ریزی
      </span>
    } wide>
      <p className="mb-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
        این‌ها فقط پیشنهادند — هر چیزی را نخواستی تیکش را بردار و بعداً هم می‌توانی از طریق
        «افزودن تسک» یا انبار اضافه کنی.
      </p>
      <div className="mb-4 max-h-[50vh] space-y-1.5 overflow-y-auto">
        {suggestions.map((s) => {
          const isChecked = checked.has(s.task.id);
          return (
            <label
              key={s.task.id}
              className={`flex cursor-pointer flex-wrap items-center gap-2 rounded-xl border p-2.5 text-sm transition ${
                isChecked
                  ? "border-indigo-300 bg-indigo-50/50 dark:border-indigo-500/40 dark:bg-indigo-500/10"
                  : "border-slate-200 dark:border-slate-700"
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(s.task.id)}
                className="h-4 w-4 accent-indigo-600"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  {s.task.issue_key && (
                    <span className="chip tnum bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {s.task.issue_key}
                    </span>
                  )}
                  <span className="font-medium">{s.task.title}</span>
                  {s.reasons.map((r) => (
                    <span key={r} className={`chip ${REASON_FA[r]?.cls ?? ""}`}>{REASON_FA[r]?.label ?? r}</span>
                  ))}
                </span>
              </span>
              {isChecked ? (
                <DurationInput
                  minutes={estimates[s.task.id] ?? null}
                  onChangeMinutes={(v) => setEstimates((prev) => ({ ...prev, [s.task.id]: v }))}
                />
              ) : (
                s.task.estimate_minutes && (
                  <span className="tnum text-xs text-slate-400">{fmtEstimateLogged(s.task.logged_minutes, null)}</span>
                )
              )}
              <AreaChip name={s.task.project_name ?? s.task.area_name} color={s.task.area_color} />
            </label>
          );
        })}
        {suggestions.length === 0 && (
          <div className="py-6 text-center text-sm text-slate-400">پیشنهادی برای این هفته ندارم.</div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="tnum text-xs text-slate-400">
          {n > 0 ? `برآورد مجموع: ${fmtDuration(sumEst(suggestions, checked, estimates))}` : ""}
        </span>
        <span className="flex gap-2">
          <button className="btn-secondary" onClick={onClose}>
            بستن
          </button>
          <button
            className="btn-primary"
            disabled={n === 0 || add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : `افزودن ${n} تسک`}
          </button>
        </span>
      </div>
    </Modal>
  );
}

function sumEst(
  suggestions: PlanningSuggestion[],
  checked: Set<string>,
  estimates: Record<string, number | null>
): number {
  return suggestions
    .filter((s) => checked.has(s.task.id))
    .reduce((sum, s) => sum + (estimates[s.task.id] ?? 0), 0);
}
