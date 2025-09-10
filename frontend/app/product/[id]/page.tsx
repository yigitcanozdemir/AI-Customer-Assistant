"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Heart, ShoppingBag, ArrowLeft, Star, Truck, Shield, RotateCcw, MessageCircle } from "lucide-react"
import { useParams, useRouter } from "next/navigation"

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

const mockProducts: Product[] = [
  {
    id: "1",
    name: "Elegant Evening Dress",
    description:
      "A stunning floor-length evening dress perfect for special occasions. Features intricate beadwork and a flowing silhouette that flatters every figure. Made from premium silk blend fabric with delicate hand-sewn details. This timeless piece is perfect for galas, weddings, and formal events.",
    price: 299.99,
    originalPrice: 399.99,
    currency: "USD",
    inStock: true,
    image: "/elegant-evening-dress.png",
    images: ["/elegant-evening-dress.png", "/elegant-evening-dress.png", "/elegant-evening-dress.png"],
    variants: [
      { id: "1-black", name: "Black", price: 299.99, inStock: true },
      { id: "1-navy", name: "Navy", price: 299.99, inStock: true },
      { id: "1-burgundy", name: "Burgundy", price: 319.99, inStock: false },
    ],
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: ["Black", "Navy", "Burgundy"],
  },
  {
    id: "2",
    name: "Casual Summer Dress",
    description:
      "Light and breezy summer dress with floral print. Perfect for casual outings and warm weather. Made from breathable cotton blend that keeps you cool and comfortable all day long.",
    price: 79.99,
    currency: "EURO",
    inStock: true,
    image: "/casual-summer-floral-dress.jpg",
    images: ["/casual-summer-floral-dress.jpg", "/casual-summer-floral-dress.jpg"],
    variants: [
      { id: "2-blue", name: "Floral Blue", price: 79.99, inStock: true },
      { id: "2-pink", name: "Floral Pink", price: 79.99, inStock: true },
      { id: "2-white", name: "White", price: 74.99, inStock: true },
    ],
    sizes: ["XS", "S", "M", "L"],
    colors: ["Floral Blue", "Floral Pink", "White"],
  },
  {
    id: "3",
    name: "Professional Blazer Dress",
    description:
      "Sophisticated blazer-style dress ideal for business meetings and professional events. Features structured shoulders and a tailored fit that exudes confidence and elegance.",
    price: 3299.99,
    currency: "TRY",
    inStock: true,
    image: "/professional-blazer-dress.jpg",
    images: ["/professional-blazer-dress.jpg", "/professional-blazer-dress.jpg"],
    variants: [
      { id: "3-black", name: "Black", price: 3299.99, inStock: true },
      { id: "3-gray", name: "Gray", price: 3299.99, inStock: true },
      { id: "3-navy", name: "Navy", price: 3299.99, inStock: false },
    ],
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: ["Black", "Gray", "Navy"],
  },
  {
    id: "4",
    name: "Bohemian Maxi Dress",
    description:
      "Free-spirited maxi dress with bohemian patterns and flowing fabric. Perfect for festivals and casual wear. Features unique prints and comfortable loose fit.",
    price: 119.99,
    currency: "EURO",
    inStock: true,
    image: "/bohemian-maxi-dress.jpg",
    images: ["/bohemian-maxi-dress.jpg", "/bohemian-maxi-dress.jpg"],
    variants: [
      { id: "4-earth", name: "Earth Tones", price: 119.99, inStock: true },
      { id: "4-sunset", name: "Sunset", price: 119.99, inStock: true },
      { id: "4-ocean", name: "Ocean", price: 129.99, inStock: true },
    ],
    sizes: ["S", "M", "L", "XL"],
    colors: ["Earth Tones", "Sunset", "Ocean"],
  },
  {
    id: "5",
    name: "Cocktail Party Dress",
    description:
      "Chic cocktail dress with sequin details. Perfect for parties and night events. Features shimmering sequins that catch the light beautifully.",
    price: 199.99,
    originalPrice: 249.99,
    currency: "USD",
    inStock: true,
    image: "/cocktail-party-dress-sequins.jpg",
    images: ["/cocktail-party-dress-sequins.jpg", "/cocktail-party-dress-sequins.jpg"],
    variants: [
      { id: "5-gold", name: "Gold", price: 199.99, inStock: true },
      { id: "5-silver", name: "Silver", price: 199.99, inStock: true },
      { id: "5-rose", name: "Rose Gold", price: 219.99, inStock: false },
    ],
    sizes: ["XS", "S", "M", "L"],
    colors: ["Gold", "Silver", "Rose Gold"],
  },
  {
    id: "6",
    name: "Vintage Swing Dress",
    description:
      "Classic 1950s inspired swing dress with polka dot pattern. Timeless style with modern comfort. Features a fitted bodice and full skirt that creates a flattering silhouette.",
    price: 2199.99,
    currency: "TRY",
    inStock: true,
    image: "/vintage-swing-dress-polka-dots.jpg",
    images: ["/vintage-swing-dress-polka-dots.jpg", "/vintage-swing-dress-polka-dots.jpg"],
    variants: [
      { id: "6-bw", name: "Black & White", price: 2199.99, inStock: true },
      { id: "6-rw", name: "Red & White", price: 2199.99, inStock: true },
      { id: "6-nw", name: "Navy & White", price: 2299.99, inStock: true },
    ],
    sizes: ["XS", "S", "M", "L", "XL"],
    colors: ["Black & White", "Red & White", "Navy & White"],
  },
]

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
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        // Try to fetch from backend first
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
        // Fallback to mock data
        const mockProduct = mockProducts.find((p) => p.id === params.id)
        if (mockProduct) {
          setProduct(mockProduct)
        }
      } finally {
        setIsLoading(false)
      }
    }

    if (params.id) {
      fetchProduct()
    }
  }, [params.id])

  useEffect(() => {
    if (product) {
      // Set default selections
      if (product.colors.length > 0) setSelectedColor(product.colors[0])
      if (product.sizes.length > 0) setSelectedSize(product.sizes[0])
      if (product.variants.length > 0) setSelectedVariant(product.variants[0])
    }
  }, [product])

  const getCurrentPrice = () => {
    if (selectedVariant && selectedVariant.price) {
      return selectedVariant.price
    }
    return product?.price || 0
  }

  const isCurrentVariantInStock = () => {
    if (selectedVariant) {
      return selectedVariant.inStock
    }
    return product?.inStock || false
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
          <Button onClick={() => router.push("/")} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Store
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 lg:px-6">
          <div className="flex h-16 items-center justify-between">
            <Button onClick={() => router.push("/")} variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Store
            </Button>
            <div className="flex items-center space-x-4">
              <Button variant="outline" size="sm">
                <MessageCircle className="w-4 h-4 mr-2" />
                Ask Assistant
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 lg:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Product Images */}
          <div className="space-y-4">
            <div className="aspect-[3/4] overflow-hidden rounded-lg bg-muted/20">
              <img
                src={product.images[selectedImage] || product.image || "/placeholder.svg"}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            </div>

            {product.images.length > 1 && (
              <div className="flex space-x-2 overflow-x-auto">
                {product.images.map((image, index) => (
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

          {/* Product Details */}
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
                  {formatCurrency(getCurrentPrice(), product.currency)}
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

            <Separator />

            {/* Color Selection */}
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
                        const variant = product.variants.find((v) => v.name === color)
                        if (variant) setSelectedVariant(variant)
                      }}
                      className="min-w-[80px]"
                    >
                      {color}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Size Selection */}
            {product.sizes.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-foreground">Size: {selectedSize}</h3>
                  <Button variant="ghost" size="sm" className="text-xs text-primary">
                    Size Guide
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {product.sizes.map((size) => (
                    <Button
                      key={size}
                      variant={selectedSize === size ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedSize(size)}
                      className="w-12 h-12"
                    >
                      {size}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Quantity and Add to Cart */}
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
                  <Button variant="ghost" size="sm" onClick={() => setQuantity(quantity + 1)} className="h-10 w-10 p-0">
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

              {!isCurrentVariantInStock() && (
                <p className="text-sm text-destructive">This variant is currently out of stock</p>
              )}
            </div>

            <Separator />

            {/* Product Features */}
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

            {/* Variants Information */}
            {product.variants.length > 0 && (
              <Card className="border-0 shadow-sm bg-muted/20">
                <CardContent className="p-4">
                  <h4 className="font-medium mb-3">Available Variants</h4>
                  <div className="space-y-2">
                    {product.variants.map((variant) => (
                      <div key={variant.id} className="flex items-center justify-between text-sm">
                        <span className={variant.inStock ? "text-foreground" : "text-muted-foreground"}>
                          {variant.name}
                        </span>
                        <div className="flex items-center space-x-2">
                          {variant.price && (
                            <span className="font-medium">{formatCurrency(variant.price, product.currency)}</span>
                          )}
                          <Badge variant={variant.inStock ? "secondary" : "outline"} className="text-xs">
                            {variant.inStock ? "In Stock" : "Out of Stock"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
