# Comprehensive Analysis: Conversation Flows and Context Management

## Executive Summary

This document analyzes all possible conversation flows, tool interactions, and context management logic in the two-pass agent system. It identifies potential edge cases, conflicts, and proposes improvements for a robust, production-ready system.

---

## 1. System Architecture Overview

### 1.1 Available Tools
1. **product_search** - Search for products
2. **faq_search** - Search policies and FAQs
3. **variant_check** - Check product stock/variants
4. **process_order** - Cancel/return orders
5. **list_orders** - List user's orders
6. **fetch_order_location** - Track order location

### 1.2 Intent Types
1. **PRODUCT_SEARCH** - Looking for products
2. **ORDER_TRACKING** - Track/check order status
3. **ORDER_MODIFICATION** - Cancel/return orders
4. **POLICY_INQUIRY** - Ask about store policies
5. **STOCK_CHECK** - Check product availability
6. **GENERAL_INQUIRY** - General shopping questions
7. **GREETING** - Greetings/pleasantries
8. **OFF_TOPIC** - Non-shopping topics

### 1.3 Context State
```python
ConversationContext:
  - recent_products: List[Dict]  # Last 10 products discussed
  - current_order: Dict | None   # Currently selected/referenced order
  - last_intent: IntentType | None  # Previous intent
  - last_tool_results: List[str]  # Recent tool calls
  - detected_language: str  # User's language
  - pending_confirmation: Dict | None  # Awaiting user confirmation
```

---

## 2. Context Management Flow Analysis

### 2.1 Current Context Update Sequence (two_pass_agent.py:135-239)

```
1. Line 135-139: Update with Pass 1 output (intent, language)
   ↓
2. Line 141-169: [CONDITIONAL] Clear context if list_orders + referenced_order=None
   - BUT: Skip clearing if ORDER_MODIFICATION intent detected
   ↓
3. Line 197-203: Update with products from tool results
   ↓
4. Line 206-216: Update with tracking_data (sets current_order)
   ↓
5. Line 221-232: [CONDITIONAL] Clear context if referenced_order=None
   - NO intent check here! Could clear after step 4 added order!
   ↓
6. Line 235-239: Update with Pass 1 output and tool calls
```

### 2.2 CRITICAL ISSUE: Duplicate Context Clearing Logic

**Problem**: Two separate places clear context with different conditions:
- **Place 1** (141-169): Checks for `list_orders` + modification intent
- **Place 2** (221-232): No intent check, just `referenced_order=None`

**Race Condition Scenario**:
```
User: "Track order" → selects order → "Let's make a return"

Pass 1 detects: ORDER_MODIFICATION
Pass 1 output: referenced_order=None (intent switch)
Pass 1 calls: list_orders

Execution flow:
1. Line 135: Update intent to ORDER_MODIFICATION ✓
2. Line 149: is_modification_flow = True ✓
3. Line 165: Skip clearing (preserved for modification) ✓
4. Line 206: tracking_data updates current_order (from previous turn) ✓
5. Line 222: referenced_order=None → CLEARS context ✗ (Wrong!)

Result: Context cleared AFTER we decided to preserve it!
```

---

## 3. Conversation Flow Matrix

### 3.1 Intent Transitions

| From Intent | To Intent | User Says | Expected Behavior | Current Implementation | Status |
|------------|-----------|-----------|-------------------|----------------------|--------|
| None | ORDER_TRACKING | "Track my order" | Call `list_orders` | ✅ Works | ✅ |
| ORDER_TRACKING | ORDER_TRACKING | "This one" | Call `fetch_order_location` | ✅ Works | ✅ |
| ORDER_TRACKING | ORDER_MODIFICATION | "Let's make a return" | Call `list_orders`, **CLEAR context** | ⚠️ Clears at line 222 | ⚠️ |
| ORDER_TRACKING | ORDER_MODIFICATION | "Return THIS" | Keep context, call `process_order` | ✅ Works (if prompt detects specific ref) | ✅ |
| ORDER_MODIFICATION | ORDER_MODIFICATION | "This one" (after list) | Call `process_order` with selected | ❌ May track instead | ❌ |
| ORDER_MODIFICATION | ORDER_TRACKING | "Track this" | Keep context, call `fetch_order_location` | ⚠️ May preserve modification intent | ⚠️ |
| PRODUCT_SEARCH | ORDER_TRACKING | "Check my orders" | Call `list_orders`, **CLEAR products** | ✅ Works | ✅ |
| ORDER_TRACKING | PRODUCT_SEARCH | "Show me products" | Call `product_search`, **CLEAR orders** | ⚠️ Unclear | ⚠️ |

### 3.2 Tool Combinations

| Tools Called | Intent | Context State | Issues |
|-------------|--------|---------------|--------|
| `list_orders` alone | ORDER_TRACKING | referenced_order=None | ✅ Clear context |
| `list_orders` alone | ORDER_MODIFICATION | referenced_order=None | ⚠️ May clear at line 222 |
| `list_orders`, `fetch_order_location` | ORDER_TRACKING | referenced_order=ID | ❌ Conflicting signals |
| `faq_search`, `process_order` | ORDER_MODIFICATION | referenced_order=ID | ✅ Works |
| `product_search`, `list_orders` | GENERAL_INQUIRY | Both None | ⚠️ Unclear intent |

---

## 4. Edge Cases and Potential Failures

### 4.1 Context Persistence Issues

**Case 1: Modification Flow with Stale Tracking Data**
```
Turn 1: "Track order" → User selects order A
  - tracking_data fetched
  - current_order = Order A (status: shipped)
  - last_intent = ORDER_TRACKING

Turn 2: "Let's make a return"
  - Pass 1: intent = ORDER_MODIFICATION, referenced_order = None
  - Line 165: Skip clearing (is_modification_flow = True) ✓
  - Line 206: tracking_data from Turn 1 still in scope? (May update current_order again)
  - Line 222: Clears context (referenced_order = None) ✗

Result: Context cleared when it should be preserved for order selection
```

**Case 2: Ambiguous "This One" After Intent Switch**
```
Turn 1: "Cancel order" → Shows order list
  - last_intent = ORDER_MODIFICATION

Turn 2: User clicks Order A → "This one"
  - selected_order = Order A
  - context.last_intent = ORDER_MODIFICATION
  - Order context includes: "User wants to CANCEL" ✓

Turn 3: User clicks Order B → "Actually, this one"
  - selected_order = Order B
  - context.last_intent = still ORDER_MODIFICATION
  - Order context still says: "User wants to CANCEL" ✓
  - Works correctly!

Turn 4: "Return this instead"
  - No selected_order parameter (user says "this", no click)
  - Must use context.current_order (Order B)
  - context.last_intent = ORDER_MODIFICATION (but was cancel, now return!)
  - Order context says: "User wants to CANCEL" ✗ Wrong action!

Issue: last_intent doesn't distinguish between cancel vs return
```

**Case 3: Product Search Interference**
```
Turn 1: "Show me dresses"
  - recent_products populated

Turn 2: "Track my order"
  - Should clear products? Or keep them?
  - Current: products stay in context (may confuse Pass 1)
```

### 4.2 Multi-Order Scenarios

**Case 4: Multiple Modifications**
```
Turn 1: "Cancel order" → Shows orders → "This one"
  - Process cancel, order cleared from context after confirmation

Turn 2: "Return another order"
  - Pass 1 sees: last_intent = ORDER_MODIFICATION
  - Should show list_orders ✓
  - BUT: What if user says "Return it" (ambiguous "it")?
  - No current_order in context → Fall back required
```

**Case 5: Concurrent Product and Order Context**
```
Turn 1: User viewing product X
  - recent_products = [Product X]

Turn 2: "Track order containing this product"
  - Should use Product X from context? Or ignore?
  - Current: Unclear if this is supported
```

### 4.3 Confirmation Flow Issues

**Case 6: Pending Confirmation Cancellation**
```
Turn 1: "Return order" → "This one"
  - pending_confirmation created
  - UI shows Confirm/Cancel buttons

Turn 2: User says "Actually, track it instead"
  - Should clear pending_confirmation ✓
  - Should switch to ORDER_TRACKING ✓
  - Current: May not clear pending_confirmation
```

**Case 7: Session Timeout with Pending Action**
```
Turn 1: "Return order" → "This one"
  - pending_confirmation stored in cache (TTL: 5 minutes)

<User waits 10 minutes>

Turn 2: "Confirm"
  - pending_confirmation expired
  - Error: "Confirmation not found"
  - User frustrated!
```

---

## 5. Tool-Specific Analysis

### 5.1 list_orders - The Ambiguous Tool

**Problem**: Used for BOTH tracking and modification
- ORDER_TRACKING: "Show my orders" → Clear context, browse mode
- ORDER_MODIFICATION: "Return an order" → Preserve intent, selection mode

**Current Detection**:
```python
is_modification_flow = (
    pass1_output.intent == IntentType.ORDER_MODIFICATION or
    context.last_intent == IntentType.ORDER_MODIFICATION
)
```

**Missing Cases**:
- User browses orders (tracking), then decides to modify → Need to detect transition
- User modifies, then wants to browse without action → Need to clear modification intent

### 5.2 fetch_order_location - Side Effects

**Problem**: Updates `current_order` in context (line 206-216)
- If user was in modification flow, this could overwrite the modification target
- Example: User selects Order A for return, then tracks Order B → Order A context lost

**Recommendation**: Only update `current_order` if intent is ORDER_TRACKING

### 5.3 process_order - Confirmation Required

**Current Flow**:
1. Pass 1 includes `process_order` in tool_calls
2. Backend filters it out (line 177)
3. Only executes after user confirms

**Issue**: What if user changes mind during confirmation?
- Current: Pending action remains until timeout
- Should: Detect intent change and clear pending action

---

## 6. Pass1 Prompt Analysis

### 6.1 Strengths ✅
- Clear intent switch detection (lines 101-135)
- Specific vs generic reference distinction (lines 116-134)
- Excellent examples (Examples 8 & 9 for track → return scenarios)
- Conversation flow tracking

### 6.2 Weaknesses ⚠️

**Issue 1: Action Granularity**
- Prompt treats ORDER_MODIFICATION as one intent
- Doesn't distinguish: cancel vs return vs exchange
- Result: conversation_flow must track "User wants to RETURN" vs "CANCEL"
- Problem: conversation_flow is not always preserved correctly

**Issue 2: Tool Combination Rules**
- Lines 144-148: Multi-tool calls encouraged
- But: No guidance on CONFLICTING tool combinations
- Example: What if LLM outputs `[list_orders, fetch_order_location]`?

**Issue 3: Context.current_order Ambiguity**
- Prompt says: "Check context for referenced order" (line 97)
- But doesn't specify: Is current_order from tracking VALID for modification?
- Pass 1 may assume tracked order can be returned directly

---

## 7. Proposed Improvements

### 7.1 Fix Duplicate Context Clearing (HIGH PRIORITY)

**Problem**: Lines 141-169 and 221-232 have duplicate clearing logic

**Solution**: Consolidate into single decision point

```python
# Remove duplicate clearing at line 141-169 OR line 221-232
# Use SINGLE clearing logic with comprehensive checks:

async def _should_clear_order_context(
    self,
    pass1_output: Pass1Output,
    context: ConversationContext,
    tool_calls: List[ToolCall]
) -> tuple[bool, str]:
    """
    Centralized logic to determine if order context should be cleared.

    Returns: (should_clear, reason)
    """
    # Never clear if order is specifically referenced
    if pass1_output.context_understanding.referenced_order is not None:
        return (False, "Order specifically referenced")

    # Check for intent switches
    intent_switched = (
        context.last_intent and
        context.last_intent != pass1_output.intent
    )

    # Check if list_orders is called
    has_list_orders = any(tc.tool_name == ToolName.LIST_ORDERS for tc in tool_calls)

    # CASE 1: ORDER_MODIFICATION flow
    if pass1_output.intent == IntentType.ORDER_MODIFICATION or context.last_intent == IntentType.ORDER_MODIFICATION:
        if has_list_orders and pass1_output.context_understanding.referenced_order is None:
            # User wants to select a (different) order for modification
            # Don't clear - they're in selection mode
            return (False, "Modification flow - preserving for selection")
        elif intent_switched:
            # User switched from modification to something else
            return (True, f"Intent switched from {context.last_intent} to {pass1_output.intent}")

    # CASE 2: Generic intent switch
    if intent_switched:
        return (True, f"Intent switched from {context.last_intent} to {pass1_output.intent}")

    # CASE 3: User explicitly wants to browse orders (no modification intent)
    if has_list_orders and pass1_output.intent == IntentType.ORDER_TRACKING:
        return (True, "User browsing orders for tracking")

    # CASE 4: No clearing needed
    return (False, "Context remains valid")
```

### 7.2 Add Action Type Tracking (MEDIUM PRIORITY)

**Problem**: ORDER_MODIFICATION doesn't distinguish cancel/return/exchange

**Solution**: Extend context with specific action type

```python
# In ConversationContext schema:
class ConversationContext(StrictModel):
    # ... existing fields ...

    pending_modification_action: Optional[str] = Field(
        None,
        description="Specific modification action if in ORDER_MODIFICATION flow: 'cancel', 'return', 'exchange'"
    )
```

**Update order context guidance**:
```python
if context.last_intent == IntentType.ORDER_MODIFICATION and context.pending_modification_action:
    intent_guidance = f"""
**CRITICAL CONTEXT**: The user previously requested to {context.pending_modification_action.upper()} an order.
They are now selecting THIS specific order for that {context.pending_modification_action} action.
When they say "this order", "it", "that one", etc., they want to {context.pending_modification_action.upper()} it.
If they confirm selection, call process_order with action={context.pending_modification_action}.
"""
```

### 7.3 Prevent tracking_data from Overwriting Modification Context (HIGH PRIORITY)

**Problem**: Line 206-216 updates current_order unconditionally

**Solution**: Only update if intent is ORDER_TRACKING

```python
# Update current_order when tracking is fetched
# BUT: Don't overwrite if user is in modification flow
if tracking_data:
    should_update_current_order = (
        pass1_output.intent == IntentType.ORDER_TRACKING or
        context.current_order is None
    )

    if should_update_current_order:
        order_dict = {
            'order_id': str(tracking_data.order_id),
            'status': tracking_data.status,
            'created_at': str(tracking_data.created_at),
        }
        await context_manager.update_context(
            session_id=session_id,
            selected_order=order_dict,
        )
        self.logger.info(f"[Context] Updated current_order from tracking data (intent={pass1_output.intent})")
    else:
        self.logger.info(
            f"[Context] Skipping current_order update - user in modification flow (intent={pass1_output.intent})"
        )
```

### 7.4 Auto-Clear Pending Confirmation on Intent Change (MEDIUM PRIORITY)

**Problem**: Pending confirmation doesn't clear when user changes mind

**Solution**: Detect intent change and clear pending

```python
# After Pass 1, before tool execution
if context.pending_confirmation:
    # Check if intent changed
    pending_intent = context.pending_confirmation.get('action_type')
    if pass1_output.intent not in [IntentType.ORDER_MODIFICATION, None]:
        # User switched away from modification - clear pending
        await context_manager.clear_pending_confirmation(session_id)
        self.logger.info(
            f"[Context] Cleared pending confirmation - user switched to {pass1_output.intent}"
        )
```

### 7.5 Improve Context Summary for Pass 1 (LOW PRIORITY)

**Problem**: context_summary might not capture all relevant info

**Solution**: Enhance build_context_summary to include pending action

```python
def build_context_summary(self, context: ConversationContext) -> str:
    # ... existing logic ...

    # Add pending action info
    if context.pending_confirmation:
        action_type = context.pending_confirmation.get('parameters', {}).get('action', 'unknown')
        order_id = context.pending_confirmation.get('parameters', {}).get('order_id', 'unknown')
        summary_parts.append(
            f"Awaiting confirmation for: {action_type} order {order_id}"
        )

    # Add pending modification action
    if context.pending_modification_action:
        summary_parts.append(
            f"User is selecting order to: {context.pending_modification_action}"
        )
```

### 7.6 Add Tool Combination Validation (LOW PRIORITY)

**Problem**: Pass 1 might output conflicting tool combinations

**Solution**: Validate tool calls before execution

```python
def _validate_tool_combinations(self, tool_calls: List[ToolCall]) -> List[str]:
    """
    Validate that tool combinations make sense.
    Returns list of warnings (empty if valid).
    """
    warnings = []
    tool_names = [tc.tool_name for tc in tool_calls]

    # Check for conflicting combinations
    if ToolName.LIST_ORDERS in tool_names and ToolName.FETCH_ORDER_LOCATION in tool_names:
        warnings.append("Conflicting tools: list_orders and fetch_order_location both called")

    if ToolName.PROCESS_ORDER in tool_names and len(tool_names) > 2:
        # process_order should only be with faq_search
        other_tools = [t for t in tool_names if t not in [ToolName.PROCESS_ORDER, ToolName.FAQ_SEARCH]]
        if other_tools:
            warnings.append(f"Unexpected tools with process_order: {other_tools}")

    return warnings
```

---

## 8. Testing Scenarios

### 8.1 Critical Test Cases

**Test 1: Track → Return (Generic)**
```
User: "Track my order" → selects order → sees tracking
User: "Let's make a return"
Expected: Show order list, preserve modification intent
```

**Test 2: Track → Return THIS (Specific)**
```
User: "Track my order" → selects order → sees tracking
User: "Return this"
Expected: Use tracked order, call process_order(action=return)
```

**Test 3: Return → Cancel Another**
```
User: "Return order" → selects order A → confirmation shown
User: "Actually cancel another order"
Expected: Clear pending return, show order list for cancel
```

**Test 4: Multiple Order Selections**
```
User: "Return order" → selects order A → "Actually this one" → selects order B
Expected: Order B selected for return, not Order A
```

**Test 5: Pending Confirmation Intent Switch**
```
User: "Return order" → selects order → confirmation shown
User: "Track it instead"
Expected: Clear pending confirmation, show tracking for same order
```

**Test 6: Stale Context After Completion**
```
User: "Cancel order" → selects → confirms → completed
User: "Track an order"
Expected: No stale order in context, fresh order list shown
```

### 8.2 Edge Case Tests

**Test 7: Rapid Intent Switches**
```
User: "Track" → "Cancel" → "Return" → "Track" → "This one"
Expected: System follows last intent (track), no confusion
```

**Test 8: Ambiguous Pronouns**
```
User: Tracks order A
User: "Show my orders" → sees multiple
User: "Return it"
Expected: What is "it"? Order A or last in list? (Ambiguity handling)
```

**Test 9: Cross-Session Context**
```
Session 1: User selects order A for return → doesn't confirm → closes chat
Session 2 (new): User says "Confirm"
Expected: No pending confirmation found, prompt to restart
```

---

## 9. Metrics and Monitoring

### 9.1 Proposed Metrics

**Context Management**:
- `context_clears_total{reason}` - Count of context clears by reason
- `context_preservation_decisions{decision}` - preserve vs clear decisions
- `intent_switches_total{from_intent, to_intent}` - Track all transitions

**Tool Execution**:
- `tool_call_combinations{tools}` - Frequency of tool combinations
- `tool_execution_conflicts_total` - Conflicting tool calls detected
- `order_context_overwrites_total{reason}` - Track when current_order changes unexpectedly

**Conversation Quality**:
- `ambiguous_references_total{type}` - When "this/it" is unclear
- `pending_confirmation_clears_total{reason}` - Why confirmations were cleared
- `intent_confidence_by_scenario{scenario}` - Confidence scores per flow type

### 9.2 Alerting Thresholds

- Alert if `intent_confidence < 0.5` for >10% of requests
- Alert if `context_clears_total{reason=unexpected}` spikes
- Alert if `pending_confirmation_clears_total{reason=timeout}` is high

---

## 10. Recommendations Priority

### P0 (Critical - Fix Immediately):
1. ✅ **DONE**: Fix order context clearing for modification flows (committed)
2. ✅ **DONE**: Add intent-aware order context guidance (committed)
3. **TODO**: Consolidate duplicate context clearing logic (Section 7.1)
4. **TODO**: Prevent tracking_data from overwriting modification context (Section 7.3)

### P1 (High - Fix This Sprint):
1. **TODO**: Add action type tracking (cancel/return/exchange) (Section 7.2)
2. **TODO**: Auto-clear pending confirmation on intent change (Section 7.4)
3. **TODO**: Add comprehensive test coverage (Section 8)

### P2 (Medium - Next Sprint):
1. **TODO**: Improve context summary for better Pass 1 decisions (Section 7.5)
2. **TODO**: Add tool combination validation (Section 7.6)
3. **TODO**: Implement monitoring metrics (Section 9)

### P3 (Low - Future):
1. **TODO**: Support product-order cross-references (Case 5)
2. **TODO**: Add conversation replay for debugging
3. **TODO**: ML-based intent confidence calibration

---

## 11. Conclusion

The current system is **fundamentally sound** with comprehensive prompt engineering and good intent detection. However, there are **critical implementation issues** in context management that can cause:

1. **Context cleared when it should be preserved** (modification flows)
2. **Tracking data overwriting modification targets**
3. **Ambiguous action types** (cancel vs return)
4. **Stale pending confirmations**

The fixes proposed in Section 7 address these issues with **minimal code changes** and **high reliability**. The system will be **production-ready** after implementing P0 and P1 fixes.

**Estimated effort**: 2-3 days for P0+P1 fixes + testing
