from datetime import datetime, timedelta, timezone

from app.core.timeutils import format_jalali_date, week_start_utc


def test_current_sprint_autocreated_with_sat_fri_range(auth_client):
    r = auth_client.get("/api/v1/sprints/current")
    assert r.status_code == 200, r.text
    s = r.json()
    expected_start = week_start_utc(datetime.now(timezone.utc), "Asia/Tehran")
    assert s["start_at"][:16] == expected_start.isoformat()[:16]
    # end = start + 7 days
    end = datetime.fromisoformat(s["end_at"])
    start = datetime.fromisoformat(s["start_at"])
    assert (end - start) == timedelta(days=7)
    assert s["name"].startswith("اسپرینت")
    assert s["status"] == "active"


def test_add_and_remove_task_updates_status(auth_client, project, task):
    sprint = auth_client.get("/api/v1/sprints/current").json()
    r = auth_client.post(f"/api/v1/sprints/{sprint['id']}/tasks", json={"items": [{"task_id": task["id"], "estimate_minutes": 60}]})
    assert r.status_code == 200, r.text
    members = r.json()["members"]
    assert len(members) == 1
    assert members[0]["task"]["status"] == "open"          # auto Backlog → Open
    assert members[0]["task"]["estimate_minutes"] == 60    # estimate edited at add time
    assert r.json()["estimate_minutes"] == 60

    r = auth_client.delete(f"/api/v1/sprints/{sprint['id']}/tasks/{task['id']}")
    assert r.status_code == 200
    assert r.json()["members"] == []
    t = auth_client.get(f"/api/v1/tasks/{task['id']}").json()
    assert t["status"] == "backlog"                        # Open → Backlog on removal


def test_closed_sprint_blocks_membership_changes(auth_client, project):
    s = auth_client.get("/api/v1/sprints/current").json()
    if s["status"] == "closed":  # a previous test in this session may have closed it
        auth_client.post(f"/api/v1/sprints/{s['id']}/reopen")

    t = auth_client.post("/api/v1/tasks", json={"title": "member", "project_id": project["id"]}).json()
    auth_client.post(f"/api/v1/sprints/{s['id']}/tasks", json={"items": [{"task_id": t["id"]}]})

    r = auth_client.post(f"/api/v1/sprints/{s['id']}/close", json={"decisions": []})
    assert r.status_code == 200

    # closed sprint: no adding, no removing
    r = auth_client.post(f"/api/v1/sprints/{s['id']}/tasks", json={"items": [{"task_id": t["id"]}]})
    assert r.status_code == 409
    r = auth_client.delete(f"/api/v1/sprints/{s['id']}/tasks/{t['id']}")
    assert r.status_code == 409

    r = auth_client.post(f"/api/v1/sprints/{s['id']}/reopen")
    assert r.status_code == 200 and r.json()["status"] == "active"

    t2 = auth_client.post("/api/v1/tasks", json={"title": "fresh"}).json()
    r = auth_client.post(f"/api/v1/sprints/{s['id']}/tasks", json={"items": [{"task_id": t2["id"]}]})
    assert r.status_code == 200
    assert any(m["task"]["id"] == t2["id"] for m in r.json()["members"])


def test_close_sprint_with_decisions(auth_client, project):
    # prepare: two tasks in sprint, one In Progress, one Open
    t1 = auth_client.post("/api/v1/tasks", json={"title": "carry me", "project_id": project["id"]}).json()
    t2 = auth_client.post("/api/v1/tasks", json={"title": "to backlog", "project_id": project["id"]}).json()
    t3 = auth_client.post("/api/v1/tasks", json={"title": "close me", "project_id": project["id"]}).json()
    sprint = auth_client.get("/api/v1/sprints/current").json()
    auth_client.post(f"/api/v1/sprints/{sprint['id']}/tasks", json={"items": [{"task_id": t1["id"]}, {"task_id": t2["id"]}, {"task_id": t3["id"]}]})
    auth_client.patch(f"/api/v1/tasks/{t1['id']}", json={"status": "in_progress"})

    # log some time so the report has numbers (within current week)
    now = datetime.now(timezone.utc)
    start = week_start_utc(now, "Asia/Tehran") + timedelta(days=1, hours=10)
    r = auth_client.post("/api/v1/time-entries", json={
        "task_id": t1["id"], "start_at": start.isoformat(), "end_at": (start + timedelta(minutes=90)).isoformat(), "billable": False,
    })
    assert r.status_code == 200, r.text

    r = auth_client.post(f"/api/v1/sprints/{sprint['id']}/close", json={
        "decisions": [
            {"task_id": t1["id"], "action": "carry_over"},
            {"task_id": t2["id"], "action": "backlog"},
            {"task_id": t3["id"], "action": "close"},
        ]
    })
    assert r.status_code == 200, r.text
    report = r.json()
    assert report["total_minutes"] == 90
    assert report["tasks"][0]["title"] == "carry me"
    assert any(c["title"] == "close me" for c in report["completed"])

    # statuses applied
    assert auth_client.get(f"/api/v1/tasks/{t2['id']}").json()["status"] == "backlog"
    assert auth_client.get(f"/api/v1/tasks/{t3['id']}").json()["status"] == "closed"

    # carried task is member of next sprint with source carry_over, still In Progress
    nxt_start = week_start_utc(now, "Asia/Tehran") + timedelta(days=7)
    sprints = auth_client.get("/api/v1/sprints", params={"from": nxt_start.isoformat(), "to": (nxt_start + timedelta(days=7)).isoformat()}).json()
    assert len(sprints) == 1
    nxt = auth_client.get(f"/api/v1/sprints/{sprints[0]['id']}").json()
    assert any(m["task"]["id"] == t1["id"] and m["source"] == "carry_over" for m in nxt["members"])
    assert auth_client.get(f"/api/v1/tasks/{t1['id']}").json()["status"] == "in_progress"

    # sprint closed; report exists
    closed = auth_client.get(f"/api/v1/sprints/{sprint['id']}").json()
    assert closed["status"] == "closed"
    wr = auth_client.get(f"/api/v1/reports/weekly/{sprint['id']}")
    assert wr.status_code == 200 and wr.json()["total_minutes"] == 90

    # reopen works, blocks after next sprint closes
    r = auth_client.post(f"/api/v1/sprints/{sprint['id']}/reopen")
    assert r.status_code == 200 and r.json()["status"] == "active"
    r = auth_client.post(f"/api/v1/sprints/{sprint['id']}/close", json={"decisions": []})
    assert r.status_code == 200  # default action = carry_over
    r2 = auth_client.post(f"/api/v1/sprints/{nxt['id'] if isinstance(nxt, dict) else nxt}/close", json={"decisions": []})
    assert r2.status_code == 200
    r = auth_client.post(f"/api/v1/sprints/{sprint['id']}/reopen")
    assert r.status_code == 409
