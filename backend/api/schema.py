from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from datetime import datetime, date


class Product(BaseModel):
    id: str
    name: str
    price: float
    originalPrice: Optional[float] = None
    image: str
    rating: float
    category: str
    description: str
    inStock: bool
    sizes: List[str]
    colors: List[str]


class MessageResponse(BaseModel):
    content: str
    store: str
    suggestions: Optional[List[str]] = None
    products: Optional[List[Product]] = None
    timestamp: datetime
