import json
from http import HTTPStatus
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
import traceback
from backend.services.session_manager import get_message_history, add_message
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.api.chat import handle_chat_event
from backend.api.schema import MessageResponse, ProductContext, Message
from backend.api.convert import convert_messages
from datetime import datetime
import time
from backend.db.session import get_session
from backend.db.schema import Product

from sqlalchemy import select
from sqlalchemy.orm import joinedload
from backend.api.helper import format_products

router = APIRouter()


@router.websocket("/ws/chat/{session_id}")
async def websocket_chat(websocket: WebSocket, session_id: str):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            try:
                message_data = json.loads(data)
                question = message_data.get("event_data", {}).get("question")
                store = message_data.get("event_data", {}).get("store", "default")

                product_data = message_data.get("event_data", {}).get("product")

                product_context = (
                    ProductContext(**product_data) if product_data else None
                )
                message_history = get_message_history(session_id)

                if product_context:
                    add_message(
                        session_id,
                        Message(
                            id=str(len(message_history) + 1),
                            type="user",
                            content=f"User selected product: {product_context.name}",
                            timestamp=datetime.utcnow(),
                            products=[product_context],
                        ),
                    )

                user_message = Message(
                    id=str(len(message_history) + 1),
                    type="user",
                    content=question,
                    timestamp=datetime.utcnow(),
                )
                add_message(session_id, user_message)
                message_history = get_message_history(session_id)

                response: MessageResponse = await handle_chat_event(
                    question, store, message_history
                )

                assistant_message = Message(
                    id=str(len(message_history) + 2),
                    type="assistant",
                    content=response.content,
                    timestamp=datetime.utcnow(),
                    products=response.products,
                    suggestions=getattr(response, "suggestions", []),
                )
                add_message(session_id, assistant_message)

                await websocket.send_json(jsonable_encoder(assistant_message))

            except Exception as e:
                print("Error processing message:", e)
                traceback.print_exc()
                await websocket.send_json(
                    {
                        "type": "assistant",
                        "content": "Internal server error",
                        "timestamp": datetime.utcnow().isoformat(),
                        "products": [],
                        "suggestions": [],
                    }
                )

    except WebSocketDisconnect:
        print(f"[WebSocket] Client disconnected: {session_id}")


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
        product = result.unique().scalar_one_or_none()
        if not product:
            raise HTTPException(status_code=404, detail="Product not found")
        formatted_result = format_products([product])[0]
        print(json.dumps(jsonable_encoder(formatted_result), indent=2))
        return formatted_result
