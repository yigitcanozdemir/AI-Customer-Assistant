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


class ResponseAssessment(BaseModel):
    """LLM's self-assessment of its response quality and context"""

    confidence_score: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence in response accuracy (0.0 = no confidence, 1.0 = completely confident)",
    )
    is_context_relevant: bool = Field(
        ...,
        description="Whether the user's question is relevant to e-commerce shopping context",
    )
    requires_human: bool = Field(
        ..., description="Whether this conversation requires human intervention"
    )
    reasoning: str = Field(..., description="Brief explanation of the assessment")
    warning_message: Optional[str] = Field(
        None, description="User-facing warning message if needed"
    )


class PendingAction(BaseModel):
    action_id: str
    action_type: str
    parameters: dict
    requires_confirmation: bool = True
    confirmation_message: str


class MessageResponse(BaseModel):
    content: str
    store: str
    suggestions: Optional[List[str]] = None
    products: Optional[List[Product]] = None
    orders: Optional[List[OrderStatus]] = None
    timestamp: datetime
    requires_human: bool = False
    confidence_score: Optional[float] = None
    is_context_relevant: bool = True
    pending_action: Optional[PendingAction] = None
    warning_message: Optional[str] = None
    assessment_reasoning: Optional[str] = None


class Message(BaseModel):
    id: str
    type: str
    content: str
    timestamp: datetime
    products: Optional[List[Union[Product, ProductContext, OrderProduct]]] = None
    suggestions: Optional[List[str]] = None
    requires_human: Optional[bool] = False
    confidence_score: Optional[float] = None


class ChatEventData(BaseModel):
    question: str
    store: str
    user_name: str
    user_id: uuid.UUID
    product: Optional[ProductContext] = None
    order: Optional[OrderStatus] = None
    is_initial_message: Optional[bool] = False
    confirm_action_id: Optional[str] = None

    class Config:
        arbitrary_types_allowed = True


class EventSchema(BaseModel):
    event_id: uuid.UUID
    event_data: ChatEventData
