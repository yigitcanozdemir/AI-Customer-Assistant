/**
 * Session lifecycle helpers.
 *
 * Two jobs, both in service of the promise the entry modal makes ("your data is
 * deleted when you close your browser tab"):
 *
 *  1. `endSessionOnUnload` — fire a beacon when the tab goes away so the server
 *     deletes that visitor's transcript, context and orders immediately. Before
 *     this existed nothing ran on unload; data merely aged out of Redis 24h
 *     later, so the notice was simply untrue.
 *
 *  2. `wipeLocalSession` — clear everything this origin persisted, used both on
 *     unload and when the server reports the session no longer exists.
 *
 * A dropped beacon is not a correctness problem: the backend keeps a long-TTL
 * sweep as a backstop, and the endpoint is idempotent.
 */

/** sessionStorage keys that together make up a visitor's local footprint. */
const LOCAL_SESSION_KEYS = [
  "chatSessions",
  "user_id",
  "user_name",
  "user-geo",
] as const;

/**
 * Set while the app is deliberately navigating within itself.
 *
 * `pagehide` cannot distinguish "the visitor closed the tab" from "the document
 * is being replaced by another page on this same origin" — both fire it with
 * `persisted: false`. That made an in-app navigation (or a plain refresh) delete
 * the visitor's server-side session and wipe their identity, so opening a
 * product re-prompted for name and details and lost the transcript.
 *
 * Lives in sessionStorage rather than a module variable because the module is
 * re-evaluated from scratch on the new document, and the flag has to survive
 * that gap. Read-and-clear on the way in, so it can never get stuck on and
 * suppress a genuine teardown.
 */
const INTERNAL_NAV_KEY = "internal-nav";

/** Call immediately before any navigation that stays inside this app. */
export function markInternalNavigation(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(INTERNAL_NAV_KEY, String(Date.now()));
  } catch {
    // Storage unavailable — worst case we fall back to the old behaviour.
  }
}

/**
 * True when this teardown is an in-app navigation we flagged.
 *
 * Consumes the flag, and ignores a stale one: the marker is only trusted for a
 * few seconds, so a flag set before something went wrong cannot silently
 * disable deletion for the rest of the visit.
 */
export function consumeInternalNavigation(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(INTERNAL_NAV_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(INTERNAL_NAV_KEY);
    return Date.now() - Number(raw) < 5000;
  } catch {
    return false;
  }
}

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL || "";
}

/**
 * Ask the server to delete this visitor's data, now.
 *
 * Uses `navigator.sendBeacon` because it survives page teardown, where `fetch`
 * is routinely cancelled. Beacons are always POST, which is why the endpoint is
 * `POST .../end` rather than a DELETE.
 */
export function requestSessionDeletion(
  sessionIds: string[],
  userId: string | null
): void {
  if (typeof window === "undefined") return;

  const unique = Array.from(new Set(sessionIds.filter(Boolean)));
  if (unique.length === 0) return;

  for (const sessionId of unique) {
    const query = userId ? `?user_id=${encodeURIComponent(userId)}` : "";
    const url = `${apiBase()}/events/session/${encodeURIComponent(
      sessionId
    )}/end${query}`;

    try {
      if (navigator.sendBeacon) {
        // Empty body: everything the endpoint needs is in the URL, and a
        // Blob body would trigger a CORS preflight that unload cannot await.
        navigator.sendBeacon(url);
      } else {
        // Safari < 15 and friends. `keepalive` is the closest equivalent.
        void fetch(url, { method: "POST", keepalive: true }).catch(() => {});
      }
    } catch {
      // Never let cleanup break teardown.
    }
  }
}

/** Remove every local trace of the visitor from this origin. */
export function wipeLocalSession(): void {
  if (typeof window === "undefined") return;

  try {
    for (const key of LOCAL_SESSION_KEYS) {
      sessionStorage.removeItem(key);
    }
    // Cart and per-session sync flags are keyed dynamically, so sweep by prefix.
    const doomed: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith("chat-initial-synced:") ||
        key.startsWith("fashion-cart-")
      ) {
        doomed.push(key);
      }
    }
    for (const key of doomed) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable (private mode, quota); nothing to recover.
  }
}
