"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Heart, ShoppingBag, ArrowLeft, Star, Truck, Shield, RotateCcw, MessageCircle } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useStore } from "@/context/StoreContext"

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

export default function ProductPage() {
  const params = useParams()
  const router = useRouter()
  const [product, setProduct] = useState<Product | null>(null)
  const [selectedImage, setSelectedImage] = useState(0)
  const [selectedSize, setSelectedSize] = useState<string>("")
  const [selectedColor, setSelectedColor] = useState<string>("")
  const [quantity, setQuantity] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
 const { store: currentStore, setStore, isAssistantOpen, setIsAssistantOpen, messages, setMessages } = useStore()  

  const getImagesForColor = (color: string) => {
    if (!product) return []
    if (!color || product.colors.length <= 1) return product.images
    return product.images
  }

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

  const getAvailableSizesForColor = (color: string) => {
    if (!product) return []
    return product.variants
      .filter((v) => v.color === color && v.available && v.stock > 0)
      .map((v) => v.size)
      .filter((size, index, arr) => arr.indexOf(size) === index)
  }

  useEffect(() => {
    const fetchProduct = async () => {
      try {
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
  }, [])
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
  }, [product])

  useEffect(() => {
    if (selectedColor) {
      const colorImages = getImagesForColor(selectedColor)
      if (colorImages.length > 0) {
        setSelectedImage(0)
      }
    }
  }, [selectedColor])
  const handleAskQuestion = () => {
    if (!product) return

    setIsAssistantOpen(true)
    setMessages([
      {
        id: "1",
        type: "assistant",
        content: `Hello! I see you're interested in the ${product.name}. I can help with sizing, colors, or styling tips.`,
        timestamp: new Date(),
        products: [product],
        suggestions: ["What sizes are available?", "How does this dress fit?", "Show similar products"]
      }
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
          <Button onClick={() => router.push(`/?store=${encodeURIComponent(currentStore)}`)} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Store
          </Button>
        </div>
      </div>
    )
  }

  const currentImages = getImagesForColor(selectedColor)
  const currentVariant = getCurrentVariant()

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 lg:px-6">
          <div className="flex h-16 items-center justify-between">
            <Button
              onClick={() => router.push(`/?store=${encodeURIComponent(currentStore)}`)}
              variant="ghost"
              size="sm"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Store
            </Button>
            <div className="flex items-center space-x-4">
              <Button variant="outline" size="sm" onClick={handleAskQuestion}>
                <MessageCircle className="w-4 h-4 mr-2" />
                Ask Assistant
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 lg:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <div className="space-y-4">
            <div className="aspect-[3/4] overflow-hidden rounded-lg bg-muted/20">
              <img
                src={currentImages[selectedImage] || product.image || "/placeholder.svg"}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            </div>

            {currentImages.length > 1 && (
              <div className="flex space-x-2 overflow-x-auto">
                {currentImages.map((image, index) => (
                  <button
                    key={index}
                    onClick={() => setSelectedImage(index)}
                    className={`flex-shrink-0 w-20 h-24 rounded-md overflow-hidden border-2 transition-colors ${
                      selectedImage === index ? "border-primary" : "border-transparent"
                    }`}
                  >
                    <img
                      src={image || "/placeholder.svg"}
                      alt={`${product.name} ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
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
                  <Button className="flex-1" disabled={!isCurrentVariantInStock()} size="lg">
                    <ShoppingBag className="w-4 h-4 mr-2" />
                    {isCurrentVariantInStock() ? "Add to Cart" : "Out of Stock"}
                  </Button>
                  <Button variant="outline" size="lg" className="w-12 p-0 bg-transparent">
                    <Heart className="w-4 h-4" />
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
      </main>
    </div>
  )
}
