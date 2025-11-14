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

const TrackingMap = dynamic(
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
  useEffect(() => {
    hasSentInitialMessage.current = false;
  }, [sessionId]);
  useEffect(() => {
    setIsMounted(true);
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
          console.log("Sent initial message to backend:", initialPayload);
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
      console.log("Attempting WebSocket connection...");
      const websocket = new WebSocket(`${wsBase}/events/ws/chat/${sessionId}`);
      websocket.onopen = () => {
        clearTimeout(connectingTimer);
        console.log("WebSocket connected successfully");
        setConnectionStatus("connected");
        setWs(websocket);
        wsRef.current = websocket;
      };
      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("WebSocket message received:", data);
          if (data.pending_action) {
            setPendingAction(data.pending_action);
            console.log("Pending action received:", data.pending_action);
          }
          if (typeof data.session_locked === "boolean") {
            setIsSessionLocked(data.session_locked);
            setSessionLockReason(
              data.session_locked ? data.lock_reason || "policy_violation" : null
            );
          }
          const assistantMessage = {
            id: uuidv4(),
            type: "assistant" as const,
            content:
              data.content || "I'm sorry, I didn't receive a proper response.",
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
            products: data.products || [],
            orders: data.orders || [],
            tracking_data: data.tracking_data || null,
            suggestions: data.suggestions || [],
            warning_message: data.warning_message,
            requires_human: data.requires_human,
            confidence_score: data.confidence_score,
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
        console.log("WebSocket disconnected:", event.code, event.reason);
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
  ]);

  useEffect(() => {
    if (!isAssistantOpen) return;

    console.log("Store changed, reconnecting WebSocket for new session...");

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
  }, [selectedStore, sessionId, isAssistantOpen]);

  useEffect(() => {
    if (isAssistantOpen && !ws && !wsRef.current) {
      console.log("Sidebar opened, establishing WebSocket connection...");
      connectWebSocket();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAssistantOpen, ws]);

  useEffect(() => {
    if (!isAssistantOpen || !ws || ws.readyState !== WebSocket.OPEN || hasSentInitialMessage.current) return;
    const assistantMessages = messages.filter((msg) => msg.type === "assistant");
    if (assistantMessages.length > 0) {
      console.log("Sending initial assistant messages to backend:", assistantMessages.length);
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
    if (isAssistantOpen) {
      document.body.classList.add("sidebar-open");
    } else {
      document.body.classList.remove("sidebar-open");
    }
    return () => {
      document.body.classList.remove("sidebar-open");
    };
  }, [isAssistantOpen]);

  const sendMessage = async (content: string) => {
    if (!content.trim() || isSessionLocked) return;

    const userMessage = {
      id: Date.now().toString(),
      type: "user" as const,
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsTyping(true);

    sendWebSocketMessage(content);
  };

  const sendWebSocketMessage = (content: string, confirmActionId?: string) => {
    if (isSessionLocked) {
      setIsTyping(false);
      return;
    }
    try {
      const eventPayload = {
        event_id: sessionId,
        event_data: {
          question: content,
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
        console.log("Message sent via WebSocket:", eventPayload);

        if (selectedOrder) {
          setSelectedOrder(null);
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

  const handleSuggestionClick = (
    suggestion: string,
    messageProducts?: Product[]
  ) => {
    if (messageProducts && messageProducts.length > 0) {
      setSelectedProduct(messageProducts[0]);
      console.log(
        "Updated selected product from suggestion:",
        messageProducts[0].name
      );
    }

    sendMessage(suggestion);
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
      console.log("Order selected:", order.order_id);
    }
  };

  const handleSendWithSelectedOrder = () => {
    if (!selectedOrder || !inputValue.trim()) return;

    sendMessage(inputValue);

    setSelectedOrderId(null);
  };

  const handleConfirmAction = () => {
    if (!pendingAction) return;

    const userMessage = {
      id: Date.now().toString(),
      type: "user" as const,
      content: "✓ Confirmed",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsTyping(true);

    sendWebSocketMessage("User confirmed the action", pendingAction.action_id);

    setPendingAction(null);
  };

  const handleCancelAction = () => {
    const userMessage = {
      id: Date.now().toString(),
      type: "user" as const,
      content: "✗ Cancelled",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setPendingAction(null);

    sendWebSocketMessage("User cancelled the action");
  };

  const lockedBannerMessage = sessionLockReason
    ? "This chat is paused due to repeated policy violations. You can review previous messages, but sending new ones is disabled."
    : "This chat is paused. You can review previous messages, but sending new ones is disabled.";

  const latestProductMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const candidate = messages[i];
      if (candidate.type === "assistant" && candidate.products?.length) {
        return candidate.id;
      }
    }
    return null;
  }, [messages]);

  const handleRemoveProductMessage = useCallback(
    (messageId: string) => {
      let removed = false;

      setMessages((prev) => {
        const latest = (() => {
          for (let i = prev.length - 1; i >= 0; i -= 1) {
            const candidate = prev[i];
            if (candidate.type === "assistant" && candidate.products?.length) {
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
      className={`fixed top-0 min-h-[100dvh] bg-background border-l z-50 shadow-xl transition-all duration-300 ease-in-out ${
        isAssistantOpen ? "translate-x-0" : "translate-x-full"
      }`}
      style={{
        right: isMounted ? right : -450,
        width: isMounted ? sideWidth : 450,
        height: "100dvh",
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
                paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 4rem)",
              }}
            >
              {messages.map((message) => {
                const isLatestProductMessage =
                  message.id === latestProductMessageId;
                const trackingStatus = message.tracking_data?.status
                  ? message.tracking_data.status.toLowerCase()
                  : null;
                const shouldShowTrackingMap =
                  Boolean(message.tracking_data) &&
                  trackingStatus !== "created" &&
                  Boolean(
                    message.tracking_data?.current_location ||
                      message.tracking_data?.delivery_address
                  );
                const showCurrentLocationDetails =
                  Boolean(message.tracking_data?.current_location) &&
                  trackingStatus !== "created";
                const currentLocation = message.tracking_data?.current_location;

                return (
                  <div key={message.id} className="space-y-3">
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

                  {message.warning_message && (
                    <div className="ml-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                      <p className="text-xs text-yellow-800 dark:text-yellow-200">
                        ⚠️ {message.warning_message}
                      </p>
                    </div>
                  )}

                  {message.requires_human && (
                    <div className="ml-2 flex items-center space-x-1 text-xs text-muted-foreground">
                      <span>🙋</span>
                      <span>Flagged for team review</span>
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
                                <p className="text-xs text-muted-foreground mt-1">
                                  Status: {order.status}
                                </p>
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
                          {shouldShowTrackingMap && (
                            <TrackingMap
                              currentLocation={
                                message.tracking_data.current_location
                              }
                              deliveryAddress={
                                message.tracking_data.delivery_address
                              }
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
                                    className={`w-2 h-2 rounded-full ${
                                      message.tracking_data.status ===
                                      "delivered"
                                        ? "bg-success"
                                        : message.tracking_data.status ===
                                          "shipped"
                                        ? "bg-primary animate-pulse"
                                        : "bg-warning"
                                    }`}
                                  />
                                  <div>
                                    <div className="text-sm font-medium">
                                      {message.tracking_data.status ===
                                        "created" && "Order Placed"}
                                      {message.tracking_data.status ===
                                        "shipped" && "In Transit"}
                                      {message.tracking_data.status ===
                                        "delivered" && "Delivered"}
                                    </div>
                                    {message.tracking_data.status !==
                                      "delivered" && (
                                      <div className="text-xs text-muted-foreground">
                                        Est. Delivery:{" "}
                                        {new Date(
                                          new Date(
                                            message.tracking_data.created_at
                                          ).getTime() +
                                            (message.tracking_data.status ===
                                            "created"
                                              ? 5
                                              : 2) *
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
                                <Truck
                                  className={`w-5 h-5 ${
                                    message.tracking_data.status === "delivered"
                                      ? "text-success"
                                      : "text-primary"
                                  }`}
                                />
                              </div>

                              <div className="grid grid-cols-1 gap-3">
                                {showCurrentLocationDetails && currentLocation && (
                                  <div className="p-3 bg-primary-light border border-primary-medium rounded-lg">
                                    <div className="flex items-start space-x-2">
                                      <MapPin className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-primary mb-1">
                                          Current Location
                                        </div>
                                        <div className="text-sm text-card-foreground">
                                          {currentLocation.city}
                                          ,{" "}
                                          {currentLocation.region}
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
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {message.tracking_data.delivery_address && (
                                  <div className="p-3 status-delivered rounded-lg">
                                    <div className="flex items-start space-x-2">
                                      <MapPin className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-success mb-1">
                                          Delivery Address
                                        </div>
                                        <div className="text-sm text-card-foreground">
                                          {
                                            message.tracking_data
                                              .delivery_address.full_name
                                          }
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                          {
                                            message.tracking_data
                                              .delivery_address.address_line1
                                          }
                                          {message.tracking_data
                                            .delivery_address.address_line2 &&
                                            `, ${message.tracking_data.delivery_address.address_line2}`}
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                          {
                                            message.tracking_data
                                              .delivery_address.city
                                          }
                                          ,{" "}
                                          {
                                            message.tracking_data
                                              .delivery_address.state
                                          }{" "}
                                          {
                                            message.tracking_data
                                              .delivery_address.postal_code
                                          }
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                          {
                                            message.tracking_data
                                              .delivery_address.country
                                          }
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {trackingStatus === "created" &&
                                  message.tracking_data.delivery_address && (
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
                                              {
                                                message.tracking_data
                                                  .delivery_address.city
                                              }
                                            </span>
                                            {message.tracking_data
                                              .delivery_address.state && (
                                              <>
                                                ,{" "}
                                                {
                                                  message.tracking_data
                                                    .delivery_address.state
                                                }
                                              </>
                                            )}
                                            {", "}
                                            {
                                              message.tracking_data
                                                .delivery_address.country
                                            }
                                          </div>
                                        </div>
                                      </div>
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
                          className="flex-1 bg-primary hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/90 
                                  text-primary-foreground dark:text-primary-foreground font-medium shadow-sm
                                  transition-all duration-200 hover:shadow-md"
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1.5" />
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleCancelAction}
                          className="flex-1 border-primary/30 hover:bg-primary/10 hover:text-primary hover:border-primary/50 font-medium
                                  transition-all duration-200"
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
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
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
                  : selectedOrderId
                  ? "What would you like to do with this order?"
                  : "Ask about products, sizing, or styling..."
              }
              onKeyPress={(e) => {
                if (e.key === "Enter" && !isSessionLocked) {
                  if (selectedOrderId) {
                    handleSendWithSelectedOrder();
                  } else {
                    sendMessage(inputValue);
                  }
                }
              }}
              className="flex-1 h-9 text-sm bg-background border-border/50"
              disabled={isSessionLocked}
            />
            <Button
              onClick={() => {
                if (selectedOrderId) {
                  handleSendWithSelectedOrder();
                } else {
                  sendMessage(inputValue);
                }
              }}
              disabled={!inputValue.trim() || isSessionLocked}
              size="sm"
              className="h-9 px-3"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
