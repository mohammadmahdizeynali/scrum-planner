import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { api } from "../../api/client";
import type { Task, TimeEntryRef } from "../../api/types";
import { Modal, Spinner, Toggle, useToast } from "../../components/ui";
import { clockOf, faDate, faDateRange, fmtDuration, minutesOfClock, toFa, WEEKDAYS_FA } from "../../lib/format";
import {
  addDaysToParts,
  sameDay,
  utcToZonedParts,
  weekDayParts,
  zonedPartsToUtc,
  zonedWeekStart,
  ymdOf,
} from "../../lib/tz";

const HOUR_PX = 60;
const SNAP = 15;
const GRID_HEIGHT = 24 * HOUR_PX;

interface DayInfo {
  parts: { y: number; m: number; d: number };
  iso: string;
}

interface PlacedEntry extends TimeEntryRef {
  dayIndex: number;
  startMin: number;
}

interface DragState {
  mode: "create" | "move" | "resize-top" | "resize-bottom";
  dayIndex: number;
  startMin: number;
  endMin: number;
  entryId?: string;
  moved: boolean;
}

function snapMin(v: number): number {
  return Math.max(0, Math.min(1440, Math.round(v / SNAP) * SNAP));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export default function TimesheetPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ timezone: string }>("/v1/auth/me"),
    staleTime: 60_000,
  });
  const tz = me?.timezone ?? "Asia/Tehran";

  // Week state: UTC instant of Saturday 00:00 in tz.
  const [weekStart, setWeekStart] = useState<Date | null>(null);
  useEffect(() => {
    const wParam = params.get("week");
    if (!weekStart) {
      let base = new Date();
      if (wParam) {
        const [y, m, d] = wParam.split("-").map(Number);
        base = zonedPartsToUtc(y, m, d, 12, 0, tz); // noon → unambiguous week
      }
      setWeekStart(zonedWeekStart(base, tz));
    }
  }, [weekStart, tz, params]);

  const days: DayInfo[] = useMemo(() => {
    if (!weekStart) return [];
    const sat = utcToZonedParts(weekStart, tz);
    const satParts = { y: sat.y, m: sat.m, d: sat.d };
    return Array.from({ length: 7 }, (_, i) => {
      const parts = addDaysToParts(satParts, i);
      return { parts, iso: ymdOf(parts) };
    });
  }, [weekStart, tz]);

  const startIso = weekStart ? weekStart.toISOString() : "";
  const endIso = weekStart ? new Date(weekStart.getTime() + 7 * 86400000).toISOString() : "";

  const { data: entries, isLoading } = useQuery({
    queryKey: ["entries", startIso, tz],
    queryFn: () =>
      api<TimeEntryRef[]>("/v1/time-entries", {
        params: { start: startIso, end: endIso },
      }),
    enabled: !!weekStart,
  });

  const navWeek = (delta: number) => {
    if (!weekStart) return;
    const next = new Date(weekStart.getTime() + delta * 7 * 86400000);
    setWeekStart(next);
    const p = utcToZonedParts(next, tz);
    setParams({ week: `${p.y}-${pad2(p.m)}-${pad2(p.d)}` }, { replace: true });
  };
  const goToday = () => {
    const next = zonedWeekStart(new Date(), tz);
    setWeekStart(next);
    setParams({}, { replace: true });
  };

  // ---------- layout computation ----------
  const placed: PlacedEntry[] = useMemo(() => {
    if (!entries || !days.length) return [];
    const out: PlacedEntry[] = [];
    for (const e of entries) {
      const p = utcToZonedParts(new Date(e.start_at), tz);
      const idx = days.findIndex((d) => sameDay(d.parts, p));
      if (idx >= 0) out.push({ ...e, dayIndex: idx, startMin: p.h * 60 + p.min });
    }
    return out;
  }, [entries, days, tz]);

  const lanesByDay = useMemo(() => {
    const map: Record<number, { items: { entry: PlacedEntry; lane: number }[]; laneCount: number }> = {};
    for (let i = 0; i < 7; i++) map[i] = { items: [], laneCount: 0 };
    const sorted = [...placed].sort((a, b) => a.startMin - b.startMin || a.minutes - b.minutes);
    for (let i = 0; i < 7; i++) {
      const dayEntries = sorted.filter((e) => e.dayIndex === i);
      const laneEnds: number[] = [];
      const assign = new Map<string, number>();
      for (const e of dayEntries) {
        let lane = laneEnds.findIndex((end) => end <= e.startMin);
        if (lane === -1) {
          laneEnds.push(e.startMin + e.minutes);
          lane = laneEnds.length - 1;
        } else {
          laneEnds[lane] = e.startMin + e.minutes;
        }
        assign.set(e.id, lane);
      }
      map[i] = { items: dayEntries.map((e) => ({ entry: e, lane: assign.get(e.id) ?? 0 })), laneCount: laneEnds.length };
    }
    return map;
  }, [placed]);

  const dayTotals = useMemo(() => {
    const totals: number[] = Array(7).fill(0);
    for (const e of placed) totals[e.dayIndex] += e.minutes;
    return totals;
  }, [placed]);

  // ---------- drag interaction ----------
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const [modal, setModal] = useState<{ mode: "create" | "edit"; dayIndex: number; startMin: number; endMin: number; entry?: PlacedEntry } | null>(null);
  const rectsRef = useRef<{ cols: DOMRect[]; grid: DOMRect } | null>(null);
  const nowParts = utcToZonedParts(new Date(), tz);
  const todayIndex = days.findIndex((d) => sameDay(d.parts, nowParts));
  const nowMin = nowParts.h * 60 + nowParts.min;

  // Open the grid around the user's working hours on first load.
  const didAutoScroll = useRef(false);
  useEffect(() => {
    if (didAutoScroll.current || !days.length) return;
    didAutoScroll.current = true;
    const target =
      todayIndex >= 0 ? Math.max(0, ((nowMin - 150) / 60) * HOUR_PX) : 7 * HOUR_PX;
    if (scrollRef.current) scrollRef.current.scrollTop = Math.min(target, GRID_HEIGHT - 400);
  }, [days.length, todayIndex, nowMin]);

  const beginPointer = (e: React.PointerEvent, mode: DragState["mode"], entry?: PlacedEntry) => {
    e.stopPropagation();
    e.preventDefault();
    rectsRef.current = {
      cols: colRefs.current.map((c) => c?.getBoundingClientRect() ?? new DOMRect()),
      grid: gridRef.current?.getBoundingClientRect() ?? new DOMRect(),
    };
    const dayIndex = dayIndexFromX(e.clientX);
    const y = e.clientY - (rectsRef.current.cols[dayIndex]?.top ?? 0);
    const m = snapMin((y / HOUR_PX) * 60);
    let st: DragState;
    if (mode === "create") {
      st = { mode, dayIndex, startMin: m, endMin: m + SNAP, moved: false };
    } else if (entry) {
      st =
        mode === "move"
          ? { mode, dayIndex, startMin: entry.startMin, endMin: entry.startMin + entry.minutes, entryId: entry.id, moved: false }
          : mode === "resize-top"
            ? { mode, dayIndex, startMin: entry.startMin, endMin: entry.startMin + entry.minutes, entryId: entry.id, moved: false }
            : { mode: "resize-bottom", dayIndex, startMin: entry.startMin, endMin: entry.startMin + entry.minutes, entryId: entry.id, moved: false };
    } else {
      return;
    }
    setDrag(st);
  };

  function dayIndexFromX(clientX: number): number {
    const rects = rectsRef.current?.cols ?? [];
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (clientX >= r.left && clientX <= r.right) return i;
    }
    // nearest by center distance (RTL order preserved: index 0 = شنبه = rightmost)
    let best = 0;
    let bestDist = Infinity;
    rects.forEach((r, i) => {
      const d = Math.abs(clientX - (r.left + r.right) / 2);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  useEffect(() => {
    if (!drag) return;
    const onMove = (ev: PointerEvent) => {
      const cur = dragRef.current;
      const rects = rectsRef.current;
      if (!cur || !rects) return;
      const idx = dayIndexFromX(ev.clientX);
      const colRect = rects.cols[idx];
      const raw = ((ev.clientY - (colRect?.top ?? rects.grid.top)) / HOUR_PX) * 60;
      const m = snapMin(raw);
      setDrag((prev) => {
        if (!prev) return prev;
        if (prev.mode === "create") {
          let s = prev.startMin;
          let e2 = Math.max(s + SNAP, m === s ? s + SNAP : m);
          if (m < s) {
            s = Math.max(0, m);
            e2 = prev.startMin + SNAP;
          }
          return { ...prev, startMin: s, endMin: Math.min(1440, e2), moved: true };
        }
        if (prev.mode === "move") {
          const dur = prev.endMin - prev.startMin;
          const newStart = Math.max(0, Math.min(1440 - dur, m));
          const changed = idx !== prev.dayIndex || newStart !== prev.startMin;
          return { ...prev, dayIndex: idx, startMin: newStart, endMin: newStart + dur, moved: prev.moved || changed };
        }
        if (prev.mode === "resize-bottom") {
          return { ...prev, endMin: Math.max(prev.startMin + SNAP, Math.min(1440, m)), moved: true };
        }
        // resize-top
        return { ...prev, startMin: Math.min(prev.endMin - SNAP, Math.max(0, m)), moved: true };
      });
    };
    const onUp = () => {
      const cur = dragRef.current;
      setDrag(null);
      if (!cur) return;
      if (cur.mode === "create") {
        const s = cur.startMin;
        const e2 = cur.endMin <= s ? s + SNAP : cur.endMin;
        setModal({ mode: "create", dayIndex: cur.dayIndex, startMin: s, endMin: Math.min(1440, e2) });
        return;
      }
      if (cur.mode === "move" && !cur.moved && cur.entryId) {
        const orig = placed.find((p) => p.id === cur.entryId);
        if (orig) setModal({ mode: "edit", dayIndex: orig.dayIndex, startMin: orig.startMin, endMin: orig.startMin + orig.minutes, entry: orig });
        return;
      }
      if (cur.entryId) {
        const entry = placed.find((p) => p.id === cur.entryId);
        if (!entry) return;
        if (cur.mode === "move") {
          const dp = days[cur.dayIndex].parts;
          const sameTime = cur.dayIndex === entry.dayIndex && cur.startMin === entry.startMin;
          if (sameTime) return;
          const startUtc = zonedPartsToUtc(dp.y, dp.m, dp.d, Math.floor(cur.startMin / 60), cur.startMin % 60, tz);
          const endUtc = new Date(startUtc.getTime() + entry.minutes * 60000);
          updateEntry.mutate({ id: entry.id, body: { start_at: startUtc.toISOString(), end_at: endUtc.toISOString() } });
        } else if (cur.moved) {
          const dp = days[entry.dayIndex].parts;
          const startUtc = zonedPartsToUtc(dp.y, dp.m, dp.d, Math.floor(cur.startMin / 60), cur.startMin % 60, tz);
          const endUtc = zonedPartsToUtc(dp.y, dp.m, dp.d, Math.floor(cur.endMin / 60), cur.endMin % 60, tz);
          updateEntry.mutate({ id: entry.id, body: { start_at: startUtc.toISOString(), end_at: endUtc.toISOString() } });
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag !== null, days, tz, placed]);

  const updateEntry = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/v1/time-entries/${id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entries"] }),
    onError: (e) => {
      toast.push((e as Error).message, "error");
      qc.invalidateQueries({ queryKey: ["entries"] });
    },
  });

  // ---------- render helpers ----------
  const renderBlock = (e: PlacedEntry, lane: number, laneCount: number, override?: { startMin: number; endMin: number }) => {
    const startMin = override ? override.startMin : e.startMin;
    const endMin = override ? override.endMin : e.startMin + e.minutes;
    const top = (startMin / 60) * HOUR_PX;
    const height = Math.min(Math.max(((endMin - startMin) / 60) * HOUR_PX, 14), GRID_HEIGHT - top);
    const widthPct = 100 / Math.max(laneCount, 1);
    const color = e.area_color ?? "#64748b";
    const overlaps = laneCount > 1;
    return (
      <div
        key={e.id}
        className={`group absolute cursor-grab select-none rounded-xl border text-xs shadow-sm transition-shadow hover:z-20 hover:shadow-md active:cursor-grabbing ${
          overlaps ? "border-amber-400 ring-1 ring-amber-300/60" : "border-white/50 dark:border-slate-900/50"
        } ${drag?.entryId === e.id ? "z-20 opacity-90" : "z-10"}`}
        style={{
          top,
          height,
          width: `calc(${widthPct}% - 4px)`,
          insetInlineStart: `calc(${lane * widthPct}% + 2px)`,
          backgroundColor: `${color}2e`,
          borderInlineStart: `4px solid ${color}`,
          touchAction: "none",
        }}
        onPointerDown={(ev) => {
          const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
          const y = ev.clientY - rect.top;
          const mode = y < 9 ? "resize-top" : y > rect.height - 9 ? "resize-bottom" : "move";
          beginPointer(ev, mode, e);
        }}
      >
        <div className="pointer-events-none flex h-full flex-col overflow-hidden px-2 py-1">
          <span className="truncate text-[13px] font-semibold leading-[18px] text-slate-800 dark:text-slate-100">{e.task_title}</span>
          {height >= 32 && (
            <span className="tnum text-[11px] leading-[16px] text-slate-600 dark:text-slate-300">
              {clockOf(startMin)}–{clockOf(endMin % 1440 || 1440)}
            </span>
          )}
          {height >= 54 && (
            <span className="text-[11px] leading-[16px] text-slate-500 dark:text-slate-400">
              {fmtDuration(e.minutes)}
              {e.billable && <span className="ms-1 opacity-70">· فاکتور</span>}
            </span>
          )}
          {height >= 76 && e.note && <span className="truncate text-[11px] leading-[16px] text-slate-500 dark:text-slate-400">{e.note}</span>}
        </div>
      </div>
    );
  };

  if (!weekStart || days.length === 0) return <Spinner />;

  const weekLabel = `هفته‌ی ${faDateRange(days[0].parts, days[6].parts)}`;

  return (
    <main className="w-full px-3 pb-10 pt-4 md:px-6">
      <div className="mx-auto mb-4 flex max-w-[1700px] flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">تایم‌شیت</h1>
        <div className="flex items-center gap-1.5">
          <button className="btn-secondary !px-2.5" onClick={() => navWeek(-1)} title="هفته قبل">
            <ChevronRight size={17} />
          </button>
          <span className="min-w-[240px] whitespace-nowrap text-center text-base font-extrabold">{weekLabel}</span>
          <button className="btn-secondary !px-2.5" onClick={() => navWeek(1)} title="هفته بعد">
            <ChevronLeft size={17} />
          </button>
          <button className="btn-secondary" onClick={goToday}>
            امروز
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="py-2 text-center">
          <Spinner />
        </div>
      )}

      {/* ===== Desktop week grid ===== */}
      <div className="mx-auto hidden max-w-[1700px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 md:flex">
        {/* day headers */}
        <div className="grid border-b border-slate-200 dark:border-slate-800" style={{ gridTemplateColumns: "64px repeat(7, minmax(0,1fr))" }}>
          <div />
          {days.map((d, i) => (
            <div
              key={d.iso}
              className={`px-2 py-2.5 text-center ${i === todayIndex ? "bg-indigo-50/80 dark:bg-indigo-500/10" : i === 6 ? "bg-slate-50 dark:bg-slate-800/30" : ""}`}
            >
              <div className={`text-[13px] font-bold ${i === todayIndex ? "text-indigo-600 dark:text-indigo-300" : "text-slate-600 dark:text-slate-300"}`}>
                {WEEKDAYS_FA[i]}
                {i === todayIndex && <span className="chip ms-1 bg-indigo-600 !px-1.5 !py-0 text-[10px] text-white">امروز</span>}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">{faDate(d.parts, { withYear: false })}</div>
              <div className="mt-1 flex items-center justify-center gap-1">
                <span
                  className={`tnum rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    dayTotals[i] > 1440
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                      : dayTotals[i] > 0
                        ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        : "text-slate-300 dark:text-slate-600"
                  }`}
                >
                  {dayTotals[i] > 1440 && <AlertTriangle size={10} className="me-0.5 inline" />}
                  {fmtDuration(dayTotals[i])}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div ref={scrollRef} className="max-h-[calc(100vh-235px)] min-h-[520px] overflow-y-auto">
          <div ref={gridRef} className="relative" style={{ height: GRID_HEIGHT }}>
            {/* hour + half-hour guide lines */}
            {Array.from({ length: 24 }, (_, h) => (
              <div key={`h${h}`} className="pointer-events-none absolute inset-x-0 border-t border-slate-200/80 dark:border-slate-700/70" style={{ top: h * HOUR_PX }} />
            ))}
            {Array.from({ length: 24 }, (_, h) => (
              <div key={`hh${h}`} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-100 dark:border-slate-800/50" style={{ top: h * HOUR_PX + HOUR_PX / 2 }} />
            ))}
            <div className="relative grid h-full" style={{ gridTemplateColumns: "64px repeat(7, minmax(0,1fr))" }}>
              <div className="relative border-e border-slate-200 dark:border-slate-700">
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} className="tnum absolute -translate-y-1/2 text-[11px] text-slate-400" style={{ top: h * HOUR_PX, insetInlineEnd: 8 }}>
                    {pad2(h)}:00
                  </span>
                ))}
              </div>
              {days.map((d, i) => (
                <div
                  key={d.iso}
                  ref={(el) => (colRefs.current[i] = el)}
                  className={`relative border-e border-slate-100 last:border-e-0 dark:border-slate-800/70 ${
                    i === todayIndex
                      ? "bg-indigo-50/40 dark:bg-indigo-500/[0.07]"
                      : i === 6
                        ? "bg-slate-50/80 dark:bg-slate-800/20"
                        : ""
                  }`}
                  style={{ touchAction: "none" }}
                  onPointerDown={(ev) => {
                    if (ev.target === ev.currentTarget) beginPointer(ev, "create");
                  }}
                >
                  {i === todayIndex && (
                    <div className="pointer-events-none absolute inset-x-0 z-30" style={{ top: (nowMin / 60) * HOUR_PX }}>
                      <div className="border-t-2 border-red-500/80" />
                      <span className="tnum absolute -top-2.5 start-1 rounded-full bg-red-500 px-1.5 py-px text-[10px] font-bold text-white shadow">
                        {pad2(nowParts.h)}:{pad2(nowParts.min)}
                      </span>
                    </div>
                  )}
                  {(lanesByDay[i]?.items ?? []).map(({ entry, lane }) => {
                    const laneCount = lanesByDay[i]?.laneCount ?? 1;
                    const isDragged = drag?.entryId === entry.id && drag.moved;
                    const override = isDragged && drag ? { startMin: drag.startMin, endMin: drag.endMin } : undefined;
                    return renderBlock(entry, lane, laneCount, override);
                  })}
                  {drag?.mode === "create" && drag.dayIndex === i && (
                    <div
                      className="pointer-events-none absolute inset-x-1 z-30 rounded-xl border-2 border-dashed border-indigo-500 bg-indigo-500/15"
                      style={{ top: (drag.startMin / 60) * HOUR_PX, height: Math.max(((drag.endMin - drag.startMin) / 60) * HOUR_PX, 10) }}
                    >
                      <span className="tnum absolute -top-5 start-0 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] text-white">
                        {clockOf(drag.startMin)}–{clockOf(drag.endMin)}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-slate-200 px-4 py-1.5 text-[11px] text-slate-400 dark:border-slate-800">
          برای ثبت زمان روی خانه‌های خالی بکشید · برای جابه‌جایی بلوک را بگیرید · لبه بالا/پایین = تغییر مدت · کلیک = ویرایش
        </div>
      </div>

      {/* ===== Mobile day view ===== */}
      <MobileDayView
        days={days}
        todayIndex={todayIndex}
        placed={placed}
        onOpenEntry={(e) => setModal({ mode: "edit", dayIndex: e.dayIndex, startMin: e.startMin, endMin: e.startMin + e.minutes, entry: e })}
        onCreate={() => {
          const idx = todayIndex >= 0 ? todayIndex : 0;
          const rounded = Math.ceil(nowMin / 60) * 60;
          setModal({ mode: "create", dayIndex: idx, startMin: Math.min(1380, rounded), endMin: Math.min(1440, rounded + 60) });
        }}
      />

      {modal && (
        <EntryModal
          tz={tz}
          days={days}
          initial={modal}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            qc.invalidateQueries({ queryKey: ["entries"] });
            qc.invalidateQueries({ queryKey: ["tasks"] });
            qc.invalidateQueries({ queryKey: ["sprint"] });
          }}
        />
      )}
    </main>
  );
}

// ---------------- Mobile ----------------

function MobileDayView({
  days,
  todayIndex,
  placed,
  onOpenEntry,
  onCreate,
}: {
  days: DayInfo[];
  todayIndex: number;
  placed: PlacedEntry[];
  onOpenEntry: (e: PlacedEntry) => void;
  onCreate: () => void;
}) {
  const [sel, setSel] = useState(todayIndex >= 0 ? todayIndex : 0);
  useEffect(() => {
    if (todayIndex >= 0) setSel(todayIndex);
  }, [todayIndex]);
  const dayEntries = placed.filter((e) => e.dayIndex === sel).sort((a, b) => a.startMin - b.startMin);
  const total = dayEntries.reduce((s, e) => s + e.minutes, 0);

  return (
    <div className="md:hidden">
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        {days.map((d, i) => (
          <button
            key={d.iso}
            onClick={() => setSel(i)}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
              i === sel ? "bg-indigo-600 text-white" : "bg-white text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300"
            }`}
          >
            {WEEKDAYS_FA[i].slice(0, 3)}
            <span className="ms-1 opacity-70">{toFa(days[i].parts.d)}</span>
          </button>
        ))}
      </div>
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-bold">{faDate(days[sel].parts, { withWeekday: true })}</div>
          <div className="tnum text-xs text-slate-500">{fmtDuration(total)}</div>
        </div>
        <div className="space-y-2">
          {dayEntries.map((e) => (
            <button
              key={e.id}
              className="flex w-full items-center gap-2 rounded-xl border border-slate-200 p-3 text-start dark:border-slate-700"
              onClick={() => onOpenEntry(e)}
            >
              <span className="h-8 w-1.5 rounded-full" style={{ backgroundColor: e.area_color ?? "#64748b" }} />
              <span className="flex-1">
                <span className="block text-sm font-semibold">{e.task_title}</span>
                <span className="tnum block text-xs text-slate-500">
                  {clockOf(e.startMin)}–{clockOf(e.startMin + e.minutes)}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
              </span>
              <span className="tnum text-xs text-slate-400">{fmtDuration(e.minutes)}</span>
            </button>
          ))}
          {dayEntries.length === 0 && <div className="py-8 text-center text-sm text-slate-400">این روز خالی است.</div>}
        </div>
      </div>
      <button
        className="fixed bottom-20 end-4 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-xl md:hidden"
        onClick={onCreate}
        aria-label="ثبت زمان"
      >
        <Plus size={24} />
      </button>
    </div>
  );
}

// ---------------- Entry modal ----------------

function EntryModal({
  tz,
  days,
  initial,
  onClose,
  onSaved,
}: {
  tz: string;
  days: DayInfo[];
  initial: { mode: "create" | "edit"; dayIndex: number; startMin: number; endMin: number; entry?: PlacedEntry };
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [taskId, setTaskId] = useState(initial.entry?.task_id ?? "");
  const [startMin, setStartMin] = useState(initial.startMin);
  const [endMin, setEndMin] = useState(initial.endMin);
  const [note, setNote] = useState(initial.entry?.note ?? "");
  const [billable, setBillable] = useState<boolean>(initial.entry?.billable ?? false);
  const [billableTouched, setBillableTouched] = useState(initial.mode === "edit");
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data: candidates, isFetching } = useQuery({
    queryKey: ["task-pick", debounced],
    queryFn: () => api<{ items: Task[] }>("/v1/tasks", { params: { q: debounced || undefined, limit: 30, sort: "updated" } }),
  });

  const { data: selectedTask } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api<Task>(`/v1/tasks/${taskId}`),
    enabled: !!taskId && initial.mode === "create",
    staleTime: 10_000,
  });

  useEffect(() => {
    if (initial.mode === "create" && selectedTask && !billableTouched) {
      setBillable(selectedTask.area_billable_default ?? false);
    }
  }, [selectedTask?.id]);

  const save = useMutation({
    mutationFn: () => {
      const dp = days[initial.dayIndex].parts;
      const startUtc = zonedPartsToUtc(dp.y, dp.m, dp.d, Math.floor(startMin / 60), startMin % 60, tz);
      const endUtc = zonedPartsToUtc(dp.y, dp.m, dp.d, Math.floor(endMin / 60), endMin % 60, tz);
      if (initial.mode === "create") {
        return api("/v1/time-entries", {
          method: "POST",
          body: { task_id: taskId, start_at: startUtc.toISOString(), end_at: endUtc.toISOString(), note: note || null, billable: billableTouched ? billable : null },
        });
      }
      return api(`/v1/time-entries/${initial.entry!.id}`, {
        method: "PATCH",
        body: {
          task_id: taskId,
          start_at: startUtc.toISOString(),
          end_at: endUtc.toISOString(),
          note: note || null,
          billable,
        },
      });
    },
    onSuccess: () => {
      onSaved();
      toast.push(initial.mode === "create" ? "زمان ثبت شد." : "ثبت زمان به‌روزرسانی شد.");
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const remove = useMutation({
    mutationFn: () => api(`/v1/time-entries/${initial.entry!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      onSaved();
      toast.push("ثبت زمان حذف شد.");
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const selected = candidates?.items.find((t) => t.id === taskId);
  const duration = Math.max(0, endMin - startMin);

  return (
    <Modal open onClose={onClose} title={initial.mode === "create" ? "ثبت زمان" : "ویرایش زمان"}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-xl bg-slate-100 p-2.5 text-sm dark:bg-slate-800">
          <CalendarDays size={16} className="text-slate-400" />
          <span className="font-semibold">{faDate(days[initial.dayIndex].parts, { withWeekday: true })}</span>
          <span className="ms-auto flex items-center gap-1.5">
            <input
              type="time"
              step={900}
              className="input tnum !w-24 !py-1.5"
              value={clockOf(startMin)}
              onChange={(e) => {
                const m = minutesOfClock(e.target.value);
                setStartMin(m);
                if (endMin <= m) setEndMin(Math.min(1440, m + SNAP));
              }}
            />
            <span className="text-slate-400">تا</span>
            <input
              type="time"
              step={900}
              className="input tnum !w-24 !py-1.5"
              value={clockOf(endMin % 1440 || 1440)}
              onChange={(e) => setEndMin(Math.max(startMin + SNAP, minutesOfClock(e.target.value)))}
            />
            <span className="tnum w-16 text-end text-xs text-slate-500">{fmtDuration(duration)}</span>
          </span>
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500">تسک</span>
          {initial.mode === "edit" && selected && (
            <div className="mb-1.5 flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-sm dark:bg-indigo-500/10">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: selected.area_color ?? "#64748b" }} />
              <span className="font-semibold">{selected.title}</span>
            </div>
          )}
          {(!selected || initial.mode === "create") && (
            <>
              <input className="input" placeholder="جستجوی تسک…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              {isFetching && <Spinner className="mt-2" />}
              <div className="mt-1.5 max-h-52 space-y-1 overflow-y-auto">
                {(candidates?.items ?? []).map((t) => (
                  <button
                    key={t.id}
                    className={`flex w-full items-center gap-2 rounded-lg border p-2 text-start text-sm transition ${
                      t.id === taskId
                        ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15"
                        : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                    }`}
                    onClick={() => {
                      setTaskId(t.id);
                      setQ("");
                      if (!billableTouched) setBillable(t.area_billable_default ?? false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                    <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                      {t.project_name ?? t.area_name ?? "مستقل"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <input className="input" placeholder="یادداشت (اختیاری) — مثلا: تمرین فصل ۳" value={note} onChange={(e) => setNote(e.target.value)} />
        <Toggle
          checked={billable}
          onChange={(v) => {
            setBillable(v);
            setBillableTouched(true);
          }}
          label="قابل‌صدور فاکتور"
        />

        <div className="flex items-center justify-between pt-1">
          {initial.mode === "edit" ? (
            <button className="text-sm text-red-500 hover:text-red-600" onClick={() => setDeleteOpen(true)}>
              حذف ثبت
            </button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>
              انصراف
            </button>
            <button className="btn-primary" disabled={!taskId || save.isPending || duration < 5} onClick={() => save.mutate()}>
              ذخیره
            </button>
          </span>
        </div>
      </div>
      {deleteOpen && (
        <Modal open onClose={() => setDeleteOpen(false)} title="حذف ثبت زمان">
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">این ثبت زمان حذف می‌شود. مطمئن هستید؟</p>
          <div className="flex gap-2">
            <button
              className="btn-danger"
              onClick={() => {
                remove.mutate();
                setDeleteOpen(false);
              }}
            >
              حذف
            </button>
            <button className="btn-secondary" onClick={() => setDeleteOpen(false)}>
              انصراف
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
