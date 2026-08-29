import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarCheck2,
  CalendarDays,
  ListTodo,
  LogOut,
  Moon,
  Boxes,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { api } from "../api/client";
import type { User } from "../api/types";
import { cn } from "./ui";

const NAV = [
  { to: "/", label: "اسپرینت", icon: CalendarCheck2 },
  { to: "/timesheet", label: "تایم‌شیت", icon: CalendarDays },
  { to: "/reports", label: "گزارش‌ها", icon: BarChart3 },
  { to: "/tasks", label: "انبار", icon: ListTodo },
  { to: "/areas", label: "حوزه‌ها", icon: Boxes },
];

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("/v1/auth/me"),
    retry: false,
  });
}

function applyTheme(theme: string) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export default function AppShell() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (me) applyTheme(me.theme);
  }, [me?.theme]);

  const setTheme = (theme: User["theme"]) => {
    applyTheme(theme);
    qc.setQueryData(["me"], (old: User | undefined) => (old ? { ...old, theme } : old));
    api("/v1/users/me", { method: "PATCH", body: { theme } }).catch(() => {});
  };

  const logout = useMutation({
    mutationFn: () => api("/v1/auth/logout", { method: "POST" }),
    onSuccess: () => {
      qc.clear();
      navigate("/login");
    },
  });

  const cycleTheme = () => {
    const order: User["theme"][] = ["light", "dark", "system"];
    const idx = order.indexOf(me?.theme ?? "system");
    setTheme(order[(idx + 1) % 3]);
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (right in RTL) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-lg shadow-indigo-600/25">
            <CalendarCheck2 size={20} />
          </div>
          <div className="text-lg font-extrabold">برنامه‌ریز</div>
        </div>

        <form
          className="relative mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (search.trim()) navigate(`/tasks?q=${encodeURIComponent(search.trim())}`);
          }}
        >
          <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input !ps-9"
            placeholder="جستجو…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-colors",
                  isActive
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                    : "text-slate-500 hover:bg-slate-100/80 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-200"
                )
              }
            >
              <item.icon size={19} className={cn("shrink-0", "transition-colors")} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200/80 pt-3 dark:border-slate-800">
          <div className="mb-1 flex items-center gap-2.5 px-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-extrabold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
              {(me?.display_name || me?.username || "؟").trim().charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold">{me?.display_name || me?.username}</div>
              <div className="truncate text-[11px] text-slate-400">{me?.username}</div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-0.5">
            <button className="btn-ghost !p-2" onClick={cycleTheme} title="تغییر پوسته">
              {me?.theme === "dark" ? <Moon size={17} /> : <Sun size={17} />}
            </button>
            <NavLink to="/settings" className="btn-ghost !p-2" title="تنظیمات">
              <Settings size={17} />
            </NavLink>
            <button className="btn-ghost !p-2" onClick={() => logout.mutate()} title="خروج">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        <Outlet />
        {/* Mobile bottom nav */}
        <nav
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200/80 bg-white/90 backdrop-blur-lg dark:border-slate-800 dark:bg-slate-900/90 md:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold",
                  isActive ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"
                )
              }
            >
              <item.icon size={20} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

export { applyTheme };
