"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Send, Package, RotateCcw, Sparkles, Star, Heart, Search, MessageCircle, X } from "lucide-react"

interface Message {
  id: string
  type: "user" | "assistant"
  content: string
  timestamp: Date
  products?: Product[]
  suggestions?: string[]
}

interface Product {
  id: string
  name: string
  price: number
  originalPrice?: number
  image: string
  rating: number
  category: string
  description: string
  inStock: boolean
  sizes: string[]
  colors: string[]
}

export default function ElegantFashionAssistant() {
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const elegantDresses: Product[] = [
    {
      id: "nataya-001",
      name: "Vintage Inspired Lace A-Line Dress",
      price: 189.99,
      originalPrice: 249.99,
      image: "/placeholder.svg?height=400&width=300&text=Elegant+Lace+A-Line+Dress",
      rating: 4.8,
      category: "Evening Wear",
      description:
        "Exquisite vintage-inspired lace with a flattering A-line silhouette, perfect for weddings and special celebrations",
      inStock: true,
      sizes: ["8", "10", "12", "14", "16", "18", "20"],
      colors: ["Navy", "Dusty Rose", "Champagne", "Sage"],
    },
    {
      id: "nataya-002",
      name: "Elegant Wrap Dress with Sleeves",
      price: 159.99,
      image: "/placeholder.svg?height=400&width=300&text=Wrap+Dress+with+Sleeves",
      rating: 4.9,
      category: "Cocktail",
      description: "Timeless wrap style with elegant three-quarter sleeves, universally flattering and comfortable",
      inStock: true,
      sizes: ["6", "8", "10", "12", "14", "16", "18", "20", "22"],
      colors: ["Deep Navy", "Burgundy", "Forest Green", "Plum"],
    },
    {
      id: "nataya-003",
      name: "Mother of Bride Chiffon Gown",
      price: 229.99,
      image: "/placeholder.svg?height=400&width=300&text=Chiffon+Mother+Gown",
      rating: 4.7,
      category: "Formal",
      description: "Flowing chiffon with delicate beading, designed for comfort and elegance at special celebrations",
      inStock: true,
      sizes: ["8", "10", "12", "14", "16", "18", "20", "22"],
      colors: ["Soft Gray", "Dusty Rose", "Sage Green", "Champagne"],
    },
    {
      id: "nataya-004",
      name: "Classic Sheath Dress with Jacket",
      price: 199.99,
      image: "/placeholder.svg?height=400&width=300&text=Sheath+Dress+Jacket",
      rating: 4.6,
      category: "Formal",
      description:
        "Sophisticated sheath dress with matching jacket, perfect for daytime weddings and professional events",
      inStock: true,
      sizes: ["8", "10", "12", "14", "16", "18", "20"],
      colors: ["Navy", "Charcoal", "Dusty Blue", "Taupe"],
    },
    {
      id: "nataya-005",
      name: "Beaded Evening Gown",
      price: 299.99,
      originalPrice: 399.99,
      image: "/placeholder.svg?height=400&width=300&text=Beaded+Evening+Gown",
      rating: 4.9,
      category: "Evening Wear",
      description: "Stunning beaded evening gown with elegant draping, perfect for galas and formal celebrations",
      inStock: true,
      sizes: ["6", "8", "10", "12", "14", "16", "18", "20"],
      colors: ["Black", "Navy", "Deep Purple", "Emerald"],
    },
    {
      id: "nataya-006",
      name: "Tea Length Cocktail Dress",
      price: 149.99,
      image: "/placeholder.svg?height=400&width=300&text=Tea+Length+Dress",
      rating: 4.7,
      category: "Cocktail",
      description: "Charming tea-length dress with vintage-inspired details, perfect for afternoon celebrations",
      inStock: true,
      sizes: ["6", "8", "10", "12", "14", "16", "18", "20", "22"],
      colors: ["Rose", "Lavender", "Mint", "Cream"],
    },
  ]


  const filteredDresses = elegantDresses.filter(
    (dress) =>
      dress.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dress.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dress.description.toLowerCase().includes(searchQuery.toLowerCase()),
  )

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

    // Cleanup on unmount
    return () => {
      document.body.classList.remove("sidebar-open")
    }
  }, [isAssistantOpen])

  const openAssistant = (product?: Product) => {
    setSelectedProduct(product || null)
    setIsAssistantOpen(true)

    // Initialize conversation based on product context
    if (product) {
      setMessages([
        {
          id: "1",
          type: "assistant",
          content: `Hello! I see you're interested in the ${product.name}. I'm here to help answer any questions about this dress - sizing, styling, care instructions, or anything else you'd like to know!`,
          timestamp: new Date(),
          suggestions: [
            "What sizes are available?",
            "How does this dress fit?",
            "What occasions is this perfect for?",
            "Care and washing instructions",
          ],
        },
      ])
    } else {
      setMessages([
        {
          id: "1",
          type: "assistant",
          content:
            "Hello! I'm your Style Assistant. How can I help you find the perfect dress for your special occasion?",
          timestamp: new Date(),
          suggestions: [
            "Find a wedding guest dress",
            "Help with sizing",
            "Show me evening wear",
            "Mother of bride options",
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

    try {
      const eventPayload = {
        event_id: `chat_${Date.now()}`,
        event_type: "chat",
        event_data: {
          question: content, store: "pinklily"
        }
        
      }

      const response = await fetch("http://localhost:8000/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer your-secret-token"
        },
        body: JSON.stringify(eventPayload),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      console.log("Backend response:", JSON.stringify(data, null, 2))
      console.log("Content type:", typeof data)
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: data.content || "I'm sorry, I didn't receive a proper response.",
        timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
        products: data.products || [],
        suggestions: data.suggestions || [],
      }
      setIsTyping(false)

      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      console.error("API error:", error)
      setIsTyping(false)
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: "Sorry, I'm having trouble connecting right now. Please try again in a moment.",
        timestamp: new Date(),
        suggestions: ["Try again", "Contact support"]
      }])
    }


  }

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-amber-50/30">
      {/* Header with Search */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between mb-4 space-y-3 sm:space-y-0">
            <h1 className="text-2xl lg:text-3xl font-serif text-gray-900 font-light">Nataya Collection</h1>
            <Button
              onClick={() => openAssistant()}
              variant="outline"
              className="border-rose-300 text-rose-600 hover:bg-rose-50 font-elegant w-full sm:w-auto"
            >
              <MessageCircle className="w-4 h-4 mr-2" />
              Style Assistant
            </Button>
          </div>

          {/* Search Bar */}
          <div className="relative max-w-2xl mx-auto">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4 lg:w-5 lg:h-5" />
            <Input
              type="text"
              placeholder="Search for dresses, occasions, or styles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 lg:py-3 w-full border-gray-200 focus:border-rose-400 focus:ring-rose-400/20 rounded-xl bg-white/70 font-elegant text-base lg:text-lg"
            />
          </div>
        </div>
      </div>
      {/* Main Content */}
      <div className="transition-all duration-300 ease-in-out">
        <div className={`px-4 py-8 transition-all duration-300 ${isAssistantOpen ? "lg:mr-[500px]" : ""}`}>
          <div
            className={`grid gap-6 transition-all duration-300 ${
              isAssistantOpen
                ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3"
                : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6"
            }`}
          >
            {filteredDresses.map((dress) => (
              <Card
                key={dress.id}
                className="overflow-hidden hover:shadow-xl transition-all duration-500 border-gray-200 bg-white/90 backdrop-blur-sm"
              >
                <div className="aspect-[3/4] overflow-hidden bg-rose-50/20">
                  <img
                    src={dress.image || "/placeholder.svg"}
                    alt={dress.name}
                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-700"
                  />
                </div>
                <CardContent className="p-4 lg:p-6">
                  <h3 className="font-serif text-lg lg:text-xl text-gray-900 mb-2 lg:mb-3 font-medium">{dress.name}</h3>
                  <div className="flex items-center mb-2 lg:mb-3">
                    <div className="flex text-rose-600">
                      {[...Array(5)].map((_, i) => (
                        <Star
                          key={i}
                          className={`w-3 h-3 lg:w-4 lg:h-4 ${i < Math.floor(dress.rating) ? "fill-current" : ""}`}
                        />
                      ))}
                    </div>
                    <span className="text-xs lg:text-sm text-gray-600 ml-2 font-elegant">({dress.rating})</span>
                  </div>
                  <p className="text-xs lg:text-sm text-gray-600 mb-3 lg:mb-4 leading-relaxed line-clamp-2">
                    {dress.description}
                  </p>

                  <div className="flex items-center justify-between mb-3 lg:mb-4">
                    <div>
                      <span className="text-lg lg:text-2xl font-semibold text-gray-900">${dress.price}</span>
                      {dress.originalPrice && (
                        <span className="text-xs lg:text-sm text-gray-600 line-through ml-2">
                          ${dress.originalPrice}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-rose-300 text-rose-600 hover:bg-rose-50 font-elegant bg-transparent"
                    >
                      <Heart className="w-3 h-3 lg:w-4 lg:h-4 mr-1 lg:mr-2" />
                      <span className="hidden sm:inline">Save</span>
                    </Button>
                  </div>

                  {/* Questions Button */}
                  <Button
                    onClick={() => openAssistant(dress)}
                    className="w-full bg-rose-400 hover:bg-rose-500 text-white font-elegant rounded-xl text-sm lg:text-base py-2 lg:py-3"
                  >
                    <MessageCircle className="w-3 h-3 lg:w-4 lg:h-4 mr-2" />
                    Questions? Ask me
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredDresses.length === 0 && (
            <div className="text-center py-16">
              <p className="text-lg lg:text-xl text-gray-600 font-elegant">No dresses found matching your search.</p>
              <Button
                onClick={() => setSearchQuery("")}
                className="mt-4 bg-rose-400 hover:bg-rose-500 text-white font-elegant"
              >
                Clear Search
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Side Panel Assistant */}
      {isAssistantOpen && (
          <div className="fixed top-0 right-0 w-full lg:w-[500px] h-full bg-white/95 backdrop-blur-xl border-l border-gray-200 z-50 shadow-2xl">
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="bg-gradient-to-r from-rose-50 to-amber-50 p-4 lg:p-6 border-b border-gray-200/70">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 lg:space-x-4 min-w-0">
                  <Avatar className="w-10 h-10 lg:w-12 lg:h-12 bg-gradient-to-br from-rose-200 to-amber-200 border-2 border-rose-300/20 flex-shrink-0">
                    <AvatarFallback className="text-rose-700 font-serif font-semibold text-sm lg:text-lg">
                      SA
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-serif text-lg lg:text-xl text-gray-900 font-medium truncate">
                      Style Assistant
                    </h3>
                    <p className="text-xs lg:text-sm text-gray-600 font-elegant truncate">
                      {selectedProduct ? `Helping with: ${selectedProduct.name}` : "Here to help you look beautiful"}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsAssistantOpen(false)}
                  className="text-gray-600 hover:text-gray-900 rounded-full flex-shrink-0 p-2"
                >
                  <X className="w-4 h-4 lg:w-5 lg:h-5" />
                </Button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full p-4 lg:p-6">
              <div className="space-y-4 lg:space-y-6">
                {messages.map((message) => (
                  <div key={message.id} className="space-y-3 lg:space-y-4">
                    <div className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-3 lg:px-5 lg:py-4 ${
                          message.type === "user"
                            ? "bg-rose-400 text-white"
                            : "bg-rose-50/60 text-gray-900 border border-gray-200/70"
                        }`}
                      >
                        <p className="text-sm leading-relaxed font-elegant">{message.content}</p>
                      </div>
                    </div>

                    {/* Product Recommendations */}
                    {message.products && message.products.length > 0 && (
                      <div className="space-y-2 lg:space-y-3 ml-2 lg:ml-4">
                        {message.products.map((product) => (
                          <Card
                            key={product.id}
                            className="border-gray-200/70 hover:shadow-lg transition-all duration-300 bg-white/60 backdrop-blur-sm"
                          >
                            <CardContent className="p-3 lg:p-4">
                              <div className="flex space-x-3 lg:space-x-4">
                                <img
                                  src={product.image || "/placeholder.svg"}
                                  alt={product.name}
                                  className="w-16 h-20 lg:w-20 lg:h-24 object-cover rounded-lg flex-shrink-0"
                                />
                                <div className="flex-1 min-w-0">
                                  <h4 className="font-serif text-sm text-gray-900 mb-2 font-medium leading-tight line-clamp-2">
                                    {product.name}
                                  </h4>
                                  <div className="flex items-center mb-2">
                                    <div className="flex text-rose-600">
                                      {[...Array(5)].map((_, i) => (
                                        <Star
                                          key={i}
                                          className={`w-3 h-3 ${i < Math.floor(product.rating) ? "fill-current" : ""}`}
                                        />
                                      ))}
                                    </div>
                                    <span className="text-xs text-gray-600 ml-1">({product.rating})</span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-rose-600 text-sm lg:text-base">
                                      ${product.price}
                                    </span>
                                    <Button
                                      size="sm"
                                      className="bg-rose-400 hover:bg-rose-500 text-xs px-3 py-1 font-elegant"
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

                    {/* Suggestion Buttons */}
                    {message.suggestions && (
                      <div className="flex flex-wrap gap-2 ml-2 lg:ml-4">
                        {message.suggestions.map((suggestion, index) => (
                          <Button
                            key={index}
                            variant="outline"
                            size="sm"
                            onClick={() => handleSuggestionClick(suggestion)}
                            className="text-xs border-rose-300 text-rose-600 hover:bg-rose-50 font-elegant rounded-full px-3 py-1"
                          >
                            {suggestion}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
            </div>

            {/* Input Area */}
            <div className="p-4 lg:p-6 border-t border-gray-200/70 bg-rose-50/20">
              <div className="flex space-x-2 lg:space-x-3 mb-3 lg:mb-4">
                <div className="flex-1 relative">
                  <Input
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder={
                      selectedProduct
                        ? `Ask about ${selectedProduct.name}...`
                        : "Ask me about dresses, sizing, or styling advice..."
                    }
                    onKeyPress={(e) => e.key === "Enter" && sendMessage(inputValue)}
                    className="border-gray-200 focus:border-rose-400 focus:ring-rose-400/20 rounded-xl bg-white/50 font-elegant text-sm lg:text-base"
                  />
                </div>
                <Button
                  onClick={() => sendMessage(inputValue)}
                  disabled={!inputValue.trim()}
                  className="bg-rose-400 hover:bg-rose-500 rounded-xl px-4 lg:px-5 font-elegant flex-shrink-0"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>

              {/* Quick Actions */}
              <div className="flex justify-center space-x-2 lg:space-x-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-gray-600 hover:text-rose-600 font-elegant px-2 lg:px-3"
                >
                  <Package className="w-3 h-3 mr-1 lg:mr-2" />
                  <span className="hidden sm:inline">Track</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-gray-600 hover:text-rose-600 font-elegant px-2 lg:px-3"
                >
                  <RotateCcw className="w-3 h-3 mr-1 lg:mr-2" />
                  <span className="hidden sm:inline">Returns</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-gray-600 hover:text-rose-600 font-elegant px-2 lg:px-3"
                >
                  <Sparkles className="w-3 h-3 mr-1 lg:mr-2" />
                  <span className="hidden sm:inline">Tips</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
