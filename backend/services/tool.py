from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from backend.db.session import get_session
from backend.db.schema import Product, Variant, Embedding
from backend.services.embedding import create_embedding
import logging

logger = logging.getLogger(__name__)


async def product_search(query: str, top_k: int = 5):
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
                .order_by("distance")
                .limit(top_k)
            )

            similarity_result = await session.execute(similarity_stmt)
            product_ids_with_distance = similarity_result.all()

            if not product_ids_with_distance:
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

            formatted_products = []
            for product in ordered_products:
                images = [img.url for img in product.images] if product.images else []
                primary_image = images[0] if images else "/placeholder-image.jpg"

                formatted_product = {
                    "id": str(product.id),
                    "name": product.name,
                    "description": product.description or "",
                    "price": (
                        float(product.price)
                        if hasattr(product, "price") and product.price
                        else 0.0
                    ),
                    "currency": (
                        product.currency if hasattr(product, "currency") else "USD"
                    ),
                    "rating": 0,
                    "category": getattr(product, "category", "General"),
                    "inStock": (
                        any(v.stock > 0 for v in product.variants)
                        if product.variants
                        else False
                    ),
                    "image": primary_image,
                    "images": images,
                    "variants": (
                        [
                            {"color": v.color, "size": v.size, "stock": v.stock}
                            for v in product.variants
                        ]
                        if product.variants
                        else []
                    ),
                    "sizes": (
                        list(set(v.size for v in product.variants if v.size))
                        if product.variants
                        else []
                    ),
                    "colors": (
                        list(set(v.color for v in product.variants if v.color))
                        if product.variants
                        else []
                    ),
                }
                formatted_products.append(formatted_product)

            return formatted_products

    except Exception as e:
        logger.error(f"Product search error: {e}")
        return [
            {
                "id": "demo",
                "name": "Demo Product",
                "description": "Demo description",
                "price": 0.0,
                "currency": "USD",
                "rating": 0,
                "category": "Demo",
                "inStock": False,
                "image": "/placeholder-image.jpg",
                "images": [],
                "variants": [],
                "sizes": [],
                "colors": [],
            }
        ]


async def variant_check(product_id: str, size: str, color: str = None):
    try:
        async with get_session() as session:
            stmt = select(Variant).filter(
                Variant.product_id == product_id, Variant.size == size
            )
            if color:
                stmt = stmt.filter(Variant.color == color)

            result = await session.execute(stmt)
            variant = result.scalars().first()

            if variant:
                return {
                    "available": variant.stock > 0,
                    "size": variant.size,
                    "color": variant.color,
                    "stock": variant.stock,
                }
            return {"available": False, "size": size, "color": color, "stock": 0}
    except Exception as e:
        logger.error(f"Variant check error: {e}")
        return {
            "available": False,
            "size": size,
            "color": color,
            "stock": 0,
            "error": str(e),
        }


async def process_order(order_id: int, action: str):
    try:
        valid_actions = ["create", "update", "cancel", "confirm"]
        if action not in valid_actions:
            return {
                "status": "error",
                "message": f"Invalid action. Must be one of: {valid_actions}",
            }

        return {
            "status": "success",
            "order_id": order_id,
            "action": action,
            "timestamp": "2025-08-23T19:15:39.724687Z",
        }
    except Exception as e:
        logger.error(f"Order processing error: {e}")
        return {
            "status": "error",
            "order_id": order_id,
            "action": action,
            "error": str(e),
        }


TOOLS = {
    "product_search": product_search,
    "variant_check": variant_check,
    "process_order": process_order,
}


async def call_tool(tool_name: str, arguments: dict):
    if tool_name not in TOOLS:
        raise ValueError(f"Unknown tool: {tool_name}")

    try:
        return await TOOLS[tool_name](**arguments)
    except Exception as e:
        logger.error(f"Tool {tool_name} error: {e}")

        if tool_name == "product_search" or tool_name == "product_search_raw":
            return [
                {
                    "id": "demo",
                    "name": "Demo Product",
                    "description": "We're having trouble finding products right now. Please try again.",
                    "price": 0.0,
                    "currency": "USD",
                    "rating": 0,
                    "category": "Demo",
                    "inStock": False,
                    "image": "/placeholder-image.jpg",
                    "images": [],
                    "variants": [],
                    "sizes": [],
                    "colors": [],
                }
            ]
        elif tool_name == "variant_check":
            return {"available": False, "error": "Unable to check variant availability"}
        elif tool_name == "process_order":
            return {"status": "error", "error": "Unable to process order at this time"}

        return {"error": str(e)}
