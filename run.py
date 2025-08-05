import uvicorn
from backend.config import settings
import os

if __name__ == "__main__":
    os.chdir("backend")
    uvicorn.run(
        "backend.main:app", host="0.0.0.0", port=settings.port, reload=settings.debug
    )
