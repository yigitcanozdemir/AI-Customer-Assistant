from sqlalchemy import select, func, or_ as sa_or
from sqlalchemy.orm import joinedload
from backend.db.session import get_session
from backend.db.schema import Product, Variant, Embedding, FAQ, Order, Image
from backend.services.embedding import create_embedding
from backend.api.helper import format_products
from backend.services.cache import cache_manager
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


# --- Retrieval tuning knobs -------------------------------------------------
# Absolute cosine-distance ceiling: anything beyond this is never semantically
# relevant regardless of the rest of the pool (guards against returning junk on
# an empty store or a nonsense query). Looser than the old hard 0.6 so valid but
# distant matches are not silently dropped.
_MAX_VECTOR_DISTANCE = 0.85
# Relative margin from the best vector hit — keep candidates within this window
# of the top result so a good match doesn't drag in unrelated tail items.
_RELATIVE_DISTANCE_MARGIN = 0.15
# Reciprocal-rank-fusion constant (standard RRF; larger => flatter weighting).
_RRF_K = 60


def _rrf_scores(ranked_ids: list, weight: float = 1.0) -> dict:
    """Reciprocal-rank-fusion contribution for one ranked id list."""
    return {pid: weight / (_RRF_K + rank) for rank, pid in enumerate(ranked_ids)}


async def get_product_primary_image(product_id: str, store: str) -> str | None:
    """Return a product's primary image URL (or None).

    Used by the "find similar to this SHOP item" flow to feed the item's own
    picture into the vision→text→search path. Scoped by store as a safety check.
    """
    try:
        async with get_session() as session:
            stmt = (
                select(Image.url)
                .join(Product, Product.id == Image.product_id)
                .where(Product.id == product_id, Product.store == store)
                .limit(1)
            )
            return (await session.execute(stmt)).scalars().first()
    except Exception as e:
        logger.error(f"get_product_primary_image error: {e}", exc_info=True)
        return None


async def product_search(
    query: str,
    store: str = "default",
    top_k: int = 5,
    exclude_product_id: str | None = None,
):
    """Hybrid (vector + keyword) product search.

    Combines pgvector semantic similarity with a Postgres trigram/ILIKE keyword
    pass over name/category/tags via reciprocal-rank fusion, so exact terms like
    "dress" always surface even when the embedding is distant, while semantic
    matches still rank for paraphrased queries. `top_k` is caller-tunable so the
    LLM can widen recall.

    `exclude_product_id` drops one product from the results — used by the
    "find similar to THIS item" flow so the source product is never returned as
    its own match. Searches that exclude an id skip the shared query cache
    (they're personalized to a source item and rarer than plain queries).
    """
    try:
        top_k = max(1, min(int(top_k or 5), 25))

        use_cache = exclude_product_id is None
        if use_cache:
            cached_results = await cache_manager.get_product_search(query, store, top_k)
            if cached_results is not None:
                logger.info(
                    f"[Product Search] Cache HIT for query='{query}', store={store}"
                )
                return cached_results

        logger.debug(
            f"[Product Search] Cache MISS - Executing hybrid search for query='{query}', store={store}"
        )

        # Pull a wider candidate pool than top_k so fusion has material to work
        # with; final list is trimmed to top_k after merging. Widen slightly when
        # excluding an id so removing the source item doesn't shrink the result.
        pool = max(top_k * 4, 20) + (1 if exclude_product_id else 0)
        embedding_vector = await create_embedding(query)

        async with get_session() as session:
            # 1) Vector candidates (ordered by cosine distance).
            vector_stmt = (
                select(
                    Product.id,
                    Embedding.embedding.cosine_distance(embedding_vector).label(
                        "distance"
                    ),
                )
                .join(Embedding, Product.id == Embedding.product_id)
                .where(Product.store == store)
                .order_by("distance")
                .limit(pool)
            )
            vector_rows = (await session.execute(vector_stmt)).all()

            # Drop the excluded item BEFORE measuring the relative window.
            # "Similar to this" searches on the source product's own text, so the
            # source is a near-exact match at distance ~0; anchoring the margin to
            # it produced a window so tight that every genuine alternative fell
            # outside, and excluding the source afterwards left NO results at all.
            if exclude_product_id is not None:
                vector_rows = [
                    r for r in vector_rows if str(r.id) != str(exclude_product_id)
                ]

            # Apply an absolute ceiling + relative margin from the best hit.
            vector_ids: list = []
            if vector_rows:
                best = vector_rows[0].distance
                cutoff = min(
                    _MAX_VECTOR_DISTANCE, best + _RELATIVE_DISTANCE_MARGIN
                )
                vector_ids = [r.id for r in vector_rows if r.distance <= cutoff]

            # 2) Keyword candidates: trigram/ILIKE over name & category, plus an
            #    exact tag match. Catches lexical hits the embedding misses.
            like = f"%{query.strip()}%"
            keyword_stmt = (
                select(Product.id)
                .where(
                    Product.store == store,
                    sa_or(
                        Product.name.ilike(like),
                        Product.category.ilike(like),
                        Product.tags.any(query.strip()),
                    ),
                )
                .limit(pool)
            )
            keyword_ids = [row.id for row in (await session.execute(keyword_stmt)).all()]

            # Never return the source item when finding items "similar to this".
            # (Vector rows were already filtered above, before the distance
            # window was measured.)
            if exclude_product_id is not None:
                keyword_ids = [
                    pid for pid in keyword_ids if str(pid) != str(exclude_product_id)
                ]

            # 3) Reciprocal-rank fusion of the two rankings.
            scores: dict = {}
            for pid, s in _rrf_scores(vector_ids, weight=1.0).items():
                scores[pid] = scores.get(pid, 0.0) + s
            for pid, s in _rrf_scores(keyword_ids, weight=1.0).items():
                scores[pid] = scores.get(pid, 0.0) + s

            if not scores:
                logger.info(
                    f"No products found for query: {query}",
                    extra={
                        "query": query,
                        "best_distance": vector_rows[0].distance if vector_rows else None,
                        "vector_hits": len(vector_ids),
                        "keyword_hits": len(keyword_ids),
                    },
                )
                return []

            ordered_ids = sorted(scores, key=lambda pid: scores[pid], reverse=True)[
                :top_k
            ]

            logger.info(
                f"Hybrid search for query: {query} -> {len(ordered_ids)} result(s)",
                extra={
                    "query": query,
                    "best_distance": vector_rows[0].distance if vector_rows else None,
                    "vector_hits": len(vector_ids),
                    "keyword_hits": len(keyword_ids),
                },
            )

            # 4) Load full product rows and preserve fused order.
            products_stmt = (
                select(Product)
                .options(joinedload(Product.variants), joinedload(Product.images))
                .where(Product.id.in_(ordered_ids))
            )
            products = (
                (await session.execute(products_stmt)).unique().scalars().all()
            )
            product_map = {p.id: p for p in products}
            ordered_products = [
                product_map[pid] for pid in ordered_ids if pid in product_map
            ]

            results = format_products(ordered_products)

            if use_cache:
                await cache_manager.set_product_search(query, store, top_k, results)
                logger.debug(
                    f"[Product Search] Cached results for query='{query}', store={store}"
                )

            return results

    except Exception as e:
        # Note: `format_products` takes a list of ORM rows, so the previous
        # keyword-argument fallback here raised TypeError on any real error.
        # Return an empty result; `call_tool` applies its own demo fallback.
        logger.error(f"Product search error: {e}", exc_info=True)
        return []


async def faq_search(query: str, store: str, top_k: int = 1):
    try:
        # Check cache first
        cached_results = await cache_manager.get_faq_search(query, store, top_k)
        if cached_results is not None:
            logger.info(f"[FAQ Search] Cache HIT for query='{query}', store={store}")
            return cached_results

        logger.debug(f"[FAQ Search] Cache MISS - Executing search for query='{query}', store={store}")

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

        # Format results
        results = [{"id": faq.id, "content": faq.content} for faq in faqs_with_distance]

        # Store in cache
        await cache_manager.set_faq_search(query, store, top_k, results)
        logger.debug(f"[FAQ Search] Cached results for query='{query}', store={store}")

        return results

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
