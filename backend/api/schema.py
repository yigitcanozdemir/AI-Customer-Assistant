from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional, Any, Union
from datetime import datetime, date


class ProductVariant(BaseModel):
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
    timestamp: datetime


class Message(BaseModel):
    id: str
    type: str
    content: str
    timestamp: datetime
    products: Optional[List[Union[Product, ProductContext]]] = None
    suggestions: Optional[List[str]] = None


class ChatEventData(BaseModel):
    question: str
    store: str
    product: Optional[ProductContext] = None


class EventSchema(BaseModel):
    event_id: str
    event_data: ChatEventData
