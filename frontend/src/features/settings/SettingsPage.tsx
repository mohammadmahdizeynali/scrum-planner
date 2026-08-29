import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, KeyRound } from "lucide-react";
import { api, ApiError } from "../../api/client";
import type { BackupRunResult, BackupStatus, User } from "../../api/types";
import { Field, useToast } from "../../components/ui";

const TIMEZONES = [
  { value: "Asia/Tehran", label: "تهران (UTC+3:30)" },
  { value: "Asia/Dubai", label: "دبی (UTC+4)" },
  { value: "Europe/Berlin", label: "برلین (UTC+1)" },
  { value: "Europe/London", label: "لندن (UTC+0)" },
  { value: "UTC", label: "UTC" },
];

const CHANNEL_FA: Record<string, string> = { telegram: "تلگرام", github: "گیت‌هاب" };

function fmtSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api<User>("/v1/auth/me") });
  const [displayName, setDisplayName] = useState(me?.display_name ?? "");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwError, setPwError] = useState("");

  const saveProfile = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/v1/users/me", { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.push("ذخیره شد.");
    },
    onError: (e) => toast.push((e as Error).message, "error"),
  });

  const changePassword = useMutation({
    mutationFn: () => api("/v1/users/me/password", { method: "PUT", body: { current_password: pw.current, new_password: pw.next } }),
    onSuccess: () => {
      toast.push("رمز عبور تغییر کرد.");
      setPw({ current: "", next: "", confirm: "" });
    },
    onError: (e) => setPwError(e instanceof ApiError ? e.detail : "خطا"),
  });

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <h1 className="page-title">تنظیمات</h1>

      <div className="card space-y-3 p-5">
        <h2 className="font-bold">پروفایل</h2>
        <Field label="نام نمایشی">
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={me?.username} />
        </Field>
        <Field label="منطقه زمانی" hint="مرز هفته‌ها و ماه‌های گزارش‌ها بر این اساس محاسبه می‌شود.">
          <select className="input" value={me?.timezone ?? "Asia/Tehran"} onChange={(e) => saveProfile.mutate({ timezone: e.target.value })}>
            {TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
            {me && !TIMEZONES.some((t) => t.value === me.timezone) && (
              <option value={me.timezone}>{me.timezone}</option>
            )}
          </select>
        </Field>
        <Field label="پوسته">
          <div className="flex gap-2">
            {([["light", "روشن"], ["dark", "تیره"], ["system", "سیستم"]] as const).map(([v, label]) => (
              <button
                key={v}
                className={`chip cursor-pointer px-3 py-1.5 ${(me?.theme ?? "system") === v ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
                onClick={() => saveProfile.mutate({ theme: v })}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
        <button className="btn-primary" onClick={() => saveProfile.mutate({ display_name: displayName })}>
          ذخیره پروفایل
        </button>
      </div>

      <div className="card space-y-3 p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <KeyRound size={17} />
          تغییر رمز عبور
        </h2>
        <Field label="رمز فعلی">
          <input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
        </Field>
        <Field label="رمز جدید (حداقل ۸ نویسه)">
          <input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
        </Field>
        <Field label="تکرار رمز جدید">
          <input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />
        </Field>
        {pwError && <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{pwError}</div>}
        <button
          className="btn-primary"
          disabled={!pw.current || pw.next.length < 8 || pw.next !== pw.confirm || changePassword.isPending}
          onClick={() => {
            setPwError("");
            changePassword.mutate();
          }}
        >
          تغییر رمز
        </button>
      </div>

      <BackupCard />

      <div className="card p-5 text-sm text-slate-500 dark:text-slate-400">
        <h2 className="mb-1 font-bold text-slate-700 dark:text-slate-200">درباره</h2>
        <p>برنامه‌ریز شخصی — نسخه ۰.۱ · تقویم شمسی · راست‌به‌چپ</p>
      </div>
    </main>
  );
}

function BackupCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: status } = useQuery({
    queryKey: ["backup-status"],
    queryFn: () => api<BackupStatus>("/v1/backup/status"),
  });

  const run = useMutation({
    mutationFn: () => api<BackupRunResult>("/v1/backup/run", { method: "POST" }),
    onSuccess: async (res) => {
      qc.invalidateQueries({ queryKey: ["backup-status"] });
      const sent = res.deliveries.filter((d) => d.ok === true).map((d) => CHANNEL_FA[d.channel] ?? d.channel);
      const failed = res.deliveries.find((d) => d.ok === false);
      if (sent.length) toast.push(`پشتیبان به ${sent.join(" و ")} ارسال شد.`);
      else if (failed) toast.push(`پشتیبان ساخته شد اما ارسال ناموفق بود: ${failed.detail}`, "error");
      else toast.push("پشتیبان ساخته شد؛ هیچ کانال ارسالی تنظیم نشده است.");
      // offer the ZIP as a local download too
      try {
        const r = await fetch(`/api/v1/backup/download/${res.name}`, { credentials: "same-origin" });
        if (r.ok) {
          const blob = await r.blob();
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = res.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(a.href);
        }
      } catch {
        /* download is a bonus; the backup itself succeeded */
      }
    },
    onError: (e) => toast.push(e instanceof ApiError ? e.detail : "خطا در ساخت پشتیبان", "error"),
  });

  return (
    <div className="card space-y-3 p-5">
      <h2 className="flex items-center gap-2 font-bold">
        <DatabaseBackup size={18} />
        پشتیبان‌گیری
      </h2>
      <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
        هر <b>شنبه ساعت ۲:۰۰ بامداد</b> یک فایل ZIP (شامل دیتابیس، تنظیمات و فایل‌های اجرایی)
        ساخته و ارسال می‌شود. با دکمه زیر هم می‌توانید همین لحظه پشتیبان بگیرید.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`chip ${status?.telegram_configured ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
          تلگرام: {status?.telegram_configured ? "فعال" : "غیرفعال"}
        </span>
        <span className={`chip ${status?.github_configured ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
          گیت‌هاب: {status?.github_configured ? "فعال" : "غیرفعال"}
        </span>
        <span className="text-slate-400">کانال‌ها از طریق .env تنظیم می‌شوند</span>
      </div>
      <button className="btn-primary" disabled={run.isPending} onClick={() => run.mutate()}>
        تهیه پشتیبان و ارسال
      </button>
      {(status?.files.length ?? 0) > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium text-slate-500">پشتیبان‌های روی سرور</div>
          <div className="space-y-1">
            {status!.files.map((f) => (
              <a
                key={f.name}
                href={`/api/v1/backup/download/${f.name}`}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-xs transition hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800"
              >
                <span className="tnum">{f.name}</span>
                <span className="tnum text-slate-400">{fmtSize(f.size)}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
