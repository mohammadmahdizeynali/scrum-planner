export interface User {
  id: string;
  username: string;
  display_name: string;
  timezone: string;
  theme: "light" | "dark" | "system";
  role: string;
}

export interface Tag {
  id: string;
  name: string;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  sort_order: number;
}

export interface Area {
  id: string;
  name: string;
  color: string;
  billable_default: boolean;
  sort_order: number;
  project_count: number;
  task_count: number;
}

export interface Project {
  id: string;
  area_id: string;
  name: string;
  color: string | null;
  sort_order: number;
  task_count: number;
}

export interface DeletePreview {
  projects: number;
  tasks: number;
  time_entries: number;
  logged_minutes: number;
}

export interface Task {
  id: string;
  title: string;
  status: "backlog" | "open" | "in_progress" | "closed";
  priority: "high" | "medium" | "low";
  estimate_minutes: number | null;
  logged_minutes: number;
  due_date: string | null;
  area_id: string | null;
  project_id: string | null;
  area_name: string | null;
  area_color: string | null;
  area_billable_default: boolean | null;
  project_name: string | null;
  active_sprint_id: string | null;
  tags: Tag[];
  subtask_total: number;
  subtask_done: number;
  sort_order: number;
  updated_at: string;
}

export interface TimeEntryRef {
  id: string;
  task_id: string;
  task_title: string;
  area_color: string | null;
  start_at: string;
  end_at: string;
  minutes: number;
  note: string | null;
  billable: boolean;
}

export interface TaskDetail extends Task {
  description: string;
  notes: string;
  recurrence_rule: RecurrenceRule | null;
  created_at: string;
  closed_at: string | null;
  subtasks: Subtask[];
  memberships: SprintBrief[];
  entries: TimeEntryRef[];
}

export interface SprintBrief {
  sprint_id: string;
  sprint_name: string;
  source: string;
}

export interface RecurrenceRule {
  kind: "every_n_days" | "weekly" | "monthly_jalali";
  n?: number;
  weekdays?: number[];
  day?: number;
}

export interface Sprint {
  id: string;
  name: string;
  start_at: string;
  end_at: string;
  status: "active" | "closed";
  closed_at: string | null;
}

export interface SprintMember {
  source: "manual" | "carry_over";
  task: Task;
}

export interface SprintDetail extends Sprint {
  members: SprintMember[];
  logged_minutes: number;
  billable_minutes: number;
  estimate_minutes: number;
  count_open: number;
  count_in_progress: number;
  count_closed: number;
}

export interface ReportProject {
  project_id: string;
  name: string;
  minutes: number;
  billable_minutes: number;
}

export interface ReportArea {
  area_id: string | null;
  name: string;
  color: string;
  minutes: number;
  billable_minutes: number;
  area_level_minutes: number;
  projects: ReportProject[];
}

export interface ReportTask {
  task_id: string;
  title: string;
  area_name: string | null;
  project_name: string | null;
  minutes: number;
  billable_minutes: number;
  estimate_minutes: number | null;
}

export interface ReportCompleted {
  task_id: string;
  title: string;
  area_name: string | null;
  project_name: string | null;
  closed_at: string | null;
}

export interface EstimateRow {
  project_id: string;
  name: string;
  estimate_minutes: number;
  logged_minutes: number;
}

export interface BaseReport {
  kind: "weekly" | "monthly";
  total_minutes: number;
  billable_minutes: number;
  areas: ReportArea[];
  tasks: ReportTask[];
  completed: ReportCompleted[];
  estimate: {
    projects: EstimateRow[];
    total_estimate_minutes: number;
    total_logged_minutes: number;
  };
}

export interface WeeklyReport extends BaseReport {
  kind: "weekly";
  sprint_id: string;
  sprint_name: string;
  start_at: string;
  end_at: string;
  generated_at: string;
  sprint_status?: string;
}

export interface MonthlyReport extends BaseReport {
  kind: "monthly";
  jy: number;
  jm: number;
  month_label: string;
  start_at: string;
  end_at: string;
  completed_count: number;
  weeks: { sprint_id: string; name: string; status: string; minutes: number; full_overlap: boolean }[];
}

export interface TaskListResponse {
  items: Task[];
  total: number;
}

export interface BackupFile {
  name: string;
  size: number;
}

export interface BackupStatus {
  telegram_configured: boolean;
  github_configured: boolean;
  files: BackupFile[];
}

export interface BackupDelivery {
  channel: string;
  ok: boolean | null;
  detail: string;
}

export interface BackupRunResult {
  name: string;
  size: number;
  trigger: string;
  deliveries: BackupDelivery[];
}
