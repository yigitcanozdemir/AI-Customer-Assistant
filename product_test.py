from fastapi import FastAPI
from fastapi.responses import Response
import pandas as pd
import io

from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from backend.db.session import get_session
from backend.db.schema import Product

app = FastAPI(title="Product API")


async def fetch_products_df():
    async with get_session() as session:  # burada async context manager kullan
        result = await session.execute(
            select(Product).options(
                selectinload(Product.variants), selectinload(Product.images)
            )
        )
        products = result.scalars().all()

        rows = []
        for p in products:
            variants = ", ".join([v.title for v in getattr(p, "variants", [])])
            images = ", ".join([img.src for img in getattr(p, "images", [])])
            rows.append(
                {
                    "id": p.id,
                    "title": p.title,
                    "handle": p.handle,
                    "body_html": p.body_html,
                    "vendor": p.vendor,
                    "product_type": p.product_type,
                    "tags": p.tags,
                    "variants": variants,
                    "images": images,
                }
            )

        df = pd.DataFrame(rows)
        return df


@app.get("/products/csv")
async def get_products_csv():
    df = await fetch_products_df()
    stream = io.StringIO()
    df.to_csv(stream, index=False)
    return Response(content=stream.getvalue(), media_type="text/csv")
