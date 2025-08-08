import json
from http import HTTPStatus
from fastapi.responses import JSONResponse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from pydantic import BaseModel
from starlette.responses import Response
from backend.api.chat import handle_chat_event
from backend.api.schema import MessageResponse
from datetime import datetime
import time

router = APIRouter()
security = HTTPBearer()
API_TOKEN = "your-secret-token"


class EventSchema(BaseModel):

    event_id: str
    event_type: str
    event_data: dict


@router.post("/")
async def handle_event(
    data: EventSchema, credentials: HTTPAuthorizationCredentials = Depends(security)
):
    if credentials.credentials != API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid authentication token")

    if data.event_type == "chat":
        question = data.event_data.get("question")
        store = data.event_data.get("store")
        if not question:
            raise HTTPException(
                status_code=400, detail="Missing 'question' in event_data"
            )
        start = time.time()

        response: MessageResponse = await handle_chat_event(question, store)
        end = time.time()
        print(f"Chat event processed in {end - start:.2f} seconds")
        print(response.model_dump_json(indent=2))
        response = response.model_dump()
        if "timestamp" in response and isinstance(response["timestamp"], datetime):
            response["timestamp"] = response["timestamp"].isoformat()
        return JSONResponse(content=response, status_code=HTTPStatus.OK)
    else:
        return JSONResponse(
            content={"message": "Event type not handled yet"},
            status_code=HTTPStatus.NOT_IMPLEMENTED,
        )
