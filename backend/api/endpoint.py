import json
from http import HTTPStatus
from fastapi.responses import JSONResponse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from pydantic import BaseModel
from starlette.responses import Response
from backend.api.v1.endpoints.chat import handle_chat_event


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

    response_data = {}
    status_code = HTTPStatus.ACCEPTED

    if data.event_type == "chat":
        question = data.event_data.get("question")
        if not question:
            raise HTTPException(
                status_code=400, detail="Missing 'question' in event_data"
            )

        answer = await handle_chat_event(question)
        response_data = {"response": answer}
    else:
        response_data = {"message": "Event type not handled yet"}
        status_code = HTTPStatus.NOT_IMPLEMENTED

    return JSONResponse(content=response_data, status_code=status_code)
