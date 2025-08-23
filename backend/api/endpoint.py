import json
from http import HTTPStatus
from fastapi.responses import JSONResponse
import traceback

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.api.chat import handle_chat_event
from backend.api.schema import MessageResponse, EventSchema
from backend.api.convert import convert_messages
from datetime import datetime
import time

router = APIRouter()
security = HTTPBearer()
API_TOKEN = "your-secret-token"


@router.post("/")
async def handle_event(
    data: EventSchema, credentials: HTTPAuthorizationCredentials = Depends(security)
):
    if credentials.credentials != API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid authentication token")

    try:
        question = data.event_data.question
        store = data.event_data.store
        message_history = convert_messages(data.event_data.message_history)
        print(f"Message History: {message_history}\n")

        if not question:
            raise HTTPException(
                status_code=400, detail="Missing 'question' in event_data"
            )
        start = time.time()

        response: MessageResponse = await handle_chat_event(
            question, store, message_history
        )
        end = time.time()
        print(f"Chat event processed in {end - start:.2f} seconds")
        print(response.model_dump_json(indent=2))
        event_dict = data.model_dump()
        print(f"Event data: {json.dumps(event_dict, indent=2, default=str)}")
        response_dict = response.model_dump()
        if "timestamp" in response_dict and isinstance(
            response_dict["timestamp"], datetime
        ):
            response_dict["timestamp"] = response_dict["timestamp"].isoformat()
        return JSONResponse(content=response_dict, status_code=HTTPStatus.OK)
    except Exception as e:
        print("Unexpected error:", str(e))
        traceback.print_exc()
        return JSONResponse(
            content={"message": "Internal server error"},
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
        )
