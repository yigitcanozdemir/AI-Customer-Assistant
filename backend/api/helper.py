from backend.api.schema import (
    Product as ProductModel,
    ProductVariant as ProductVariantModel,
)
import json


def format_products(products):
    formatted_products = []
    for product in products:
        images = [img.url for img in product.images] if product.images else []
        primary_image = images[0] if images else "/placeholder-image.jpg"

        variants = (
            [
                ProductVariantModel(
                    color=v.color,
                    size=v.size,
                    stock=v.stock,
                    available=v.stock > 0,
                )
                for v in product.variants
            ]
            if product.variants
            else []
        )

        product_obj = ProductModel(
            id=str(product.id),
            name=product.name,
            description=product.description or "",
            price=float(product.price) if product.price else 0.0,
            currency=getattr(product, "currency", "USD"),
            inStock=any(v.stock > 0 for v in variants) if variants else False,
            image=primary_image,
            images=images,
            variants=variants,
            sizes=list({v.size for v in variants if v.size}),
            colors=list({v.color for v in variants if v.color}),
        )
        formatted_products.append(product_obj)
    print(json.dumps([p.model_dump() for p in formatted_products], indent=2))
    return formatted_products
