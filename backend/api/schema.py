from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional, Any
from datetime import datetime, date


class ProductVariant(BaseModel):
    color: Optional[str] = None
    size: Optional[str] = None
    stock: int = 0


class Product(BaseModel):
    id: str
    name: str
    description: str = ""
    price: float = 0.0
    currency: str = "USD"
    rating: int = 0
    category: str = "General"
    inStock: bool = False
    image: str = "/placeholder-image.jpg"  # Required single image field
    images: List[str] = Field(default_factory=list)  # Additional images
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
    products: Optional[List[Product]] = None
    suggestions: Optional[List[str]] = None


class ChatEventData(BaseModel):
    question: str
    store: Optional[str] = None
    message_history: List[Message]


class EventSchema(BaseModel):
    event_id: str
    event_data: ChatEventData
