from sqlalchemy import (
    Column,
    String,
    BigInteger,
    Text,
    Boolean,
    Numeric,
    Integer,
    TIMESTAMP,
    ARRAY,
    ForeignKey,
    Index,
    text,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector


Base = declarative_base()


class Product(Base):
    __tablename__ = "products"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    store = Column(String(100), nullable=False, index=True)
    title = Column(Text, nullable=False)
    handle = Column(String(255), nullable=True)
    body_html = Column(Text, nullable=True)
    vendor = Column(String(255), nullable=True)
    product_type = Column(String(255), nullable=True)
    tags = Column(PG_ARRAY(String), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    variants = relationship("Variant", back_populates="product", cascade="all, delete")
    images = relationship("Image", back_populates="product", cascade="all, delete")
    embeddings = relationship(
        "Embedding", back_populates="product", cascade="all, delete"
    )


class Variant(Base):
    __tablename__ = "variants"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    product_id = Column(
        BigInteger,
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title = Column(String(255), nullable=True)
    option1 = Column(String(255), nullable=True)
    option2 = Column(String(255), nullable=True)
    option3 = Column(String(255), nullable=True)
    sku = Column(String(255), nullable=True)
    requires_shipping = Column(Boolean, nullable=True)
    taxable = Column(Boolean, nullable=True)
    available = Column(Boolean, nullable=True)
    stock = Column(Integer, default=0)
    price = Column(Numeric(10, 2), nullable=True)
    grams = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    product = relationship("Product", back_populates="variants")


class Image(Base):
    __tablename__ = "images"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    product_id = Column(
        BigInteger,
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position = Column(Integer, nullable=True)
    src = Column(Text, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())

    product = relationship("Product", back_populates="images")


class Embedding(Base):
    __tablename__ = "embeddings"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    product_id = Column(
        BigInteger,
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    content_type = Column(String(50), nullable=False)
    content = Column(Text, nullable=True)
    embedding = Column(Vector(3072), nullable=False)

    product = relationship("Product", back_populates="embeddings")


class FAQ(Base):
    __tablename__ = "faqs"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    store = Column(String(100), nullable=False, index=True)
    content = Column(Text, nullable=True)

    embedding = Column(Vector(3072), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), onupdate=func.now())
