import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, CheckCircle2, ChevronLeft, ChevronRight, Clock, FileArchive, Wallet } from "lucide-react";
import { api } from "../../api/client";
import type { BaseReport, MonthlyReport, Project, TrendData, WeeklyReport } from "../../api/types";
import { EmptyState, PageSpinner, ProgressBar } from "../../components/ui";
import { faDate, faMonth, faPercent, fmtDuration, JALALI_MONTHS, toFa } from "../../lib/format";
import { toJalali } from "../../lib/jalaali";
import { utcToZonedParts } from "../../lib/tz";

function useMeTz(): string {
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ timezone: string }>("/v1/auth/me"),
    staleTime: 60_000,
  });
  return data?.timezone ?? "Asia/Tehran";
}

function AreaProjectTable({ data }: { data: BaseReport }) {
  return (
    <div className="card divide-y divide-slate-100 overflow-hidden dark:divide-slate-800">
      {data.areas.map((a) => (
        <div key={a.area_id ?? "standalone"} className="p-4">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: a.color }} />
            <span className="font-bold">{a.name}</span>
            <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 tnum">{fmtDuration(a.minutes)}</span>
            {a.billable_minutes > 0 && (
              <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 tnum">
                {fmtDuration(a.billable_minutes)} فاکتور
              </span>
            )}
          </div>
          <div className="mt-2 space-y-1 ps-5">
            {a.projects.map((p) => (
              <div key={p.project_id} className="flex items-center gap-2 text-sm">
                <span className="text-slate-600 dark:text-slate-300">{p.name}</span>
                <span className="tnum text-xs text-slate-400">{fmtDuration(p.minutes)}</span>
              </div>
            ))}
            {a.area_id && a.area_level_minutes > 0 && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <span>وظایف حوزه</span>
                <span className="tnum text-xs text-slate-400">{fmtDuration(a.area_level_minutes)}</span>
              </div>
            )}
          </div>
        </div>
      ))}
      {data.areas.length === 0 && <div className="p-8 text-center text-sm text-slate-400">در این بازه زمانی ثبت نشده است.</div>}
    </div>
  );
}

function EstimateSection({ data }: { data: BaseReport }) {
  const rows = data.estimate.projects.filter((p) => p.estimate_minutes > 0 || p.logged_minutes > 0);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => Math.max(r.estimate_minutes, r.logged_minutes)), 1);
  return (
    <div className="card p-4">
      <h3 className="mb-3 font-bold">برآورد در برابر واقعیت</h3>
      <div className="space-y-3">
        {rows.map((r) => {
          const delta = r.logged_minutes - r.estimate_minutes;
          return (
            <div key={r.project_id}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-semibold">{r.name}</span>
                <span className={`tnum text-xs ${delta > 0 ? "text-red-500" : delta < 0 ? "text-emerald-500" : "text-slate-400"}`}>
                  {fmtDuration(r.logged_minutes)} / {fmtDuration(r.estimate_minutes)}
                  {delta !== 0 && (delta > 0 ? ` (+${fmtDuration(delta)})` : ` (${fmtDuration(-delta)} کمتر)`)}
                </span>
              </div>
              <div className="space-y-1">
                <ProgressBar value={r.logged_minutes} max={max} />
                <ProgressBar value={r.estimate_minutes} max={max} className="opacity-40" />
              </div>
            </div>
          );
        })}
      </div>
      {data.estimate.total_estimate_minutes > 0 && (
        <div className="mt-3 text-xs text-slate-400 tnum">
          مجموع: {fmtDuration(data.estimate.total_logged_minutes)} / {fmtDuration(data.estimate.total_estimate_minutes)}
        </div>
      )}
    </div>
  );
}

function TaskBreakdown({ data }: { data: BaseReport }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? data.tasks : data.tasks.slice(0, 10);
  const max = Math.max(...data.tasks.map((t) => t.minutes), 1);
  if (data.tasks.length === 0) return null;
  return (
    <div className="card p-4">
      <h3 className="mb-3 font-bold">تفکیک تسک‌ها</h3>
      <div className="space-y-2">
        {shown.map((t) => (
          <div key={t.task_id} className="flex items-center gap-2">
            <span className="w-40 shrink-0 truncate text-sm sm:w-64">{t.title}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full bg-indigo-500/70" style={{ width: `${(t.minutes / max) * 100}%` }} />
            </div>
            <span className="tnum w-20 shrink-0 text-end text-xs text-slate-500">{fmtDuration(t.minutes)}</span>
          </div>
        ))}
      </div>
      {data.tasks.length > 10 && (
        <button className="btn-ghost mt-2 text-xs" onClick={() => setShowAll(!showAll)}>
          {showAll ? "نمایش کمتر" : `نمایش همه (${toFa(data.tasks.length)})`}
        </button>
      )}
    </div>
  );
}

function CompletedList({ data }: { data: BaseReport }) {
  if (data.completed.length === 0) return null;
  return (
    <div className="card p-4">
      <h3 className="mb-3 flex items-center gap-2 font-bold">
        <CheckCircle2 size={17} className="text-emerald-500" />
        تسک‌های انجام‌شده
        <span className="chip bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 tnum">{toFa(data.completed.length)}</span>
      </h3>
      <div className="space-y-1.5">
        {data.completed.map((c) => (
          <div key={c.task_id} className="flex items-center gap-2 text-sm">
            <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
            <span className="flex-1 truncate">{c.title}</span>
            {(c.project_name || c.area_name) && (
              <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">{c.project_name ?? c.area_name}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryCards({ data }: { data: BaseReport }) {
  const cards = [
    { label: "مجموع زمان", value: fmtDuration(data.total_minutes), icon: <Clock size={18} /> },
    { label: "قابل‌صدور فاکتور", value: fmtDuration(data.billable_minutes), icon: <Wallet size={18} /> },
    { label: "انجام‌شده", value: toFa(data.completed.length), icon: <CheckCircle2 size={18} /> },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="card p-4">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {c.icon}
            {c.label}
          </div>
          <div className="tnum mt-1.5 text-lg font-extrabold">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Time distribution donut ----------------

interface PieSlice {
  key: string;
  label: string;
  minutes: number;
  color: string;
}

function hexLuminance(hex: string): number {
  const m = hex.replace("#", "");
  const rgb = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) || 0);
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

function TimePie({ data, projectColors }: { data: BaseReport; projectColors: Map<string, string | null> }) {
  const [hover, setHover] = useState<string | null>(null);
  if (data.total_minutes <= 0) return null;

  const slices: PieSlice[] = [];
  for (const a of data.areas) {
    for (const p of a.projects) {
      if (p.minutes > 0)
        slices.push({
          key: `p:${p.project_id}`,
          label: p.name,
          minutes: p.minutes,
          color: projectColors.get(p.project_id) ?? a.color,
        });
    }
    if (a.area_level_minutes > 0 && a.area_id)
      slices.push({ key: `al:${a.area_id}`, label: `وظایف حوزه ${a.name}`, minutes: a.area_level_minutes, color: a.color });
    if (a.area_id === null && a.minutes > 0)
      slices.push({ key: "standalone", label: "تسک‌های مستقل", minutes: a.minutes, color: a.color });
  }
  slices.sort((x, y) => y.minutes - x.minutes);

  const size = 220;
  const stroke = 30;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - stroke) / 2 - 6;
  const C = 2 * Math.PI * r;
  let acc = 0;
  const segs = slices.map((s) => {
    const frac = s.minutes / data.total_minutes;
    const seg = { ...s, frac, start: acc };
    acc += frac;
    return seg;
  });

  const hoveredSlice = segs.find((s) => s.key === hover);
  const centerMain = hoveredSlice ? fmtDuration(hoveredSlice.minutes) : fmtDuration(data.total_minutes);

  return (
    <div className="card p-5">
      <h3 className="mb-4 font-bold">سهم هر پروژه از کل زمان</h3>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <div className="relative shrink-0" onMouseLeave={() => setHover(null)}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <g transform={`rotate(-90 ${cx} ${cy})`}>
              {segs.map((seg) => (
                <circle
                  key={seg.key}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={hover && hover !== seg.key ? stroke - 6 : stroke}
                  strokeDasharray={`${Math.max(seg.frac * C - 2, 0.5)} ${C}`}
                  strokeDashoffset={-seg.start * C}
                  opacity={hover && hover !== seg.key ? 0.35 : 1}
                  className="cursor-pointer transition-all duration-150"
                  onMouseEnter={() => setHover(seg.key)}
                />
              ))}
            </g>
            {segs.map((seg) => {
              if (seg.frac < 0.06) return null;
              const theta = (seg.start + seg.frac / 2) * 2 * Math.PI - Math.PI / 2;
              const lx = cx + Math.cos(theta) * r;
              const ly = cy + Math.sin(theta) * r;
              const light = hexLuminance(seg.color) > 0.6;
              return (
                <text
                  key={`t${seg.key}`}
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none select-none"
                  fontSize="12"
                  fontWeight="700"
                  fill={light ? "#334155" : "#ffffff"}
                  style={{ paintOrder: "stroke", stroke: light ? "#ffffffaa" : "#00000055", strokeWidth: 3 }}
                >
                  {faPercent(seg.frac * 100)}
                </text>
              );
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[11px] text-slate-400">{hoveredSlice ? hoveredSlice.label : "مجموع"}</span>
            <span className="tnum mt-0.5 px-2 text-sm font-extrabold text-slate-700 dark:text-slate-200">{centerMain}</span>
          </div>
        </div>
        <div className="grid w-full flex-1 gap-1.5 sm:grid-cols-2">
          {segs.map((seg) => (
            <div
              key={seg.key}
              className={`flex cursor-default items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm transition-colors ${
                hover === seg.key ? "bg-slate-100 dark:bg-slate-800" : ""
              }`}
              onMouseEnter={() => setHover(seg.key)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
              <span className="min-w-0 flex-1 truncate">{seg.label}</span>
              <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{faPercent(seg.frac * 100)}</span>
              <span className="tnum shrink-0 text-xs text-slate-500 dark:text-slate-400">{fmtDuration(seg.minutes)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------- Month picker ----------------

function MonthPicker({ jy, jm, onPick }: { jy: number; jm: number; onPick: (jy: number, jm: number) => void }) {
  const [year, setYear] = useState(jy);
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button className="tnum btn-secondary min-w-[130px]" onClick={() => setOpen(!open)}>
        {faMonth(jy, jm)}
      </button>
      {open && (
        <div className="card absolute z-30 mt-2 w-64 p-3">
          <div className="mb-2 flex items-center justify-between">
            {/* RTL: rightmost button = previous year, leftmost = next year */}
            <button className="btn-ghost !p-1" onClick={() => setYear(year - 1)} aria-label="سال قبل">
              <ChevronRight size={16} />
            </button>
            <span className="tnum font-bold">{toFa(year)}</span>
            <button className="btn-ghost !p-1" onClick={() => setYear(year + 1)} aria-label="سال بعد">
              <ChevronLeft size={16} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {JALALI_MONTHS.map((m, i) => (
              <button
                key={m}
                className={`rounded-lg px-2 py-1.5 text-xs transition ${
                  year === jy && i + 1 === jm ? "bg-indigo-600 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
                onClick={() => {
                  onPick(year, i + 1);
                  setOpen(false);
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function monthlyNeighbors(jy: number, jm: number, delta: number): { jy: number; jm: number } {
  let m = jm + delta;
  let y = jy;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return { jy: y, jm: m };
}

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tz = useMeTz();
  const sprintParam = params.get("sprint");

  const { data: projectsList } = useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/v1/projects") });
  const projectColors = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const p of projectsList ?? []) m.set(p.id, p.color);
    return m;
  }, [projectsList]);

  // default month = current
  const { data: meUser } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ timezone: string }>("/v1/auth/me"),
    staleTime: 60_000,
  });
  const defaultMonth = useMemo(() => {
    const p = utcToZonedParts(new Date(), tz);
    return toJalali(p.y, p.m, p.d);
  }, [tz]);
  const jy = parseInt(params.get("jy") ?? "", 10) || defaultMonth.jy;
  const jm = parseInt(params.get("jm") ?? "", 10) || defaultMonth.jm;

  const monthly = useQuery({
    queryKey: ["report-monthly", jy, jm, tz],
    queryFn: () => api<MonthlyReport>("/v1/reports/monthly", { params: { jy, jm } }),
    enabled: !sprintParam,
  });

  const weekly = useQuery({
    queryKey: ["report-weekly", sprintParam],
    queryFn: () => api<WeeklyReport>(`/v1/reports/weekly/${sprintParam}`),
    enabled: !!sprintParam,
  });

  const setMonth = (y: number, m: number) => {
    const next = new URLSearchParams(params);
    next.set("jy", String(y));
    next.set("jm", String(m));
    setParams(next, { replace: true });
  };

  if (sprintParam) {
    if (weekly.isLoading) return <PageSpinner />;
    if (weekly.isError)
      return (
        <main className="mx-auto max-w-4xl p-4 md:p-6">
          <EmptyState
            icon={<FileArchive size={36} />}
            title="گزارشی برای این هفته بسته نشده"
            hint="گزارش هفتگی هنگام بستن اسپرینت ساخته می‌شود."
            action={
              <button className="btn-secondary mt-2" onClick={() => setParams({})}>
                بازگشت به گزارش ماهانه
              </button>
            }
          />
        </main>
      );
    const data = weekly.data!;
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">{data.sprint_name}</h1>
            <div className="mt-1 text-sm text-slate-500">
              گزارش هفتگی — بسته‌شده در {data.generated_at ? faDate(utcToParts(data.generated_at, tz), { withWeekday: true }) : "—"}
            </div>
          </div>
          <button className="btn-secondary" onClick={() => setParams({})}>
            <ArrowLeft size={16} />
            گزارش ماهانه
          </button>
        </div>
        <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          این گزارش در زمان بستن اسپرینت آرشیو شده است؛ ویرایش‌های بعدی روی آن اثر نمی‌گذارند.
        </div>
        <SummaryCards data={data} />
        <TimePie data={data} projectColors={projectColors} />
        <AreaProjectTable data={data} />
        <EstimateSection data={data} />
        <TaskBreakdown data={data} />
        <CompletedList data={data} />
      </main>
    );
  }

  if (monthly.isLoading) return <PageSpinner />;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="page-title">گزارش‌ها</h1>
        <div className="flex items-center gap-1.5">
          {/* RTL: rightmost button = previous month, leftmost = next month (matches the timesheet week nav) */}
          <button
            className="btn-secondary !px-2.5"
            title="ماه قبل"
            aria-label="ماه قبل"
            onClick={() => { const n = monthlyNeighbors(jy, jm, -1); setMonth(n.jy, n.jm); }}
          >
            <ChevronRight size={17} />
          </button>
          <MonthPicker jy={jy} jm={jm} onPick={setMonth} />
          <button
            className="btn-secondary !px-2.5"
            title="ماه بعد"
            aria-label="ماه بعد"
            onClick={() => { const n = monthlyNeighbors(jy, jm, 1); setMonth(n.jy, n.jm); }}
          >
            <ChevronLeft size={17} />
          </button>
        </div>
      </div>

      <TrendCharts tz={tz} />

      {monthly.data && monthly.data.total_minutes === 0 && monthly.data.completed.length === 0 ? (
        <EmptyState
          icon={<BarChart3 size={36} />}
          title={`${faMonth(jy, jm)} داده‌ای ندارد`}
          hint="با ثبت زمان در صفحه‌ی ثبت زمان، گزارش‌ها ساخته می‌شوند."
          action={
            <button className="btn-secondary mt-2" onClick={() => { const n = monthlyNeighbors(jy, jm, -1); setMonth(n.jy, n.jm); }}>
              ماه قبل
            </button>
          }
        />
      ) : (
        monthly.data && (
          <>
            <SummaryCards data={monthly.data} />
            <TimePie data={monthly.data} projectColors={projectColors} />
            {monthly.data.weeks.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-bold text-slate-500">هفته‌ها (اسپرینت‌ها)</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {monthly.data.weeks.map((w) => (
                    <button
                      key={w.sprint_id}
                      className="card flex items-center justify-between p-3.5 text-start transition hover:border-indigo-300"
                      onClick={() => setParams({ sprint: w.sprint_id })}
                    >
                      <span>
                        <span className="block text-sm font-semibold">{w.name}</span>
                        {w.status === "closed" ? (
                          <span className="chip mt-1 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">آرشیو</span>
                        ) : (
                          <span className="chip mt-1 bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300">جاری</span>
                        )}
                      </span>
                      <span className="tnum text-sm font-bold">{fmtDuration(w.minutes)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <AreaProjectTable data={monthly.data} />
            <EstimateSection data={monthly.data} />
            <TaskBreakdown data={monthly.data} />
            <CompletedList data={monthly.data} />
          </>
        )
      )}
    </main>
  );
}

function utcToParts(iso: string, tz: string) {
  const p = utcToZonedParts(new Date(iso), tz);
  return { y: p.y, m: p.m, d: p.d };
}

// ---------------- Trend charts (last 8 sprints) ----------------

function TrendCharts({ tz }: { tz: string }) {
  const { data } = useQuery({
    queryKey: ["trends"],
    queryFn: () => api<TrendData>("/v1/reports/trends"),
  });
  const weeks = data?.weeks ?? [];
  if (weeks.length === 0) return null;

  const maxVal = Math.max(
    ...weeks.map((w) => Math.max(w.total_minutes, w.estimate_minutes)),
    1
  );
  const chartH = 140;

  const legend: { key: string; name: string; color: string }[] = [];
  const seen = new Set<string>();
  for (const w of weeks)
    for (const a of w.areas) {
      const k = a.area_id ?? a.name;
      if (!seen.has(k)) {
        seen.add(k);
        legend.push({ key: k, name: a.name, color: a.color });
      }
    }

  // estimate-accuracy verdict: compare avg |logged - estimate| of the older
  // half vs the newer half (only weeks with an estimate).
  const scored = weeks.filter((w) => w.estimate_minutes > 0);
  let verdict: string | null = null;
  if (scored.length >= 4) {
    const half = Math.floor(scored.length / 2);
    const avg = (arr: typeof scored) =>
      arr.reduce((s, w) => s + Math.abs(w.total_minutes - w.estimate_minutes), 0) / arr.length;
    const oldAvg = avg(scored.slice(0, half));
    const newAvg = avg(scored.slice(half));
    if (newAvg < oldAvg * 0.9) verdict = "دقت برآوردهایت در حال بهبود است 👌";
    else if (newAvg > oldAvg * 1.1) verdict = "دقت برآوردهایت افت کرده — شاید تسک‌ها را بزرگ‌تر برآورد کنی.";
  }

  return (
    <div className="card p-5">
      <h3 className="mb-1 font-bold">روند ۸ هفتهٔ اخیر</h3>
      <p className="mb-4 text-xs text-slate-400">
        میله‌ها = ساعات ثبت‌شده هر هفته (رنگ‌ها = حوزه‌ها) · خط‌چین = برآورد همان هفته
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {weeks.map((w) => {
          const startParts = utcToZonedParts(new Date(w.start_at), tz);
          const delta = w.total_minutes - w.estimate_minutes;
          return (
            <div key={w.sprint_id} className="flex min-w-[52px] flex-1 flex-col items-center gap-1">
              <div className="relative flex w-full items-end justify-center" style={{ height: chartH }}>
                {w.estimate_minutes > 0 && (
                  <div
                    className="absolute inset-x-0 z-10 border-t-2 border-dashed border-slate-400/80"
                    style={{ bottom: `${(w.estimate_minutes / maxVal) * chartH}px` }}
                    title={`برآورد: ${fmtDuration(w.estimate_minutes)}`}
                  />
                )}
                <div
                  className="flex w-7 flex-col-reverse overflow-hidden rounded-t-md"
                  style={{ height: `${(w.total_minutes / maxVal) * chartH}px` }}
                  title={`ثبت‌شده: ${fmtDuration(w.total_minutes)}`}
                >
                  {w.areas.map((a) => (
                    <div
                      key={a.area_id ?? a.name}
                      style={{
                        height: `${(a.minutes / Math.max(w.total_minutes, 1)) * 100}%`,
                        backgroundColor: a.color,
                      }}
                    />
                  ))}
                </div>
              </div>
              <span className="tnum text-[10px] text-slate-500 dark:text-slate-400">
                {w.total_minutes > 0 ? fmtDuration(w.total_minutes) : "—"}
              </span>
              <span className="text-[10px] text-slate-400">{faDate({ y: startParts.y, m: startParts.m, d: startParts.d }, { withYear: false })}</span>
              {w.estimate_minutes > 0 && delta !== 0 && new Date(w.end_at).getTime() < Date.now() ? (
                <span className={`tnum text-[10px] font-semibold ${delta > 0 ? "text-red-500" : "text-emerald-500"}`}>
                  {delta > 0 ? "+" : "−"}
                  {fmtDuration(Math.abs(delta))}
                </span>
              ) : (
                <span className="text-[10px]"> </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {legend.map((l) => (
          <span key={l.key} className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: l.color }} />
            {l.name}
          </span>
        ))}
        <span className="flex items-center gap-1 text-slate-400">
          <span className="inline-block w-4 border-t-2 border-dashed border-slate-400" />
          برآورد
        </span>
      </div>
      {verdict && (
        <div className="mt-3 rounded-xl bg-indigo-50 px-3 py-2 text-xs text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
          {verdict}
        </div>
      )}
    </div>
  );
}
