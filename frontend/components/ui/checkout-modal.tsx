"use client";

import type React from "react";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { X, CheckCircle, User, MapPin } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { useUser } from "@/context/UserContext";
import { useChat } from "@/context/ChatContext";
import Image from "next/image";

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCheckout: (deliveryAddress: DeliveryAddress) => Promise<void>;
  isLoading?: boolean;
  userName: string;
}

export interface DeliveryAddress {
  full_name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

const formatCurrency = (price: number, currency: string): string => {
  switch (currency) {
    case "USD":
      return `$${price.toFixed(2)}`;
    case "EURO":
      return `€${price.toFixed(2)}`;
    case "TRY":
      return `₺${price.toFixed(2)}`;
    default:
      return `${currency} ${price.toFixed(2)}`;
  }
};

export function CheckoutModal({
  isOpen,
  onClose,
  onCheckout,
  isLoading = false,
  userName,
}: CheckoutModalProps) {
  const { state } = useCart();
  const { userId } = useUser();
  const { isAssistantOpen } = useChat();
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  const [formData, setFormData] = useState<DeliveryAddress>({
    full_name: userName || "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    postal_code: "",
    country: "",
  });

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.width = "100%";
      document.body.style.height = "100%";
    } else {
      const isMobile = windowWidth < 1024;
      if (isMobile && state.isOpen) {
        document.body.style.overflow = "hidden";
        document.body.style.position = "fixed";
        document.body.style.width = "100%";
        document.body.style.height = "100%";
      } else {
        document.body.style.overflow = "";
        document.body.style.position = "";
        document.body.style.width = "";
        document.body.style.height = "";
      }
    }

    return () => {
      if (!state.isOpen) {
        document.body.style.overflow = "";
        document.body.style.position = "";
        document.body.style.width = "";
        document.body.style.height = "";
      }
    };
  }, [isOpen, state.isOpen, windowWidth]);

  const handleInputChange = (field: keyof DeliveryAddress, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCheckout(formData);
  };

  if (!isOpen) return null;

  const MAX_SIDE_WIDTH = 450;
  const bothPanelsOpen = isAssistantOpen && state.isOpen;

  let sideWidth;
  if (windowWidth < 1024) {
    sideWidth = windowWidth;
  } else if (bothPanelsOpen && windowWidth >= 1024 && windowWidth < 1400) {
    sideWidth = windowWidth / 2;
  } else {
    sideWidth = MAX_SIDE_WIDTH;
  }

  const totalOffset =
    windowWidth >= 1024
      ? (isAssistantOpen ? sideWidth : 0) + (state.isOpen ? sideWidth : 0)
      : 0;

  const shouldShowFullScreen =
    bothPanelsOpen && windowWidth >= 1024 && windowWidth < 1400;

  const availableWidth = windowWidth - totalOffset;
  const useMobileLayout = windowWidth < 1024 || availableWidth < 700;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center"
      style={{
        zIndex: 60,
        overflow: "hidden",
        touchAction: "none",
        paddingLeft: shouldShowFullScreen ? "0" : "1rem",
        paddingRight: shouldShowFullScreen
          ? "0"
          : windowWidth >= 1024
          ? `calc(${totalOffset}px + 1rem)`
          : "1rem",
        paddingTop: shouldShowFullScreen ? "0" : "1rem",
        paddingBottom: shouldShowFullScreen ? "0" : "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="bg-background rounded-lg shadow-xl w-full flex flex-col"
        style={{
          maxWidth: shouldShowFullScreen ? "100%" : "56rem",
          maxHeight: shouldShowFullScreen ? "100%" : "90vh",
          height: shouldShowFullScreen ? "100%" : "auto",
          borderRadius: shouldShowFullScreen ? "0" : undefined,
          touchAction: "auto",
          overflowX: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 sm:p-6 border-b flex-shrink-0">
          <h2 className="text-xl sm:text-2xl font-semibold">Checkout</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="w-8 h-8 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div 
          className="flex-1"
          style={{
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <div className={`gap-6 p-4 sm:p-6 ${useMobileLayout ? 'grid grid-cols-1' : 'grid md:grid-cols-2'}`}>
            {/* Left Column - Forms */}
            <div className="space-y-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base sm:text-lg flex items-center">
                      <User className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                      Customer Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-3 bg-muted/20 rounded-lg">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="font-medium text-sm sm:text-base">{userName}</p>
                          <p className="text-xs sm:text-sm text-muted-foreground">
                            User ID: {userId?.slice(0, 8)}...
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Delivery Address */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base sm:text-lg flex items-center">
                      <MapPin className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                      Delivery Address
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="full_name" className="text-sm">Full Name *</Label>
                      <Input
                        id="full_name"
                        value={formData.full_name}
                        onChange={(e) =>
                          handleInputChange("full_name", e.target.value)
                        }
                        placeholder="John Doe"
                        required
                        className="text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="address_line1" className="text-sm">Address Line 1 *</Label>
                      <Input
                        id="address_line1"
                        value={formData.address_line1}
                        onChange={(e) =>
                          handleInputChange("address_line1", e.target.value)
                        }
                        placeholder="123 Main Street"
                        required
                        className="text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor="address_line2" className="text-sm">Address Line 2 (Optional)</Label>
                      <Input
                        id="address_line2"
                        value={formData.address_line2}
                        onChange={(e) =>
                          handleInputChange("address_line2", e.target.value)
                        }
                        placeholder="Apt 4B"
                        className="text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="city" className="text-sm">City *</Label>
                        <Input
                          id="city"
                          value={formData.city}
                          onChange={(e) =>
                            handleInputChange("city", e.target.value)
                          }
                          placeholder="New York"
                          required
                          className="text-sm"
                        />
                      </div>
                      <div>
                        <Label htmlFor="state" className="text-sm">State/Province *</Label>
                        <Input
                          id="state"
                          value={formData.state}
                          onChange={(e) =>
                            handleInputChange("state", e.target.value)
                          }
                          placeholder="NY"
                          required
                          className="text-sm"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="postal_code" className="text-sm">Postal Code *</Label>
                        <Input
                          id="postal_code"
                          value={formData.postal_code}
                          onChange={(e) =>
                            handleInputChange("postal_code", e.target.value)
                          }
                          placeholder="10001"
                          required
                          className="text-sm"
                        />
                      </div>
                      <div>
                        <Label htmlFor="country" className="text-sm">Country *</Label>
                        <Input
                          id="country"
                          value={formData.country}
                          onChange={(e) =>
                            handleInputChange("country", e.target.value)
                          }
                          placeholder="United States"
                          required
                          className="text-sm"
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
                  <CardTitle className="text-base sm:text-lg">Order Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Order Items */}
                  <div className="space-y-3">
                    {state.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center space-x-2 sm:space-x-3 p-2 sm:p-3 rounded-lg border bg-muted/20"
                      >
                        <div className="relative w-10 h-10 sm:w-12 sm:h-12 rounded overflow-hidden bg-muted/20 flex-shrink-0">
                          <Image
                            src={item.image || "/placeholder.svg"}
                            alt={item.name}
                            width={400}
                            height={800}
                            className="w-full h-full object-cover"
                            unoptimized={false}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-xs sm:text-sm line-clamp-1">
                            {item.name}
                          </h4>
                          <div className="flex items-center space-x-1 sm:space-x-2 text-xs text-muted-foreground">
                            <span>{item.size}</span>
                            <span>•</span>
                            <span>{item.color}</span>
                            <span>•</span>
                            <span>Qty: {item.quantity}</span>
                          </div>
                        </div>
                        <div className="text-xs sm:text-sm font-medium flex-shrink-0">
                          {formatCurrency(
                            item.price * item.quantity,
                            item.currency
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <Separator />

                  {/* Order Totals */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs sm:text-sm">
                      <span>Subtotal ({state.totalItems} items)</span>
                      <span>
                        {formatCurrency(
                          state.totalPrice,
                          state.items[0]?.currency || "USD"
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs sm:text-sm">
                      <span>Shipping</span>
                      <span className="text-green-600">Free</span>
                    </div>
                    <div className="flex justify-between text-xs sm:text-sm">
                      <span>Tax</span>
                      <span>
                        {formatCurrency(
                          state.totalPrice * 0.08,
                          state.items[0]?.currency || "USD"
                        )}
                      </span>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-base sm:text-lg font-semibold">
                      <span>Total</span>
                      <span>
                        {formatCurrency(
                          state.totalPrice * 1.08,
                          state.items[0]?.currency || "USD"
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Place Order Button */}
                  <Button
                    onClick={handleSubmit}
                    className="w-full text-sm sm:text-base"
                    size="lg"
                    disabled={isLoading}
                  >
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
    </div>
  );
}