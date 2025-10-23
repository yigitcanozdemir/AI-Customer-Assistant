"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { X, CreditCard, Truck, Shield, CheckCircle, User } from "lucide-react"
import { useCart } from "@/lib/cart-context"
import { useUser } from "@/context/UserContext"
import { useChat } from "@/context/ChatContext"
import Image from "next/image"
interface CheckoutModalProps {
  isOpen: boolean
  onClose: () => void
  onCheckout: () => Promise<void>
  isLoading?: boolean
  userName: string
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

export function CheckoutModal({ isOpen, onClose, onCheckout, isLoading = false, userName }: CheckoutModalProps) {
  const { state } = useCart()
  const { userId } = useUser()
  const { isAssistantOpen } = useChat()
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  )
  const [formData, setFormData] = useState({
    email: "",
    address: "",
    city: "",
    postalCode: "",
    country: "",
    cardNumber: "",
    expiryDate: "",
    cvv: "",
    nameOnCard: "",
  })

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  useEffect(() => {
    if (isOpen && isAssistantOpen) {

    }
  }, [isOpen, isAssistantOpen])

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onCheckout()
  }

  if (!isOpen) return null

  const MAX_SIDE_WIDTH = 450
  const bothPanelsOpen = isAssistantOpen && state.isOpen

  let sideWidth
  if (windowWidth < 1024) {
    sideWidth = windowWidth
  } else if (bothPanelsOpen && windowWidth >= 1024 && windowWidth < 1400) {
    sideWidth = windowWidth / 2
  } else {
    sideWidth = MAX_SIDE_WIDTH
  }

  const totalOffset =
    windowWidth >= 1024
      ? (isAssistantOpen ? sideWidth : 0) + (state.isOpen ? sideWidth : 0)
      : 0

  const shouldShowFullScreen = bothPanelsOpen && windowWidth >= 1024 && windowWidth < 1400

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center"
      style={{ 
        zIndex: 60,
        paddingLeft: shouldShowFullScreen ? '0' : '1rem',
        paddingRight: shouldShowFullScreen ? '0' : (windowWidth >= 1024 ? `calc(${totalOffset}px + 1rem)` : '1rem'),
        paddingTop: shouldShowFullScreen ? '0' : '1rem',
        paddingBottom: shouldShowFullScreen ? '0' : '1rem',
      }}
    >
      <div 
        className="bg-background rounded-lg shadow-xl w-full overflow-y-auto"
        style={{
          maxWidth: shouldShowFullScreen ? '100%' : '56rem',
          maxHeight: shouldShowFullScreen ? '100%' : '90vh',
          height: shouldShowFullScreen ? '100%' : 'auto',
          borderRadius: shouldShowFullScreen ? '0' : undefined,
        }}
      >
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-2xl font-semibold">Checkout</h2>
          <Button variant="ghost" size="sm" onClick={onClose} className="w-8 h-8 p-0">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid md:grid-cols-2 gap-6 p-6">
          {/* Left Column - Forms */}
          <div className="space-y-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <User className="w-5 h-5 mr-2" />
                    Customer Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-3 bg-muted/20 rounded-lg">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium">{userName}</p>
                        <p className="text-sm text-muted-foreground">User ID: {userId?.slice(0, 8)}...</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleInputChange("email", e.target.value)}
                      placeholder="your@email.com"
                      required
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Shipping Address */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <Truck className="w-5 h-5 mr-2" />
                    Shipping Address
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="address">Street Address</Label>
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) => handleInputChange("address", e.target.value)}
                      placeholder="123 Main Street"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={formData.city}
                        onChange={(e) => handleInputChange("city", e.target.value)}
                        placeholder="New York"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="postalCode">Postal Code</Label>
                      <Input
                        id="postalCode"
                        value={formData.postalCode}
                        onChange={(e) => handleInputChange("postalCode", e.target.value)}
                        placeholder="10001"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="country">Country</Label>
                    <Input
                      id="country"
                      value={formData.country}
                      onChange={(e) => handleInputChange("country", e.target.value)}
                      placeholder="United States"
                      required
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Payment Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <CreditCard className="w-5 h-5 mr-2" />
                    Payment Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="nameOnCard">Name on Card</Label>
                    <Input
                      id="nameOnCard"
                      value={formData.nameOnCard}
                      onChange={(e) => handleInputChange("nameOnCard", e.target.value)}
                      placeholder={userName}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="cardNumber">Card Number</Label>
                    <Input
                      id="cardNumber"
                      value={formData.cardNumber}
                      onChange={(e) => handleInputChange("cardNumber", e.target.value)}
                      placeholder="1234 5678 9012 3456"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="expiryDate">Expiry Date</Label>
                      <Input
                        id="expiryDate"
                        value={formData.expiryDate}
                        onChange={(e) => handleInputChange("expiryDate", e.target.value)}
                        placeholder="MM/YY"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="cvv">CVV</Label>
                      <Input
                        id="cvv"
                        value={formData.cvv}
                        onChange={(e) => handleInputChange("cvv", e.target.value)}
                        placeholder="123"
                        required
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </form>
          </div>

          {/* Right Column - Order Summary */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Order Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Order Items */}
                <div className="space-y-3">
                  {state.items.map((item) => (
                    <div key={item.id} className="flex items-center space-x-3 p-3 rounded-lg border bg-muted/20">
                      <div className="relative w-12 h-12 rounded overflow-hidden bg-muted/20 flex-shrink-0">
                        <Image
                          src={item.image|| "/placeholder.svg"}
                          alt={item.name}
                          width={400}
                          height={800}
                          className="w-full h-full object-cover"
                          unoptimized={false}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm line-clamp-1">{item.name}</h4>
                        <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                          <span>{item.size}</span>
                          <span>•</span>
                          <span>{item.color}</span>
                          <span>•</span>
                          <span>Qty: {item.quantity}</span>
                        </div>
                      </div>
                      <div className="text-sm font-medium">
                        {formatCurrency(item.price * item.quantity, item.currency)}
                      </div>
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Order Totals */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Subtotal ({state.totalItems} items)</span>
                    <span>{formatCurrency(state.totalPrice, state.items[0]?.currency || "USD")}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Shipping</span>
                    <span className="text-green-600">Free</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Tax</span>
                    <span>{formatCurrency(state.totalPrice * 0.08, state.items[0]?.currency || "USD")}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-lg font-semibold">
                    <span>Total</span>
                    <span>{formatCurrency(state.totalPrice * 1.08, state.items[0]?.currency || "USD")}</span>
                  </div>
                </div>

                {/* Security Badge */}
                <div className="flex items-center justify-center space-x-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                  <Shield className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-green-700 dark:text-green-400">Secure 256-bit SSL encryption</span>
                </div>

                {/* Place Order Button */}
                <Button onClick={handleSubmit} className="w-full" size="lg" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Processing...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Place Order
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}