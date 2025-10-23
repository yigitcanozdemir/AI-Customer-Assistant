"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { X, Plus, Minus, ShoppingBag, Trash2 } from "lucide-react"
import Image from "next/image"
import { useCart } from "@/lib/cart-context"
import { useUser } from "@/context/UserContext"
import { CheckoutModal } from "./checkout-modal"
import { OrderSuccessModal } from "./order-success-modal"
import { useStore } from "@/context/StoreContext"
interface CreateOrderRequest {
  user_id: string
  user_name: string
  store : string
  items: {
    product_id: string
    variant_id?: string | null
    quantity: number
    product: {
      id: string
      variant_id: string
      name: string
      price: number
      currency: string
      image?: string | null
      variant: string | null
      variant_text: string | null
    }
  }[]
}

interface Product {
  id: string
  variant_id: string
  name: string
  price: number
  currency: string
  image?: string | null
  variant: string | null
  variant_text: string | null
}

interface OrderStatus {
  order_id: string
  status: string
  user_name: string
  created_at: string
  product: Product
}

interface CreateOrderResponse {
  orders: OrderStatus[]
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

interface ShoppingCartProps {
  right: number
  sideWidth: number
}

export function ShoppingCart({ right , sideWidth}: ShoppingCartProps) {
  const { state, updateQuantity, removeItem, closeCart, clearCart } = useCart()
  const { userId, userName } = useUser()
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { store: selectedStore } = useStore()
  const [isOrderSuccessOpen, setIsOrderSuccessOpen] = useState(false)
  const [orderData, setOrderData] = useState<CreateOrderResponse | null>(null)

  const handleCheckout = async () => {
    if (!state.items.length || !userId || !userName) return

    try {
      setIsLoading(true)

      const payload: CreateOrderRequest = {
        user_id: userId,
        user_name: userName,
        store: selectedStore,
        items: state.items.map((item) => ({
          product_id: item.productId,
          variant_id: item.variantId || null,
          quantity: item.quantity,
          product: {
            id: item.productId,
            variant_id: item.variantId || "",
            name: item.name,
            price: item.price,
            currency: item.currency,
            image: item.image || null,
            variant: item.color || null,
            variant_text: `${item.size} - ${item.color}` || null,
          },
        })),
      }
      console.log("Selected Store in Cart:", selectedStore)

      console.log("Sending request to:", "http://localhost:8000/events/orders")
      console.log("Payload:", JSON.stringify(payload, null, 2))

      const res = await fetch("http://localhost:8000/events/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      console.log("Response status:", res.status)

      if (!res.ok) {
        const errorText = await res.text()
        console.error("Error response:", errorText)
        throw new Error(`Order creation failed: ${res.status} ${errorText}`)
      }

      const data: CreateOrderResponse = await res.json()
      console.log("Order created:", data)

      setOrderData(data)
      clearCart()
      setIsCheckoutOpen(false)
      setIsOrderSuccessOpen(true)
    } catch (error) {
      console.error("Checkout error:", error)
      let errorMessage = "Unknown error"
      if (error instanceof Error) {
        errorMessage = error.message
      }
      alert(`Failed to create order: ${errorMessage}`)
    } finally {
      setIsLoading(false)
    }
  }

  const openCheckoutModal = () => {
    setIsCheckoutOpen(true)
  }

  if (!state.isOpen) return null

  return (
    <>
        <div
          className="fixed top-0 h-full bg-background border-l z-50 shadow-xl transition-all duration-300 ease-in-out"
          style={{ right, width: sideWidth }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center space-x-2">
                <ShoppingBag className="w-5 h-5" />
                <h2 className="text-lg font-semibold">Shopping Cart</h2>
                {state.totalItems > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {state.totalItems}
                  </Badge>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={closeCart} className="w-8 h-8 p-0">
                <X className="w-4 h-4" />
              </Button>
            </div>

            {state.items.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                <ShoppingBag className="w-16 h-16 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">Your cart is empty</h3>
                <p className="text-muted-foreground mb-6">Add some items to get started</p>
                <Button onClick={closeCart} className="w-full">
                  Continue Shopping
                </Button>
              </div>
            ) : (
              <>
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-4">
                    {state.items.map((item) => (
                      <div key={item.id} className="flex space-x-3 p-3 rounded-lg border bg-card">
                        <div className="relative w-16 h-20 rounded overflow-hidden bg-muted/20 flex-shrink-0">
                          <Image
                            src={item.image || "/placeholder.svg"}
                            alt={item.name}
                            fill
                            sizes="64px"
                            className="object-cover"
                            unoptimized
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm text-card-foreground line-clamp-2 mb-1">{item.name}</h4>

                          <div className="flex items-center space-x-2 text-xs text-muted-foreground mb-2">
                            <span>Size: {item.size}</span>
                            <span>•</span>
                            <span>Color: {item.color}</span>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                className="w-6 h-6 p-0"
                                disabled={item.quantity <= 1}
                              >
                                <Minus className="w-3 h-3" />
                              </Button>
                              <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                className="w-6 h-6 p-0"
                              >
                                <Plus className="w-3 h-3" />
                              </Button>
                            </div>

                            <div className="flex items-center space-x-2">
                              <span className="font-semibold text-sm">
                                {formatCurrency(item.price * item.quantity, item.currency)}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeItem(item.id)}
                                className="w-6 h-6 p-0 text-destructive hover:text-destructive"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="border-t p-4 space-y-4">
                  {state.items.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearCart}
                      className="w-full text-destructive hover:text-destructive bg-transparent"
                    >
                      Clear Cart
                    </Button>
                  )}

                  <Separator />

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Subtotal ({state.totalItems} items)</span>
                      <span className="font-medium">
                        {formatCurrency(state.totalPrice, state.items[0]?.currency || "USD")}
                      </span>
                    </div>

                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Shipping</span>
                      <span>Free</span>
                    </div>

                    <Separator />

                    <div className="flex justify-between text-base font-semibold">
                      <span>Total</span>
                      <span>{formatCurrency(state.totalPrice, state.items[0]?.currency || "USD")}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Button className="w-full" size="lg" onClick={() => openCheckoutModal()}>
                      Checkout
                    </Button>
                    <Button variant="outline" onClick={closeCart} className="w-full bg-transparent">
                      Continue Shopping
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
        onCheckout={handleCheckout}
        isLoading={isLoading}
        userName={userName || ""}
      />

      <OrderSuccessModal
        isOpen={isOrderSuccessOpen}
        onClose={() => setIsOrderSuccessOpen(false)}
        orderData={orderData}
      />
    </>
  )
}
