"""Unit tests for the conversation-flow fixes.

Deliberately dependency-free (stdlib `unittest`, no pytest) and free of DB, Redis
and LLM calls, so it runs with just the app's own requirements:

    python -m unittest discover -s backend/tests -v

Covers the logic most likely to regress silently:
  - `_handle_confirmation` name resolution (the UnboundLocalError crash)
  - transcript building (skips the current message, hidden markers, images)
  - language-code normalization
  - the Pass 1 auto-repair validator
  - non-specific "similar products" query substitution
  - order-timestamp coercion for the return-policy window
  - provider message-role normalization
"""

import symtable
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from backend.api.agent import (
    ESCALATING_FLAGS,
    TwoPassAgent,
    _NON_SPECIFIC_SIMILAR_QUERIES,
    _coerce_to_date,
)
from backend.api.agent_schema import (
    AssessmentInfo,
    ToolResult,
    TwoPassExecutionTrace,
    ContextUnderstanding,
    IntentType,
    LANGUAGE_NAMES,
    Pass1Output,
    ToolCall,
    ToolName,
    ToolParameters,
    normalize_language_code,
)
from backend.services.llm.anthropic_provider import AnthropicProvider
from backend.services.llm.base import LLMMessage
from backend.services.llm.gemini_provider import GeminiProvider

AGENT_PATH = Path(__file__).resolve().parents[1] / "api" / "agent.py"


def msg(type_, content, hide_content=False):
    """A stand-in for api.schema.Message with only the fields history reads."""
    return SimpleNamespace(type=type_, content=content, hide_content=hide_content)


class TestConfirmationNameScoping(unittest.TestCase):
    """Guards the UnboundLocalError that broke every return/cancel confirm.

    A function-local `import X` binds X as local for the WHOLE function body, so
    a use of X earlier in the function raises UnboundLocalError. This asserts the
    names stay module-global rather than re-imported inside the function.
    """

    def test_shared_names_are_not_function_local(self):
        table = symtable.symtable(AGENT_PATH.read_text(), "agent.py", "exec")

        def find(scope, name):
            for child in scope.get_children():
                if child.get_name() == name:
                    return child
                found = find(child, name)
                if found:
                    return found
            return None

        fn = find(table, "_handle_confirmation")
        self.assertIsNotNone(fn, "_handle_confirmation not found")

        for name in (
            "ToolName",
            "ToolResult",
            "Pass1Output",
            "IntentType",
            "ContextUnderstanding",
            "AssessmentInfo",
            "filter_tool_params",
        ):
            symbol = fn.lookup(name)
            self.assertFalse(
                symbol.is_local(),
                f"{name} is function-local in _handle_confirmation — a use before "
                f"the import will raise UnboundLocalError at runtime",
            )


class TestEscalationFlags(unittest.TestCase):
    def test_clarification_does_not_escalate(self):
        self.assertNotIn("unclear_request", ESCALATING_FLAGS)

    def test_dead_off_topic_flag_removed(self):
        # "off_topic" is an IntentType, never a valid flagging_reason.
        self.assertNotIn("off_topic", ESCALATING_FLAGS)

    def test_serious_violations_still_escalate(self):
        for flag in ("abusive_language", "policy_violation", "prompt_injection"):
            self.assertIn(flag, ESCALATING_FLAGS)


class TestBuildHistoryMessages(unittest.TestCase):
    def setUp(self):
        self.agent = TwoPassAgent()

    def test_empty_history(self):
        self.assertEqual(self.agent._build_history_messages(None), [])
        self.assertEqual(self.agent._build_history_messages([]), [])

    def test_drops_current_user_message_only_once(self):
        history = [
            msg("user", "show me t-shirts"),
            msg("assistant", "Here are some options."),
            msg("user", "show me t-shirts"),  # the current turn (duplicate text)
        ]
        out = self.agent._build_history_messages(
            history, current_user_input="show me t-shirts"
        )
        self.assertEqual(
            [(m.role, m.content) for m in out],
            [("user", "show me t-shirts"), ("assistant", "Here are some options.")],
            "only the newest matching user message should be dropped",
        )

    def test_skips_hidden_order_markers(self):
        history = [
            msg("user", "track my order"),
            msg("assistant", "Here are your orders."),
            msg("user", "User selected order: 550e8400-e29b-41d4-a716-446655440000",
                hide_content=True),
            msg("user", "return this"),
        ]
        out = self.agent._build_history_messages(history, current_user_input="return this")
        joined = " ".join(m.content for m in out)
        self.assertNotIn("550e8400", joined, "raw UUID marker leaked into the prompt")

    def test_skips_image_payloads_and_system_init(self):
        history = [
            msg("user", "[SYSTEM_INIT] welcome blurb"),
            msg("user", "data:image/png;base64,AAAABBBB"),
            msg("assistant", "Nice jacket!"),
            msg("user", "any in blue?"),
        ]
        out = self.agent._build_history_messages(history, current_user_input="any in blue?")
        joined = " ".join(m.content for m in out)
        self.assertNotIn("SYSTEM_INIT", joined)
        self.assertNotIn("data:image", joined)

    def test_never_starts_with_assistant_turn(self):
        # A session's stored transcript begins with the assistant greeting;
        # Anthropic rejects a leading assistant turn.
        history = [msg("assistant", "Welcome!"), msg("user", "hi")]
        out = self.agent._build_history_messages(history, current_user_input="hi")
        self.assertTrue(not out or out[0].role == "user")

    def test_respects_message_limit_and_keeps_newest(self):
        history = [msg("user", f"message {i}") for i in range(40)]
        out = self.agent._build_history_messages(history, current_user_input="")
        self.assertLessEqual(len(out), self.agent.HISTORY_MESSAGE_LIMIT)
        self.assertIn("39", out[-1].content, "should keep the most recent turns")

    def test_enforces_char_budget(self):
        history = [msg("user", "x" * 5000) for _ in range(8)]
        out = self.agent._build_history_messages(history, current_user_input="")
        total = sum(len(m.content) for m in out)
        self.assertLessEqual(total, self.agent.HISTORY_CHAR_BUDGET)

    def test_truncates_long_single_message(self):
        history = [msg("user", "word " * 400), msg("user", "now")]
        out = self.agent._build_history_messages(history, current_user_input="now")
        self.assertTrue(
            all(
                len(m.content) <= TwoPassAgent.HISTORY_PER_MESSAGE_CHARS + 1
                for m in out
            )
        )


class TestRenderHistoryTranscript(unittest.TestCase):
    def setUp(self):
        self.agent = TwoPassAgent()

    def test_first_exchange_wording(self):
        self.assertIn("first exchange", self.agent._render_history_transcript([]))

    def test_labels_roles(self):
        rendered = self.agent._render_history_transcript(
            [LLMMessage("user", "hi"), LLMMessage("assistant", "hello")]
        )
        self.assertEqual(rendered, "Customer: hi\nAssistant: hello")


class TestLanguageNormalization(unittest.TestCase):
    def test_region_subtags_and_names(self):
        cases = {
            "tr-TR": "tr",
            "tr_TR": "tr",
            "Turkish": "tr",
            "TR": "tr",
            "en-US": "en",
            "zh-Hans": "zh",
            "  fr  ": "fr",
        }
        for raw, expected in cases.items():
            self.assertEqual(normalize_language_code(raw), expected, raw)

    def test_unknown_and_empty_fall_back_to_english(self):
        for raw in ("", "   ", None, 42, "klingon", "xx"):
            self.assertEqual(normalize_language_code(raw), "en")

    def test_schema_coerces_rather_than_raising(self):
        # A hard Literal would abort the whole Pass 1 parse and degrade the turn.
        self.assertEqual(
            ContextUnderstanding(language_detected="tr-TR").language_detected, "tr"
        )
        self.assertEqual(
            ContextUnderstanding(language_detected="nonsense").language_detected, "en"
        )

    def test_every_supported_code_has_a_display_name(self):
        for code in LANGUAGE_NAMES:
            self.assertEqual(normalize_language_code(code), code)


class TestPass1ValidatorAutoRepair(unittest.TestCase):
    def _process_order_plan(self, action="return", extra=()):
        return Pass1Output(
            intent=IntentType.ORDER_MODIFICATION,
            tool_calls=[
                *extra,
                ToolCall(
                    tool_name=ToolName.PROCESS_ORDER,
                    parameters=ToolParameters(order_id="abc", action=action),
                    reasoning="customer asked",
                ),
            ],
            assessment=AssessmentInfo(confidence=0.95),
        )

    def test_injects_missing_faq_search(self):
        out = self._process_order_plan(action="return")
        names = [t.tool_name for t in out.tool_calls]
        self.assertIn(ToolName.FAQ_SEARCH, names)
        self.assertEqual(names[0], ToolName.FAQ_SEARCH, "faq_search should read first")
        self.assertEqual(out.tool_calls[0].parameters.query, "return policy")

    def test_process_order_without_action_is_rejected_upstream(self):
        """The generic-query branch is unreachable defence, and this is why.

        ToolCall's own required-parameter check rejects a process_order call with
        no `action`, so the auto-repair never has to guess. Asserted so a future
        loosening of that check surfaces here.
        """
        with self.assertRaises(Exception):
            ToolCall(
                tool_name=ToolName.PROCESS_ORDER,
                parameters=ToolParameters(order_id="abc"),
                reasoning="missing action",
            )

    def test_cancel_action_gets_cancel_policy_query(self):
        out = self._process_order_plan(action="cancel")
        self.assertEqual(out.tool_calls[0].parameters.query, "cancel policy")

    def test_does_not_duplicate_existing_faq_search(self):
        existing = ToolCall(
            tool_name=ToolName.FAQ_SEARCH,
            parameters=ToolParameters(query="return policy"),
            reasoning="policy",
        )
        out = self._process_order_plan(extra=(existing,))
        names = [t.tool_name for t in out.tool_calls]
        self.assertEqual(names.count(ToolName.FAQ_SEARCH), 1)

    def test_leaves_other_intents_alone(self):
        out = Pass1Output(
            intent=IntentType.PRODUCT_SEARCH,
            tool_calls=[
                ToolCall(
                    tool_name=ToolName.PRODUCT_SEARCH,
                    parameters=ToolParameters(query="dress"),
                    reasoning="search",
                )
            ],
            assessment=AssessmentInfo(confidence=0.9),
        )
        self.assertEqual(
            [t.tool_name for t in out.tool_calls], [ToolName.PRODUCT_SEARCH]
        )


class TestNonSpecificSimilarQueries(unittest.TestCase):
    def test_catches_the_reported_phrases(self):
        for phrase in (
            "similar products",
            "Show me similar products",
            "like this",
            "more like this",
        ):
            self.assertIn(phrase.lower(), _NON_SPECIFIC_SIMILAR_QUERIES)

    def test_real_garment_queries_are_not_matched(self):
        for phrase in (
            "black belted mini dress",
            "wolf t-shirt",
            "blue summer dress",
        ):
            self.assertNotIn(phrase, _NON_SPECIFIC_SIMILAR_QUERIES)


class TestEmptySimilarSearchRetry(unittest.IsolatedAsyncioTestCase):
    """A visual similar-item query is very specific and can match nothing.

    On a small catalogue that meant "I couldn't find any matches" while two
    comparable dresses sat in the same category, so an empty result retries once
    with the broader name-based query.
    """

    def setUp(self):
        self.agent = TwoPassAgent()
        self.trace = TwoPassExecutionTrace(
            session_id="s", turn_number=1, started_at=0.0, user_input="x"
        )

    @staticmethod
    def _search_call(query):
        return ToolCall(
            tool_name=ToolName.PRODUCT_SEARCH,
            parameters=ToolParameters(query=query),
            reasoning="similar items",
        )

    @staticmethod
    def _result(data):
        return ToolResult(
            tool_name=ToolName.PRODUCT_SEARCH, success=True, data=data
        )

    async def test_retries_with_broader_query_and_replaces_result(self):
        call = self._search_call("black sleeveless v-neck contrast gold belt crepe")
        found = self._result([{"id": "1", "name": "GREEN BACKLESS DRESS"}])

        with patch.object(
            self.agent, "_execute_single_tool", new=AsyncMock(return_value=found)
        ) as mock:
            out = await self.agent._retry_empty_similar_searches(
                [call], [self._result([])], {0: "black belted mini dress"}, self.trace
            )

        self.assertEqual(mock.await_count, 1)
        self.assertEqual(call.parameters.query, "black belted mini dress")
        self.assertEqual(out[0].data, found.data)

    async def test_does_not_retry_when_results_exist(self):
        call = self._search_call("visual description")
        with patch.object(
            self.agent, "_execute_single_tool", new=AsyncMock()
        ) as mock:
            await self.agent._retry_empty_similar_searches(
                [call], [self._result([{"id": "9"}])], {0: "broader"}, self.trace
            )
        self.assertEqual(mock.await_count, 0)

    async def test_no_op_without_a_recorded_fallback(self):
        call = self._search_call("plain search")
        with patch.object(
            self.agent, "_execute_single_tool", new=AsyncMock()
        ) as mock:
            await self.agent._retry_empty_similar_searches(
                [call], [self._result([])], {}, self.trace
            )
        self.assertEqual(mock.await_count, 0)

    async def test_does_not_retry_an_identical_query(self):
        # No point re-running the exact same search.
        call = self._search_call("same query")
        with patch.object(
            self.agent, "_execute_single_tool", new=AsyncMock()
        ) as mock:
            await self.agent._retry_empty_similar_searches(
                [call], [self._result([])], {0: "same query"}, self.trace
            )
        self.assertEqual(mock.await_count, 0)


class TestPriceFilterParams(unittest.TestCase):
    """A budget is a hard constraint, not a ranking hint.

    "under $45" in the query text is invisible to the embedding — prices are not
    semantically encoded — so it was silently dropped while Pass 2 still claimed
    the budget had been applied, showing $80 items to someone who asked for $45.
    """

    def test_price_params_are_accepted(self):
        params = ToolParameters(query="casual dress", max_price=45, min_price=20)
        self.assertEqual(params.max_price, 45.0)
        self.assertEqual(params.min_price, 20.0)

    def test_price_params_reach_the_tool(self):
        from backend.api.agent_schema import TOOL_VALID_PARAMS, filter_tool_params

        allowed = TOOL_VALID_PARAMS[ToolName.PRODUCT_SEARCH]
        self.assertIn("max_price", allowed)
        self.assertIn("min_price", allowed)

        # filter_tool_params must not strip them on the way to product_search.
        kept = filter_tool_params(
            ToolName.PRODUCT_SEARCH,
            {"query": "dress", "max_price": 45, "min_price": 20, "bogus": 1},
        )
        self.assertEqual(kept["max_price"], 45)
        self.assertEqual(kept["min_price"], 20)
        self.assertNotIn("bogus", kept)

    def test_price_is_not_offered_to_unrelated_tools(self):
        from backend.api.agent_schema import filter_tool_params

        kept = filter_tool_params(
            ToolName.FAQ_SEARCH, {"query": "returns", "max_price": 45}
        )
        self.assertNotIn("max_price", kept)

    def test_predicates_compile_to_sql(self):
        from sqlalchemy import select
        from backend.db.schema import Product

        def where_clause(max_price=None, min_price=None):
            filters = []
            if max_price is not None:
                filters.append(Product.price <= max_price)
            if min_price is not None:
                filters.append(Product.price >= min_price)
            stmt = select(Product.id).where(Product.store == "S", *filters)
            return str(stmt.compile(compile_kwargs={"literal_binds": True}))

        self.assertIn("products.price <= 45", where_clause(max_price=45))
        self.assertIn("products.price >= 20", where_clause(min_price=20))
        # No budget given → no price predicate at all.
        self.assertNotIn("products.price", where_clause())


class TestCoerceToDate(unittest.TestCase):
    """A None here used to make the policy gate DENY a legitimate return."""

    def test_parses_shapes_the_gate_actually_receives(self):
        cases = {
            datetime(2026, 7, 20, 12, 30, tzinfo=timezone.utc): date(2026, 7, 20),
            date(2026, 7, 20): date(2026, 7, 20),
            "2026-07-20": date(2026, 7, 20),
            "2026-07-20 12:30:00": date(2026, 7, 20),
            "2026-07-20 12:30:00.123456": date(2026, 7, 20),
            "2026-07-20T12:30:00+00:00": date(2026, 7, 20),
            "2026-07-20T12:30:00Z": date(2026, 7, 20),
            "2026-07-20 12:30:00+00:00": date(2026, 7, 20),
        }
        for raw, expected in cases.items():
            self.assertEqual(_coerce_to_date(raw), expected, f"failed on {raw!r}")

    def test_unknown_values_return_none(self):
        for raw in (None, "", "   ", "unknown", "None", "null", "not a date"):
            self.assertIsNone(_coerce_to_date(raw))

    def test_upper_bound_reasoning_holds(self):
        # Delivery is always on/after creation, so days-since-creation bounds
        # days-since-delivery from above.
        created = _coerce_to_date("2026-07-20 10:00:00")
        today = date(2026, 7, 26)
        self.assertEqual((today - created).days, 6)


class TestProviderRoleNormalization(unittest.TestCase):
    MESSAGES = [
        LLMMessage("system", "SYS"),
        LLMMessage("assistant", "stored greeting"),
        LLMMessage("user", "u1"),
        LLMMessage("user", "u2"),
        LLMMessage("assistant", "a1"),
        LLMMessage("user", "current"),
    ]

    def test_gemini_preserves_roles(self):
        system, contents = GeminiProvider._split(self.MESSAGES)
        self.assertEqual(system, "SYS")
        self.assertEqual(
            [(c.role, c.parts[0].text) for c in contents],
            [
                ("model", "stored greeting"),
                ("user", "u1"),
                ("user", "u2"),
                ("model", "a1"),
                ("user", "current"),
            ],
            "history must stay role-labeled, not flattened into one string",
        )

    def test_gemini_handles_system_only(self):
        _, contents = GeminiProvider._split([LLMMessage("system", "S")])
        self.assertEqual(len(contents), 1)
        self.assertEqual(contents[0].role, "user")

    def test_anthropic_drops_leading_assistant_and_merges_same_role(self):
        system, chat = AnthropicProvider._split(self.MESSAGES)
        self.assertEqual(system, "SYS")
        self.assertEqual(chat[0]["role"], "user", "must not start with assistant")
        self.assertEqual(
            chat,
            [
                {"role": "user", "content": "u1\n\nu2"},
                {"role": "assistant", "content": "a1"},
                {"role": "user", "content": "current"},
            ],
        )

    def test_anthropic_handles_system_only(self):
        _, chat = AnthropicProvider._split([LLMMessage("system", "S")])
        self.assertEqual(chat, [{"role": "user", "content": "Continue."}])


if __name__ == "__main__":
    unittest.main(verbosity=2)
