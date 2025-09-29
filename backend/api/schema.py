from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional, Any, Union
from datetime import datetime, date
import uuid


class OrderProduct(BaseModel):
    id: uuid.UUID
    variant_id: uuid.UUID
    name: str
    price: float
    currency: str
    image: Optional[str] = None
    variant: Optional[str] = None
    variant_text: Optional[str] = None


class OrderItem(BaseModel):
    product_id: uuid.UUID
    variant_id: Optional[uuid.UUID] = None
    quantity: int
    product: Optional[OrderProduct] = None


class CreateOrderRequest(BaseModel):
    user_id: uuid.UUID
    user_name: str
    store: str
    items: List[OrderItem]


class OrderStatus(BaseModel):
    order_id: uuid.UUID
    status: str
    user_name: str
    created_at: datetime
    product: OrderProduct


class CreateOrderResponse(BaseModel):
    orders: List[OrderStatus]


class ListOrdersResponse(BaseModel):
    orders: List[OrderStatus]


class ProductVariant(BaseModel):
    id: str
    color: Optional[str] = None
    size: Optional[str] = None
    stock: int = 0
    available: bool = False


class ProductContext(BaseModel):
    id: str
    name: str
    price: float
    currency: str
    sizes: List[str] = []
    colors: List[str] = []
    variants: List[ProductVariant] = []


class Product(BaseModel):
    id: str
    name: str
    description: str = ""
    price: float = 0.0
    currency: str = "USD"
    inStock: bool = False
    image: str = "/placeholder-image.jpg"
    images: List[str] = Field(default_factory=list)
    variants: List[ProductVariant] = Field(default_factory=list)
    sizes: List[str] = Field(default_factory=list)
    colors: List[str] = Field(default_factory=list)


class MessageResponse(BaseModel):
    content: str
    store: str
    suggestions: Optional[List[str]] = None
    products: Optional[List[Product]] = None
    orders: Optional[List[OrderStatus]] = None
    timestamp: datetime


class Message(BaseModel):
    id: str
    type: str
    content: str
    timestamp: datetime
    products: Optional[List[Union[Product, ProductContext, OrderProduct]]] = None
    suggestions: Optional[List[str]] = None


class ChatEventData(BaseModel):
    question: str
    store: str
    user_name: str
    user_id: uuid.UUID
    product: Optional[ProductContext] = None
    order: Optional[OrderStatus] = None


class EventSchema(BaseModel):
    event_id: uuid.UUID
    event_data: ChatEventData
