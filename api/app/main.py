from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import models  # noqa: F401 - registers metadata for Alembic
from .auth import current_user, router as auth_router
from .db import get_db

app = FastAPI(
    title="CloudSync API",
    version="0.1.0",
    description="Production API foundation. File transfer routes are intentionally not enabled yet.",
    docs_url="/docs",
    redoc_url=None,
)


@app.get("/health/live", tags=["health"])
def live():
    return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
def ready(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    return {"status": "ready"}


app.include_router(auth_router)
