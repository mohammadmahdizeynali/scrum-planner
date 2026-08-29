from datetime import date


def test_create_standalone_task(auth_client):
    r = auth_client.post("/api/v1/tasks", json={"title": "Pay internet bill"})
    assert r.status_code == 200
    t = r.json()
    assert t["area_id"] is None and t["project_id"] is None
    assert t["status"] == "backlog" and t["priority"] == "medium"


def test_task_cannot_have_both_parents(auth_client, area, project):
    r = auth_client.post("/api/v1/tasks", json={"title": "x", "area_id": area["id"], "project_id": project["id"]})
    assert r.status_code == 422


def test_task_in_project_has_area_via_project(auth_client, area, project, task):
    t = auth_client.get(f"/api/v1/tasks/{task['id']}").json()
    assert t["area_name"] == "University"
    assert t["project_name"] == "Course A"
    assert t["estimate_minutes"] == 90


def test_status_transition_sets_closed_at(auth_client, task):
    r = auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"status": "in_progress"})
    assert r.json()["status"] == "in_progress"
    assert r.json()["closed_at"] is None
    r = auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"status": "closed"})
    assert r.json()["status"] == "closed"
    assert r.json()["closed_at"] is not None
    r = auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"status": "in_progress"})
    assert r.json()["closed_at"] is None


def test_tags_and_subtasks(auth_client, task):
    tag = auth_client.post("/api/v1/tags", json={"name": "exam"}).json()
    r = auth_client.patch(f"/api/v1/tasks/{task['id']}", json={"tag_ids": [tag["id"]]})
    assert [x["name"] for x in r.json()["tags"]] == ["exam"]

    r = auth_client.post(f"/api/v1/tasks/{task['id']}/subtasks", json={"title": "page 30"})
    assert r.status_code == 200
    st_id = r.json()["id"]
    r = auth_client.patch(f"/api/v1/subtasks/{st_id}", json={"done": True})
    assert r.json()["done"] is True

    tasks = auth_client.get("/api/v1/tasks", params={"tag_id": tag["id"]}).json()
    assert tasks["total"] == 1
    assert tasks["items"][0]["subtask_done"] == 1


def test_search_and_filters(auth_client, project):
    auth_client.post("/api/v1/tasks", json={"title": "تمرین فصل سوم", "project_id": project["id"]})
    auth_client.post("/api/v1/tasks", json={"title": "Call client", "priority": "high"})

    r = auth_client.get("/api/v1/tasks", params={"q": "تمرین"}).json()
    assert r["total"] == 1
    r = auth_client.get("/api/v1/tasks", params={"priority": "high"}).json()
    assert r["total"] == 1 and r["items"][0]["title"] == "Call client"
    r = auth_client.get("/api/v1/tasks", params={"standalone": True}).json()
    assert all(i["area_id"] is None and i["project_id"] is None for i in r["items"])


def test_recurring_task_generates_next_on_close(auth_client, area):
    r = auth_client.post(
        "/api/v1/tasks",
        json={
            "title": "Weekly exercise sheet",
            "area_id": area["id"],
            "due_date": "2026-08-26",  # a Wednesday
            "recurrence_rule": {"kind": "weekly", "weekdays": [2]},  # Wednesdays
        },
    )
    task_id = r.json()["id"]
    r = auth_client.patch(f"/api/v1/tasks/{task_id}", json={"status": "closed"})
    assert r.json()["status"] == "closed"
    tasks = auth_client.get("/api/v1/tasks", params={"q": "Weekly exercise sheet"}).json()
    assert tasks["total"] == 2
    new = [t for t in tasks["items"] if t["status"] == "backlog"][0]
    assert str(new["due_date"]) == "2026-09-02"  # next Wednesday


def test_monthly_jalali_recurrence_clamps(auth_client, area):
    from app.services.recurrence import compute_next_due

    # 1405/06/31 doesn't exist; Shahrivar 1405 has 31 days but Mehr has 30.
    from datetime import date

    base = date(2026, 9, 22)  # 1405/06/31
    nxt = compute_next_due({"kind": "monthly_jalali", "day": 31}, base)
    assert nxt == date(2026, 10, 22)  # 1405/07/30 (Mehr has 30 days)


def test_delete_task_with_entries(auth_client, task):
    r = auth_client.post(
        "/api/v1/time-entries",
        json={
            "task_id": task["id"],
            "start_at": "2026-08-26T08:00:00+00:00",
            "end_at": "2026-08-26T09:30:00+00:00",
        },
    )
    assert r.status_code == 200
    preview = auth_client.get(f"/api/v1/tasks/{task['id']}/delete-preview").json()
    assert preview["logged_minutes"] == 90
    r = auth_client.delete(f"/api/v1/tasks/{task['id']}")
    assert r.status_code == 200
    detail = auth_client.get(f"/api/v1/tasks/{task['id']}")
    assert detail.status_code == 404
