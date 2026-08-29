def test_area_and_project_crud(auth_client, area, project):
    areas = auth_client.get("/api/v1/areas").json()
    assert len(areas) == 1
    assert areas[0]["name"] == "University"
    assert areas[0]["project_count"] == 1

    projects = auth_client.get("/api/v1/projects", params={"area_id": area["id"]}).json()
    assert len(projects) == 1 and projects[0]["name"] == "Course A"

    r = auth_client.patch(f"/api/v1/areas/{area['id']}", json={"name": "دانشگاه", "billable_default": False})
    assert r.json()["name"] == "دانشگاه"


def test_project_move_between_areas(auth_client, area, project):
    r = auth_client.post("/api/v1/areas", json={"name": "Freelance", "billable_default": True})
    freelance = r.json()
    r = auth_client.patch(f"/api/v1/projects/{project['id']}", json={"area_id": freelance["id"]})
    assert r.json()["area_id"] == freelance["id"]
    # move back
    auth_client.patch(f"/api/v1/projects/{project['id']}", json={"area_id": area["id"]})


def test_area_delete_move(auth_client, area, project, task):
    r = auth_client.post("/api/v1/areas", json={"name": "Other"})
    other = r.json()
    r = auth_client.delete(f"/api/v1/areas/{area['id']}", params={"mode": "move", "target_area_id": other["id"]})
    assert r.status_code == 200
    projects = auth_client.get("/api/v1/projects", params={"area_id": other["id"]}).json()
    assert len(projects) == 1
    t = auth_client.get(f"/api/v1/tasks/{task['id']}").json()
    assert t["project_name"] == "Course A"


def test_project_delete_move_tasks_to_area(auth_client, area, project, task):
    r = auth_client.delete(f"/api/v1/projects/{project['id']}", params={"mode": "move"})
    assert r.status_code == 200
    t = auth_client.get(f"/api/v1/tasks/{task['id']}").json()
    assert t["area_name"] == "University"
    assert t["project_id"] is None
