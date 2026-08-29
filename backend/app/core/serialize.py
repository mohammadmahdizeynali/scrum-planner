"""Make payload dicts JSON-safe (UUIDs → str, datetimes → ISO) for JSONB/JSON columns."""

import uuid
from datetime import date, datetime


def jsonable(obj):
    if isinstance(obj, dict):
        return {k: jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    if isinstance(obj, uuid.UUID):
        return str(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    return obj
