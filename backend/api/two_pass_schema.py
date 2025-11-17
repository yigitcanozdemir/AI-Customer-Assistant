"""
Two-Pass Architecture Schema Definitions

This module contains all Pydantic models for the two-pass agent architecture:
- Pass 1: Intent Recognition & Tool Planning (JSON-only output)
- Pass 2: Natural Language Response Generation

The architecture separates intent parsing from response generation, providing:
- Better reliability through structured parsing
- Clearer separation of concerns
- Easier debugging and testing
- More predictable tool execution
"""

from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import List, Optional, Dict, Any, Literal
from enum import Enum


class StrictModel(BaseModel):
    """Base model ensuring OpenAI schema compatibility."""
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={"additionalProperties": False},
    )


class ToolName(str, Enum):
    """Available tool names in the system"""
    PRODUCT_SEARCH = "product_search"
    FAQ_SEARCH = "faq_search"
    VARIANT_CHECK = "variant_check"
    PROCESS_ORDER = "process_order"
    LIST_ORDERS = "list_orders"
    FETCH_ORDER_LOCATION = "fetch_order_location"


class ToolParameters(StrictModel):
    """Tool parameters with explicit fields for OpenAI structured output compatibility"""

    # Common parameters
    query: Optional[str] = None
    store: Optional[str] = None
    product_id: Optional[str] = None
    order_id: Optional[str] = None
    action: Optional[str] = None
    size: Optional[str] = None
    color: Optional[str] = None
    user_id: Optional[str] = None  # Used for user-scoped operations


class ToolCall(StrictModel):
    """
    Represents a single tool call with its parameters.

    This is output by the LLM in Pass 1 to indicate which tool should be executed.
    """

    tool_name: ToolName = Field(
        ...,
        description="Name of the tool to execute"
    )
    parameters: ToolParameters = Field(
        default_factory=ToolParameters,
        description="Parameters to pass to the tool"
    )
    reasoning: Optional[str] = Field(
        None,
        description="Brief explanation of why this tool is being called"
    )

    @field_validator('parameters')
    @classmethod
    def validate_parameters(cls, v, info):
        """Validate that required parameters are present for each tool"""
        tool_name = info.data.get('tool_name')

        if not tool_name:
            return v

        # Convert to dict for checking
        params_dict = v.model_dump(exclude_none=True) if hasattr(v, 'model_dump') else {}

        # Define required parameters for each tool
        required_params = {
            ToolName.PRODUCT_SEARCH: ['query', 'store'],
            ToolName.FAQ_SEARCH: ['query', 'store'],
            ToolName.VARIANT_CHECK: ['product_id'],
            ToolName.PROCESS_ORDER: ['order_id', 'action', 'store'],
            ToolName.LIST_ORDERS: ['store'],
            ToolName.FETCH_ORDER_LOCATION: ['order_id', 'store'],
        }

        if tool_name in required_params:
            missing = [p for p in required_params[tool_name] if p not in params_dict or params_dict[p] is None]
            if missing:
                raise ValueError(f"Missing required parameters for {tool_name}: {missing}")

        return v


class IntentType(str, Enum):
    """High-level intent categories"""
    PRODUCT_SEARCH = "product_search"
    ORDER_TRACKING = "order_tracking"
    ORDER_MODIFICATION = "order_modification"
    POLICY_INQUIRY = "policy_inquiry"
    STOCK_CHECK = "stock_check"
    GENERAL_INQUIRY = "general_inquiry"
    GREETING = "greeting"
    OFF_TOPIC = "off_topic"


class ContextUnderstanding(StrictModel):
    """Context understanding with explicit fields for OpenAI compatibility"""

    referenced_product: Optional[str] = None
    referenced_order: Optional[str] = None
    language_detected: str = "en"
    conversation_flow: Optional[str] = None


class AssessmentInfo(StrictModel):
    """
    Self-assessment information from Pass 1.
    This replaces the separate assessment LLM call for better performance.
    """

    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence score 0.0-1.0 for intent recognition quality"
    )

    flagging_reason: Literal["none", "potential_error", "off_topic", "unclear_request"] = Field(
        default="none",
        description="Reason for flagging this response for attention"
    )

    orders_found: int = Field(
        default=0,
        ge=0,
        description="Number of orders found in context or tools"
    )

    products_found: int = Field(
        default=0,
        ge=0,
        description="Number of products found in context or tools"
    )

    context_used: bool = Field(
        default=False,
        description="Whether conversation context was used in this response"
    )

    suggested_fallback: Optional[str] = Field(
        None,
        description="Suggested fallback response if confidence is low or flagged"
    )


class Pass1Output(StrictModel):
    """
    Pass 1 Output Schema - LLM Intent Recognition & Tool Planning

    In Pass 1, the LLM analyzes the user's message and outputs ONLY this structured JSON.
    No natural language is allowed in Pass 1.

    The LLM must:
    1. Identify the user's intent
    2. Determine which tools (if any) need to be called
    3. Extract the necessary parameters for each tool
    4. Understand context from conversation history
    5. Provide self-assessment for quality and flagging
    """
    model_config = ConfigDict(extra="forbid")  # Strict validation for OpenAI

    intent: IntentType = Field(
        ...,
        description="Primary intent detected from user's message"
    )

    tool_calls: List[ToolCall] = Field(
        default_factory=list,
        description="List of tools to execute (can be empty, one, or multiple)"
    )

    context_understanding: ContextUnderstanding = Field(
        default_factory=ContextUnderstanding,
        description="Understanding of conversation context (products, orders, references)"
    )

    requires_confirmation: bool = Field(
        default=False,
        description="Whether this action requires user confirmation before execution"
    )

    assessment: AssessmentInfo = Field(
        ...,
        description="Self-assessment of intent recognition quality and potential issues"
    )

    @field_validator('tool_calls')
    @classmethod
    def validate_tool_calls_logic(cls, v, info):
        """Validate logical consistency of tool calls"""
        intent = info.data.get('intent')

        # Check for required tools based on intent
        if intent == IntentType.ORDER_MODIFICATION:
            tool_names = [tc.tool_name for tc in v]
            # Order modifications should include FAQ search for policy check
            if ToolName.PROCESS_ORDER in tool_names and ToolName.FAQ_SEARCH not in tool_names:
                raise ValueError(
                    "ORDER_MODIFICATION intent with process_order must include faq_search for policy validation"
                )

        return v


class ToolResult(StrictModel):
    """
    Result from executing a tool.
    This is passed to Pass 2 so the LLM can generate a natural language response.
    """
    tool_name: ToolName
    success: bool
    data: Any = None
    error: Optional[str] = None
    execution_time_ms: Optional[float] = None


class Pass2Input(StrictModel):
    """
    Pass 2 Input Schema - Provided to LLM for Response Generation

    Pass 2 receives:
    1. Original user message
    2. Pass 1 output (intent & planned tools)
    3. Tool execution results
    4. Conversation context

    The LLM then generates a natural language response based on this information.
    """
    user_message: str = Field(
        ...,
        description="Original user message"
    )

    pass1_output: Pass1Output = Field(
        ...,
        description="The intent and tool plan from Pass 1"
    )

    tool_results: List[ToolResult] = Field(
        default_factory=list,
        description="Results from executed tools"
    )

    conversation_context: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional context (recent products, selected order, etc.)"
    )


class ConversationContext(StrictModel):
    """
    Enhanced conversation context tracking.

    This structure maintains awareness of:
    - Recently mentioned products
    - Currently selected order
    - Pending confirmations
    - User preferences (language, etc.)
    """
    session_id: str
    user_id: str
    user_name: str
    store: str

    # Context tracking
    recent_products: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Recently discussed products (last 10)"
    )

    current_order: Optional[Dict[str, Any]] = Field(
        None,
        description="Currently selected/referenced order"
    )

    last_intent: Optional[IntentType] = Field(
        None,
        description="Previous intent to understand conversation flow"
    )

    last_tool_results: List[str] = Field(
        default_factory=list,
        description="History of last tool calls for context awareness"
    )

    pending_confirmation: Optional[Dict[str, Any]] = Field(
        None,
        description="Action awaiting user confirmation"
    )

    detected_language: str = Field(
        default="en",
        description="Detected language code (en, es, fr, etc.)"
    )

    conversation_turn: int = Field(
        default=0,
        description="Current turn number in conversation"
    )


class AgentState(str, Enum):
    """Agent execution states"""
    PASS_1_INTENT_RECOGNITION = "pass_1_intent"
    TOOL_EXECUTION = "tool_execution"
    PASS_2_RESPONSE_GENERATION = "pass_2_response"
    CONFIRMATION_WAITING = "confirmation_waiting"
    ERROR = "error"
    COMPLETE = "complete"


class TwoPassExecutionTrace(StrictModel):
    """
    Complete execution trace for debugging and monitoring.
    Tracks the full lifecycle of a two-pass execution.
    """
    session_id: str
    turn_number: int

    # Timestamps
    started_at: float
    pass1_completed_at: Optional[float] = None
    tools_completed_at: Optional[float] = None
    pass2_completed_at: Optional[float] = None
    total_duration_ms: Optional[float] = None

    # State tracking
    current_state: AgentState = AgentState.PASS_1_INTENT_RECOGNITION

    # Pass 1 data
    user_input: str
    pass1_raw_output: Optional[str] = None  # Raw JSON from LLM
    pass1_parsed: Optional[Pass1Output] = None
    pass1_parse_error: Optional[str] = None

    # Tool execution data
    tools_executed: List[ToolResult] = Field(default_factory=list)
    tool_execution_errors: List[str] = Field(default_factory=list)

    # Pass 2 data
    pass2_input: Optional[Pass2Input] = None
    pass2_output: Optional[str] = None

    # Final response
    final_response: Optional[Dict[str, Any]] = None

    # Error tracking
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
