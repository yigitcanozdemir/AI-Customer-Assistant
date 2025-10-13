"use client"

import Image from "next/image"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ShoppingBag, ArrowLeft, Star, Truck, Shield, RotateCcw, MessageCircle,ChevronLeft, ChevronRight } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useStore } from "@/context/StoreContext"
import { useCart } from "@/lib/cart-context"
import { ShoppingCart } from "@/components/ui/shopping-cart"
import { ChatSidebar } from "@/components/ui/chat-sidebar"
import { useChat } from "@/context/ChatContext"
import { useCallback } from "react"

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

export default function ProductPage() {
  const params = useParams()
  const router = useRouter()
  const [product, setProduct] = useState<Product | null>(null)
  const [selectedImage, setSelectedImage] = useState(0)
  const [selectedSize, setSelectedSize] = useState<string>("")
  const [selectedColor, setSelectedColor] = useState<string>("")
  const [quantity, setQuantity] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const { store: currentStore, setStore } = useStore()
  const { addItem, openCart, state, toggleCart } = useCart()

  const { setIsAssistantOpen, setMessages, setSelectedProduct, isAssistantOpen } = useChat()

  const getImagesForColor = useCallback(
    (color: string) => {
      if (!product) return []
      return product.images && product.images.length > 0 ? product.images : [product.image]
    },
    [product],
  )

  const getCurrentVariant = () => {
    if (!product || !selectedColor || !selectedSize) return null
    return product.variants.find((v) => v.color === selectedColor && v.size === selectedSize)
  }

  const isCurrentVariantInStock = () => {
    const variant = getCurrentVariant()
    if (variant) {
      return variant.available && variant.stock > 0
    }
    return product?.inStock || false
  }

  const getAvailableSizesForColor = useCallback(
    (color: string) => {
      if (!product) return []
      return product.variants
        .filter((v) => v.color === color && v.available && v.stock > 0)
        .map((v) => v.size)
        .filter((size, index, arr) => arr.indexOf(size) === index)
    },
    [product],
  )

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        setIsLoading(true)
        const res = await fetch(`http://localhost:8000/events/products/${params.id}`, {
          headers: {
            Authorization: "Bearer your-secret-token",
          },
        })
        if (!res.ok) throw new Error("Failed to fetch product")
        const data: Product = await res.json()
        setProduct(data)
      } catch (err) {
        console.error("Error fetching product, using mock data:", err)
      } finally {
        setIsLoading(false)
      }
    }

    if (params.id) {
      fetchProduct()
    }
  }, [params.id])

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const storeParam = urlParams.get("store")
    if (storeParam) {
      setStore(storeParam)
    }
  }, [setStore])

  useEffect(() => {
    if (product) {
      if (product.colors.length > 0) {
        setSelectedColor(product.colors[0])
        const availableSizes = getAvailableSizesForColor(product.colors[0])
        if (availableSizes.length > 0) {
          setSelectedSize(availableSizes[0] || "")
        } else if (product.sizes.length > 0) {
          setSelectedSize(product.sizes[0] || "")
        }
      }
    }
  }, [product, getAvailableSizesForColor])

  useEffect(() => {
    if (product) {
      setSelectedImage(0)
    }
  }, [product])

  const handleAskQuestion = () => {
    if (!product) return

    setSelectedProduct(product)
    setIsAssistantOpen(true)
    setMessages([
      {
        id: "1",
        type: "assistant",
        content: `Hello! I see you're interested in the ${product.name}. I can help with sizing, colors, or styling tips.`,
        timestamp: new Date(),
        products: [product],
        suggestions: ["What sizes are available?", "How does this dress fit?", "Show similar products"],
      },
    ])
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading product...</p>
        </div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Product Not Found</h1>
          <Button
            onClick={() => {
              if (window.history.length > 1) {
                router.back()
              } else {
                const urlParams = new URLSearchParams(window.location.search)
                const storeParam = urlParams.get("store") || currentStore
                router.push(`/?store=${encodeURIComponent(storeParam)}`)
              }
            }}
            variant="outline"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Store
          </Button>
        </div>
      </div>
    )
  }

  const handleAddToCart = () => {
    if (!product || !selectedColor || !selectedSize) return

    const selectedVariant = getCurrentVariant()
    if (!selectedVariant) return
    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      currency: product.currency,
      image: currentImages[0] || product.image,
      size: selectedSize,
      color: selectedColor,
      inStock: selectedVariant.available,
      quantity,
      variantId: selectedVariant.id,
    })

    openCart()
  }

  const currentImages = getImagesForColor(selectedColor)
  const currentVariant = getCurrentVariant()

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
            <div className="flex items-center space-x-4">
              <Button
                onClick={() => {
                  if (window.history.length > 1) {
                    router.back()
                  } else {
                    const urlParams = new URLSearchParams(window.location.search)
                    const storeParam = urlParams.get("store") || currentStore
                    router.push(`/?store=${encodeURIComponent(storeParam)}`)
                  }
                }}
                variant="ghost"
                size="sm"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Store
              </Button>
            </div>

            <div className="flex items-center space-x-4">
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

              <Button variant="outline" size="sm" onClick={handleAskQuestion}>
                <MessageCircle className="w-4 h-4 mr-2" />
                Ask Assistant
              </Button>
            </div>
          </div>
        </div>
      </header>

        <main className="py-8 transition-all duration-300 ease-in-out" style={{
          paddingLeft: '1.5rem',
          paddingRight: isAssistantOpen && state.isOpen ? 'calc(900px + 1.5rem)' :
                        isAssistantOpen ? 'calc(450px + 1.5rem)' :
                        state.isOpen ? 'calc(450px + 1.5rem)' : '1.5rem'
        }}>

          <div className="max-w-[2000px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div className="space-y-4 max-w-[800px]">
              <div className="aspect-[3/4] overflow-hidden rounded-lg bg-muted/20 relative group">
                <Image
                  src={currentImages[selectedImage] || product.image || "/placeholder.svg"}
                    alt={product.name}
                    width={400}
                    height={600}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    unoptimized={true}
                    />
                {currentImages.length > 1 && (
                  <>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 p-0 bg-black/70 hover:bg-black/90 shadow-lg border-0"
                    onClick={() => setSelectedImage((selectedImage - 1 + currentImages.length) % currentImages.length)}
                  >
                    <ChevronLeft className="w-5 h-5 text-white" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 p-0 bg-black/70 hover:bg-black/90 shadow-lg border-0"
                    onClick={() => setSelectedImage((selectedImage + 1) % currentImages.length)}
                  >
                    <ChevronRight className="w-5 h-5 text-white" />
                  </Button>
                    
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex space-x-2">
                      {currentImages.map((_, index) => (
                        <button
                          key={index}
                          onClick={() => setSelectedImage(index)}
                          className={`w-2 h-2 rounded-full transition-all ${
                            selectedImage === index ? "bg-black w-8" : "bg-black/60"
                          }`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <h1 className="text-3xl font-bold text-foreground mb-2 font-modern-heading">{product.name}</h1>

                <div className="flex items-center space-x-4 mb-4">
                  <div className="flex items-center space-x-1">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-current text-secondary" />
                    ))}
                    <span className="text-sm text-muted-foreground ml-2">(4.8) • 127 reviews</span>
                  </div>
                </div>

                <div className="flex items-center space-x-4 mb-6">
                  <span className="text-3xl font-bold text-foreground">
                    {formatCurrency(product.price, product.currency)}
                  </span>
                  {product.originalPrice && (
                    <span className="text-xl text-muted-foreground line-through">
                      {formatCurrency(product.originalPrice, product.currency)}
                    </span>
                  )}
                  {product.originalPrice && (
                    <Badge variant="destructive" className="text-xs">
                      Save {Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)}%
                    </Badge>
                  )}
                </div>

                <p className="text-muted-foreground leading-relaxed font-modern-body">{product.description}</p>
              </div>

              <div className="mt-4">
                <Button variant="outline" size="sm" onClick={handleAskQuestion}>
                  <MessageCircle className="w-4 h-4 mr-2" />
                  Ask Question About This Product
                </Button>
              </div>
              <Separator />

              {product.colors.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-medium text-foreground">Color: {selectedColor}</h3>
                  <div className="flex flex-wrap gap-2">
                    {product.colors.map((color) => (
                      <Button
                        key={color}
                        variant={selectedColor === color ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setSelectedColor(color)
                          const availableSizes = getAvailableSizesForColor(color)
                          if (availableSizes.length > 0) {
                            setSelectedSize(availableSizes[0] || "")
                          } else {
                            setSelectedSize("")
                          }
                        }}
                        className="min-w-[80px]"
                      >
                        {color}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {product.sizes.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-foreground">Size: {selectedSize}</h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {product.sizes.map((size) => {
                      const sizeVariant = product.variants.find((v) => v.color === selectedColor && v.size === size)
                      const isAvailable = sizeVariant ? sizeVariant.available && sizeVariant.stock > 0 : false

                      return (
                        <Button
                          key={size}
                          variant={selectedSize === size ? "default" : "outline"}
                          size="sm"
                          onClick={() => setSelectedSize(size)}
                          disabled={!isAvailable}
                          className={`w-12 h-12 ${!isAvailable ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          {size}
                        </Button>
                      )
                    })}
                  </div>
                </div>
              )}

              <Separator />

              <div className="space-y-4">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center border rounded-md">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="h-10 w-10 p-0"
                    >
                      -
                    </Button>
                    <span className="w-12 text-center text-sm font-medium">{quantity}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const maxStock = currentVariant?.stock || 10
                        setQuantity(Math.min(maxStock, quantity + 1))
                      }}
                      className="h-10 w-10 p-0"
                    >
                      +
                    </Button>
                  </div>

                  <div className="flex-1 flex space-x-3">
                    <Button
                      className="flex-1"
                      disabled={!isCurrentVariantInStock() || !selectedColor || !selectedSize}
                      size="lg"
                      onClick={handleAddToCart}
                    >
                      <ShoppingBag className="w-4 h-4 mr-2" />
                      {isCurrentVariantInStock() ? "Add to Cart" : "Out of Stock"}
                    </Button>
                  </div>
                </div>

                {!isCurrentVariantInStock() && selectedColor && selectedSize && (
                  <div className="text-sm text-destructive">
                    {currentVariant
                      ? `This size is out of stock (${currentVariant.stock} remaining)`
                      : "This combination is not available"}
                  </div>
                )}

                {isCurrentVariantInStock() && currentVariant && (
                  <div className="text-sm text-muted-foreground">{currentVariant.stock} items in stock</div>
                )}
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex items-center space-x-3 p-3 rounded-lg bg-muted/30">
                    <Truck className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Free Shipping</p>
                      <p className="text-xs text-muted-foreground">On orders over $100</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 p-3 rounded-lg bg-muted/30">
                    <RotateCcw className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Easy Returns</p>
                      <p className="text-xs text-muted-foreground">30-day return policy</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 p-3 rounded-lg bg-muted/30">
                    <Shield className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Secure Payment</p>
                      <p className="text-xs text-muted-foreground">SSL encrypted</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <ShoppingCart />
      <ChatSidebar />
    </div>
  )
}
