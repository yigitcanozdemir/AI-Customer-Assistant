from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from backend.db.session import get_session
from backend.db.schema import Product, Variant, Embedding, FAQ, Order
from backend.services.embedding import create_embedding
from backend.api.helper import format_products
import logging
import uuid
from datetime import datetime
from backend.api.schema import (
    OrderStatus,
    ListOrdersResponse,
    OrderProduct,
    ProductVariant,
    OrderLocation,
    CurrentLocation,
    DeliveryAddress,
)
from typing import List

logger = logging.getLogger(__name__)


async def product_search(query: str, store=str, top_k: int = 1):
    try:
        embedding_vector = await create_embedding(query)

        async with get_session() as session:
            similarity_stmt = (
                select(
                    Product.id,
                    Embedding.embedding.cosine_distance(embedding_vector).label(
                        "distance"
                    ),
                )
                .join(Embedding, Product.id == Embedding.product_id)
                .where(Product.store == store)
                .order_by("distance")
                .limit(top_k)
            )

            similarity_result = await session.execute(similarity_stmt)
            product_ids_with_distance = similarity_result.all()

            if not product_ids_with_distance:
                return []

            RELEVANCE_THRESHOLD = 0.6
            relevant_products = [
                row
                for row in product_ids_with_distance
                if row.distance < RELEVANCE_THRESHOLD
            ]

            if relevant_products:
                logger.info(
                    f"Relevant products found for query: {query} Best distance: {product_ids_with_distance[0].distance if product_ids_with_distance else None}",
                    extra={
                        "query": query,
                        "best_distance": product_ids_with_distance[0].distance,
                        "threshold": RELEVANCE_THRESHOLD,
                    },
                )

            if not relevant_products:
                logger.info(
                    f"No relevant products found for query: {query} Best distance: {product_ids_with_distance[0].distance if product_ids_with_distance else None}",
                    extra={
                        "query": query,
                        "best_distance": (
                            product_ids_with_distance[0].distance
                            if product_ids_with_distance
                            else None
                        ),
                        "threshold": RELEVANCE_THRESHOLD,
                    },
                )
                return []

            product_ids = [row.id for row in product_ids_with_distance]

            products_stmt = (
                select(Product)
                .options(joinedload(Product.variants), joinedload(Product.images))
                .where(Product.id.in_(product_ids))
            )

            products_result = await session.execute(products_stmt)
            products = products_result.unique().scalars().all()
            product_map = {p.id: p for p in products}
            ordered_products = [
                product_map[pid] for pid in product_ids if pid in product_map
            ]

            return format_products(ordered_products)

    except Exception as e:
        logger.error(f"Product search error: {e}")
        return [
            format_products(
                id="demo",
                name="Demo Product",
                description="Demo description",
                price=0.0,
                currency="USD",
                inStock=False,
                image="/placeholder-image.jpg",
                images=[],
                variants=[],
                sizes=[],
                colors=[],
            )
        ]


async def faq_search(query: str, store: str, top_k: int = 1):
    try:
        embedding_vector = await create_embedding(query)

        async with get_session() as session:
            similarity_stmt = (
                select(
                    FAQ.id,
                    FAQ.content,
                    FAQ.embedding.cosine_distance(embedding_vector).label("distance"),
                )
                .where(FAQ.store == store)
                .order_by("distance")
                .limit(top_k)
            )

            similarity_result = await session.execute(similarity_stmt)
            faqs_with_distance = similarity_result.all()
            if similarity_result:
                logger.info(
                    f"FAQ search found {len(faqs_with_distance)} results for query: {query}",
                    extra={"query": query, "top_k": top_k},
                )

        return [{"id": faq.id, "content": faq.content} for faq in faqs_with_distance]

    except Exception as e:
        logger.error(f"FAQ search error: {e}")
        return []


async def variant_check(
    product_id: str, size: str = None, color: str = None
) -> List[ProductVariant]:
    try:
        async with get_session() as session:
            stmt = select(Variant).filter(Variant.product_id == product_id)
            if size:
                stmt = stmt.filter(Variant.size == size)
            if color:
                stmt = stmt.filter(Variant.color == color)

            result = await session.execute(stmt)
            variants = result.scalars().all()

            return [
                ProductVariant(
                    id=str(v.id),
                    size=v.size,
                    color=v.color,
                    stock=v.stock,
                    available=v.stock > 0,
                )
                for v in variants
            ]

    except Exception as e:
        logger.error(f"Variant check error: {e}")
        return []


async def process_order(order_id: uuid.UUID, action: str, store: str):
    valid_actions = ["create", "update", "cancel", "return", "confirm"]

    if action not in valid_actions:
        return {
            "status": "error",
            "message": f"Invalid action. Must be one of: {valid_actions}",
        }

    async with get_session() as session:
        async with session.begin():
            stmt = select(Order).where(Order.order_id == order_id, Order.store == store)
            result = await session.execute(stmt)
            order = result.scalar_one_or_none()
            if not order:
                return {"status": "error", "message": "Order not found"}

            current_status = order.status

            if action == "cancel":
                if current_status == "shipped":
                    return {
                        "status": "error",
                        "message": "Cannot cancel a shipped order. You may initiate a return instead.",
                        "current_status": current_status,
                        "suggested_action": "return",
                    }
                elif current_status == "delivered":
                    return {
                        "status": "error",
                        "message": "Cannot cancel a delivered order. You may initiate a return instead.",
                        "current_status": current_status,
                        "suggested_action": "return",
                    }
                elif current_status in ["cancelled", "returned"]:
                    return {
                        "status": "error",
                        "message": f"Order is already {current_status}.",
                        "current_status": current_status,
                    }
                order.status = "cancelled"

            elif action == "return":
                if current_status == "created":
                    return {
                        "status": "error",
                        "message": "Cannot return an order that hasn't been shipped yet. You can cancel it instead.",
                        "current_status": current_status,
                        "suggested_action": "cancel",
                    }
                elif current_status == "cancelled":
                    return {
                        "status": "error",
                        "message": "Cannot return a cancelled order.",
                        "current_status": current_status,
                    }
                elif current_status == "returned":
                    return {
                        "status": "error",
                        "message": "Order is already returned.",
                        "current_status": current_status,
                    }
                order.status = "returned"

            elif action == "update":
                order.status = "updated"

        await session.commit()

    return {
        "status": "success",
        "order_id": str(order_id),
        "action": action,
        "previous_status": current_status,
        "current_status": order.status,
        "timestamp": datetime.utcnow().isoformat(),
        "message": f"Order {action} completed successfully.",
    }


async def list_orders(user_id: str, store: str) -> ListOrdersResponse:
    try:
        async with get_session() as session:
            stmt = (
                select(Order)
                .options(
                    joinedload(Order.product).joinedload(Product.images),
                    joinedload(Order.variant),
                )
                .where(Order.user_id == user_id, Order.store == store)
                .order_by(Order.created_at.desc())
            )
            result = await session.execute(stmt)
            orders = result.unique().scalars().all()

            logger.info(f"Found {len(orders)} orders for user {user_id}")

            orders_list = []
            for order in orders:
                try:
                    product = order.product
                    variant = order.variant

                    if not product:
                        logger.warning(f"Order {order.order_id} has no product")
                        continue

                    primary_image = (
                        product.images[0].url
                        if product.images
                        else "/placeholder-image.jpg"
                    )
                    variant_text = (
                        f"{variant.color} / {variant.size}" if variant else None
                    )

                    product_data = OrderProduct(
                        id=product.id,
                        variant_id=variant.id if variant else None,
                        name=product.name,
                        price=float(product.price),
                        currency=product.currency,
                        image=primary_image,
                        variant_text=variant_text,
                    )

                    order_status = OrderStatus(
                        order_id=order.order_id,
                        status=order.status,
                        user_name=order.user_name,
                        created_at=order.created_at,
                        product=product_data,
                    )
                    orders_list.append(order_status)

                except Exception as order_error:
                    logger.error(
                        f"Error processing order {order.order_id}: {order_error}",
                        exc_info=True,
                    )
                    continue

            logger.info(f"Successfully processed {len(orders_list)} orders")
            return ListOrdersResponse(orders=orders_list)

    except Exception as e:
        logger.error(f"List orders error: {e}")

        return ListOrdersResponse(orders=[])


async def fetch_order_location(order_id: uuid.UUID, store: str) -> OrderLocation:
    try:
        async with get_session() as session:
            stmt = select(Order).where(Order.order_id == order_id, Order.store == store)
            result = await session.execute(stmt)
            order = result.scalar_one_or_none()

            if not order:
                logger.warning(f"Order {order_id} not found")
                return None

            current_loc = None
            if order.current_location and order.status != "delivered":
                current_loc = CurrentLocation(**order.current_location)

            delivery_addr = None
            if order.delivery_address:
                delivery_addr = DeliveryAddress(**order.delivery_address)

            return OrderLocation(
                order_id=order.order_id,
                current_location=current_loc,
                delivery_address=delivery_addr,
                created_at=order.created_at,
                status=order.status,
            )

    except Exception as e:
        logger.error(f"Fetch order location error: {e}", exc_info=True)
        return None


TOOLS = {
    "product_search": product_search,
    "variant_check": variant_check,
    "process_order": process_order,
    "faq_search": faq_search,
    "list_orders": list_orders,
    "fetch_order_location": fetch_order_location,
}


async def call_tool(tool_name: str, arguments: dict):
    if tool_name not in TOOLS:
        raise ValueError(f"Unknown tool: {tool_name}")

    try:
        return await TOOLS[tool_name](**arguments)
    except Exception as e:
        logger.error(f"Tool {tool_name} error: {e}")

        if tool_name == "product_search":
            return await product_search("demo", "demo")

        elif tool_name == "faq_search":
            return [{"id": "demo", "content": "This is a demo FAQ response."}]
        elif tool_name == "variant_check":
            return {
                "available": False,
                "size": arguments.get("size"),
                "color": arguments.get("color"),
                "stock": 0,
            }
        elif tool_name == "process_order":
            return {"status": "error", "error": "Unable to process order at this time"}
        elif tool_name == "list_orders":
            return ListOrdersResponse(orders=[])
        elif tool_name == "fetch_order_location":
            return None

        return {"error": str(e)}
