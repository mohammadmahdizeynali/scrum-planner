import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2 } from "lucide-react";
import { api, ApiError } from "../../api/client";
import { Spinner } from "../../components/ui";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/v1/auth/login", { method: "POST", body: { username, password } });
      await qc.invalidateQueries();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "خطا در برقراری ارتباط با سرور");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-indigo-100/70 p-4 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950/40">
      <form onSubmit={submit} className="card w-full max-w-sm p-8 shadow-xl shadow-slate-900/10">
        <div className="mb-7 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-lg shadow-indigo-600/30">
            <CalendarCheck2 size={28} />
          </div>
          <h1 className="text-xl font-extrabold">برنامه‌ریز شخصی</h1>
          <p className="text-xs text-slate-400">برای ادامه وارد شوید</p>
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-slate-500">نام کاربری</span>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-500">رمز عبور</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        )}
        <button className="btn-primary w-full" disabled={loading || !username || !password}>
          {loading ? <Spinner className="h-4 w-4 border-white/40 border-t-white" /> : "ورود"}
        </button>
      </form>
    </div>
  );
}
