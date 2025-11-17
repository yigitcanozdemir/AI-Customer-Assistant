import json
from http import HTTPStatus
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
import traceback
import random
from typing import Optional
from backend.services.session_manager import (
    get_message_history,
    add_message,
    is_session_locked,
    lock_session,
)
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    Query,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.api.chat import handle_chat_event
from backend.api.two_pass_agent import two_pass_agent
from backend.api.schema import (
    MessageResponse,
    ProductContext,
    Message,
    EventSchema,
    CreateOrderRequest,
    CreateOrderResponse,
    OrderStatus,
    CurrentLocation,
    DeliveryAddress,
    FlaggedSessionsResponse,
    ReviewFlaggedSessionRequest,
    FlaggedSessionReview,
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
from backend.services.flagged_sessions import (
    store_flagged_session,
    get_flagged_sessions_for_user,
    mark_reviewed,
    get_flag_count_for_session,
)

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

PROFANITY_KEYWORDS = {
    "fuck",
    "shit",
    "bitch",
    "asshole",
    "bastard",
    "dumbass",
    "cunt",
    "motherfucker",
    "fucker",
}


def contains_abusive_language(text: str) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in PROFANITY_KEYWORDS)


def log_chat_interaction(
    session_id: str,
    user_id: str,
    user_name: str,
    store: str,
    user_message: str,
    assistant_response: str,
    confidence_score: float = None,
    requires_human: bool = False,
    products_found: int = 0,
    orders_found: int = 0,
    tools_used: list = None,
    trace_id: str = None,
    duration_ms: float = None,
):
    """
    Structured logging for chat interactions that will be properly indexed in Loki
    """

    logger.info(
        f"CHAT_INTERACTION session={session_id} user={user_name}",
        extra={
            "event_type": "chat_interaction",
            "session_id": session_id,
            "user_id": user_id,
            "user_name": user_name,
            "store": store,
            "user_message": (
                user_message[:500] if len(user_message) > 500 else user_message
            ),
            "assistant_response": (
                assistant_response[:500]
                if len(assistant_response) > 500
                else assistant_response
            ),
            "message_length_user": len(user_message),
            "message_length_assistant": len(assistant_response),
            "confidence_score": confidence_score,
            "requires_human": requires_human,
            "products_found": products_found,
            "orders_found": orders_found,
            "tools_used": ",".join(tools_used) if tools_used else "none",
            "duration_ms": duration_ms,
            "trace_id": trace_id,
        },
    )


def serialize_flagged_session(session) -> FlaggedSessionReview:
    return FlaggedSessionReview(
        id=session.id,
        session_id=session.session_id,
        user_id=session.user_id,
        user_name=session.user_name,
        store=session.store,
        user_query=session.user_query,
        assistant_response=session.assistant_response,
        confidence_score=session.confidence_score,
        requires_human=session.requires_human,
        is_context_relevant=session.is_context_relevant,
        warning_message=session.warning_message,
        assessment_reasoning=session.assessment_reasoning,
        message_history=session.message_history,
        flagged_at=session.flagged_at,
        reviewed=session.reviewed,
        reviewed_at=session.reviewed_at,
        reviewed_by=session.reviewed_by,
        review_notes=session.review_notes,
    )


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
                confirm_action_id = getattr(event.event_data, "confirm_action_id", None)

                product_context = product_data
                order_context = order_data if order_data else None
                message_history = await get_message_history(session_id)
                next_message_id = len(message_history) + 1

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
                    await add_message(session_id, initial_message)

                    logger.info(
                        "Stored initial assistant message in session",
                        extra={
                            "session_id": session_id,
                            "message_count": len(
                                await get_message_history(session_id)
                            ),
                        },
                    )

                    continue

                if await is_session_locked(session_id):
                    locked_response = MessageResponse(
                        content=(
                            "This chat session is paused due to repeated policy violations. "
                            "You can still review earlier messages, but sending new ones is disabled."
                        ),
                        store=store,
                        suggestions=[],
                        products=[],
                        orders=None,
                        tracking_data=None,
                        timestamp=datetime.utcnow(),
                        requires_human=True,
                        confidence_score=0.0,
                        is_context_relevant=True,
                        warning_message="Session paused",
                        session_locked=True,
                        lock_reason="policy_violation",
                    )

                    await websocket.send_json(jsonable_encoder(locked_response))
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
                    continue

                if order_context:
                    await add_message(
                        session_id,
                        Message(
                            id=str(next_message_id),
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
                    next_message_id += 1
                if product_context:
                    await add_message(
                        session_id,
                        Message(
                            id=str(next_message_id),
                            type="user",
                            content=f"User selected product: {product_context.name}",
                            timestamp=datetime.utcnow(),
                            products=[product_context],
                        ),
                    )
                    next_message_id += 1

                user_message = Message(
                    id=str(next_message_id),
                    type="user",
                    content=question,
                    timestamp=datetime.utcnow(),
                )
                await add_message(session_id, user_message)
                message_history = await get_message_history(session_id)

                abusive_language = contains_abusive_language(question)

                response: MessageResponse

                if abusive_language:
                    response = MessageResponse(
                        content=(
                            "We need to keep this conversation respectful. "
                            "Using abusive or harassing language violates our policy and may pause this chat."
                        ),
                        store=store,
                        suggestions=["Browse products", "Contact support"],
                        products=[],
                        orders=None,
                        tracking_data=None,
                        timestamp=datetime.utcnow(),
                        requires_human=True,
                        confidence_score=0.0,
                        is_context_relevant=True,
                        warning_message="Abusive language detected",
                        assessment_reasoning="Detected prohibited language",
                    )
                else:
                    use_two_pass = getattr(settings, 'use_two_pass_agent', True)

                    if use_two_pass:
                        logger.info(
                            "[Two-Pass] Using new two-pass agent architecture",
                            extra={"session_id": session_id}
                        )
                        response = await two_pass_agent.execute(
                            user_input=question,
                            session_id=session_id,
                            store=store,
                            user_id=str(user_id),
                            user_name=user_name,
                            selected_order=order_data,
                            confirm_action_id=confirm_action_id,
                        )
                    else:
                        logger.info(
                            "[Legacy] Using legacy chat handler",
                            extra={"session_id": session_id}
                        )
                        response = await handle_chat_event(
                            user_input=question,
                            store=store,
                            message_history=message_history,
                            user_id=str(user_id),
                            user_name=user_name,
                            confirm_action_id=confirm_action_id,
                            selected_order=order_data,
                        )

                span_context = trace.get_current_span().get_span_context()
                trace_id_str = (
                    trace.format_trace_id(span_context.trace_id)
                    if span_context
                    else "N/A"
                )

                log_chat_interaction(
                    session_id=session_id,
                    user_id=user_id,
                    user_name=user_name,
                    store=store,
                    user_message=question,
                    assistant_response=response.content,
                    confidence_score=response.confidence_score,
                    requires_human=response.requires_human,
                    products_found=len(response.products) if response.products else 0,
                    orders_found=len(response.orders) if response.orders else 0,
                    tools_used=response.tools_used if response.tools_used else [],
                    trace_id=trace_id_str,
                    duration_ms=round((time.perf_counter() - msg_start) * 1000, 2),
                )

                logger.info(
                    "Chat response generated",
                    extra={
                        "event": "chat_response",
                        "session_id": session_id,
                        "user_id": user_id,
                        "response_length": len(response.content),
                        "requires_human": response.requires_human,
                        "confidence_score": response.confidence_score,
                        "is_context_relevant": response.is_context_relevant,
                    },
                )

                assistant_message = Message(
                    id=str(len(message_history) + 2),
                    type="assistant",
                    content=response.content,
                    timestamp=datetime.utcnow(),
                    products=response.products,
                    suggestions=getattr(response, "suggestions", []),
                    requires_human=response.requires_human,
                    confidence_score=response.confidence_score,
                )
                await add_message(session_id, assistant_message)
                message_history.append(assistant_message)

                if response.requires_human:
                    logger.warning(
                        "Message flagged for human review",
                        extra={
                            "session_id": session_id,
                            "user_id": user_id,
                            "confidence_score": response.confidence_score,
                            "warning": response.warning_message,
                        },
                    )
                    stored_flag = await store_flagged_session(
                        session_id=session_id,
                        user_id=str(user_id),
                        user_name=user_name,
                        store=store,
                        user_query=question,
                        assistant_response=response.content,
                        confidence_score=response.confidence_score,
                        requires_human=response.requires_human,
                        is_context_relevant=response.is_context_relevant,
                        warning_message=response.warning_message,
                        assessment_reasoning=getattr(
                            response, "assessment_reasoning", None
                        ),
                        message_history=[
                            m.dict() if hasattr(m, "dict") else m.__dict__
                            for m in message_history[-10:]
                        ],
                    )

                    flag_count = 0
                    if stored_flag:
                        flag_count = await get_flag_count_for_session(session_id)

                    if flag_count >= 4:
                        await lock_session(session_id)
                        response.session_locked = True
                        response.lock_reason = "policy_violation"
                        response.content = (
                            "This chat session is paused due to repeated policy violations. "
                            "You can review earlier messages, but sending new ones is disabled."
                        )
                        response.warning_message = response.warning_message or (
                            "Session paused after multiple policy violations"
                        )

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
                current_location_data = None
                if item.current_location:
                    current_location_data = {
                        "country": item.current_location.country,
                        "region": item.current_location.region,
                        "city": item.current_location.city,
                        "lat": item.current_location.lat,
                        "lng": item.current_location.lng,
                    }
                else:
                    current_location_data = {
                        "country": "Germany",
                        "region": "Berlin",
                        "city": "Berlin",
                        "lat": 52.52,
                        "lng": 13.405,
                    }

                delivery_address_data = None
                if item.delivery_address:
                    delivery_address_data = {
                        "full_name": item.delivery_address.full_name,
                        "address_line1": item.delivery_address.address_line1,
                        "address_line2": item.delivery_address.address_line2,
                        "city": item.delivery_address.city,
                        "state": item.delivery_address.state,
                        "postal_code": item.delivery_address.postal_code,
                        "country": item.delivery_address.country,
                    }

                for _ in range(item.quantity):
                    order_id = uuid.uuid4()
                    created_at = datetime.utcnow()
                    order_status = random.choice(["created", "shipped", "delivered"])
                    location_payload = (
                        None if order_status == "delivered" else current_location_data
                    )
                    order = Order(
                        order_id=order_id,
                        user_id=request.user_id,
                        user_name=request.user_name,
                        product_id=item.product_id,
                        variant_id=item.variant_id,
                        store=request.store,
                        status=order_status,
                        created_at=created_at,
                        current_location=location_payload,
                        delivery_address=delivery_address_data,
                    )
                    session.add(order)

                    created_orders.append(
                        OrderStatus(
                            order_id=order_id,
                            status=order_status,
                            user_name=request.user_name,
                            created_at=created_at,
                            product=item.product,
                        )
                    )

        await session.commit()

    return CreateOrderResponse(orders=created_orders)


@router.get("/flagged-sessions", response_model=FlaggedSessionsResponse)
async def list_flagged_sessions(
    user_id: str,
    store: Optional[str] = Query(default=None),
    user_name: Optional[str] = None,
    limit: int = 25,
):
    try:
        try:
            uuid.UUID(user_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid user_id")

        safe_limit = max(1, min(limit, 100))
        store_filter = None
        if store and store.lower() != "all":
            store_filter = store
        sessions = await get_flagged_sessions_for_user(
            user_id=user_id,
            user_name=user_name,
            store=store_filter,
            limit=safe_limit,
        )

        serialized = [serialize_flagged_session(session) for session in sessions]
        return FlaggedSessionsResponse(sessions=serialized)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to list flagged sessions",
            extra={
                "user_id": user_id,
                "store": store if store else "all",
                "error": str(e),
            },
        )
        raise HTTPException(status_code=500, detail="Unable to fetch flagged sessions")


@router.post("/flagged-sessions/{flagged_id}/review")
async def review_flagged_session(
    flagged_id: str, payload: ReviewFlaggedSessionRequest
):
    if not payload.reviewed_by:
        raise HTTPException(status_code=400, detail="reviewed_by is required")

    try:
        success = await mark_reviewed(
            flagged_id=flagged_id,
            reviewed_by=payload.reviewed_by,
            notes=payload.notes,
        )
        if not success:
            raise HTTPException(status_code=500, detail="Failed to mark reviewed")

        return {"status": "reviewed"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Failed to review flagged session",
            extra={"flagged_id": flagged_id, "error": str(e)},
        )
        raise HTTPException(status_code=500, detail="Unable to review session")
