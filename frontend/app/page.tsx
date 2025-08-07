"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { MessageCircle, Send, X, Package, RotateCcw, Sparkles, Star, Heart } from 'lucide-react'

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
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      type: "assistant",
      content: "Hello! I'm your Style Assistant. How can I help you feel confident and beautiful for your next special occasion?",
      timestamp: new Date(),
      suggestions: ["Find a wedding guest dress", "Help with sizing", "Track my order", "Return assistance"]
    },
  ])
  const [inputValue, setInputValue] = useState("")
  const [isTyping, setIsTyping] = useState(false)
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
      description: "Exquisite vintage-inspired lace with a flattering A-line silhouette, perfect for weddings and special celebrations",
      inStock: true,
      sizes: ["8", "10", "12", "14", "16", "18", "20"],
      colors: ["Navy", "Dusty Rose", "Champagne", "Sage"]
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
      colors: ["Deep Navy", "Burgundy", "Forest Green", "Plum"]
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
      colors: ["Soft Gray", "Dusty Rose", "Sage Green", "Champagne"]
    }
  ]

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const simulateTyping = async () => {
    setIsTyping(true)
    await new Promise(resolve => setTimeout(resolve, 1800))
    setIsTyping(false)
  }

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue("")

    setIsTyping(true)

    try {
      const eventPayload = {
        event_id: `chat_${Date.now()}`,
        event_type: "chat",
        event_data: {
          question: content
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
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: "Sorry, I'm having trouble connecting right now. Please try again in a moment.",
        timestamp: new Date()
      }])
    }


  }

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion)
  }

  return (
    <>
      {/* Main Page */}
      <div className="min-h-screen bg-gradient-to-br from-background via-secondary/30 to-accent/20">
        <div className="container mx-auto px-4 py-20">
          <div className="text-center mb-20">
            <h1 className="text-6xl font-serif text-gray-900 mb-6 font-light tracking-wide">
              Nataya Vintage Inspired
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto font-elegant leading-relaxed">
              Elegant dresses for life's most beautiful moments. Designed for the sophisticated woman who values timeless style and exceptional quality.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-10 mb-20">
            {elegantDresses.map((dress) => (
              <Card key={dress.id} className="overflow-hidden hover:shadow-xl transition-all duration-500 border-gray-200 bg-white/80 backdrop-blur-sm">
                <div className="aspect-[3/4] overflow-hidden bg-rose-50/20">
                  <img 
                    src={dress.image || "/placeholder.svg"} 
                    alt={dress.name}
                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-700"
                  />
                </div>
                <CardContent className="p-8">
                  <h3 className="font-serif text-xl text-gray-900 mb-3 font-medium">{dress.name}</h3>
                  <div className="flex items-center mb-3">
                    <div className="flex text-rose-600">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className={`w-4 h-4 ${i < Math.floor(dress.rating) ? 'fill-current' : ''}`} />
                      ))}
                    </div>
                    <span className="text-sm text-gray-600 ml-2 font-elegant">({dress.rating})</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-4 leading-relaxed">{dress.description}</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-2xl font-semibold text-gray-900">${dress.price}</span>
                      {dress.originalPrice && (
                        <span className="text-sm text-gray-600 line-through ml-2">${dress.originalPrice}</span>
                      )}
                    </div>
                    <Button variant="outline" className="border-rose-300 text-rose-600 hover:bg-rose-50 font-elegant">
                      <Heart className="w-4 h-4 mr-2" />
                      Save
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Chat Widget*/}
      {!isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-8 right-8 w-16 h-16 rounded-full bg-rose-400 hover:bg-rose-500 shadow-2xl hover:shadow-3xl transition-all duration-300 border-2 border-background elegant-shadow group"
        >
          <MessageCircle className="w-6 h-6 text-primary-foreground group-hover:scale-110 transition-transform" />
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-accent rounded-full animate-pulse"></div>
        </Button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-8 right-8 w-[420px] h-[650px] bg-white/95 backdrop-blur-xl rounded-3xl elegant-shadow border border-gray-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="bg-gradient-to-r from-secondary/50 to-accent/30 p-6 border-b border-gray-200/70">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Avatar className="w-12 h-12 bg-gradient-to-br from-primary/20 to-accent/20 border-2 border-primary/20">
                  <AvatarFallback className="text-primary font-serif font-semibold text-lg">
                    SA
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-serif text-xl text-gray-900 font-medium">Style Assistant</h3>
                  <p className="text-sm text-gray-600 font-elegant">Here to help you look beautiful</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="text-gray-600 hover:text-gray-900 rounded-full"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          {/* Messages Area */}
          <ScrollArea className="flex-1 p-6">
            <div className="space-y-6">
              {messages.map((message) => (
                <div key={message.id} className="space-y-4">
                  <div className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-5 py-4 ${
                        message.type === 'user'
                          ? 'bg-rose-400 text-primary-foreground'
                          : 'bg-rose-50/60 text-gray-900 border border-gray-200/70'
                      }`}
                    >
                      <p className="text-sm leading-relaxed font-elegant">{message.content}</p>
                    </div>
                  </div>

                  {/* Product Recommendations */}
                  {message.products && message.products.length > 0 && (
                    <div className="space-y-3 ml-4">
                      {message.products.map((product) => (
                        <Card key={product.id} className="border-gray-200/70 hover:shadow-lg transition-all duration-300 bg-white/60 backdrop-blur-sm">
                          <CardContent className="p-4">
                            <div className="flex space-x-4">
                              <img
                                src={product.image || "/placeholder.svg"}
                                alt={product.name}
                                className="w-20 h-24 object-cover rounded-lg"
                              />
                              <div className="flex-1 min-w-0">
                                <h4 className="font-serif text-sm text-gray-900 mb-2 font-medium leading-tight">
                                  {product.name}
                                </h4>
                                <div className="flex items-center mb-2">
                                  <div className="flex text-rose-600">
                                    {[...Array(5)].map((_, i) => (
                                      <Star key={i} className={`w-3 h-3 ${i < Math.floor(product.rating) ? 'fill-current' : ''}`} />
                                    ))}
                                  </div>
                                  <span className="text-xs text-gray-600 ml-1">({product.rating})</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-rose-600">${product.price}</span>
                                  <Button size="sm" className="bg-rose-400 hover:bg-rose-500 text-xs px-4 py-1 font-elegant">
                                    View Details
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
                    <div className="flex flex-wrap gap-2 ml-4">
                      {message.suggestions.map((suggestion, index) => (
                        <Button
                          key={index}
                          variant="outline"
                          size="sm"
                          onClick={() => handleSuggestionClick(suggestion)}
                          className="text-xs border-rose-300 text-rose-600 hover:bg-rose-50 font-elegant rounded-full"
                        >
                          {suggestion}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Typing Indicator */}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-rose-50/60 border border-gray-200/70 rounded-2xl px-5 py-4">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-rose-600 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-rose-600 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-rose-600 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div ref={messagesEndRef} />
          </ScrollArea>

          {/* Input Area */}
          <div className="p-6 border-t border-gray-200/70 bg-rose-50/20">
            <div className="flex space-x-3 mb-4">
              <div className="flex-1 relative">
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Ask me about dresses, sizing, or styling advice..."
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage(inputValue)}
                  className="border-gray-200 focus:border-primary focus:ring-primary/20 rounded-xl bg-white/50 font-elegant"
                />
              </div>
              <Button
                onClick={() => sendMessage(inputValue)}
                disabled={!inputValue.trim()}
                className="bg-rose-400 hover:bg-rose-500 rounded-xl px-5 font-elegant"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            
            {/* Quick Actions */}
            <div className="flex justify-center space-x-6">
              <Button variant="ghost" size="sm" className="text-xs text-gray-600 hover:text-primary font-elegant">
                <Package className="w-3 h-3 mr-2" />
                Track Order
              </Button>
              <Button variant="ghost" size="sm" className="text-xs text-gray-600 hover:text-primary font-elegant">
                <RotateCcw className="w-3 h-3 mr-2" />
                Returns
              </Button>
              <Button variant="ghost" size="sm" className="text-xs text-gray-600 hover:text-primary font-elegant">
                <Sparkles className="w-3 h-3 mr-2" />
                Style Tips
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
