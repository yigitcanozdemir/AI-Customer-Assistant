"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Send, Package, RotateCcw, Sparkles, Heart, Search, MessageCircle, X, ShoppingBag, Star } from "lucide-react"
import { v4 as uuidv4 } from "uuid"
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select"
import { useStore } from "../context/StoreContext"
interface Message {
  id: string
  type: "user" | "assistant"
  content: string
  timestamp: Date
  products?: Product[]
  suggestions?: string[]
}

interface ProductVariant {
  id: string
  name: string
  price?: number
  inStock?: boolean
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

const stores = ["Aurora Style", "Luna Apperal", "Celeste Wear", "Dayifuse Fashion"]


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

export default function Store() {
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [sessionId, setSessionId] = useState<string>("")
  const {store: selectedStore, setStore } = useStore()
  const [products, setProducts] = useState<Product[] | null>(null)

  const [ws, setWs] = useState<WebSocket | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected")
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        console.log("Attempting to fetch products from backend...")
        const res = await fetch(`http://localhost:8000/events/products?store=${selectedStore}`, {
          headers: {
            Authorization: "Bearer your-secret-token",
          },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        const data: Product[] = await res.json()
        console.log("Successfully fetched products from backend:", data.length)
        setProducts(data)
      } catch (err) {
        console.error("Error fetching products from backend:", err)
      }
    }

    fetchProducts()
  }, [selectedStore])

  useEffect(() => {
    if (isAssistantOpen && !ws) {
      connectWebSocket()
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [isAssistantOpen])

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

          const assistantMessage: Message = {
            id: uuidv4(),
            type: "assistant",
            content: data.content || "I'm sorry, I didn't receive a proper response.",
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
            products: data.products || [],
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
            suggestions: [
              "Tell me about the evening dress",
              "What sizes are available?",
              "Show me casual options",
              "Help with styling tips",
            ],
          },
        ])
      }
    } catch (error) {
      console.error("Error creating WebSocket connection:", error)
      setConnectionStatus("disconnected")
    }
  }

  const filteredDresses = (products ?? []).filter(
    (dress) =>
      dress.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dress.description.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const fetchProductById = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:8000/events/products/${id}`, {
        headers: {
          Authorization: "Bearer your-secret-token",
        },
      })
      if (!res.ok) throw new Error("Failed to fetch product details")
      const data: Product = await res.json()
      setSelectedProduct(data)
    } catch (err) {
      console.error("Error fetching product details", err)
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    const id = uuidv4()
    setSessionId(id)
  }, [])

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


  
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const storeParam = urlParams.get("store")
    const productId = urlParams.get("product")
    const shouldOpenChat = urlParams.get("chat") === "true"

    if (storeParam) {
      setStore(storeParam)
    }

    if (productId && shouldOpenChat) {
      const product = products ? products.find((p) => p.id === productId) : undefined
      if (product) {
        openAssistant(product)
        const newUrl = storeParam ? `?store=${encodeURIComponent(storeParam)}` : window.location.pathname
        window.history.replaceState({}, "", newUrl)
      }
    }
  }, [products, setStore])

  const openAssistant = (product?: Product) => {
    if (product) {
      fetchProductById(product.id)
    } else {
      setSelectedProduct(null)
    }
    setIsAssistantOpen(true)

    if (product) {
      setMessages([
        {
          id: "1",
          type: "assistant",
          content: `Hello! I see you're interested in the ${product.name}. I have all the details about this product including pricing (${formatCurrency(product.price, product.currency)}), available sizes (${product.sizes.join(", ")}), colors (${product.colors.join(", ")}), and current stock levels. What would you like to know?`,
          timestamp: new Date(),
          products: [product],
          suggestions: [
            "What sizes are available?",
            "How does this dress fit?",
            "What occasions is this perfect for?",
            "Care and washing instructions",
            "Show me similar products"
          ],
        },
      ])
    } 
  }

  const sendMessage = async (content: string) => {
    if (!content.trim()) return

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
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
            : null,
        },
      }

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(eventPayload))
        console.log("Message sent via WebSocket with product context:", eventPayload)
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

  const openProductPage = (productId: string) => {
    window.location.href = `/product/${productId}?store=${encodeURIComponent(selectedStore)}`
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 lg:px-6">

          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center space-x-8">
              <h1 className="text-xl font-semibold text-foreground font-modern-heading">{selectedStore}</h1>
              <nav className="hidden md:flex items-center space-x-6">
                <a
                  href="#"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  New Arrivals
                </a>
                <a
                  href="#"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Dresses
                </a>
                <a
                  href="#"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Sale
                </a>
              </nav>
            </div>

            <div className="flex items-center space-x-4">
            <Select
              value={selectedStore}
              onValueChange={(value) => {
                setStore(value);

                const url = new URL(window.location.href);
                url.searchParams.set("store", value);
                url.searchParams.delete("product");
                url.searchParams.delete("chat");   
                window.history.replaceState({}, "", url.toString());
              }}
            >
              <SelectTrigger className="w-[160px] h-9 text-sm">
                <SelectValue placeholder="Select store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map((store) => (
                  <SelectItem key={store} value={store}>
                    {store}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

              <Button onClick={() => openAssistant()} variant="outline" size="sm" className="relative">
                <MessageCircle className="w-4 h-4 mr-2" />
                Chat
                {isAssistantOpen && (
                  <div
                    className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${
                      connectionStatus === "connected"
                        ? "bg-green-500"
                        : connectionStatus === "connecting"
                          ? "bg-secondary"
                          : "bg-destructive"
                    }`}
                  />
                )}
              </Button>
            </div>
          </div>

          <div className="pb-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-9 text-sm bg-muted/50 border-0 focus-visible:ring-1"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 lg:px-6 py-8">
        <div className={`transition-all duration-300 ${isAssistantOpen ? "lg:mr-[400px]" : ""}`}>


          <div
            className={`grid gap-6 transition-all duration-300 ${
              isAssistantOpen
                ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"
            }`}
          >
            {filteredDresses.map((dress) => (
              <Card
                key={dress.id}
                className="group overflow-hidden border-0 shadow-sm hover:shadow-md transition-all duration-200 bg-card"
              >
                <div className="aspect-[3/4] overflow-hidden bg-muted/20 relative">
                  <img
                    src={dress.image || "/placeholder.svg"}
                    alt={dress.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute top-3 right-3 w-8 h-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Heart className="w-4 h-4" />
                  </Button>
                </div>
                <CardContent className="p-4">
                  <div className="space-y-2">
                    <h3 className="font-medium text-sm text-card-foreground line-clamp-2 font-modern-body">
                      {dress.name}
                    </h3>

                    <div className="flex items-center space-x-1">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="w-3 h-3 fill-current text-secondary" />
                      ))}
                      <span className="text-xs text-muted-foreground ml-1">(4.8)</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-x-2">
                     <span className="font-semibold text-foreground">
                          {formatCurrency(dress.price, dress.currency)}
                        </span>
                        {dress.originalPrice && (
                          <span className="text-sm text-muted-foreground line-through">
                            {formatCurrency(dress.originalPrice, dress.currency)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex space-x-2 pt-2">
                      <Button size="sm" className="flex-1 h-8 text-xs">
                        <ShoppingBag className="w-3 h-3 mr-1" />
                        Add to Cart
                      </Button>

                        <Button
                        onClick={() => openProductPage(dress.id)}
                        variant="outline"
                        size="sm"
                        className="h-8 px-3"
                      >
                        View
                      </Button>
                      <Button onClick={() => openAssistant(dress)} variant="outline" size="sm" className="h-8 px-3">
                        <MessageCircle className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredDresses.length === 0 && (
            <div className="text-center py-16">
              <p className="text-lg text-muted-foreground font-modern-body mb-4">
                No products found matching your search.
              </p>
              <Button onClick={() => setSearchQuery("")} variant="outline">
                Clear Search
              </Button>
            </div>
          )}
        </div>
      </main>

      {/* Chat Panel*/}
      {isAssistantOpen && (
        <div className="fixed top-0 right-0 w-full lg:w-[400px] h-full bg-background border-l z-50 shadow-xl">
          <div className="flex flex-col h-full">
            <div className="p-4 border-b bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Avatar className="w-8 h-8 bg-primary/10">
                    <AvatarFallback className="text-primary font-medium text-sm">AI</AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="font-medium text-sm text-foreground font-modern-heading">Style Assistant</h3>
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
                          <p className="leading-relaxed font-modern-body">{message.content}</p>
                        </div>
                      </div>

                      {message.products && message.products.length > 0 && (
                        <div className="space-y-2 ml-2">
                          {message.products.map((product) => (
                            <Card key={product.id} className="border-0 shadow-sm bg-card">
                              <CardContent className="p-3">
                                <div className="flex space-x-3">
                                  <img
                                    src={product.image || "/placeholder.svg"}
                                    alt={product.name}
                                    className="w-12 h-16 object-cover rounded"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-medium text-sm text-card-foreground mb-1 line-clamp-2 font-modern-body">
                                      {product.name}
                                    </h4>
                                    <div className="flex items-center justify-between">
                                      <span className="font-semibold text-primary text-sm">
                                        {formatCurrency(product.price, product.currency)}
                                      </span>                                      
                                      <Button size="sm" className="h-6 px-2 text-xs">
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
      )}
    </div>
  )
}
