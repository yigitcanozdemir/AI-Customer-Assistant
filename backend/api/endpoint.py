import json
from http import HTTPStatus
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
import traceback
from backend.services.session_manager import get_message_history, add_message
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.api.chat import handle_chat_event
from backend.api.schema import (
    MessageResponse,
    ProductContext,
    Message,
    EventSchema,
    CreateOrderRequest,
    CreateOrderResponse,
    OrderStatus,
)
from backend.api.convert import convert_messages
from datetime import datetime
import time
from backend.db.session import get_session
from backend.db.schema import Product, Order

from sqlalchemy import select
from sqlalchemy.orm import joinedload
from backend.api.helper import format_products
import uuid
import logging
from backend.services.cache import cache_manager
from prometheus_client import Counter
from opentelemetry import trace
from backend.utility.utils import (
    REQUESTS,
    RESPONSES,
    REQUESTS_PROCESSING_TIME,
    REQUESTS_IN_PROGRESS,
    EXCEPTIONS,
)
from backend.config import settings

tracer = trace.get_tracer(__name__)
logger = logging.getLogger(__name__)
router = APIRouter()

websocket_messages_total = Counter(
    "websocket_messages_total",
    "Total number of WebSocket messages processed",
    ["direction"],
)

websocket_disconnects_total = Counter(
    "websocket_disconnects_total",
    "Total number of WebSocket disconnections",
)


@router.get("/health", tags=["health"])
async def health_check():
    try:
        async with get_session() as session:
            await session.execute("SELECT 1")
    except Exception as e:
        return {"status": "fail", "db": str(e)}

    try:
        pong = await cache_manager.redis.ping()
        if not pong:
            return {"status": "fail", "redis": "ping failed"}
    except Exception as e:
        return {"status": "fail", "redis": str(e)}

    return {"status": "ok"}


@router.websocket("/ws/chat/{session_id}")
async def websocket_chat(websocket: WebSocket, session_id: str):
    await websocket.accept()

    path = "/ws/chat"
    method = "WS"
    app_name = settings.app_name

    REQUESTS_IN_PROGRESS.labels(method=method, path=path, app_name=app_name).inc()
    REQUESTS.labels(method=method, path=path, app_name=app_name).inc()
    start_total = time.perf_counter()
    try:
        trace_id = tracer.start_as_current_span("websocket_chat")
        logger.info(
            "WebSocket connected",
            extra={
                "event": "websocket_connected",
                "session_id": session_id,
                "trace_id": str(trace_id),
            },
        )
        while True:
            msg_start = time.perf_counter()
            data = await websocket.receive_text()
            websocket_messages_total.labels(direction="inbound").inc()

            logger.debug(
                "Incoming WebSocket message",
                extra={"session_id": session_id, "data_preview": data[:200]},
            )
            try:
                event = EventSchema.model_validate_json(data)
                question = event.event_data.question
                store = event.event_data.store
                product_data = event.event_data.product
                user_id = event.event_data.user_id
                user_name = event.event_data.user_name
                order_data = event.event_data.order

                is_initial_message = getattr(
                    event.event_data, "is_initial_message", False
                )

                product_context = product_data
                order_context = order_data if order_data else None
                message_history = get_message_history(session_id)

                if is_initial_message:
                    logger.info(
                        "Received initial assistant message",
                        extra={
                            "session_id": session_id,
                            "question": question,
                            "has_product": product_context is not None,
                        },
                    )

                    initial_content = question.replace("[SYSTEM_INIT] ", "")

                    initial_message = Message(
                        id="1",
                        type="assistant",
                        content=initial_content,
                        timestamp=datetime.utcnow(),
                        products=[product_context] if product_context else None,
                    )
                    add_message(session_id, initial_message)

                    logger.info(
                        "Stored initial assistant message in session",
                        extra={
                            "session_id": session_id,
                            "message_count": len(get_message_history(session_id)),
                        },
                    )

                    continue

                if order_context:
                    add_message(
                        session_id,
                        Message(
                            id=str(len(message_history) + 1),
                            type="user",
                            content=f"User selected order: {order_context.order_id}",
                            timestamp=datetime.utcnow(),
                            products=(
                                [order_context.product]
                                if order_context.product
                                else None
                            ),
                        ),
                    )
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
                    question, store, message_history, user_id, user_name
                )

                logger.info(
                    "Chat response generated",
                    extra={
                        "event": "chat_response",
                        "session_id": session_id,
                        "user_id": user_id,
                        "response_length": len(response.content),
                    },
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

                await websocket.send_json(jsonable_encoder(response))
                websocket_messages_total.labels(direction="outbound").inc()
                duration = time.perf_counter() - msg_start
                span_ctx = trace.get_current_span().get_span_context()
                trace_id_val = (
                    trace.format_trace_id(span_ctx.trace_id) if span_ctx else "N/A"
                )
                REQUESTS_PROCESSING_TIME.labels(
                    method=method, path=path, app_name=app_name
                ).observe(duration, exemplar={"TraceID": trace_id_val})
                RESPONSES.labels(
                    method=method, path=path, status_code=200, app_name=app_name
                ).inc()

            except Exception as e:
                EXCEPTIONS.labels(
                    method=method,
                    path=path,
                    exception_type=type(e).__name__,
                    app_name=app_name,
                ).inc()
                logger.exception(
                    "Error processing WebSocket message",
                    extra={
                        "event": "websocket_message_error",
                        "session_id": session_id,
                        "error": str(e),
                    },
                )
                await websocket.send_json(
                    {
                        "type": "assistant",
                        "content": "Internal server error",
                        "timestamp": datetime.utcnow().isoformat(),
                        "products": [],
                        "suggestions": [],
                    }
                )
                RESPONSES.labels(
                    method=method, path=path, status_code=500, app_name=app_name
                ).inc()

    except WebSocketDisconnect:
        websocket_disconnects_total.inc()
        logger.warning(
            "WebSocket disconnected",
            extra={"event": "websocket_disconnected", "session_id": session_id},
        )

    except Exception as e:
        EXCEPTIONS.labels(
            method=method, path=path, exception_type=type(e).__name__, app_name=app_name
        ).inc()
        logger.exception(
            "Unhandled WebSocket exception",
            extra={
                "event": "websocket_unhandled_exception",
                "session_id": session_id,
                "error": str(e),
            },
        )

    finally:
        REQUESTS_IN_PROGRESS.labels(method=method, path=path, app_name=app_name).dec()
        total_duration = time.perf_counter() - start_total
        logger.info(f"WebSocket session ended, total duration: {total_duration:.2f}s")


@router.get("/products")
async def list_products(store: str = "default", limit: int = 30):
    try:
        cached_products = await cache_manager.get_product_list(store, limit)
        if cached_products:
            logger.info(f"Cache hit for product list: {store}")
            return cached_products

        logger.info(f"Cache miss for product list: {store}")

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

            await cache_manager.set_product_list(store, limit, formatted_result)

            return formatted_result

    except Exception as e:
        logger.error(f"List products error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/products/{product_id}")
async def get_product(product_id: str):
    try:
        cache_key = f"product:{product_id}"
        cached = await cache_manager.redis.get(cache_key)

        if cached:
            logger.info(f"Cache hit for product: {product_id}")
            return json.loads(cached)

        logger.info(f"Cache miss for product: {product_id}")

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

            await cache_manager.redis.setex(
                cache_key, 1200, json.dumps(jsonable_encoder(formatted_result))
            )

            return formatted_result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get product error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/orders", response_model=CreateOrderResponse)
async def create_order(request: CreateOrderRequest):
    created_orders = []

    async with get_session() as session:
        async with session.begin():
            for item in request.items:
                for _ in range(item.quantity):
                    order_id = uuid.uuid4()
                    created_at = datetime.utcnow()
                    order = Order(
                        order_id=order_id,
                        user_id=request.user_id,
                        user_name=request.user_name,
                        product_id=item.product_id,
                        variant_id=item.variant_id,
                        store=request.store,
                        status="created",
                        created_at=created_at,
                    )
                    session.add(order)

                    created_orders.append(
                        OrderStatus(
                            order_id=order_id,
                            status=order.status,
                            user_name=request.user_name,
                            created_at=created_at,
                            product=item.product,
                        )
                    )

        await session.commit()

    return CreateOrderResponse(orders=created_orders)
