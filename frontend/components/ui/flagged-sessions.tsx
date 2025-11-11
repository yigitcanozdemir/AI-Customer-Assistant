"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUser } from "@/context/UserContext";
import { useStore } from "@/context/StoreContext";
import {
  AlertTriangle,
  CheckCircle2,
  Flag,
  Loader2,
  MessageSquareText,
} from "lucide-react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL;
const STORE_OPTIONS = [
  "Aurora Style",
  "Luna Apperal",
  "Celeste Wear",
  "Dayifuse Fashion",
];

interface FlaggedSessionItem {
  id: string;
  session_id: string;
  user_id: string;
  user_name?: string | null;
  store: string;
  user_query: string;
  assistant_response: string;
  confidence_score?: number | null;
  requires_human: boolean;
  is_context_relevant: boolean;
  warning_message?: string | null;
  assessment_reasoning?: string | null;
  message_history?: unknown[] | null;
  flagged_at: string;
  reviewed: boolean;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  review_notes?: string | null;
}

type ReviewNotesState = Record<string, string>;
type LoadingMap = Record<string, boolean>;

const formatDateTime = (value: string) => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

interface GroupedSession {
  sessionId: string;
  store: string;
  totalFlags: number;
  pendingFlags: number;
  latestFlaggedAt: string;
  flags: FlaggedSessionItem[];
}

export function FlaggedSessionsButton() {
  const { userId, userName } = useUser();
  const { store } = useStore();

  const [isOpen, setIsOpen] = useState(false);
  const [sessions, setSessions] = useState<FlaggedSessionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<ReviewNotesState>({});
  const [reviewLoading, setReviewLoading] = useState<LoadingMap>({});
  const [storeFilter, setStoreFilter] = useState<string>(store || "all");

  const hasUserProfile = Boolean(userId);

  useEffect(() => {
    if (!isOpen) return;
    setStoreFilter(store || "all");
  }, [isOpen, store]);

  const fetchSessions = useCallback(async () => {
    if (!apiUrl) {
      setError("API URL is not configured");
      return;
    }

    if (!hasUserProfile) {
      setSessions([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const url = new URL(`${apiUrl}/events/flagged-sessions`);
      url.searchParams.set("user_id", userId!);
      if (userName) {
        url.searchParams.set("user_name", userName);
      }
      if (storeFilter !== "all") {
        url.searchParams.set("store", storeFilter);
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Failed to fetch flagged sessions (${response.status})`);
      }

      const data = await response.json();
      setSessions(data.sessions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setIsLoading(false);
    }
  }, [hasUserProfile, storeFilter, userId, userName]);

  useEffect(() => {
    if (isOpen) {
      void fetchSessions();
    }
  }, [isOpen, storeFilter, fetchSessions]);

  const handleReviewSubmit = async (flaggedId: string) => {
    if (!apiUrl) {
      setError("API URL is not configured");
      return;
    }

    if (!userName) {
      setError("Please set a user profile before reviewing sessions");
      return;
    }

    setReviewLoading((prev) => ({ ...prev, [flaggedId]: true }));
    setError(null);

    try {
      const response = await fetch(
        `${apiUrl}/events/flagged-sessions/${flaggedId}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reviewed_by: userName,
            notes: reviewNotes[flaggedId] ?? "",
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to submit review");
      }

      setSessions((prev) =>
        prev.map((session) =>
          session.id === flaggedId
            ? {
                ...session,
                reviewed: true,
                reviewed_at: new Date().toISOString(),
                reviewed_by: userName,
                review_notes: reviewNotes[flaggedId] ?? "",
              }
            : session
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit review");
    } finally {
      setReviewLoading((prev) => ({ ...prev, [flaggedId]: false }));
    }
  };

  const hasPendingReviews = useMemo(
    () => sessions.some((session) => !session.reviewed),
    [sessions]
  );

  const groupedSessions = useMemo<GroupedSession[]>(() => {
    const map = new Map<
      string,
      { sessionId: string; store: string; flags: FlaggedSessionItem[] }
    >();

    sessions.forEach((session) => {
      const key = `${session.store}-${session.session_id}`;
      const existing = map.get(key);
      if (existing) {
        existing.flags.push(session);
      } else {
        map.set(key, {
          sessionId: session.session_id,
          store: session.store,
          flags: [session],
        });
      }
    });

    return Array.from(map.values())
      .map((group) => {
        const sortedFlags = [...group.flags].sort(
          (a, b) =>
            new Date(b.flagged_at).getTime() - new Date(a.flagged_at).getTime()
        );
        const pendingFlags = sortedFlags.filter((flag) => !flag.reviewed).length;
        return {
          sessionId: group.sessionId,
          store: group.store,
          totalFlags: sortedFlags.length,
          pendingFlags,
          latestFlaggedAt: sortedFlags[0]?.flagged_at ?? "",
          flags: sortedFlags,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.latestFlaggedAt).getTime() -
          new Date(a.latestFlaggedAt).getTime()
      );
  }, [sessions]);

  const renderSessionCard = (session: FlaggedSessionItem) => {
    const sessionNotes = reviewNotes[session.id] ?? session.review_notes ?? "";
    const disabled = reviewLoading[session.id];

    return (
      <Card key={session.id} className="border border-border/60 bg-card/80">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={session.reviewed ? "default" : "destructive"}>
                {session.reviewed ? "Reviewed" : "Pending"}
              </Badge>
              {session.warning_message && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Alert
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(session.flagged_at)}
            </span>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              User Query
            </p>
            <p className="text-sm text-foreground leading-relaxed">
              {session.user_query}
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Assistant Response
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {session.assistant_response}
            </p>
          </div>

          {session.assessment_reasoning && (
            <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
              {session.assessment_reasoning}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium">Store:</span>
            <Badge variant="outline">{session.store}</Badge>
            <Separator orientation="vertical" className="h-4" />
            <span className="font-medium">Confidence:</span>
            <span>
              {typeof session.confidence_score === "number"
                ? `${Math.round(session.confidence_score * 100)}%`
                : "—"}
            </span>
            <Separator orientation="vertical" className="h-4" />
            <span className="font-medium">Requires human:</span>
            <span>{session.requires_human ? "Yes" : "No"}</span>
          </div>

          {Array.isArray(session.message_history) &&
            session.message_history.length > 0 && (
            <details className="rounded-md border border-border/50 bg-muted/20 p-3">
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                Conversation History
              </summary>
              <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                {(session.message_history as Array<Record<string, unknown>>).map(
                  (entry, index) => {
                    const typeValue = entry["type"];
                    const roleValue = entry["role"];
                    const contentValue = entry["content"];
                    const textValue = entry["text"];

                    const role =
                      (typeof typeValue === "string" && typeValue) ||
                      (typeof roleValue === "string" && roleValue) ||
                      "message";
                    const content =
                      (typeof contentValue === "string" && contentValue) ||
                      (typeof textValue === "string" && textValue) ||
                      "";

                    return (
                      <div key={`${session.id}-history-${index}`}>
                        <span className="font-semibold capitalize">
                          {role.replace("_", " ")}:
                        </span>{" "}
                        <span>{content}</span>
                      </div>
                    );
                  }
                )}
              </div>
            </details>
          )}

          <Separator />

          {session.reviewed ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span>Reviewed by {session.reviewed_by || "Unknown"}</span>
              </div>
              {session.review_notes && (
                <span className="italic">“{session.review_notes}”</span>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={sessionNotes}
                onChange={(event) =>
                  setReviewNotes((prev) => ({
                    ...prev,
                    [session.id]: event.target.value,
                  }))
                }
                placeholder="Add review notes (optional)"
                className="w-full rounded-md border border-border bg-background/80 p-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                rows={3}
              />
              <Button
                onClick={() => void handleReviewSubmit(session.id)}
                disabled={disabled}
                className="w-full"
              >
                {disabled && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Mark as Reviewed
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-10 w-10 p-0 text-foreground hover:text-primary bg-transparent hover:bg-transparent transition-colors"
          disabled={!hasUserProfile}
          aria-label="Review flagged sessions"
        >
          <Flag className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex h-full w-full flex-col sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-primary" /> Flagged Sessions
          </SheetTitle>
          <SheetDescription>
            Review escalated chats for store-specific issues.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between border-b px-4 py-3 text-xs text-muted-foreground">
          <span>Store scope</span>
          <Select
            value={storeFilter}
            onValueChange={(value) => setStoreFilter(value)}
          >
            <SelectTrigger className="h-8 w-40 text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stores</SelectItem>
              {STORE_OPTIONS.map((storeOption) => (
                <SelectItem key={storeOption} value={storeOption}>
                  {storeOption}
                </SelectItem>
              ))}
              {store && !STORE_OPTIONS.includes(store) && (
                <SelectItem value={store}>{store}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full space-y-3 p-4">
            {!hasUserProfile && (
              <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                Set your user profile to review flagged sessions.
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {isLoading && (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading flagged sessions...
              </div>
            )}

            {!isLoading && hasUserProfile && sessions.length === 0 && !error && (
              <div className="rounded-md border border-border/60 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                No flagged sessions found for the selected store filter.
              </div>
            )}

            {groupedSessions.map((group) => (
              <div
                key={`${group.store}-${group.sessionId}`}
                className="space-y-3 rounded-lg border border-border/60 bg-card/60 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Session
                    </p>
                    <p className="font-semibold text-sm text-foreground">
                      {group.sessionId}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-xs">
                      {group.store}
                    </Badge>
                    <Separator orientation="vertical" className="h-4" />
                    <span>Total Flags: {group.totalFlags}</span>
                    <Separator orientation="vertical" className="h-4" />
                    <span>
                      Pending:{" "}
                      <span className="font-semibold text-foreground">
                        {group.pendingFlags}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {group.flags.map((session) => renderSessionCard(session))}
                </div>
              </div>
            ))}
          </ScrollArea>
        </div>

        <div className="border-t p-4 text-xs text-muted-foreground">
          {hasPendingReviews
            ? "Pending reviews help improve the assistant experience."
            : "All flagged sessions for this store are reviewed."}
        </div>
      </SheetContent>
    </Sheet>
  );
}
