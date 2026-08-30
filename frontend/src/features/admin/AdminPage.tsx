import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Pencil, Shield, Trash2, UserPlus, Wand2 } from "lucide-react";
import { api, ApiError } from "../../api/client";
import type { AdminUser, User } from "../../api/types";
import {
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  PageSpinner,
  Toggle,
  useToast,
} from "../../components/ui";
import { faDate } from "../../lib/format";
import { utcToZonedParts } from "../../lib/tz";

const TIMEZONES = [
  { value: "Asia/Tehran", label: "تهران (UTC+3:30)" },
  { value: "Asia/Dubai", label: "دبی (UTC+4)" },
  { value: "Europe/Berlin", label: "برلین (UTC+1)" },
  { value: "Europe/London", label: "لندن (UTC+0)" },
  { value: "UTC", label: "UTC" },
];

const ROLE_FA: Record<string, string> = { admin: "مدیر", member: "عضو" };

function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function faCreated(iso: string, tz: string): string {
  const p = utcToZonedParts(new Date(iso), tz);
  return faDate({ y: p.y, m: p.m, d: p.d });
}

function errText(e: unknown): string {
  return e instanceof ApiError ? e.detail : "خطای غیرمنتظره رخ داد.";
}

export default function AdminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("/v1/auth/me"),
    retry: false,
  });
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<AdminUser[]>("/v1/users") });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);

  const remove = useMutation({
    mutationFn: (u: AdminUser) => api(`/v1/users/${u.id}`, { method: "DELETE" }),
    onSuccess: (_, u) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.push(`کاربر «${u.display_name || u.username}» حذف شد.`);
    },
    onError: (e) => toast.push(errText(e), "error"),
  });

  if (meLoading) return <PageSpinner />;
  if (!me) return <Navigate to="/login" replace />;
  if (me.role !== "admin") return <Navigate to="/" replace />;

  const list = users.data ?? [];

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="page-title">مدیریت کاربران</h1>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          <UserPlus size={17} />
          کاربر جدید
        </button>
      </div>

      <div className="flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-[13px] leading-6 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
        <Info size={17} className="mt-0.5 shrink-0" />
        <span>
          هر کاربر پس از ورود، فضای کاری کاملاً جداگانه خودش را دارد؛ داده‌های هر کاربر فقط برای خودش
          قابل مشاهده است و مدیر هم به آن دسترسی ندارد.
        </span>
      </div>

      {users.isLoading ? (
        <PageSpinner />
      ) : list.length === 0 ? (
        <EmptyState icon={<Shield size={26} />} title="کاربری ثبت نشده است" />
      ) : (
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {list.map((u) => (
            <div key={u.id} className="flex items-center gap-3 p-4">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                  u.is_active
                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
                    : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                }`}
              >
                {(u.display_name || u.username).trim().charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-sm font-bold">{u.display_name || u.username}</span>
                  <span className="chip bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {ROLE_FA[u.role] ?? u.role}
                  </span>
                  {!u.is_active && (
                    <span className="chip bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
                      غیرفعال
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
                  <span dir="ltr">{u.username}</span>
                  <span className="tnum">عضویت: {faCreated(u.created_at, me.timezone)}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  className="btn-ghost !p-2"
                  title="ویرایش"
                  onClick={() => setEditing(u)}
                  disabled={remove.isPending}
                >
                  <Pencil size={16} />
                </button>
                {u.id !== me.id && (
                  <button
                    className="btn-ghost !p-2 text-red-600 hover:!bg-red-50 dark:text-red-400 dark:hover:!bg-red-950/40"
                    title="حذف کاربر"
                    onClick={() => setDeleting(u)}
                    disabled={remove.isPending}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={(u) => toast.push(`کاربر «${u.display_name || u.username}» ساخته شد.`)}
        />
      )}
      {editing && (
        <EditUserModal
          key={editing.id}
          user={editing}
          isSelf={editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={() => toast.push("ذخیره شد.")}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={`حذف کاربر «${deleting?.display_name || deleting?.username}»`}
        message="با حذف کاربر، کل فضای کاری او — مسیرها، پروژه‌ها، تسک‌ها، اسپرینت‌ها و زمان‌های ثبت‌شده — برای همیشه حذف می‌شود. این کار برگشت‌پذیر نیست."
        confirmLabel="حذف کاربر"
        danger
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </main>
  );
}

// ---------------- create ----------------

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (u: AdminUser) => void;
}) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [timezone, setTimezone] = useState("Asia/Tehran");
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<AdminUser>("/v1/users", { method: "POST", body }),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
      onCreated(u);
    },
    onError: (e) => setError(errText(e)),
  });

  return (
    <Modal open onClose={onClose} title="کاربر جدید">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          create.mutate({ username, password, display_name: displayName, timezone });
        }}
      >
        <Field label="نام کاربری" hint="حداقل ۳ نویسه، بدون فاصله؛ برای ورود استفاده می‌شود.">
          <input
            className="input"
            dir="ltr"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="sara"
            required
            minLength={3}
          />
        </Field>
        <Field label="نام نمایشی (اختیاری)">
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="سارا"
          />
        </Field>
        <Field label="رمز عبور" hint="حداقل ۸ نویسه؛ کاربر می‌تواند بعداً از تنظیمات عوضش کند.">
          <div className="flex gap-2">
            <input
              className="input"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            <button
              type="button"
              className="btn-secondary shrink-0"
              title="تولید رمز تصادفی"
              onClick={() => setPassword(generatePassword())}
            >
              <Wand2 size={16} />
            </button>
          </div>
        </Field>
        <Field label="منطقه زمانی" hint="مرز هفته‌ها و ماه‌های گزارش‌های او بر این اساس محاسبه می‌شود.">
          <select className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        {error && <p className="text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-start gap-2 pt-1">
          <button className="btn-primary" type="submit" disabled={create.isPending}>
            ایجاد کاربر
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            انصراف
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- edit ----------------

function EditUserModal({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(user.display_name);
  const [timezone, setTimezone] = useState(user.timezone);
  const [isActive, setIsActive] = useState(user.is_active);
  const [newPassword, setPassword] = useState("");
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<AdminUser>(`/v1/users/${user.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      onClose();
      onSaved();
    },
    onError: (e) => setError(errText(e)),
  });

  const body: Record<string, unknown> = {};
  if (displayName !== user.display_name) body.display_name = displayName;
  if (timezone !== user.timezone) body.timezone = timezone;
  if (!isSelf && isActive !== user.is_active) body.is_active = isActive;
  if (newPassword) body.new_password = newPassword;

  return (
    <Modal open onClose={onClose} title={`ویرایش کاربر «${user.display_name || user.username}»`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          save.mutate(body);
        }}
      >
        <Field label="نام نمایشی">
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={user.username}
          />
        </Field>
        <Field label="منطقه زمانی" hint="مرز هفته‌ها و ماه‌های گزارش‌های او بر این اساس محاسبه می‌شود.">
          <select className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
            {!TIMEZONES.some((t) => t.value === timezone) && <option value={timezone}>{timezone}</option>}
          </select>
        </Field>
        {!isSelf && (
          <Field
            label="وضعیت حساب"
            hint="حساب غیرفعال نمی‌تواند وارد شود و نشست‌های بازش بسته می‌شود؛ داده‌هایش حذف نمی‌شود."
          >
            <div className="pt-1">
              <Toggle checked={isActive} onChange={(v) => setIsActive(v)} label="فعال" />
            </div>
          </Field>
        )}
        {!isSelf && (
          <Field
            label="رمز عبور جدید (اختیاری)"
            hint="خالی بگذارید تا رمز عوض نشود؛ با تغییر رمز، نشست‌های کاربر بسته می‌شود."
          >
            <div className="flex gap-2">
              <input
                className="input"
                dir="ltr"
                value={newPassword}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                placeholder="••••••••"
              />
              <button
                type="button"
                className="btn-secondary shrink-0"
                title="تولید رمز تصادفی"
                onClick={() => setPassword(generatePassword())}
              >
                <Wand2 size={16} />
              </button>
            </div>
          </Field>
        )}
        {isSelf && (
          <p className="text-xs leading-5 text-slate-400">
            برای تغییر رمز یا پوستهٔ حساب خودتان از صفحهٔ تنظیمات استفاده کنید.
          </p>
        )}
        {error && <p className="text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-start gap-2 pt-1">
          <button className="btn-primary" type="submit" disabled={save.isPending}>
            ذخیره
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            انصراف
          </button>
        </div>
      </form>
    </Modal>
  );
}
