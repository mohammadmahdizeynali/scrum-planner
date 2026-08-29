def test_sequential_keys_per_area(auth_client):
    r = auth_client.post("/api/v1/areas", json={"name": "University", "key_prefix": "SBU"})
    assert r.status_code == 200, r.text
    area = r.json()
    assert area["key_prefix"] == "SBU"
    t1 = auth_client.post("/api/v1/tasks", json={"title": "a", "area_id": area["id"]}).json()
    t2 = auth_client.post("/api/v1/tasks", json={"title": "b", "area_id": area["id"]}).json()
    assert t1["issue_key"] == "SBU-001"
    assert t2["issue_key"] == "SBU-002"


def test_project_tasks_use_area_prefix(auth_client, area, project):
    r = auth_client.patch(f"/api/v1/areas/{area['id']}", json={"key_prefix": "UNI"})
    assert r.json()["key_prefix"] == "UNI"
    t = auth_client.post("/api/v1/tasks", json={"title": "x", "project_id": project["id"]}).json()
    assert t["issue_key"] == "UNI-001"


def test_standalone_tasks_have_no_key(auth_client):
    t = auth_client.post("/api/v1/tasks", json={"title": "solo"}).json()
    assert t["issue_key"] is None


def test_key_is_immutable_across_area_move(auth_client):
    a1 = auth_client.post("/api/v1/areas", json={"name": "A", "key_prefix": "AAA"}).json()
    a2 = auth_client.post("/api/v1/areas", json={"name": "B", "key_prefix": "BBB"}).json()
    t = auth_client.post("/api/v1/tasks", json={"title": "x", "area_id": a1["id"]}).json()
    r = auth_client.patch(f"/api/v1/tasks/{t['id']}", json={"area_id": a2["id"]})
    assert r.status_code == 200
    assert r.json()["issue_key"] == "AAA-001"


def test_prefix_locked_once_keyed_tasks_exist(auth_client, area):
    r = auth_client.patch(f"/api/v1/areas/{area['id']}", json={"key_prefix": "SBU"})
    assert r.status_code == 200
    auth_client.post("/api/v1/tasks", json={"title": "x", "area_id": area["id"]})
    r = auth_client.patch(f"/api/v1/areas/{area['id']}", json={"key_prefix": "NEW"})
    assert r.status_code == 409


def test_duplicate_prefix_rejected_case_insensitive(auth_client):
    assert auth_client.post("/api/v1/areas", json={"name": "A", "key_prefix": "SBU"}).status_code == 200
    r = auth_client.post("/api/v1/areas", json={"name": "B", "key_prefix": "sbu"})
    assert r.status_code == 409


def test_invalid_prefixes_rejected(auth_client):
    assert auth_client.post("/api/v1/areas", json={"name": "A", "key_prefix": "1AB"}).status_code == 422
    assert auth_client.post("/api/v1/areas", json={"name": "A", "key_prefix": "TOOLONGPREFIXX"}).status_code == 422
    assert auth_client.post("/api/v1/areas", json={"name": "A", "key_prefix": "قالب"}).status_code == 422


def test_search_by_key(auth_client, area):
    auth_client.patch(f"/api/v1/areas/{area['id']}", json={"key_prefix": "SBU"})
    t1 = auth_client.post("/api/v1/tasks", json={"title": "alpha", "area_id": area["id"]}).json()
    t2 = auth_client.post("/api/v1/tasks", json={"title": "beta", "area_id": area["id"]}).json()

    # exact + sloppy forms find only SBU-002
    for q in ("SBU-002", "sbu-2", "sbu 2", "sbu/2"):
        r = auth_client.get("/api/v1/tasks", params={"q": q}).json()
        ids = [i["id"] for i in r["items"]]
        assert t2["id"] in ids and t1["id"] not in ids, q

    # bare prefix finds both
    r = auth_client.get("/api/v1/tasks", params={"q": "SBU"}).json()
    ids = [i["id"] for i in r["items"]]
    assert t1["id"] in ids and t2["id"] in ids
