"""create pgvector extension

Revision ID: 232759b28172
Revises:
Create Date: 2025-10-10 19:37:41.273612

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "232759b28172"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    pass


def downgrade() -> None:
    op.execute("DROP EXTENSION vector")
    pass
