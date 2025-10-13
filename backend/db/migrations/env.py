import sys
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

from backend.db.schema import Base
from backend.config import settings

from pgvector.sqlalchemy import Vector

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

database_url = settings.database_url.replace(
    "postgresql+asyncpg://", "postgresql+psycopg2://"
)


config.set_main_option("sqlalchemy.url", database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")

    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    try:
        connectable = engine_from_config(
            config.get_section(config.config_ini_section, {}),
            prefix="sqlalchemy.",
            poolclass=pool.NullPool,
        )

        with connectable.connect() as connection:
            print("Connected to database", file=sys.stderr)
            connection.dialect.ischema_names["vector"] = Vector
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                compare_type=True,
                compare_server_default=True,
            )

            with context.begin_transaction():
                context.run_migrations()

    except Exception as e:
        import traceback

        traceback.print_exc()
        raise


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
