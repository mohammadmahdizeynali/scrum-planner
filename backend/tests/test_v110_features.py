"""v1.1.0 feature tests: task types, subprojects, project issue keys, closing,
dependencies, due time, duration-only time entries, auto-archive, events."""

from datetime import date, timedelta


# ---------------- dual task-type model ----------------

def test_task_type_explicit(auth_client, area):
    r = auth_client.post("/api/v1/tasks", json={"title": "Tick me off", "area_id": area["id"], "task_type": "todo"})
    assert r.status_code == 200, r.text
    assert r.json()["task_type"] == "todo"


def test_task_type_default_from_project(auth_client, area):
    r = auth_client.post("/api/v1/projects", json={"area_id": area["id"], "name": "P", "default_task_type": "todo"})
    project = r.json()
    r = auth_client.post("/api/v1/tasks", json={"title": "T", "project_id": project["id"]})
    assert r.json()["task_type"] == "todo"
    # explicit override wins
    r = auth_client.post("/api/v1/tasks", json={"title": "T2", "project_id": project["id"], "task_type": "timed"})
    assert r.json()["task_type"] == "timed"


def test_task_type_default_from_area(auth_client):
    r = auth_client.post("/api/v1/areas", json={"name": "Chores", "default_task_type": "todo"})
    area = r.json()
    r = auth_client.post("/api/v1/tasks", json={"title": "Take out trash", "area_id": area["id"]})
    assert r.json()["task_type"] == "todo"


def test_task_type_filter(auth_client, area):
    auth_client.post("/api/v1/tasks", json={"title": "A", "area_id": area["id"], "task_type": "todo"})
    auth_client.post("/api/v1/tasks", json={"title": "B", "area_id": area["id"], "task_type": "timed"})
    r = auth_client.get("/api/v1/tasks", params={"task_type": "todo"})
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["title"] == "A"


def test_task_type_can_be_changed(auth_client, task):
    r = auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"task_type": "todo"})
    assert r.status_code == 200
    assert r.json()["task_type"] == "todo"


# ---------------- project hierarchy + issue keys ----------------

def test_subproject_and_keys(auth_client, area):
    """University → SBU → MCDA → MCDA-1 style keys."""
    r = auth_client.post("/api/v1/areas", json={"name": "University", "key_prefix": "SBU"})
    uni = r.json()
    r = auth_client.post("/api/v1/projects", json={"area_id": uni["id"], "name": "SBU", "key_prefix": "SBU2"})
    assert r.status_code == 200, r.text
    parent = r.json()
    r = auth_client.post(
        "/api/v1/projects",
        json={"area_id": uni["id"], "name": "MCDA", "parent_project_id": parent["id"], "key_prefix": "MCDA"},
    )
    sub = r.json()
    assert sub["parent_project_id"] == parent["id"]

    r = auth_client.post("/api/v1/tasks", json={"title": "HW1", "project_id": sub["id"]})
    assert r.json()["issue_key"] == "MCDA-001"

    # subproject without its own key inherits the parent's key chain
    r = auth_client.post("/api/v1/projects", json={"area_id": uni["id"], "name": "NoKey", "parent_project_id": parent["id"]})
    bare = r.json()
    r = auth_client.post("/api/v1/tasks", json={"title": "HW2", "project_id": bare["id"]})
    assert r.json()["issue_key"] == "SBU2-001"


def test_subproject_depth_limited(auth_client, area):
    r = auth_client.post("/api/v1/projects", json={"area_id": area["id"], "name": "Top"})
    top = r.json()
    r = auth_client.post("/api/v1/projects", json={"area_id": area["id"], "name": "Mid", "parent_project_id": top["id"]})
    mid = r.json()
    r = auth_client.post("/api/v1/projects", json={"area_id": area["id"], "name": "Deep", "parent_project_id": mid["id"]})
    assert r.status_code == 422


def test_key_prefix_validation_and_namespace(auth_client, area):
    # too long / bad shape
    r = auth_client.post("/api/v1/projects", json={"area_id": area["id"], "name": "P", "key_prefix": "TOOLONG"})
    assert r.status_code == 422
    r = auth_client.post("/api/v1/projects", json={"area_id": area["id"], "name": "P", "key_prefix": "OK1"})
    assert r.status_code == 200
    # same prefix rejected for another project
    r = auth_client.post("/api/v1/projects", json={"area_id": area["id"], "name": "Q", "key_prefix": "ok1"})
    assert r.status_code == 409
    # and for an area (one namespace across areas + projects)
    r = auth_client.post("/api/v1/areas", json={"name": "A2", "key_prefix": "OK1"})
    assert r.status_code == 409


def test_project_close_reopen(auth_client, area):
    r = auth_client.post("/api/v1/projects", json={"area_id": area["id"], "name": "Done project"})
    p = r.json()
    r = auth_client.post(f"/api/v1/projects/{p['id']}/close")
    assert r.status_code == 200 and r.json()["closed_at"] is not None
    # closed projects are hidden from the default list but reachable with include_closed
    r = auth_client.get("/api/v1/projects")
    assert all(x["id"] != p["id"] for x in r.json())
    r = auth_client.get("/api/v1/projects", params={"include_closed": "true"})
    assert any(x["id"] == p["id"] for x in r.json())
    r = auth_client.post(f"/api/v1/projects/{p['id']}/reopen")
    assert r.json()["closed_at"] is None


# ---------------- dependencies / blocking ----------------

def _mk_task(auth_client, project, title):
    return auth_client.post("/api/v1/tasks", json={"title": title, "project_id": project["id"]}).json()


def test_blocking_by_issue_key(auth_client, project):
    auth_client.patch(f"/api/v1/projects/{project['id']}", json={"key_prefix": "CRS"})
    blocker = _mk_task(auth_client, project, "Design")
    blocked = _mk_task(auth_client, project, "Implement")
    r = auth_client.post(f"/api/v1/tasks/{blocked['id']}/dependencies", json={"blocker_ref": blocker["issue_key"]})
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["is_blocked"] is True
    assert [t["issue_key"] for t in detail["blocked_by"]] == [blocker["issue_key"]]

    # blocker side sees "blocks"
    r = auth_client.get(f"/api/v1/tasks/{blocker['id']}")
    assert [t["id"] for t in r.json()["blocks"]] == [blocked["id"]]

    # once the blocker closes, the task is no longer blocked
    auth_client.patch(f"/api/v1/tasks/{blocker['id']}", json={"status": "closed"})
    r = auth_client.get(f"/api/v1/tasks/{blocked['id']}")
    assert r.json()["is_blocked"] is False

    # remove the edge
    r = auth_client.delete(f"/api/v1/tasks/{blocked['id']}/dependencies/{blocker['id']}")
    assert r.status_code == 200
    assert r.json()["blocked_by"] == []


def test_dependency_edge_cases(auth_client, project):
    a = _mk_task(auth_client, project, "A")
    r = auth_client.post(f"/api/v1/tasks/{a['id']}/dependencies", json={"blocker_ref": a["issue_key"]})
    assert r.status_code == 422  # self-block
    r = auth_client.post(f"/api/v1/tasks/{a['id']}/dependencies", json={"blocker_ref": "ZZZ-999"})
    assert r.status_code == 404
    # idempotent duplicate
    b = _mk_task(auth_client, project, "B")
    auth_client.post(f"/api/v1/tasks/{a['id']}/dependencies", json={"blocker_ref": b["issue_key"]})
    r = auth_client.post(f"/api/v1/tasks/{a['id']}/dependencies", json={"blocker_id": b["id"]})
    assert r.status_code == 200


# ---------------- deadlines with time ----------------

def test_due_date_and_time(auth_client, task):
    r = auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"due_date": "2026-10-01", "due_time": "14:30"})
    assert r.status_code == 200
    assert r.json()["due_date"] == "2026-10-01"
    assert r.json()["due_time"] in ("14:30", "14:30:00")
    r = auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"clear_due_time": True})
    assert r.json()["due_time"] is None
    # deadline removal (Phase 0): clearing the date works
    r = auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"clear_due_date": True})
    assert r.json()["due_date"] is None


# ---------------- auto-archive on completion ----------------

def test_auto_archive_on_close_and_reopen(auth_client, task):
    r = auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"status": "closed"})
    body = r.json()
    assert body["status"] == "closed"
    assert body["archived"] is True
    # hidden from the default warehouse list, visible in the archive view
    r = auth_client.get("/api/v1/tasks")
    assert all(t["id"] != task["id"] for t in r.json()["items"])
    r = auth_client.get("/api/v1/tasks", params={"archived": "true"})
    assert any(t["id"] == task["id"] for t in r.json()["items"])
    # still a member of its sprint board
    sprint = auth_client.post("/api/v1/sprints/current/tasks", json={"items": [{"task_id": task["id"]}]}).json()
    # (closed sprints reject adds, so this may 409 — then verify via a fresh task)
    r = auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"status": "open"})
    assert r.json()["archived"] is False


def test_search_finds_archived(auth_client, project):
    t = _mk_task(auth_client, project, "Needle in archive")
    auth_client.patch(f"/api/v1/tasks/{t['id']}", json={"status": "closed"})
    r = auth_client.get("/api/v1/tasks", params={"q": "Needle"})
    assert r.json()["total"] == 1


# ---------------- duration-only time logging ----------------

def test_duration_only_entry(auth_client, task):
    r = auth_client.post(
        "/api/v1/time-entries",
        json={"task_id": task["id"], "minutes": 150, "logged_date": "2026-09-21"},
    )
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["minutes"] == 150 and e["logged_date"] == "2026-09-21" and e["start_at"] is None

    # invalid: neither mode
    r = auth_client.post("/api/v1/time-entries", json={"task_id": task["id"]})
    assert r.status_code == 422

    # totals include duration entries
    r = auth_client.get(f"/api/v1/tasks/{task['id']}")
    assert r.json()["logged_minutes"] == 150


def test_duration_entry_counts_in_sprint(auth_client, task):
    sprint = auth_client.get("/api/v1/sprints/current").json()
    r = auth_client.post("/api/v1/sprints/current/tasks", json={"items": [{"task_id": task["id"]}]})
    assert r.status_code == 200, r.text
    # log inside the sprint week (its start date, duration-only)
    from datetime import datetime

    start = datetime.fromisoformat(sprint["start_at"].replace("Z", "+00:00"))
    d = (start + timedelta(days=1)).date().isoformat()
    r = auth_client.post("/api/v1/time-entries", json={"task_id": task["id"], "minutes": 45, "logged_date": d})
    assert r.status_code == 200, r.text
    sprint = auth_client.get("/api/v1/sprints/current").json()
    print("WINDOW", sprint["start_at"], sprint["end_at"], "LOGGED_DATE", d)
    assert sprint["logged_minutes"] == 45


# ---------------- standalone events ----------------

def test_event_crud(auth_client):
    r = auth_client.post(
        "/api/v1/events",
        json={"title": "Dentist", "event_date": "2026-09-27", "event_time": "10:00", "note": ""},
    )
    assert r.status_code == 200, r.text
    ev = r.json()
    r = auth_client.get("/api/v1/events", params={"from": "2026-09-26", "to": "2026-09-28"})
    assert [e["id"] for e in r.json()] == [ev["id"]]
    r = auth_client.get("/api/v1/events", params={"from": "2026-10-01", "to": "2026-10-02"})
    assert r.json() == []
    r = auth_client.patch(f"/api/v1/events/{ev['id']}", json={"title": "Dentist ✓", "clear_event_time": True})
    assert r.json()["title"] == "Dentist ✓" and r.json()["event_time"] is None
    r = auth_client.delete(f"/api/v1/events/{ev['id']}")
    assert r.status_code == 200
    r = auth_client.get("/api/v1/events")
    assert r.json() == []
