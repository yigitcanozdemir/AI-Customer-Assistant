import json
from http import HTTPStatus
from fastapi.responses import JSONResponse
import traceback
from backend.services.session_manager import get_message_history, add_message
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.api.chat import handle_chat_event
from backend.api.schema import MessageResponse, EventSchema, Message
from backend.api.convert import convert_messages
from datetime import datetime
import time
from backend.db.session import get_session
from backend.db.schema import Product

from sqlalchemy import select
from sqlalchemy.orm import joinedload
from backend.api.helper import format_products

router = APIRouter()
security = HTTPBearer()
API_TOKEN = "your-secret-token"


@router.post("/chat")
async def handle_event(
    data: EventSchema, credentials: HTTPAuthorizationCredentials = Depends(security)
):
    if credentials.credentials != API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid authentication token")

    try:
        session_id = data.event_id
        question = data.event_data.question
        store = data.event_data.store
        message_history = get_message_history(session_id)

        user_message = Message(
            id=str(len(message_history) + 1),
            type="user",
            content=question,
            timestamp=datetime.utcnow(),
        )
        add_message(session_id, user_message)
        message_history = get_message_history(session_id)

        if not question:
            raise HTTPException(
                status_code=400, detail="Missing 'question' in event_data"
            )
        start = time.time()

        response: MessageResponse = await handle_chat_event(
            question, store, message_history
        )

        assistant_message = Message(
            id=str(len(message_history) + 2),
            type="assistant",
            content=response.content,
            timestamp=datetime.utcnow(),
            products=response.products,
        )
        add_message(session_id, assistant_message)
        end = time.time()
        print(f"Chat event processed in {end - start:.2f} seconds")
        print(response.model_dump_json(indent=2))

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


@router.get("/products")
async def list_products(store: str = "default", limit: int = 30):
    async with get_session() as session:
        stmt = (
            select(Product)
            .options(joinedload(Product.variants), joinedload(Product.images))
            .where(Product.store == store)
            .limit(limit)
        )
        result = await session.execute(stmt)
        products = result.unique().scalars().all()
        formatted_result = format_products(products)
        print(json.dumps([p.model_dump() for p in formatted_result], indent=2))
        return formatted_result


@router.get("/products/{product_id}")
async def get_product(product_id: str):
    async with get_session() as session:
        stmt = (
            select(Product)
            .options(joinedload(Product.variants), joinedload(Product.images))
            .where(Product.id == product_id)
        )
        result = await session.execute(stmt)
        product = result.scalar_one_or_none()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        formatted_result = format_products([product])[0]
        print(json.dumps([p.model_dump() for p in formatted_result], indent=2))
        return formatted_result
