"use client";

import type React from "react";
import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { useStore } from "@/context/StoreContext";

const isDev = process.env.NODE_ENV !== "production";
const logDebug = (...args: unknown[]) => {
  if (isDev) console.log(...args);
};

export interface Message {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: Date;
  products?: Product[];
  orders?: OrderStatus[];
  tracking_data?: TrackingData;
  reply_product?: Product | null;
  reply_order?: OrderStatus | null;
  suggestions?: string[];
  warning_message?: string;
  requires_human?: boolean;
  confidence_score?: number;
  is_user_added?: boolean;
  flagging_reason?: string;
  confirmation_state?: "accepted" | "declined" | null;
  confirmation_message?: string;
  confirmation_order?: {
    order_id: string;
    status: string;
    product: OrderProduct;
  };
  confirmation_action?: string;
  hide_content?: boolean;
}

interface TrackingData {
  order_id: string;
  current_location?: {
    country: string;
    region: string;
    city: string;
    lat: number;
    lng: number;
  } | null;
  delivery_address?: {
    full_name: string;
    address_line1: string;
    address_line2?: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
  } | null;
  created_at: string;
  status: string;
}

interface OrderProduct {
  id: string;
  name: string;
  price: number;
  currency: string;
  image?: string | null;
  variant?: string | null;
}

interface OrderStatus {
  order_id: string;
  status: string;
  created_at: Date;
  product: OrderProduct;
}
interface ProductVariant {
  color?: string;
  size?: string;
  stock: number;
  available: boolean;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  originalPrice?: number;
  currency: string;
  inStock: boolean;
  image: string;
  images: string[];
  variants: ProductVariant[];
  sizes: string[];
  colors: string[];
}

interface ChatContextType {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  isAssistantOpen: boolean;
  setIsAssistantOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sessionId: string;
  ws: WebSocket | null;
  setWs: React.Dispatch<React.SetStateAction<WebSocket | null>>;
  connectionStatus: "connecting" | "connected" | "disconnected";
  setConnectionStatus: React.Dispatch<
    React.SetStateAction<"connecting" | "connected" | "disconnected">
  >;
  isTyping: boolean;
  setIsTyping: React.Dispatch<React.SetStateAction<boolean>>;
  wsRef: React.MutableRefObject<WebSocket | null>;
  selectedProduct: Product | null;
  setSelectedProduct: React.Dispatch<React.SetStateAction<Product | null>>;

  selectedOrder: OrderStatus | null;
  setSelectedOrder: React.Dispatch<React.SetStateAction<OrderStatus | null>>;
  isSessionLocked: boolean;
  setIsSessionLocked: React.Dispatch<React.SetStateAction<boolean>>;
  sessionLockReason: string | null;
  setSessionLockReason: React.Dispatch<React.SetStateAction<string | null>>;
  resetChatForStore: () => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { store: currentStore } = useStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string>(() => uuidv4());
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("disconnected");
  const [isTyping, setIsTyping] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderStatus | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isSessionLocked, setIsSessionLocked] = useState(false);
  const [sessionLockReason, setSessionLockReason] = useState<string | null>(null);

  type StoreSession = {
    sessionId: string;
    messages: Message[];
    isAssistantOpen: boolean;
    selectedProduct: Product | null;
    isSessionLocked: boolean;
    sessionLockReason: string | null;
    isTyping: boolean;
  };

  const [storeSessionMap, setStoreSessionMap] = useState<
    Record<string, StoreSession>
  >({});

  useEffect(() => {
    setIsMounted(true);
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem("chatSessions");
        if (saved) {
          setStoreSessionMap(JSON.parse(saved));
        }
      } catch (error) {
        console.error("Failed to load chat sessions:", error);
      }
    }
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem("chatSessions", JSON.stringify(storeSessionMap));
      } catch (error) {
        console.error("Failed to save chat sessions:", error);
      }
    }
  }, [storeSessionMap, isMounted]);

  const resetChatForStore = useCallback(() => {
    const newSessionId = uuidv4();
    setSessionId(newSessionId);
    setMessages([]);
    setSelectedProduct(null);
    setConnectionStatus("disconnected");
    if (wsRef.current) {
      wsRef.current.close();
      setWs(null);
      wsRef.current = null;
    }

    if (currentStore) {
      setStoreSessionMap((prev) => ({
        ...prev,
        [currentStore]: {
          sessionId: newSessionId,
          messages: [],
          isAssistantOpen: false,
          selectedProduct: null,
          isSessionLocked: false,
          sessionLockReason: null,
          isTyping: false,
        },
      }));
    }
  }, [currentStore]);

  useEffect(() => {
    if (!currentStore || !isMounted) return;

    logDebug("Store changed to:", currentStore);
    const storeState = storeSessionMap[currentStore];
    logDebug("Store state found:", storeState);

    if (storeState) {
      logDebug(
        "Restoring store state - messages:",
        storeState.messages.length,
        "isAssistantOpen:",
        storeState.isAssistantOpen
      );
      setSessionId(storeState.sessionId);

      const messagesWithDates = storeState.messages.map((msg: Message) => ({
        ...msg,
        timestamp: typeof msg.timestamp === 'string' ? new Date(msg.timestamp) : msg.timestamp,
      }));
      setMessages(messagesWithDates);

      setIsAssistantOpen(storeState.isAssistantOpen);
      setSelectedProduct(storeState.selectedProduct);
      setIsSessionLocked(storeState.isSessionLocked ?? false);
      setSessionLockReason(storeState.sessionLockReason ?? null);
      const restoredTyping = storeState.isTyping ?? false;
      const lastMessage = messagesWithDates[messagesWithDates.length - 1];
      const shouldShowTyping = restoredTyping && lastMessage && lastMessage.type === 'user';

      setIsTyping(shouldShowTyping);
      if (shouldShowTyping) {
        logDebug('Restored typing indicator - agent is still processing (last message is from user)');
      } else if (restoredTyping && !shouldShowTyping) {
        logDebug('Not restoring typing indicator - response already received (last message is from assistant)');
      }

      if (storeState.messages.length > 0) {
        logDebug("Setting connection to connected - has messages");
        setConnectionStatus("connected");
      } else if (storeState.isAssistantOpen) {
        logDebug(
          "Setting connection to connecting - chat open but no messages"
        );
        setConnectionStatus("connecting");
      } else {
        logDebug(
          "Setting connection to disconnected - no messages and chat closed"
        );
        setConnectionStatus("disconnected");
      }
    } else {
      logDebug("Creating new store state");
      const newSessionId = uuidv4();
      setSessionId(newSessionId);
      setMessages([]);
      setIsAssistantOpen(false);
      setSelectedProduct(null);
      setIsSessionLocked(false);
      setSessionLockReason(null);
      setConnectionStatus("disconnected");

      setStoreSessionMap((prev) => ({
        ...prev,
        [currentStore]: {
          sessionId: newSessionId,
          messages: [],
          isAssistantOpen: false,
          selectedProduct: null,
          isSessionLocked: false,
          sessionLockReason: null,
          isTyping: false,
        },
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStore, isMounted]);

  useEffect(() => {
    if (!isMounted) return;
    if (currentStore && storeSessionMap[currentStore]) {
      const timeoutId = setTimeout(() => {
        setStoreSessionMap((prev) => ({
          ...prev,
          [currentStore]: {
            sessionId,
            messages,
            isAssistantOpen,
            selectedProduct,
            isSessionLocked,
            sessionLockReason,
            isTyping,
          },
        }));
      }, 300);

      return () => clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentStore,
    sessionId,
    messages,
    isAssistantOpen,
    selectedProduct,
    isSessionLocked,
    sessionLockReason,
    isTyping,
    isMounted,
  ]);

  const value: ChatContextType = {
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
    resetChatForStore,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};
