"""Add product.category and trigram search index for hybrid product search

Revision ID: a1b2c3d4e5f6
Revises: de6611daabbb
Create Date: 2026-07-22 00:00:00.000000

Adds the `category` column (dropped at ingestion previously) and a pg_trgm GIN
index over name/category so the hybrid keyword pass in product_search runs
efficiently. Existing rows get NULL category until re-embedded/re-ingested.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "de6611daabbb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "products", sa.Column("category", sa.String(length=100), nullable=True)
    )
    # Enable trigram matching so the hybrid keyword pass (ILIKE on name/category)
    # can use an index instead of a full scan.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_products_name_trgm "
        "ON products USING gin (name gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_products_category_trgm "
        "ON products USING gin (category gin_trgm_ops)"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS ix_products_category_trgm")
    op.execute("DROP INDEX IF EXISTS ix_products_name_trgm")
    op.drop_column("products", "category")
