/**
 * Quick-reply chips shown in the chat.
 *
 * Defined once here because these used to be copy-pasted across four call sites
 * (home page + product page, greeting + product card) and had drifted out of
 * sync — different counts, and "Show me similar products" vs "Show similar
 * products" for the same feature.
 *
 * Every chip must map to something the agent can actually do:
 *   - product search / similar items  -> product_search (+ exclude_product_id)
 *   - sizes & availability            -> variant_check (returns the full
 *                                        variant list when no size is given)
 *   - order tracking                  -> list_orders + fetch_order_location
 *   - returns & cancellations         -> faq_search + process_order
 *   - image search                    -> vision -> text -> product_search
 *
 * Deliberately NOT included: "Contact support" (no such feature existed — it
 * just sent the literal words to the LLM) and anything phrased around a
 * hardcoded product category.
 */

/** Opening chips for an empty conversation. Kept to three so the row stays one line. */
export const GREETING_SUGGESTIONS = [
  "I'm looking for a dress",
  "Help me track my order",
  "What's your return policy?",
] as const;

/**
 * Chips attached to a product card.
 *
 * Note there is no "How does this dress fit?" — it hardcoded one category and
 * showed "dress" for t-shirts and hoodies alike. Fit has no backing data model
 * either, so it was answered by improvisation.
 */
export const PRODUCT_SUGGESTIONS = [
  "What sizes are available?",
  "Show me similar products",
  "Is this in stock?",
] as const;

/** Shown when the socket is down, so the only useful action is to retry. */
export const CONNECTION_ERROR_SUGGESTIONS = ["Try again"] as const;
