"use client"

import Image from "next/image"
import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Send, Package, RotateCcw, Sparkles, X } from "lucide-react"
import { v4 as uuidv4 } from "uuid"
import { useStore } from "@/context/StoreContext"
import { useChat } from "@/context/ChatContext"
import { useUser } from "@/context/UserContext"
import { useCart } from "@/lib/cart-context"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

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

const formatCurrency = (price: number, currency: string): string => {
  switch (currency) {
    case "USD":
      return `$${price.toFixed(2)}`
    case "EURO":
      return `€${price.toFixed(2)}`
    case "TRY":
      return `₺${price.toFixed(2)}`
    default:
      return `${currency} ${price.toFixed(2)}`
  }
}

export function ChatSidebar() {
  const [inputValue, setInputValue] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { store: selectedStore } = useStore()
  const { store: selectedStoreForProduct } = useStore()
  const { userId, userName } = useUser()
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
    selectedOrder,
    setSelectedOrder,
  } = useChat()
  const { state } = useCart()
  useEffect(() => {
    if (!isAssistantOpen) return

    console.log("Store changed, reconnecting WebSocket for new session...")
    if (wsRef.current) {
      wsRef.current.close()
    }
    setWs(null)
    wsRef.current = null

    connectWebSocket()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStore, sessionId, isAssistantOpen])

  const connectWebSocket = () => {
    try {
      setConnectionStatus("connecting")
      console.log("Attempting WebSocket connection...")
      const websocket = new WebSocket(`ws://localhost:8000/events/ws/chat/${sessionId}`)

      websocket.onopen = () => {
        console.log("WebSocket connected successfully")
        setConnectionStatus("connected")
        setWs(websocket)
        wsRef.current = websocket
      }

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log("WebSocket message received:", data)

          const assistantMessage = {
            id: uuidv4(),
            type: "assistant" as const,
            content: data.content || "I'm sorry, I didn't receive a proper response.",
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
            products: data.products || [],
            orders: data.orders || [],
            suggestions: data.suggestions || [],
          }

          setIsTyping(false)
          setMessages((prev) => [...prev, assistantMessage])
        } catch (error) {
          console.error("Error parsing WebSocket message:", error)
          setIsTyping(false)
        }
      }

      websocket.onclose = (event) => {
        console.log("WebSocket disconnected:", event.code, event.reason)
        setConnectionStatus("disconnected")
        setWs(null)
        wsRef.current = null
        setIsTyping(false)
      }

      websocket.onerror = (error) => {
        console.error("WebSocket error:", error)
        setConnectionStatus("disconnected")
        setIsTyping(false)

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
        ])
      }
    } catch (error) {
      console.error("Error creating WebSocket connection:", error)
      setConnectionStatus("disconnected")
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (isAssistantOpen) {
      document.body.classList.add("sidebar-open")
    } else {
      document.body.classList.remove("sidebar-open")
    }
    return () => {
      document.body.classList.remove("sidebar-open")
    }
  }, [isAssistantOpen])

  const sendMessage = async (content: string) => {
    if (!content.trim()) return

    const userMessage = {
      id: Date.now().toString(),
      type: "user" as const,
      content,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInputValue("")
    setIsTyping(true)

    sendWebSocketMessage(content)
  }

  const sendWebSocketMessage = (content: string) => {
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
        },
      }

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(eventPayload))
        console.log("Message sent via WebSocket with product context:", eventPayload)

        if (selectedOrder) {
          setSelectedOrder(null)
        }
      } else {
        handleWebSocketError()
      }
    } catch (error) {
      console.error("Error sending WebSocket message:", error)
      handleWebSocketError()
    }
  }

  const handleWebSocketError = () => {
    setIsTyping(false)
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
    ])
  }

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion)
  }

  const handleViewProduct = (productId: string) => {
    window.location.href = `/product/${productId}?store=${encodeURIComponent(selectedStoreForProduct)}`
  }

  const handleOrderSelect = (order: any) => {
    const userMessage = {
      id: Date.now().toString(),
      type: "user" as const,
      content: `This one: ${order.product.name}`,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setIsTyping(true)

    // Send WebSocket message with the order data directly
    const eventPayload = {
      event_id: sessionId,
      event_data: {
        question: `This one: ${order.product.name}`,
        store: selectedStore,
        user_name: userName || "Anonymous User",
        user_id: userId || "00000000-0000-0000-0000-000000000000",
        product: selectedProduct
          ? {
              id: selectedProduct.id,
              name: selectedProduct.name,
              price: selectedProduct.price,
              currency: selectedProduct.currency,
              description: selectedProduct.description,
              sizes: selectedProduct.sizes,
              colors: selectedProduct.colors,
              variants: selectedProduct.variants,
            }
          : undefined,
        order: {
          order_id: order.order_id,
          status: order.status,
          user_name: userName || "Anonymous User",
          created_at: order.created_at,
          product: order.product,
        },
      },
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(eventPayload))
      console.log("Order message sent via WebSocket:", eventPayload)
    } else {
      handleWebSocketError()
    }
  }

  if (!isAssistantOpen) return null

  return (
      <div
        className={`
          fixed top-0 h-full bg-background border-l z-50 shadow-xl transition-all duration-300 ease-in-out
          w-full lg:w-[450px]
          ${isAssistantOpen ? 'right-0' : '-right-full'}
          lg:${state.isOpen ? 'right-[450px]' : 'right-0'}
        `}
      >
      <div className="flex flex-col h-full">
        <div className="p-4 border-b bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Avatar className="w-8 h-8 bg-primary/10">
                <AvatarFallback className="text-primary font-medium text-sm">AI</AvatarFallback>
              </Avatar>
              <div>
                <h3 className="font-medium text-sm text-foreground font-modern-heading">Customer Assistant</h3>
                <div className="flex items-center mt-0.5">
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
            <Button variant="ghost" size="sm" onClick={() => setIsAssistantOpen(false)} className="w-8 h-8 p-0">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full p-4">
            <div className="space-y-4">
              {messages.map((message) => (
                <div key={message.id} className="space-y-3">
                  <div className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                        message.type === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                      }`}
                    >
                      <div className="prose prose-sm dark:prose-invert max-w-none font-modern-body">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        // Artık 'className' burada yok!
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                    </div>
                  </div>

                  {message.products && message.products.length > 0 && (
                    <div className="space-y-2 ml-2">
                      {message.products.map((product) => (
                        <Card key={product.id} className="border-0 shadow-sm bg-card">
                          <CardContent className="p-3">
                            <div className="flex space-x-3">
                              <Image
                                src={product.image || "/placeholder.svg"}
                                alt={product.name}
                                width={400}
                                height={800}
                                className="w-12 h-16 object-cover rounded"
                                unoptimized={false}
                              />
                              <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-sm text-card-foreground mb-1 line-clamp-2 font-modern-body">
                                  {product.name}
                                </h4>
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-primary text-sm">
                                    {formatCurrency(product.price, product.currency)}
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
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}

                  {message.orders && message.orders.length > 0 && (
                    <div className="space-y-2 ml-2">
                      {message.orders.map((order) => (
                        <Card
                          key={order.order_id}
                          className={`border-0 shadow-sm bg-card cursor-pointer hover:bg-muted/50 transition-colors ${
                            selectedOrder?.order_id === order.order_id ? "border-blue-500 bg-blue-50" : ""
                          }`}
                          onClick={() => handleOrderSelect(order)}
                        >
                          <CardContent className="p-3">
                            <div className="flex space-x-3">
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
                                    {formatCurrency(order.product.price, order.product.currency)}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(order.created_at).toLocaleDateString()}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">Status: {order.status}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}

                  {message.suggestions && (
                    <div className="flex flex-wrap gap-1.5 ml-2">
                      {message.suggestions.map((suggestion, index) => (
                        <Button
                          key={index}
                          variant="outline"
                          size="sm"
                          onClick={() => handleSuggestionClick(suggestion)}
                          className="text-xs h-7 px-2 rounded-full border-border/50 hover:border-primary/50"
                        >
                          {suggestion}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

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

        <div className="p-4 border-t bg-muted/30">
          <div className="flex space-x-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask about products, sizing, or styling..."
              onKeyPress={(e) => e.key === "Enter" && sendMessage(inputValue)}
              className="flex-1 h-9 text-sm bg-background border-border/50"
            />
            <Button
              onClick={() => sendMessage(inputValue)}
              disabled={!inputValue.trim()}
              size="sm"
              className="h-9 px-3"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex justify-center space-x-4 mt-3">
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-primary h-7 px-2">
              <Package className="w-3 h-3 mr-1" />
              Track Order
            </Button>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-primary h-7 px-2">
              <RotateCcw className="w-3 h-3 mr-1" />
              Returns
            </Button>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-primary h-7 px-2">
              <Sparkles className="w-3 h-3 mr-1" />
              Style Tips
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
