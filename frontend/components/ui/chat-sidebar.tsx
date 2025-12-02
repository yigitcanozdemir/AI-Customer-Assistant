"use client";

import Image from "next/image";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Send,
  Package,
  Sparkles,
  X,
  CheckCircle2,
  MapPin,
  Truck,
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { useStore } from "@/context/StoreContext";
import { useChat, type Message, type Product } from "@/context/ChatContext";
import { useUser } from "@/context/UserContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import dynamic from "next/dynamic";
import type { TrackingMapProps } from "@/components/ui/TrackingMap";

const TrackingMap = dynamic<TrackingMapProps>(
  () =>
    import("@/components/ui/TrackingMap").then((mod) => ({
      default: mod.TrackingMap,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-48 bg-muted flex items-center justify-center text-muted-foreground text-sm">
        Loading map...
      </div>
    ),
  }
);

const wsBase = process.env.NEXT_PUBLIC_WS_URL;
const isDev = process.env.NODE_ENV !== "production";
const logDebug = (...args: unknown[]) => {
  if (isDev) console.log(...args);
};

interface Order {
  order_id: string;
  status: string;
  created_at: Date;
  product: {
    id: string;
    name: string;
    price: number;
    currency: string;
    image?: string | null;
  };
}

interface PendingAction {
  action_id: string;
  action_type: string;
  parameters: Record<string, unknown>;
  requires_confirmation: boolean;
  confirmation_message: string;
}

const formatCurrency = (price: number, currency: string): string => {
  switch (currency) {
    case "USD":
      return `$${price.toFixed(2)}`;
    case "EURO":
      return `€${price.toFixed(2)}`;
    case "TRY":
      return `₺${price.toFixed(2)}`;
    default:
      return `${currency} ${price.toFixed(2)}`;
  }
};

const ORDER_STATUS_STEPS = ["created", "shipped", "delivered"] as const;

const formatStatusLabel = (status?: string | null) => {
  if (!status) return "";
  return status
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const getStatusAccentClass = (status?: string | null) => {
  const normalized = (status || "").toLowerCase();
  if (normalized === "delivered") return "text-success";
  if (normalized === "created" || normalized === "returned") return "text-warning";
  if (normalized === "cancelled") return "text-destructive";
  return "text-primary";
};

const getStepClassForStatus = (status: string, index: number) => {
  const normalized = status.toLowerCase();
  if (normalized === "delivered") {
    return index <= 2 ? "bg-success" : "bg-border/70";
  }
  if (normalized === "shipped") {
    return index <= 1 ? "bg-primary" : "bg-border/70";
  }
  if (normalized === "returned") {
    return index === 0 ? "bg-warning" : "bg-border/70";
  }
  if (normalized === "cancelled") {
    return index === 0 ? "bg-destructive" : "bg-border/70";
  }
  if (normalized === "created") {
    return index === 0 ? "bg-warning" : "bg-border/70";
  }
  return index === 0 ? "bg-primary" : "bg-border/70";
};

interface ChatSidebarProps {
  right: number;
  sideWidth: number;
}

export function ChatSidebar({ right, sideWidth }: ChatSidebarProps) {
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isMounted, setIsMounted] = useState(false);
  const { store: selectedStore } = useStore();
  const { store: selectedStoreForProduct } = useStore();
  const { userId, userName } = useUser();
  const hasSentInitialMessage = useRef(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null
  );
  const pendingActionsRef = useRef<Record<string, PendingAction | null>>({});
  const ordersRegistryRef = useRef<Record<string, Order>>({});
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const {
    messages,
    setMessages,
    isAssistantOpen,
    setIsAssistantOpen,
    sessionId,
    ws,
    setWs,
    connectionStatus,
    setConnectionStatus,
    isTyping,
    setIsTyping,
    wsRef,
    selectedProduct,
    setSelectedProduct,
    selectedOrder,
    setSelectedOrder,
    isSessionLocked,
    setIsSessionLocked,
    sessionLockReason,
    setSessionLockReason,
  } = useChat();
  const sessionStateKey = useMemo(
    () => `${selectedStore || "default"}:${sessionId}`,
    [selectedStore, sessionId]
  );

  useEffect(() => {
    hasSentInitialMessage.current = false;
  }, [sessionId]);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const fetchUndeliveredMessages = useCallback(async () => {
    if (!sessionId) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";

      let lastMessageId: string | null = null;
      setMessages((currentMessages) => {
        lastMessageId = currentMessages.length > 0 ? currentMessages[currentMessages.length - 1].id : null;
        return currentMessages;
      });

      const url = lastMessageId
        ? `${apiUrl}/events/chat/history/${sessionId}?after=${encodeURIComponent(lastMessageId)}`
        : `${apiUrl}/events/chat/history/${sessionId}`;

      logDebug(`Fetching undelivered messages${lastMessageId ? ` after ${lastMessageId}` : ' (all messages)'}`);
      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();

        const newMessages = data.messages.map((msg: Record<string, unknown>) => {
          const timestamp = msg.timestamp;
          return {
            ...msg,
            timestamp: typeof timestamp === 'string' ? new Date(timestamp) : timestamp instanceof Date ? timestamp : new Date(),
          };
        });

        if (newMessages.length > 0) {
          setMessages((currentMessages) => {
            const existingIds = new Set(currentMessages.map(m => m.id));

            const existingContentKeys = new Set(
              currentMessages.map(m => `${m.type}:${m.content}`)
            );

            const trulyNewMessages = newMessages.filter((msg: Message) => {
              if (existingIds.has(msg.id)) return false;

              const contentKey = `${msg.type}:${msg.content}`;
              if (existingContentKeys.has(contentKey)) {
                logDebug("Skipping duplicate message with different ID");
                return false;
              }

              if (msg.type === 'user' && msg.reply_order) {
                const msgOrderId = msg.reply_order.order_id;
                const isDuplicateOrder = currentMessages.some((existing: Message) =>
                  existing.type === 'user' &&
                  existing.reply_order &&
                  existing.reply_order.order_id === msgOrderId
                );
                if (isDuplicateOrder) {
                  logDebug("Skipping duplicate order selection");
                  return false;
                }
              }

              if (msg.type === 'user' && msg.reply_product) {
                const msgProductId = msg.reply_product.id;
                const isDuplicateProduct = currentMessages.some((existing: Message) =>
                  existing.type === 'user' &&
                  existing.reply_product &&
                  existing.reply_product.id === msgProductId &&
                  Math.abs(new Date(existing.timestamp).getTime() - new Date(msg.timestamp).getTime()) < 5000
                );
                if (isDuplicateProduct) {
                  logDebug("Skipping duplicate product selection");
                  return false;
                }
              }

              return true;
            });

            if (trulyNewMessages.length > 0) {
              logDebug(`Fetched ${trulyNewMessages.length} undelivered messages`);

              return [...currentMessages, ...trulyNewMessages];
            }

            return currentMessages;
          });
        } else {
          logDebug('No new messages to fetch');
        }

        if (typeof data.is_typing === 'boolean') {
          logDebug(`Backend typing state: ${data.is_typing}`);
          setIsTyping(data.is_typing);
        }

        if (data.pending_action) {
          logDebug("Restored pending action from history");
          const action = data.pending_action as PendingAction;
          pendingActionsRef.current[sessionStateKey] = action;
          setPendingAction(action);
        }
      }
    } catch (error) {
      console.error("Failed to fetch undelivered messages:", error);
    }
  }, [sessionId, setMessages, setIsTyping, sessionStateKey]);

  const lastSessionRef = useRef<string>('');
  const lastStoreRef = useRef<string>('');

  useEffect(() => {
    if (!isAssistantOpen || !sessionId) return;

    const sessionChanged = lastSessionRef.current !== '' && lastSessionRef.current !== sessionId;
    const storeChanged = lastStoreRef.current !== '' && lastStoreRef.current !== selectedStore;

    lastSessionRef.current = sessionId;
    lastStoreRef.current = selectedStore;

    if (sessionChanged || storeChanged) {
      logDebug('Session or store changed, skipping initial fetch (ChatContext will handle)');
      return;
    }

    logDebug('Sidebar opened, fetching undelivered messages');
    fetchUndeliveredMessages();
  }, [isAssistantOpen, sessionId, selectedStore, fetchUndeliveredMessages]);

  useEffect(() => {
    if (!isAssistantOpen || !sessionId) return;

    const sessionJustChanged = lastSessionRef.current !== sessionId;
    const storeJustChanged = lastStoreRef.current !== selectedStore;

    if (sessionJustChanged || storeJustChanged) {
      logDebug('Session/store just changed, skipping polling to avoid cross-contamination');
      return;
    }

    const earlyPollInterval = setInterval(() => {
      logDebug('Early polling for undelivered messages...');
      fetchUndeliveredMessages();
    }, 1000);

    const earlyPollTimeout = setTimeout(() => {
      clearInterval(earlyPollInterval);
      logDebug('Early polling complete');
    }, 10000);

    let typingPollInterval: NodeJS.Timeout | null = null;
    if (isTyping) {
      logDebug('Starting typing poll for undelivered messages');
      typingPollInterval = setInterval(() => {
        logDebug('Typing poll for undelivered messages...');
        fetchUndeliveredMessages();
      }, 1500);
    }

    return () => {
      clearInterval(earlyPollInterval);
      clearTimeout(earlyPollTimeout);
      if (typingPollInterval) {
        logDebug('Stopping typing poll');
        clearInterval(typingPollInterval);
      }
    };
  }, [isAssistantOpen, sessionId, selectedStore, isTyping, fetchUndeliveredMessages]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateViewportMetrics = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
        const inset = Math.max(
          window.innerHeight - window.visualViewport.height,
          0
        );
        setKeyboardInset(inset);
      } else {
        setViewportHeight(window.innerHeight);
        setKeyboardInset(0);
      }
    };

    const handleResize = () => {
      updateViewportMetrics();
    };

    updateViewportMetrics();
    window.visualViewport?.addEventListener("resize", updateViewportMetrics);
    window.addEventListener("resize", handleResize);

    return () => {
      window.visualViewport?.removeEventListener("resize", updateViewportMetrics);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (isAssistantOpen && typeof window !== "undefined") {
      const isMobile = window.innerWidth < 1024;
      if (isMobile) {
        document.body.style.overflow = "hidden";
        document.body.style.position = "fixed";
        document.body.style.width = "100%";
        document.body.style.height = "100dvh";
      }
    } else {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.width = "";
      document.body.style.height = "";
    }

    return () => {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.width = "";
      document.body.style.height = "";
    };
  }, [isAssistantOpen]);

  const sendInitialMessageToBackend = useCallback(
    (message: Message, websocket: WebSocket) => {
      try {
        const initialPayload = {
          event_id: sessionId,
          event_data: {
            question: `[SYSTEM_INIT] ${message.content}`,
            store: selectedStore,
            user_name: userName || "Anonymous User",
            user_id: userId || "00000000-0000-0000-0000-000000000000",
            product: selectedProduct
              ? {
                  id: selectedProduct.id,
                  name: selectedProduct.name,
                  price: selectedProduct.price,
                  currency: selectedProduct.currency,
                }
              : undefined,
            is_initial_message: true,
          },
        };

        if (websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify(initialPayload));
          logDebug("Sent initial message to backend");
        }
      } catch (error) {
        console.error("Error sending initial message to backend:", error);
      }
    },
    [sessionId, selectedStore, userName, userId, selectedProduct]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `chat-initial-synced:${sessionId}`;
    const synced = window.sessionStorage.getItem(key);
    hasSentInitialMessage.current = synced === "true";
  }, [sessionId]);

  const connectWebSocket = useCallback(() => {
    try {
      const connectingTimer = setTimeout(() => {
        setConnectionStatus("connecting");
      }, 200);
      logDebug("Attempting WebSocket connection...");
      const websocket = new WebSocket(`${wsBase}/events/ws/chat/${sessionId}`);
      websocket.onopen = () => {
        clearTimeout(connectingTimer);
        logDebug("WebSocket connected successfully");
        setConnectionStatus("connected");
        setWs(websocket);
        wsRef.current = websocket;
      };
      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          logDebug("WebSocket message received");
          if ("pending_action" in data) {
            const action = data.pending_action ?? null;
            pendingActionsRef.current[sessionStateKey] = action;
            setPendingAction(action);
            if (action) {
              logDebug("Pending action received");
            }
          }
          if (typeof data.session_locked === "boolean") {
            setIsSessionLocked(data.session_locked);
            setSessionLockReason(
              data.session_locked ? data.lock_reason || "policy_violation" : null
            );
          }
          const assistantMessage = {
            id: data.id || uuidv4(),  
            type: "assistant" as const,
            content:
              data.content || "I'm sorry, I didn't receive a proper response.",
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
            products: data.products || [],
            orders: data.orders || [],
            tracking_data: data.tracking_data || null,
            reply_order: data.reply_order || null,
            suggestions: data.suggestions || [],
            warning_message: data.warning_message,
            requires_human: data.requires_human,
            confidence_score: data.confidence_score,
            flagging_reason: data.flagging_reason,
          };
          setIsTyping(false);
          setMessages((prev) => [...prev, assistantMessage]);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
          setIsTyping(false);
        }
      };
      websocket.onclose = (event) => {
        clearTimeout(connectingTimer);
        logDebug("WebSocket disconnected", event.code, event.reason);
        setTimeout(() => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            setConnectionStatus("disconnected");
          }
        }, 300);
        setWs(null);
        wsRef.current = null;
        setIsTyping(false);
      };
      websocket.onerror = (error) => {
        clearTimeout(connectingTimer);
        console.error("WebSocket error:", error);
        setConnectionStatus("disconnected");
        setIsTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            id: uuidv4(),
            type: "assistant",
            content:
              "I'm currently in demo mode since the backend isn't connected. I can still help you explore our products! Try asking about sizing, styling, or specific items.",
            timestamp: new Date(),
            suggestions: ["Try again", "Contact support"],
          },
        ]);
      };
    } catch (error) {
      console.error("Error creating WebSocket connection:", error);
      setConnectionStatus("disconnected");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sessionId,
    setConnectionStatus,
    setWs,
    setIsTyping,
    setMessages,
    sendInitialMessageToBackend,
    sessionStateKey,
  ]);

  useEffect(() => {
    logDebug("Store/session changed, reconnecting WebSocket for new session...");

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWs(null);
    const timer = setTimeout(() => {
      connectWebSocket();
    }, 100);

    return () => {
      clearTimeout(timer);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore, sessionId]);

  useEffect(() => {
    if (!isAssistantOpen || !ws || ws.readyState !== WebSocket.OPEN || hasSentInitialMessage.current) return;
    const assistantMessages = messages.filter((msg) => msg.type === "assistant");
    if (assistantMessages.length > 0) {
      logDebug("Sending initial assistant messages to backend", assistantMessages.length);
      assistantMessages.forEach((message) => {
        sendInitialMessageToBackend(message, ws);
      });
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(`chat-initial-synced:${sessionId}`, "true");
      }
      hasSentInitialMessage.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, ws, sendInitialMessageToBackend, isAssistantOpen]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    messages.forEach((message) => {
      message.orders?.forEach((order) => {
        ordersRegistryRef.current[order.order_id] = order;
      });
    });
  }, [messages]);

  useEffect(() => {
    setPendingAction(pendingActionsRef.current[sessionStateKey] ?? null);
  }, [sessionStateKey]);

  useEffect(() => {
    if (isAssistantOpen) {
      document.body.classList.add("sidebar-open");
    } else {
      document.body.classList.remove("sidebar-open");
    }
    return () => {
      document.body.classList.remove("sidebar-open");
    };
  }, [isAssistantOpen]);

  const sendMessage = async (content: string, explicitProduct?: Product | null) => {
    if (!content.trim() || isSessionLocked || isTyping) return;

    const productToUse = explicitProduct !== undefined ? explicitProduct : selectedProduct;
    const replyProductSnapshot = productToUse
      ? { ...productToUse }
      : null;
    const replyOrderSnapshot = selectedOrder ? { ...selectedOrder } : null;

    const userMessage = {
      id: Date.now().toString(),
      type: "user" as const,
      content,
      timestamp: new Date(),
      reply_product: replyProductSnapshot,
      reply_order: replyOrderSnapshot,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsTyping(true);

    sendWebSocketMessage(content, undefined, productToUse);
  };

  const sendWebSocketMessage = (
    content: string,
    confirmActionId?: string,
    explicitProduct?: Product | null
  ) => {
    if (isSessionLocked) {
      setIsTyping(false);
      return;
    }
    try {
      const productToSend = explicitProduct !== undefined ? explicitProduct : selectedProduct;
      const eventPayload = {
        event_id: sessionId,
        event_data: {
          question: content,
          store: selectedStore,
          user_name: userName || "Anonymous User",
          user_id: userId || "00000000-0000-0000-0000-000000000000",
          product: productToSend
            ? {
                id: productToSend.id,
                name: productToSend.name,
                price: productToSend.price,
                currency: productToSend.currency,
              }
            : undefined,
          order: selectedOrder
            ? {
                order_id: selectedOrder.order_id,
                status: selectedOrder.status,
                user_name: userName || "Anonymous User",
                created_at: selectedOrder.created_at,
                product: selectedOrder.product,
              }
            : undefined,
          confirm_action_id: confirmActionId,
        },
      };

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(eventPayload));
        logDebug("Message sent via WebSocket");

        if (selectedOrder) {
          setSelectedOrder(null);
        }
        if (productToSend) {
          setSelectedProduct(null);
        }
      } else {
        handleWebSocketError();
      }
    } catch (error) {
      console.error("Error sending WebSocket message:", error);
      handleWebSocketError();
    }
  };

  const handleWebSocketError = () => {
    setIsTyping(false);
    setMessages((prev) => [
      ...prev,
      {
        id: uuidv4(),
        type: "assistant",
        content:
          "I'm currently in demo mode since the backend isn't connected. I can still help you explore our products! Try asking about sizing, styling, or specific items.",
        timestamp: new Date(),
        suggestions: ["Try again", "Contact support"],
      },
    ]);
  };

  const lastSuggestionClickRef = useRef<{text: string, time: number} | null>(null);

  const handleSuggestionClick = (
    suggestion: string,
    messageProducts?: Product[]
  ) => {
    if (isTyping) return;

    const now = Date.now();
    if (lastSuggestionClickRef.current &&
        lastSuggestionClickRef.current.text === suggestion &&
        now - lastSuggestionClickRef.current.time < 500) {
      logDebug("Ignoring duplicate suggestion click");
      return;
    }
    lastSuggestionClickRef.current = { text: suggestion, time: now };

    const productToReference = messageProducts && messageProducts.length > 0
      ? messageProducts[0]
      : selectedProduct;

    if (productToReference) {
      setSelectedProduct(productToReference);
      logDebug("Updated selected product from suggestion");
    }

    sendMessage(suggestion, productToReference);
  };

  const handleViewProduct = (productId: string) => {
    window.location.href = `/product/${productId}?store=${encodeURIComponent(
      selectedStoreForProduct
    )}`;
  };

  const handleOrderSelect = (order: Order) => {
    if (selectedOrderId === order.order_id) {
      setSelectedOrderId(null);
      setSelectedOrder(null);
    } else {
      setSelectedOrderId(order.order_id);
      setSelectedOrder(order);
    }
  };

  const handleSendWithSelectedOrder = () => {
    if (!selectedOrder || !inputValue.trim() || isTyping) return;

    sendMessage(inputValue);

    setSelectedOrderId(null);
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;

    const orderPreview = pendingOrderPreview || selectedOrder;

    const confirmationMessage = {
      id: `${sessionId}:${Date.now()}`,
      type: "user" as const,
      content: "Confirmed",
      timestamp: new Date(),
      confirmation_state: "accepted" as const,
      confirmation_message: pendingAction.confirmation_message,
      confirmation_order: orderPreview ? {
        order_id: orderPreview.order_id,
        status: orderPreview.status,
        product: orderPreview.product,
      } : undefined,
      confirmation_action: (pendingAction.parameters as Record<string, unknown>)?.action as string,
    };

    setMessages((prev) => [...prev, confirmationMessage]);
    setIsTyping(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
      await fetch(`${apiUrl}/events/chat/message/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmationMessage),
      });
    } catch (error) {
      console.error("Failed to save confirmation message:", error);
    }

    sendWebSocketMessage("User confirmed the action", pendingAction.action_id);

    setPendingAction(null);
    pendingActionsRef.current[sessionStateKey] = null;
  };

  const handleCancelAction = async () => {
    if (!pendingAction) return;

    const orderPreview = pendingOrderPreview || selectedOrder;

    const declineMessage = {
      id: `${sessionId}:${Date.now()}`,
      type: "user" as const,
      content: "Declined",
      timestamp: new Date(),
      confirmation_state: "declined" as const,
      confirmation_message: pendingAction.confirmation_message,
      confirmation_order: orderPreview ? {
        order_id: orderPreview.order_id,
        status: orderPreview.status,
        product: orderPreview.product,
      } : undefined,
      confirmation_action: (pendingAction.parameters as Record<string, unknown>)?.action as string,
    };

    setMessages((prev) => [...prev, declineMessage]);
    setIsTyping(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
      await fetch(`${apiUrl}/events/chat/message/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(declineMessage),
      });
    } catch (error) {
      console.error("Failed to save decline message:", error);
    }

    sendWebSocketMessage("User declined the action", pendingAction.action_id);

    setPendingAction(null);
    pendingActionsRef.current[sessionStateKey] = null;
  };

  const lockedBannerMessage = (() => {
    if (!sessionLockReason) {
      return "This chat is paused. You can review previous messages, but sending new ones is disabled.";
    }

    switch (sessionLockReason) {
      case "abusive_language":
        return "This chat is paused due to inappropriate language. Please keep conversations respectful. Contact support if you need assistance.";
      case "prompt_injection":
        return "This chat is paused. Our assistant can only help with shopping-related questions. Contact support if you need help.";
      case "repeated_policy_violations":
      case "policy_violation":
        return "This chat is paused due to repeated off-topic requests. Our assistant is here to help with shopping. Contact support if you need assistance.";
      default:
        return "This chat is paused due to repeated policy violations. You can review previous messages, but sending new ones is disabled.";
    }
  })();

  const latestProductMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const candidate = messages[i];
      if (
        candidate.type === "assistant" &&
        candidate.products?.length &&
        candidate.is_user_added === true
      ) {
        return candidate.id;
      }
    }
    return null;
  }, [messages]);

  const pendingOrderId = (() => {
    if (!pendingAction) return null;
    const rawOrderId = (pendingAction.parameters || {}).order_id as
      | string
      | number
      | undefined;
    if (typeof rawOrderId === "string") return rawOrderId;
    if (typeof rawOrderId === "number") return rawOrderId.toString();
    return null;
  })();

  const pendingOrderPreview =
    pendingOrderId && ordersRegistryRef.current[pendingOrderId]
      ? ordersRegistryRef.current[pendingOrderId]
      : null;

  const handleRemoveProductMessage = useCallback(
    (messageId: string) => {
      let removed = false;

      setMessages((prev) => {
        const latest = (() => {
          for (let i = prev.length - 1; i >= 0; i -= 1) {
            const candidate = prev[i];
            if (
              candidate.type === "assistant" &&
              candidate.products?.length &&
              candidate.is_user_added === true
            ) {
              return candidate.id;
            }
          }
          return null;
        })();

        if (latest !== messageId) {
          return prev;
        }

        removed = true;
        return prev.filter((message) => message.id !== messageId);
      });

      if (removed) {
        setSelectedProduct(null);
      }
    },
    [setMessages, setSelectedProduct]
  );

  return (
    <div
      className={`fixed top-0 bg-background border-l z-50 shadow-xl transition-all duration-300 ease-in-out ${
        isAssistantOpen ? "translate-x-0" : "translate-x-full"
      }`}
      style={{
        right: isMounted ? right : -450,
        width: isMounted ? sideWidth : 450,
        height: viewportHeight ? `${viewportHeight}px` : "100vh",
        minHeight: viewportHeight ? `${viewportHeight}px` : "100vh",
        transition:
          "right 300ms ease-in-out, width 300ms ease-in-out, transform 300ms ease-in-out",
      }}
    >
      <div className="flex flex-col h-full">
        <div className="p-4 border-b bg-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-5 h-5" />

              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-semibold">Assistant</h2>
                <div className="flex items-center">
                  <div
                    className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                      connectionStatus === "connected"
                        ? "bg-green-500"
                        : connectionStatus === "connecting"
                        ? "bg-secondary"
                        : "bg-destructive"
                    }`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {connectionStatus === "connected"
                      ? "Online"
                      : connectionStatus === "connecting"
                      ? "Connecting..."
                      : "Offline"}
                  </span>
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsAssistantOpen(false)}
              className="w-8 h-8 p-0 text-foreground hover:text-primary bg-transparent hover:bg-transparent transition-colors"
            >
              <X className="w-4 h-4 text-current" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full p-4">
            <div
              className="space-y-4 pb-28"
              style={{
                paddingBottom:
                  keyboardInset > 0
                    ? `${keyboardInset + 56}px`
                    : "calc(env(safe-area-inset-bottom, 0px) + 4rem)",
              }}
            >
              {messages.map((message) => {
                const isLatestProductMessage =
                  message.id === latestProductMessageId;
                const trackingStatus = message.tracking_data?.status
                  ? message.tracking_data.status.toLowerCase()
                  : null;
                const isReturned = trackingStatus === "returned";
                const isCancelled = trackingStatus === "cancelled";
                const currentLocation = message.tracking_data?.current_location;
                const deliveryAddress = message.tracking_data?.delivery_address;
                const hasCurrentLocationData = Boolean(currentLocation);
                const hasDeliveryAddressData = Boolean(deliveryAddress);
                const shouldShowTrackingMap =
                  Boolean(message.tracking_data) &&
                  !isCancelled &&
                  (trackingStatus !== "created" || isReturned) &&
                  Boolean(
                    (isReturned && (hasDeliveryAddressData || hasCurrentLocationData)) ||
                      (!isReturned &&
                        (hasCurrentLocationData || hasDeliveryAddressData))
                  );
                const showCurrentLocationDetails =
                  !isCancelled &&
                  ((isReturned && hasDeliveryAddressData) ||
                    (!isReturned &&
                      trackingStatus !== "created" &&
                      hasCurrentLocationData));
                const showDeliveryAddressDetails = isReturned
                  ? hasCurrentLocationData
                  : hasDeliveryAddressData;
                const trackingOrder = message.tracking_data?.order_id
                  ? ordersRegistryRef.current[message.tracking_data.order_id]
                  : null;
                const statusLabel =
                  trackingStatus === "created"
                    ? "Order Placed"
                    : trackingStatus === "shipped"
                    ? "In Transit"
                    : trackingStatus === "delivered"
                    ? "Delivered"
                    : trackingStatus === "returned"
                    ? "Return Pending"
                    : trackingStatus === "cancelled"
                    ? "Cancelled"
                    : "Order Update";
                const statusIndicatorClass =
                  trackingStatus === "delivered"
                    ? "bg-success"
                    : trackingStatus === "shipped"
                    ? "bg-primary animate-pulse"
                    : trackingStatus === "cancelled"
                    ? "bg-muted-foreground"
                    : "bg-warning";
                const showEta =
                  trackingStatus === "created" || trackingStatus === "shipped";
                const truckColorClass =
                  trackingStatus === "delivered"
                    ? "text-success"
                    : trackingStatus === "cancelled"
                    ? "text-muted-foreground"
                    : "text-primary";

                return (
                  <div key={message.id} className="space-y-3">
                    {message.reply_product && (
                      <div
                        className={`flex ${
                          message.type === "user"
                            ? "justify-end"
                            : "justify-start"
                        }`}
                      >
                        <div className="max-w-[80%] mb-1">
                          <div className="flex items-center space-x-3 rounded-2xl border border-border/60 bg-card/90 backdrop-blur px-3 py-2 shadow-sm">
                            <Image
                              src={message.reply_product.image || "/placeholder.svg"}
                              alt={message.reply_product.name}
                              width={48}
                              height={48}
                              className="w-10 h-10 object-cover rounded-lg border border-border/40"
                              unoptimized={false}
                            />
                            <div className="min-w-0">
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Product selected
                              </p>
                              <p className="text-sm font-medium text-card-foreground line-clamp-1">
                                {message.reply_product.name}
                              </p>
                              <p className="text-xs font-semibold text-primary">
                                {formatCurrency(
                                  message.reply_product.price,
                                  message.reply_product.currency
                                )}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {message.reply_order && (
                      <div
                        className={`flex ${
                          message.type === "user"
                            ? "justify-end"
                            : "justify-start"
                        }`}
                      >
                        <div className="max-w-[80%] mb-1">
                          <div className="flex items-center space-x-3 rounded-2xl border border-border/60 bg-card/90 backdrop-blur px-3 py-2 shadow-sm">
                            <Image
                              src={
                                message.reply_order.product.image || "/placeholder.svg"
                              }
                              alt={message.reply_order.product.name}
                              width={48}
                              height={48}
                              className="w-10 h-10 object-cover rounded-lg border border-border/40"
                              unoptimized={false}
                            />
                            <div className="min-w-0">
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Selected Order
                              </p>
                              <p className="text-sm font-medium text-card-foreground line-clamp-1">
                                {message.reply_order.product.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatCurrency(
                                  message.reply_order.product.price,
                                  message.reply_order.product.currency
                                )}{" "}
                                • {formatStatusLabel(message.reply_order.status)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  {message.confirmation_state ? (
                    <div className="flex justify-start w-full">
                      <div className="relative w-full">
                        <div className={`absolute -top-2 left-1/2 transform -translate-x-1/2 w-4 h-4 rotate-45 border-t border-l ${
                          message.confirmation_state === "accepted"
                            ? "bg-success/5 border-success/30"
                            : "bg-destructive/5 border-destructive/30"
                        }`}></div>
                        <Card className={`border shadow-sm ${
                          message.confirmation_state === "accepted"
                            ? "bg-success/5 border-success/30"
                            : "bg-destructive/5 border-destructive/30"
                        }`}>
                          <CardContent className="p-3 space-y-3">
                            {message.confirmation_order && (
                              <div className="flex space-x-3 border border-border/40 rounded-xl bg-muted/30 p-3">
                                <Image
                                  src={message.confirmation_order.product.image || "/placeholder.svg"}
                                  alt={message.confirmation_order.product.name}
                                  width={64}
                                  height={64}
                                  className="w-12 h-12 rounded-lg object-cover border border-border/40"
                                  unoptimized={false}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-card-foreground line-clamp-1">
                                    {message.confirmation_order.product.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatCurrency(
                                      message.confirmation_order.product.price,
                                      message.confirmation_order.product.currency
                                    )}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                    {message.confirmation_order.order_id}
                                  </p>
                                </div>
                              </div>
                            )}
                            <div className="flex items-start space-x-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                                message.confirmation_state === "accepted"
                                  ? "bg-success/10"
                                  : "bg-destructive/10"
                              }`}>
                                {message.confirmation_state === "accepted" ? (
                                  <CheckCircle2 className="w-5 h-5 text-success" />
                                ) : (
                                  <X className="w-5 h-5 text-destructive" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-semibold mb-0.5 ${
                                  message.confirmation_state === "accepted"
                                    ? "text-success"
                                    : "text-destructive"
                                }`}>
                                  {message.confirmation_state === "accepted"
                                    ? `${message.confirmation_action ? formatStatusLabel(message.confirmation_action) : 'Order'} Request Confirmed`
                                    : `${message.confirmation_action ? formatStatusLabel(message.confirmation_action) : 'Order'} Request Declined`
                                  }
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  ) : !message.hide_content ? (
                    <div
                      className={`flex ${
                        message.type === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                          message.type === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        <div className="prose prose-sm dark:prose-invert max-w-none font-modern-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {message.warning_message && (
                    <div className="ml-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                      <p className="text-xs text-yellow-800 dark:text-yellow-200">
                        ⚠️ {message.warning_message}
                      </p>
                    </div>
                  )}

                  {message.requires_human && (
                    <div className="ml-2 flex items-center space-x-1 text-xs text-muted-foreground">
                      {message.flagging_reason === "policy_violation" ||
                      message.flagging_reason === "abusive_language" ||
                      message.flagging_reason === "prompt_injection" ? (
                        <>
                          <span>⚠️</span>
                          <span className="text-orange-600 dark:text-orange-400">
                            Policy violation detected
                          </span>
                        </>
                      ) : (
                        <>
                          <span>🙋</span>
                          <span>Team reviewing for assistance</span>
                        </>
                      )}
                    </div>
                  )}

                  {message.products && message.products.length > 0 && (
                    <div className="space-y-1 ml-2">
                      {message.products.map((product) => (
                        <Card
                          key={product.id}
                          className="border-0 shadow-sm bg-card"
                        >
                          <CardContent className="px-3 py-1.5">
                            <div className="flex items-center space-x-3">
                              <Image
                                src={product.image || "/placeholder.svg"}
                                alt={product.name}
                                width={400}
                                height={800}
                                className="w-12 h-16 object-cover rounded"
                                unoptimized={false}
                              />
                              <div className="flex-1 min-w-0 space-y-0.5">
                                <h4 className="font-medium text-sm text-card-foreground line-clamp-2 font-modern-body">
                                  {product.name}
                                </h4>
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-primary text-sm">
                                    {formatCurrency(
                                      product.price,
                                      product.currency
                                    )}
                                  </span>
                                  <Button
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={() => handleViewProduct(product.id)}
                                  >
                                    View
                                  </Button>
                                </div>
                              </div>
                            </div>
                            {isLatestProductMessage && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleRemoveProductMessage(message.id)
                                }
                                className="mt-1.5 text-[11px] text-foreground hover:text-primary bg-transparent hover:bg-transparent transition-colors text-left w-full"
                              >
                                · Remove product from chat
                              </button>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}

                  {message.orders && message.orders.length > 0 && (
                    <div className="space-y-2 ml-2">
                      <p className="text-xs text-muted-foreground mb-2">
                        💡 Select an order, then tell me what you&apos;d like to
                        do (cancel, return, etc.)
                      </p>
                      {message.orders.map((order) => (
                        <Card
                          key={order.order_id}
                          className={`border shadow-sm bg-card cursor-pointer hover:bg-muted/50 transition-all ${
                            selectedOrderId === order.order_id
                              ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                              : "border-border/50"
                          }`}
                          onClick={() => handleOrderSelect(order)}
                        >
                          <CardContent className="p-3">
                            <div className="flex space-x-3">
                              {selectedOrderId === order.order_id && (
                                <div className="flex items-center justify-center">
                                  <CheckCircle2 className="w-5 h-5 text-primary" />
                                </div>
                              )}
                              <Image
                                src={order.product.image || "/placeholder.svg"}
                                alt={order.product.name}
                                width={400}
                                height={800}
                                className="w-12 h-16 object-cover rounded"
                                unoptimized={false}
                              />
                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-sm text-card-foreground mb-1 line-clamp-2 font-modern-body">
                                  {order.product.name}
                                </h4>
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-primary text-sm">
                                    {formatCurrency(
                                      order.product.price,
                                      order.product.currency
                                    )}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(
                                      order.created_at
                                    ).toLocaleDateString()}
                                  </span>
                                </div>
                                <div className="mt-2">
                                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wide">
                                    <span className={`text-[11px] font-semibold ${getStatusAccentClass(order.status)}`}>
                                      {formatStatusLabel(order.status)}
                                    </span>
                                  </div>
                                  <div className="flex items-center space-x-1 mt-1">
                                    {ORDER_STATUS_STEPS.map((step, index) => {
                                      return (
                                        <span
                                          key={`${order.order_id}-${step}`}
                                          className={`flex-1 h-1.5 rounded-full ${
                                            getStepClassForStatus(order.status, index)
                                          }`}
                                        ></span>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}

                  {message.tracking_data && (
                    <div className="ml-2">
                      <Card className="border-0 shadow-sm bg-card overflow-hidden">
                        <CardContent className="p-0">
                          {trackingOrder && (
                            <div className="px-4 py-2 border-b border-border/60">
                              <div className="flex items-center space-x-3">
                                <Image
                                  src={trackingOrder.product.image || "/placeholder.svg"}
                                  alt={trackingOrder.product.name}
                                  width={48}
                                  height={48}
                                  className="w-12 h-12 object-cover rounded-lg border border-border/30"
                                  unoptimized={false}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-card-foreground line-clamp-1">
                                    {trackingOrder.product.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatCurrency(
                                      trackingOrder.product.price,
                                      trackingOrder.product.currency
                                    )}
                                    {" • "}
                                    {new Date(
                                      trackingOrder.created_at
                                    ).toLocaleDateString()}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p
                                    className={`text-sm font-semibold ${getStatusAccentClass(
                                      trackingStatus || trackingOrder.status
                                    )}`}
                                  >
                                    {formatStatusLabel(
                                      trackingStatus || trackingOrder.status
                                    )}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}
                          {shouldShowTrackingMap && (
                            <TrackingMap
                              currentLocation={currentLocation}
                              deliveryAddress={deliveryAddress}
                              isReturnRoute={isReturned}
                            />
                          )}

                          <div className="p-4 space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <Package className="w-5 h-5 text-primary" />
                                <h4 className="font-semibold text-card-foreground">
                                  Order Tracking
                                </h4>
                              </div>
                              <div className="text-right">
                                <div className="text-xs text-muted-foreground">
                                  Tracking ID
                                </div>
                                <div className="text-sm font-mono font-medium">
                                  #FX
                                  {message.tracking_data.order_id
                                    .split("-")[0]
                                    .toUpperCase()}
                                </div>
                              </div>
                            </div>

                            <Separator />

                            <div className="space-y-3">
                              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                                <div className="flex items-center space-x-3">
                                  <div
                                    className={`w-2 h-2 rounded-full ${statusIndicatorClass}`}
                                  />
                                  <div>
                                    <div className="text-sm font-medium">
                                      {statusLabel}
                                    </div>
                                    {showEta && (
                                      <div className="text-xs text-muted-foreground">
                                        Est. Delivery:{" "}
                                        {new Date(
                                          new Date(
                                            message.tracking_data.created_at
                                          ).getTime() +
                                            (trackingStatus === "created" ? 5 : 2) *
                                              24 *
                                              60 *
                                              60 *
                                              1000
                                        ).toLocaleDateString("en-US", {
                                          month: "short",
                                          day: "numeric",
                                          year: "numeric",
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <Truck className={`w-5 h-5 ${truckColorClass}`} />
                              </div>

                              <div className="grid grid-cols-1 gap-3">
                                {showCurrentLocationDetails && (
                                  <div className="p-3 bg-primary-light border border-primary-medium rounded-lg">
                                    <div className="flex items-start space-x-2">
                                      <MapPin className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-primary mb-1">
                                          Current Location
                                        </div>
                                        {isReturned && deliveryAddress ? (
                                          <>
                                            <div className="text-sm text-card-foreground">
                                              {deliveryAddress.full_name}
                                            </div>
                                            <div className="text-sm text-muted-foreground">
                                              {deliveryAddress.address_line1}
                                              {deliveryAddress.address_line2 &&
                                                `, ${deliveryAddress.address_line2}`}
                                            </div>
                                            <div className="text-sm text-muted-foreground">
                                              {deliveryAddress.city}
                                              {deliveryAddress.state && (
                                                <>
                                                  , {deliveryAddress.state}{" "}
                                                </>
                                              )}
                                              {deliveryAddress.postal_code}
                                            </div>
                                            <div className="text-sm text-muted-foreground">
                                              {deliveryAddress.country}
                                            </div>
                                          </>
                                        ) : (
                                          currentLocation && (
                                            <>
                                              <div className="text-sm text-card-foreground">
                                                {currentLocation.city}, {currentLocation.region}
                                              </div>
                                              <div className="text-sm text-muted-foreground">
                                                {currentLocation.country}
                                              </div>
                                              <div className="text-xs text-muted-foreground mt-1">
                                                {new Date(
                                                  message.tracking_data.created_at
                                                ).toLocaleString("en-US", {
                                                  month: "short",
                                                  day: "numeric",
                                                  hour: "2-digit",
                                                  minute: "2-digit",
                                                })}
                                              </div>
                                            </>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {showDeliveryAddressDetails && (
                                  <div className="p-3 status-delivered rounded-lg">
                                    <div className="flex items-start space-x-2">
                                      <MapPin className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-success mb-1">
                                          Delivery Address
                                        </div>
                                        {isReturned ? (
                                          currentLocation && (
                                            <>
                                              <div className="text-sm text-card-foreground">
                                                {currentLocation.city || "Fulfillment Facility"}
                                              </div>
                                              <div className="text-sm text-muted-foreground">
                                                {[currentLocation.region, currentLocation.country]
                                                  .filter(Boolean)
                                                  .join(", ")}
                                              </div>
                                            </>
                                          )
                                        ) : (
                                          deliveryAddress && (
                                            <>
                                              <div className="text-sm text-card-foreground">
                                                {deliveryAddress.full_name}
                                              </div>
                                              <div className="text-sm text-muted-foreground">
                                                {deliveryAddress.address_line1}
                                                {deliveryAddress.address_line2 &&
                                                  `, ${deliveryAddress.address_line2}`}
                                              </div>
                                              <div className="text-sm text-muted-foreground">
                                                {deliveryAddress.city}, {deliveryAddress.state}{" "}
                                                {deliveryAddress.postal_code}
                                              </div>
                                              <div className="text-sm text-muted-foreground">
                                                {deliveryAddress.country}
                                              </div>
                                            </>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {trackingStatus === "created" &&
                                  deliveryAddress && (
                                    <div className="p-3 bg-muted/40 border border-dashed rounded-lg">
                                      <div className="flex items-start space-x-2">
                                        <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                        <div className="flex-1">
                                          <div className="text-xs font-medium text-muted-foreground mb-1">
                                            Shipment will depart soon
                                          </div>
                                          <div className="text-sm text-card-foreground">
                                            We&apos;ll send this order to{" "}
                                            <span className="font-semibold">
                                              {deliveryAddress.city}
                                            </span>
                                            {deliveryAddress.state && (
                                              <>
                                                ,{" "}
                                                {deliveryAddress.state}
                                              </>
                                            )}
                                            {", "}
                                            {deliveryAddress.country}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                {isReturned && currentLocation && (
                                  <div className="p-3 bg-muted/40 border border-dashed rounded-lg">
                                    <div className="flex items-start space-x-2">
                                      <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                                      <div className="flex-1">
                                        <div className="text-xs font-medium text-muted-foreground mb-1">
                                          Return shipment will depart soon
                                        </div>
                                        <div className="text-sm text-card-foreground">
                                          We&apos;ll route this package back toward{" "}
                                          <span className="font-semibold">
                                            {currentLocation.city || "our facility"}
                                          </span>
                                          {currentLocation.region && `, ${currentLocation.region}`}{" "}
                                          {currentLocation.country}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {isCancelled && (
                                  <div className="p-3 bg-muted/40 border border-dashed rounded-lg text-sm text-muted-foreground">
                                    This order was cancelled before it left the
                                    warehouse, so there isn&apos;t any active tracking
                                    information to display.
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg border">
                                <div className="flex items-center space-x-2">
                                  <Truck className="w-4 h-4 text-muted-foreground" />
                                  <span className="text-sm text-muted-foreground">
                                    Carrier
                                  </span>
                                </div>
                                <span className="text-sm font-medium">
                                  FedEx Express
                                </span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {message.suggestions && (
                    <div className="flex flex-wrap gap-1.5 ml-2">
                      {message.suggestions.map((suggestion, index) => (
                        <Button
                          key={index}
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleSuggestionClick(suggestion, message.products)
                          }
                          className="text-xs h-7 px-2 rounded-full border-border/50 hover:border-primary/50"
                          disabled={isTyping}
                        >
                          {suggestion}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}

              {pendingAction && (
                <div className="relative">
                  <div className="absolute -top-2 left-1/2 transform -translate-x-1/2 w-4 h-4 bg-card dark:bg-card rotate-45 border-t border-l border-border dark:border-border"></div>
                  <Card className="bg-card dark:bg-card border-primary/30 dark:border-primary/30 shadow-lg">
                    <CardContent className="p-4 space-y-3">
                      {pendingOrderPreview ? (
                        <div className="flex space-x-3 border border-border/40 rounded-xl bg-muted/30 p-3">
                          <Image
                            src={pendingOrderPreview.product.image || "/placeholder.svg"}
                            alt={pendingOrderPreview.product.name}
                            width={64}
                            height={64}
                            className="w-12 h-12 rounded-lg object-cover border border-border/40"
                            unoptimized={false}
                          />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-card-foreground line-clamp-1">
                              {pendingOrderPreview.product.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatCurrency(
                                pendingOrderPreview.product.price,
                                pendingOrderPreview.product.currency
                              )}{" "}
                              • {pendingOrderPreview.status}
                            </p>
                          </div>
                        </div>
                      ) : null}
                      <div className="flex items-start space-x-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-primary text-sm">⚠️</span>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-foreground dark:text-foreground leading-relaxed">
                            {pendingAction.confirmation_message}
                          </p>
                          <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                            This action cannot be undone.
                          </p>
                        </div>
                      </div>

                      <div className="flex space-x-2 pt-1">
                        <Button
                          size="sm"
                          onClick={handleConfirmAction}
                          disabled={isTyping}
                          className="flex-1 bg-primary hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/90
                                  text-primary-foreground dark:text-primary-foreground font-medium shadow-sm
                                  transition-all duration-200 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1.5" />
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCancelAction}
                          disabled={isTyping}
                          className="flex-1 border-primary/30 hover:bg-primary/10 hover:text-primary hover:border-primary/50 font-medium
                                  transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <X className="w-4 h-4 mr-1.5" />
                          Cancel
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-muted text-foreground rounded-2xl px-3 py-2">
                    <div className="flex space-x-1">
                      <div
                        className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
                        style={{ animationDelay: "0ms" }}
                      ></div>
                      <div
                        className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
                        style={{ animationDelay: "150ms" }}
                      ></div>
                      <div
                        className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
                        style={{ animationDelay: "300ms" }}
                      ></div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        </div>

        <div
          className="p-4 border-t bg-muted/30"
          style={{
            paddingBottom:
              keyboardInset > 0
                ? `${keyboardInset + 16}px`
                : "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
          }}
        >
          {selectedOrderId && (
            <div className="mb-2 p-2 bg-primary/10 border border-primary/20 rounded-lg flex items-center justify-between">
              <span className="text-xs text-foreground flex items-center">
                <CheckCircle2 className="w-3 h-3 mr-1 text-primary" />
                Order selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedOrderId(null);
                  setSelectedOrder(null);
                }}
                className="h-5 px-1 text-xs"
              >
                Clear
              </Button>
            </div>
          )}

          {isSessionLocked && (
            <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {lockedBannerMessage}
            </div>
          )}

          <div className="flex space-x-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={
                isSessionLocked
                  ? "Chat is paused due to policy violations."
                  : isTyping
                  ? "Hold tight, I'm replying..."
                  : selectedOrderId
                  ? "What would you like to do with this order?"
                  : "Ask about products, sizing, or styling..."
              }
              onKeyPress={(e) => {
                if (e.key === "Enter" && !isSessionLocked && !isTyping) {
                  if (selectedOrderId) {
                    handleSendWithSelectedOrder();
                  } else {
                    sendMessage(inputValue);
                  }
                }
              }}
              className="flex-1 h-9 text-sm bg-background border-border/50"
              disabled={isSessionLocked || isTyping}
            />
            <Button
              onClick={() => {
                if (selectedOrderId) {
                  handleSendWithSelectedOrder();
                } else {
                  sendMessage(inputValue);
                }
              }}
              disabled={!inputValue.trim() || isSessionLocked || isTyping}
              size="sm"
              className="h-9 px-3"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground text-center">
            Keep in mind AI can make mistakes
          </p>
        </div>
      </div>
    </div>
  );
}
