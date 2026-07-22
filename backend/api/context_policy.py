"""
Intent-scoped context transitions for the two-pass agent.

This module owns the decisions about *when to clear* carried-over conversation
context between turns — the logic that previously lived as four near-duplicate
"clear → re-fetch context" branches inside `TwoPassAgent.execute()` and was the
root of the context-carryover bug (a new question inheriting stale product /
order context, or an order-modification flow being wrongly cleared).

Centralizing it here means:
- `is_modification_flow` is computed once (it was duplicated).
- Each clear-decision is a small named predicate, unit-testable in isolation.
- `execute()` calls one coroutine, `apply_intent_transitions()`, instead of
  interleaving context mutations with the main flow.
"""

from __future__ import annotations

import logging
from typing import List

from backend.api.agent_schema import (
    ConversationContext,
    IntentType,
    Pass1Output,
    ToolCall,
    ToolName,
)
from backend.services.context_manager import context_manager

logger = logging.getLogger(__name__)

_ORDER_INTENTS = (IntentType.ORDER_TRACKING, IntentType.ORDER_MODIFICATION)


def is_modification_flow(pass1: Pass1Output, context: ConversationContext) -> bool:
    """
    True when the user is in an order-modification flow (returning/cancelling),
    whether the modification intent is on the current turn or carried over from
    the previous one. Selecting an order for modification must NOT clear order
    context, so several clear-decisions gate on this.
    """
    return (
        pass1.intent == IntentType.ORDER_MODIFICATION
        or context.last_intent == IntentType.ORDER_MODIFICATION
    )


def _switched_into_order_intent(
    pass1: Pass1Output, context: ConversationContext
) -> bool:
    """User was NOT in an order intent and now is, while product context exists."""
    return (
        pass1.intent in _ORDER_INTENTS
        and bool(context.recent_products)
        and context.last_intent not in _ORDER_INTENTS
    )


def _requested_all_orders(tool_calls: List[ToolCall]) -> bool:
    return any(tc.tool_name == ToolName.LIST_ORDERS for tc in tool_calls)


async def apply_intent_transitions(
    session_id: str,
    pass1: Pass1Output,
    context: ConversationContext,
) -> ConversationContext:
    """
    Apply all intent-driven context clears for this turn and return the
    resulting (possibly re-fetched) context. Safe to call once per turn,
    immediately after Pass 1, before tool execution.
    """
    modification_flow = is_modification_flow(pass1, context)
    dirty = False

    # 1. Product → order intent switch: drop stale product context so the user's
    #    new order question doesn't inherit "similar products" context.
    if _switched_into_order_intent(pass1, context):
        logger.info(
            "[Context] Clearing product context — intent switched %s -> %s",
            context.last_intent,
            pass1.intent,
        )
        await context_manager.clear_product_context(
            session_id, reason=f"Intent switched to {pass1.intent}"
        )
        dirty = True

    # 2. Pass 1 dropped the order reference AND the user asked to browse orders,
    #    and this is not a modification selection: clear the stale current_order.
    referenced_order_cleared = pass1.context_understanding.referenced_order is None
    if (
        referenced_order_cleared
        and _requested_all_orders(pass1.tool_calls)
        and not modification_flow
    ):
        logger.info("[Context] Clearing current_order — user requested to see all orders")
        await context_manager.clear_order_context(
            session_id, reason="User requested to see all orders"
        )
        dirty = True

    # 3. Pass 1 dropped the order reference on a genuine intent switch (order
    #    exists in context, not a modification flow): clear it.
    elif (
        referenced_order_cleared
        and context.current_order is not None
        and not modification_flow
    ):
        flow = pass1.context_understanding.conversation_flow
        logger.info(
            "[Context] Clearing current_order — intent switch detected (flow=%s)", flow
        )
        await context_manager.clear_order_context(
            session_id, reason=f"Intent switch detected: {flow}"
        )
        dirty = True
    elif referenced_order_cleared and modification_flow:
        logger.info(
            "[Context] Preserving current_order — user in modification flow "
            "(intent=%s, last_intent=%s)",
            pass1.intent,
            context.last_intent,
        )

    if dirty:
        refreshed = await context_manager.get_context(session_id)
        if refreshed is not None:
            return refreshed
    return context


def should_update_current_order_from_tracking(
    pass1: Pass1Output, context: ConversationContext
) -> bool:
    """
    After tracking data is fetched, only adopt it as `current_order` when the
    intent is genuinely tracking (or there is no order in context yet). This
    prevents tracking output from overwriting a modification target.
    """
    return (
        pass1.intent == IntentType.ORDER_TRACKING or context.current_order is None
    )
