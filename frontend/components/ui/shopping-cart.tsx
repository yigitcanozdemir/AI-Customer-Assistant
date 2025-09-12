"use client"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { X, Plus, Minus, ShoppingBag, Trash2 } from "lucide-react"
import Image from "next/image"
import { useCart } from "@/lib/cart-context"

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

export function ShoppingCart() {
  const { state, updateQuantity, removeItem, closeCart, clearCart } = useCart()

  if (!state.isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={closeCart}>
      <div
        className="fixed right-0 top-0 h-full w-full max-w-md bg-background border-l shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
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

          {/* Cart Items */}
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

              {/* Footer */}
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
                  <Button className="w-full" size="lg">
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
    </div>
  )
}
