from fastapi import APIRouter, Depends, HTTPException, Query

from app.deps import get_current_user
from app.db import get_db
from app.models import User
from app.services.notifications import daily_briefing_text, evening_summary_text

router = APIRouter(prefix="/notify", tags=["notify"])


@router.get("/preview")
def preview(
    type: str = Query(..., pattern="^(morning|evening)$"),
    user: User = Depends(get_current_user),
    db=Depends(get_db),
):
    """Render the exact message text the scheduler would send — useful for
    checking the digests without waiting for a slot (and without Telegram)."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="فقط مدیر مجاز است.")
    text = daily_briefing_text(db, user) if type == "morning" else evening_summary_text(db, user)
    return {"type": type, "text": text}
