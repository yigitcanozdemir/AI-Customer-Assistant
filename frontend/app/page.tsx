"use client"

import { Badge } from "@/components/ui/badge"
import type React from "react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import {
  Search,
  ShoppingBag,
  Star,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
} from "lucide-react"
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select"
import { useStore } from "@/context/StoreContext"
import { useCart } from "@/lib/cart-context"
import { ShoppingCart } from "@/components/ui/shopping-cart"
import { ChatSidebar } from "@/components/ui/chat-sidebar"
import { useChat } from "@/context/ChatContext"

interface ProductVariant {
  id: string
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
  const [searchQuery, setSearchQuery] = useState("")
  const { store: selectedStore, setStore } = useStore()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [currentImageIndex, setCurrentImageIndex] = useState<{ [key: string]: number }>({})
  const [isLoading, setIsLoading] = useState(true)

  const [hasProcessedUrlStore, setHasProcessedUrlStore] = useState(false)
  const { addItem, openCart, toggleCart, state } = useCart()

  const { isAssistantOpen, setIsAssistantOpen, setMessages, setSelectedProduct } = useChat()

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const storeFromUrl = urlParams.get("store")

    if (storeFromUrl && stores.includes(storeFromUrl) && storeFromUrl !== selectedStore) {
      setStore(storeFromUrl)
    }
    setHasProcessedUrlStore(true)
  }, [])

  useEffect(() => {
    if (!hasProcessedUrlStore) return

    const fetchProducts = async () => {
      try {
        setIsLoading(true)
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
      } finally {
        setIsLoading(false)
      }
    }

    fetchProducts()
  }, [selectedStore, hasProcessedUrlStore])

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
      const localProduct = products?.find((p) => p.id === id)
      if (localProduct) {
        setSelectedProduct(localProduct)
      }
    }
  }

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
          content: `Hello! I see you're interested in the ${product.name}. What would you like to know?`,
          timestamp: new Date(),
          products: [product],
          suggestions: [
            "What sizes are available?",
            "How does this dress fit?",
            "What occasions is this perfect for?",
            "Care and washing instructions",
            "Show me similar products",
          ],
        },
      ])
    }
  }

  const openProductPage = (productId: string) => {
    const url = new URL(`/product/${productId}`, window.location.origin)
    url.searchParams.set("store", selectedStore)
    url.searchParams.delete("product")
    url.searchParams.delete("chat")
    window.location.href = url.toString()
  }

  const nextImage = (productId: string, images: string[]) => {
    setCurrentImageIndex((prev) => ({
      ...prev,
      [productId]: ((prev[productId] || 0) + 1) % images.length,
    }))
  }

  const prevImage = (productId: string, images: string[]) => {
    setCurrentImageIndex((prev) => ({
      ...prev,
      [productId]: ((prev[productId] || 0) - 1 + images.length) % images.length,
    }))
  }

  const handleAddToCart = (dress: Product, e: React.MouseEvent) => {
    e.stopPropagation()
    const firstAvailableColor = dress.colors[0] || "Default"
    const firstAvailableSize = dress.variants.find(v => v.color === firstAvailableColor)?.size || "M"
    const selectedVariant = dress.variants.find(
      (v) => v.color === firstAvailableColor && v.size === firstAvailableSize
    )
    if (!selectedVariant) return

    addItem({
      productId: dress.id,
      name: dress.name,
      price: dress.price,
      currency: dress.currency,
      image: dress.image,
      size: firstAvailableSize,
      color: firstAvailableColor,
      inStock: dress.inStock,
      variantId: selectedVariant.id
    })

    openCart()
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-all duration-300 ease-in-out" style={{
        paddingLeft: '1.5rem',
        paddingRight: isAssistantOpen && state.isOpen ? 'calc(900px + 1.5rem)' :
                      isAssistantOpen ? 'calc(450px + 1.5rem)' :
                      state.isOpen ? 'calc(450px + 1.5rem)' : '1.5rem'
      }}>
        <div className="max-w-[2000px] mx-auto">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center space-x-8">
              <div className="flex items-center space-x-2">
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <Select
                value={selectedStore}
                onValueChange={(value) => {
                  setStore(value)

                  const url = new URL(window.location.href)
                  url.searchParams.set("store", value)
                  url.searchParams.delete("product")
                  url.searchParams.delete("chat")
                  window.history.replaceState({}, "", url.toString())
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
              </Button>

              <Button onClick={toggleCart} variant="outline" size="sm" className="relative bg-transparent">
                <ShoppingBag className="w-4 h-4 mr-2" />
                Cart
                {state.totalItems > 0 && (
                  <Badge
                    variant="destructive"
                    className="absolute -top-2 -right-2 w-5 h-5 p-0 flex items-center justify-center text-xs"
                  >
                    {state.totalItems}
                  </Badge>
                )}
              </Button>
            </div>
          </div>

          <div className="pb-4">
            <div className="relative w-full">
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
        <main className="py-8 transition-all duration-300 ease-in-out" style={{
          paddingLeft: '1.5rem',
          paddingRight: isAssistantOpen && state.isOpen ? 'calc(900px + 1.5rem)' :
                        isAssistantOpen ? 'calc(450px + 1.5rem)' :
                        state.isOpen ? 'calc(450px + 1.5rem)' : '1.5rem'
        }}>
          <div className="max-w-[2000px] mx-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                <p className="text-muted-foreground">Loading products...</p>
              </div>
            </div>
          ) : (
            <div className={`grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5
            }`}>
              {filteredDresses.map((dress) => (
                <Card
                  key={dress.id}
                  className="group overflow-hidden border-0 shadow-sm hover:shadow-lg transition-all duration-300 bg-card cursor-pointer"
                  onClick={() => openProductPage(dress.id)}
                >
                  <div className="aspect-[3/4] overflow-hidden bg-muted/20 relative">
                    <img
                      src={
                        dress.images && dress.images.length > 0
                          ? dress.images[currentImageIndex[dress.id] || 0]
                          : dress.image || "/placeholder.svg"
                      }
                      alt={dress.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />

                    {dress.images && dress.images.length > 1 && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="absolute left-2 top-1/2 transform -translate-y-1/2 w-8 h-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 hover:bg-black/90 border-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            prevImage(dress.id, dress.images)
                          }}
                        >
                          <ChevronLeft className="w-5 h-5 text-white" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="absolute right-2 top-1/2 transform -translate-y-1/2 w-8 h-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 hover:bg-black/90 border-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            nextImage(dress.id, dress.images)
                          }}
                        >
                          <ChevronRight className="w-5 h-5 text-white" />
                        </Button>

                        <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {dress.images.map((_, index) => (
                            <div
                              key={index}
                              className={`w-1.5 h-1.5 rounded-full ${
                                index === (currentImageIndex[dress.id] || 0) ? "bg-black w-8" : "bg-black/60"
                              }`}
                            />
                          ))}
                        </div>
                      </>
                    )}
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
                        <Button size="sm" className="flex-1 h-8 text-xs" onClick={(e) => handleAddToCart(dress, e)}>
                          <ShoppingBag className="w-3 h-3 mr-1" />
                          Add to Cart
                        </Button>

                        <Button
                          onClick={(e) => {
                            e.stopPropagation()
                            openAssistant(dress)
                          }}
                          variant="outline"
                          size="sm"
                          className="h-8 px-3"
                        >
                          <MessageCircle className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!isLoading && filteredDresses.length === 0 && (
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

      <ShoppingCart />
      <ChatSidebar />
    </div>
  )
}
