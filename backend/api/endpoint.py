import json
from http import HTTPStatus
from fastapi.responses import JSONResponse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from pydantic import BaseModel
from typing import Optional

from starlette.responses import Response
from backend.api.chat import handle_chat_event
from backend.api.schema import MessageResponse
from datetime import datetime
import time

router = APIRouter()
security = HTTPBearer()
API_TOKEN = "your-secret-token"


class ChatEventData(BaseModel):
    question: str
    store: Optional[str] = None


class EventSchema(BaseModel):

    event_id: str
    event_type: str
    event_data: ChatEventData


@router.post("/")
async def handle_event(
    data: EventSchema, credentials: HTTPAuthorizationCredentials = Depends(security)
):
    if credentials.credentials != API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid authentication token")

    if data.event_type == "chat":
        question = data.event_data.question
        store = data.event_data.store
        if not question:
            raise HTTPException(
                status_code=400, detail="Missing 'question' in event_data"
            )
        start = time.time()

        response: MessageResponse = await handle_chat_event(question, store)
        end = time.time()
        print(f"Chat event processed in {end - start:.2f} seconds")
        print(response.model_dump_json(indent=2))
        event_dict = data.model_dump()
        print(f"Event data: {json.dumps(event_dict, indent=2)}")
        response_dict = response.model_dump()
        if "timestamp" in response_dict and isinstance(
            response_dict["timestamp"], datetime
        ):
            response_dict["timestamp"] = response_dict["timestamp"].isoformat()
        return JSONResponse(content=response_dict, status_code=HTTPStatus.OK)
    else:
        return JSONResponse(
            content={"message": "Event type not handled yet"},
            status_code=HTTPStatus.NOT_IMPLEMENTED,
        )
