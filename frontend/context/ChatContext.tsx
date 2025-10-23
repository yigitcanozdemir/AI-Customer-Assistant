"use client"

import type React from "react"
import { createContext, useContext, useState, useRef, useEffect, useCallback } from "react"
import { v4 as uuidv4 } from "uuid"
import { useStore } from "@/context/StoreContext"

export interface Message {
  id: string
  type: "user" | "assistant"
  content: string
  timestamp: Date
  products?: Product[]
  orders?: OrderStatus[]
  suggestions?: string[]
}

interface OrderProduct {
  id: string
  name: string
  price: number
  currency: string
  image?: string | null
  variant?: string | null
}

interface OrderStatus {
  order_id: string
  status: string
  created_at: Date
  product: OrderProduct
}
interface ProductVariant {
  color?: string
  size?: string
  stock: number
  available: boolean
}

interface Product {
  id: string
  name: string
  description: string
  price: number
  originalPrice?: number
  currency: string
  inStock: boolean
  image: string
  images: string[]
  variants: ProductVariant[]
  sizes: string[]
  colors: string[]
}

interface ChatContextType {
  messages: Message[]
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  isAssistantOpen: boolean
  setIsAssistantOpen: React.Dispatch<React.SetStateAction<boolean>>
  sessionId: string
  ws: WebSocket | null
  setWs: React.Dispatch<React.SetStateAction<WebSocket | null>>
  connectionStatus: "connecting" | "connected" | "disconnected"
  setConnectionStatus: React.Dispatch<React.SetStateAction<"connecting" | "connected" | "disconnected">>
  isTyping: boolean
  setIsTyping: React.Dispatch<React.SetStateAction<boolean>>
  wsRef: React.MutableRefObject<WebSocket | null>
  selectedProduct: Product | null
  setSelectedProduct: React.Dispatch<React.SetStateAction<Product | null>>

  selectedOrder: OrderStatus | null
  setSelectedOrder: React.Dispatch<React.SetStateAction<OrderStatus | null>>
  resetChatForStore: () => void
}

const ChatContext = createContext<ChatContextType | undefined>(undefined)

export const useChat = () => {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider")
  }
  return context
}

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { store: currentStore } = useStore()
  const [messages, setMessages] = useState<Message[]>([])
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string>(() => uuidv4())
  const [ws, setWs] = useState<WebSocket | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected")
  const [isTyping, setIsTyping] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<OrderStatus | null>(null)

  const [storeSessionMap, setStoreSessionMap] = useState<
    Record<
      string,
      {
        sessionId: string
        messages: Message[]
        isAssistantOpen: boolean
        selectedProduct: Product | null
      }
    >
  >(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem("chatSessions")
        return saved ? JSON.parse(saved) : {}
      } catch {
        return {}
      }
    }
    return {}
  })

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem("chatSessions", JSON.stringify(storeSessionMap))
      } catch (error) {
        console.error("Failed to save chat sessions:", error)
      }
    }
  }, [storeSessionMap])

  const resetChatForStore = useCallback(() => {
    const newSessionId = uuidv4()
    setSessionId(newSessionId)
    setMessages([])
    setSelectedProduct(null)
    setConnectionStatus("disconnected")
    if (wsRef.current) {
      wsRef.current.close()
      setWs(null)
      wsRef.current = null
    }

    if (currentStore) {
      setStoreSessionMap((prev) => ({
        ...prev,
        [currentStore]: {
          sessionId: newSessionId,
          messages: [],
          isAssistantOpen: false,
          selectedProduct: null,
        },
      }))
    }
  }, [currentStore])

  useEffect(() => {
    if (!currentStore) return

    console.log("Store changed to:", currentStore)
    const storeState = storeSessionMap[currentStore]
    console.log("Store state found:", storeState)

    if (storeState) {
      console.log(
        "Restoring store state - messages:",
        storeState.messages.length,
        "isAssistantOpen:",
        storeState.isAssistantOpen,
      )
      setSessionId(storeState.sessionId)
      setMessages(storeState.messages)
      setIsAssistantOpen(storeState.isAssistantOpen)
      setSelectedProduct(storeState.selectedProduct)

      if (storeState.messages.length > 0) {
        console.log("Setting connection to connected - has messages")
        setConnectionStatus("connected")
      } else if (storeState.isAssistantOpen) {
        console.log("Setting connection to connecting - chat open but no messages")
        setConnectionStatus("connecting")
      } else {
        console.log("Setting connection to disconnected - no messages and chat closed")
        setConnectionStatus("disconnected")
      }
    } else {
      console.log("Creating new store state")
      const newSessionId = uuidv4()
      setSessionId(newSessionId)
      setMessages([])
      setIsAssistantOpen(false)
      setSelectedProduct(null)
      setConnectionStatus("disconnected")

      setStoreSessionMap((prev) => ({
        ...prev,
        [currentStore]: {
          sessionId: newSessionId,
          messages: [],
          isAssistantOpen: false,
          selectedProduct: null,
        },
      }))
    }
  }, [currentStore])

  useEffect(() => {
    if (currentStore && storeSessionMap[currentStore]) {
      const timeoutId = setTimeout(() => {
        setStoreSessionMap((prev) => ({
          ...prev,
          [currentStore]: {
            sessionId,
            messages,
            isAssistantOpen,
            selectedProduct,
          },
        }))
      }, 300)

      return () => clearTimeout(timeoutId)
    }
  }, [currentStore, sessionId, messages, isAssistantOpen, selectedProduct])

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
    resetChatForStore,
  }

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}