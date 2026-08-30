import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import AppShell, { useMe } from "./components/AppShell";
import { PageSpinner } from "./components/ui";
import LoginPage from "./features/auth/LoginPage";
import SprintPage from "./features/sprint/SprintPage";
import TimesheetPage from "./features/timesheet/TimesheetPage";
import ReportsPage from "./features/reports/ReportsPage";
import AllTasksPage from "./features/tasks/AllTasksPage";
import AreasPage from "./features/areas/AreasPage";
import SettingsPage from "./features/settings/SettingsPage";
import AdminPage from "./features/admin/AdminPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { data, isLoading, error } = useMe();
  const location = useLocation();
  if (isLoading) return <PageSpinner />;
  if (error || !data) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<SprintPage />} />
        <Route path="/timesheet" element={<TimesheetPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/tasks" element={<AllTasksPage />} />
        <Route path="/areas" element={<AreasPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
