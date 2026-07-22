"""
Redis-based Context Manager for Two-Pass Architecture

This module provides persistent session and context management using Redis.
It tracks conversation history, context references, and intent flow across sessions.

Features:
- Persistent conversation history storage
- Intelligent context tracking (products, orders, intents)
- Session-based context retrieval
- Automatic context pruning and management
- Language detection tracking
"""

import json
import logging
from typing import List, Dict, Any, Optional
from backend.services.cache import cache_manager
from backend.api.agent_schema import ConversationContext, Pass1Output

logger = logging.getLogger(__name__)


class ContextManager:
    """
    Manages conversation context and history using Redis.

    This is a singleton that handles:
    - Session-based conversation history
    - Context tracking (products, orders, language)
    - Intelligent context summarization
    - Intent flow tracking
    """

    # Redis key prefixes
    CONTEXT_KEY_PREFIX = "context:"
    TURN_KEY_PREFIX = "turn:"

    # TTL settings (in seconds)
    CONTEXT_TTL = 3600 * 24  # 24 hours

    # Context limits
    MAX_RECENT_PRODUCTS = 10  # Maximum recent products to track
    MAX_TOOL_HISTORY = 5  # Maximum recent tool calls to remember

    def __init__(self):
        """Initialize the context manager"""
        self.logger = logging.getLogger(__name__)

    async def get_context(self, session_id: str) -> Optional[ConversationContext]:
        """
        Retrieve conversation context for a session.

        Args:
            session_id: The session identifier

        Returns:
            ConversationContext object or None if not found
        """
        try:
            context_key = f"{self.CONTEXT_KEY_PREFIX}{session_id}"
            context_data = await cache_manager.get(context_key)

            if not context_data:
                return None

            # Parse JSON and reconstruct ConversationContext
            context_dict = json.loads(context_data)
            return ConversationContext(**context_dict)

        except Exception as e:
            self.logger.error(f"Error retrieving context for session {session_id}: {e}")
            return None

    async def save_context(self, context: ConversationContext) -> bool:
        """
        Save conversation context to Redis.

        Args:
            context: The ConversationContext to save

        Returns:
            True if successful, False otherwise
        """
        try:
            context_key = f"{self.CONTEXT_KEY_PREFIX}{context.session_id}"
            context_json = context.model_dump_json()

            await cache_manager.set(
                context_key,
                context_json,
                ttl=self.CONTEXT_TTL
            )

            return True

        except Exception as e:
            self.logger.error(f"Error saving context for session {context.session_id}: {e}")
            return False

    async def update_context(
        self,
        session_id: str,
        pass1_output: Optional[Pass1Output] = None,
        products: Optional[List[Dict[str, Any]]] = None,
        selected_order: Optional[Dict[str, Any]] = None,
        tool_calls: Optional[List[str]] = None,
        language: Optional[str] = None,
    ) -> ConversationContext:
        """
        Update conversation context with new information.

        Args:
            session_id: Session identifier
            pass1_output: Output from Pass 1 (intent recognition)
            products: New products to add to context
            selected_order: Currently selected order
            tool_calls: Tool calls made in this turn
            language: Detected language

        Returns:
            Updated ConversationContext
        """
        try:
            # Get existing context or create new one
            context = await self.get_context(session_id)

            if not context:
                # Create new context
                context = ConversationContext(
                    session_id=session_id,
                    user_id="",  # Will be set by caller
                    user_name="",  # Will be set by caller
                    store="",  # Will be set by caller
                )

            # Update turn number
            context.conversation_turn += 1

            # Update intent history
            if pass1_output:
                context.last_intent = pass1_output.intent

            # Update recent products
            if products:
                for product in products:
                    # Check if product already exists
                    # Handle both dict and Pydantic model formats
                    existing_ids = [
                        p.id if hasattr(p, 'id') else p.get('id')
                        for p in context.recent_products
                    ]
                    product_id = product.id if hasattr(product, 'id') else product.get('id')

                    if product_id not in existing_ids:
                        # Convert Product model to dict for Pydantic serialization compatibility
                        product_dict = product.model_dump() if hasattr(product, 'model_dump') else product
                        context.recent_products.append(product_dict)

                # Keep only last N products
                context.recent_products = context.recent_products[-self.MAX_RECENT_PRODUCTS:]

            # Update current order
            if selected_order:
                context.current_order = selected_order

            # Update tool history
            if tool_calls:
                context.last_tool_results.extend(tool_calls)
                context.last_tool_results = context.last_tool_results[-self.MAX_TOOL_HISTORY:]

            # Update language
            if language:
                context.detected_language = language

            # Save updated context
            await self.save_context(context)

            return context

        except Exception as e:
            self.logger.error(f"Error updating context for session {session_id}: {e}")
            raise

    async def clear_session(self, session_id: str) -> bool:
        """
        Clear structured context and turn counter for a session.

        Note: the user-facing message log lives in `session_manager`
        (`session_history:` keys), not here — this only clears the
        structured `ConversationContext` and turn counter.

        Args:
            session_id: Session identifier

        Returns:
            True if successful, False otherwise
        """
        try:
            context_key = f"{self.CONTEXT_KEY_PREFIX}{session_id}"
            turn_key = f"{self.TURN_KEY_PREFIX}{session_id}"

            await cache_manager.delete(context_key)
            await cache_manager.delete(turn_key)

            return True

        except Exception as e:
            self.logger.error(f"Error clearing session {session_id}: {e}")
            return False

    async def increment_turn(self, session_id: str) -> int:
        """
        Increment and return the current turn number for a session.

        Args:
            session_id: Session identifier

        Returns:
            New turn number
        """
        try:
            turn_key = f"{self.TURN_KEY_PREFIX}{session_id}"
            turn_data = await cache_manager.get(turn_key)

            if turn_data:
                turn_number = int(turn_data) + 1
            else:
                turn_number = 1

            await cache_manager.set(
                turn_key,
                str(turn_number),
                ttl=self.CONTEXT_TTL
            )

            return turn_number

        except Exception as e:
            self.logger.error(f"Error incrementing turn for session {session_id}: {e}")
            return 1

    def build_context_summary(self, context: ConversationContext) -> str:
        """
        Build a human-readable context summary for prompts.

        Args:
            context: The conversation context

        Returns:
            Formatted context summary string
        """
        summary_parts = []

        # Recent products
        if context.recent_products:
            product_count = len(context.recent_products)
            summary_parts.append(f"Recently discussed {product_count} product(s)")

        # Current order
        if context.current_order:
            order_id = context.current_order.get('order_id', 'unknown')
            order_status = context.current_order.get('status', 'unknown')
            summary_parts.append(f"Currently selected order: {order_id} (status: {order_status})")

        # Last intent
        if context.last_intent:
            summary_parts.append(f"Previous intent: {context.last_intent}")

        # Last tools
        if context.last_tool_results:
            tools = ', '.join(context.last_tool_results[-3:])
            summary_parts.append(f"Recent tools used: {tools}")

        # Language
        if context.detected_language and context.detected_language != 'en':
            summary_parts.append(f"User language: {context.detected_language}")

        # Pending confirmation
        if context.pending_confirmation:
            parameters = context.pending_confirmation.get('parameters', {})
            specific_action = parameters.get('action', 'unknown')
            order_id = parameters.get('order_id', 'unknown')
            summary_parts.append(
                f"Pending confirmation: {specific_action} order {order_id} (user must say 'confirm' or select from UI)"
            )

        if not summary_parts:
            return "No prior context in this conversation."

        return "\n".join(f"- {part}" for part in summary_parts)

    async def clear_product_context(
        self,
        session_id: str,
        reason: str = "Manual clear"
    ) -> bool:
        """
        Clear recent products from context.
        This is called when:
        - User switches from product context to order context (intent switch)
        - Product context becomes stale or invalid

        Args:
            session_id: Session identifier
            reason: Reason for clearing (for logging)

        Returns:
            True if successful, False otherwise
        """
        try:
            context = await self.get_context(session_id)

            if not context:
                self.logger.warning(f"[Context Clear] No context found for session {session_id}")
                return True  # Nothing to clear

            # Log the clearing action
            if context.recent_products:
                product_count = len(context.recent_products)
                self.logger.info(
                    f"[Context Clear] Clearing {product_count} product(s) from context. Reason: {reason}"
                )

            # Clear recent products
            context.recent_products = []

            # Save updated context
            await self.save_context(context)

            return True

        except Exception as e:
            self.logger.error(f"[Context Clear] Error clearing product context: {e}")
            return False

    async def clear_order_context(
        self,
        session_id: str,
        reason: str = "Manual clear"
    ) -> bool:
        """
        Clear the current order from context.
        This is called when:
        - User completes an order operation (cancel, return)
        - User explicitly requests to see all orders
        - Order context becomes stale or invalid
        Args:
            session_id: Session identifier
            reason: Reason for clearing (for logging)
        Returns:
            True if successful, False otherwise
        """
        try:
            context = await self.get_context(session_id)

            if not context:
                self.logger.warning(f"[Context Clear] No context found for session {session_id}")
                return True  # Nothing to clear

            # Log the clearing action
            if context.current_order:
                order_id = context.current_order.get('order_id', 'unknown')
                self.logger.info(
                    f"[Context Clear] Clearing order {order_id} from context. Reason: {reason}"
                )

            # Clear current order
            context.current_order = None

            # CRITICAL FIX: Clear last_intent when order operation completes
            # This prevents intent carryover to newly selected orders
            # Example: User returns order A, then selects order B and says "track this"
            # Without clearing, system thinks user wants to return order B
            if "Order operation completed" in reason:
                old_intent = context.last_intent
                context.last_intent = None
                self.logger.info(
                    f"[Context Clear] Cleared last_intent ({old_intent}) after order operation completion to prevent intent carryover"
                )

            # Save updated context
            await self.save_context(context)

            return True

        except Exception as e:
            self.logger.error(f"[Context Clear] Error clearing order context: {e}")
            return False

    async def store_pending_confirmation(
        self,
        session_id: str,
        action_id: str,
        action_data: Dict[str, Any]
    ) -> bool:
        """
        Store a pending confirmation in context.

        Args:
            session_id: Session identifier
            action_id: Unique action identifier
            action_data: Data about the pending action

        Returns:
            True if successful, False otherwise
        """
        try:
            context = await self.get_context(session_id)

            if not context:
                self.logger.warning(f"No context found for session {session_id}")
                return False

            context.pending_confirmation = {
                'action_id': action_id,
                **action_data
            }

            await self.save_context(context)

            return True

        except Exception as e:
            self.logger.error(f"Error storing pending confirmation: {e}")
            return False

    async def clear_pending_confirmation(self, session_id: str) -> bool:
        """
        Clear pending confirmation from context.

        Args:
            session_id: Session identifier

        Returns:
            True if successful, False otherwise
        """
        try:
            context = await self.get_context(session_id)

            if not context:
                return True  # Already cleared

            context.pending_confirmation = None

            await self.save_context(context)

            return True

        except Exception as e:
            self.logger.error(f"Error clearing pending confirmation: {e}")
            return False


# Singleton instance
context_manager = ContextManager()
