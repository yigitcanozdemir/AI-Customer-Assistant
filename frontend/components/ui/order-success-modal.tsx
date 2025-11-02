"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, X, Package, Clock, User } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { useChat } from "@/context/ChatContext";

interface OrderProduct {
  id: string;
  name: string;
  price: number;
  currency: string;
  image?: string | null;
  variant?: string | null;
}

interface OrderStatus {
  order_id: string;
  status: string;
  user_name: string;
  created_at: string;
  product: OrderProduct;
}

interface CreateOrderResponse {
  orders: OrderStatus[];
}

interface OrderSuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderData: CreateOrderResponse | null;
}

export function OrderSuccessModal({
  isOpen,
  onClose,
  orderData,
}: OrderSuccessModalProps) {
  const { state } = useCart();
  const { isAssistantOpen } = useChat();
  const [windowWidth, setWindowWidth] = useState(1200);

  useEffect(() => {
    setWindowWidth(window.innerWidth);
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen || !orderData) return null;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

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

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center overflow-hidden"
      style={{
        zIndex: 60,
        paddingLeft: shouldShowFullScreen ? "0" : "1rem",
        paddingRight: shouldShowFullScreen
          ? "0"
          : windowWidth >= 1024
          ? `calc(${totalOffset}px + 1rem)`
          : "1rem",
        paddingTop: shouldShowFullScreen ? "0" : "1rem",
        paddingBottom: shouldShowFullScreen ? "0" : "1rem",
      }}
    >
      <div
        className="bg-background rounded-lg shadow-xl w-full overflow-y-auto"
        style={{
          maxWidth: shouldShowFullScreen ? "100%" : "32rem",
          maxHeight: shouldShowFullScreen ? "100%" : "90vh",
          height: shouldShowFullScreen ? "100%" : "auto",
          borderRadius: shouldShowFullScreen ? "0" : undefined,
        }}
      >
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center space-x-3">
            <CheckCircle className="w-8 h-8 text-green-600" />
            <h2 className="text-2xl font-semibold text-green-600">
              Order Successful!
            </h2>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="w-8 h-8 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          <div className="text-center">
            <p className="text-lg text-muted-foreground">
              Thank you for your order! Your items are being processed.
            </p>
          </div>

          <div className="space-y-4">
            {orderData.orders.map((order) => (
              <Card
                key={order.order_id}
                className="border-green-200 bg-green-50/50 dark:bg-green-950/20"
              >
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <Package className="w-5 h-5" />
                    <span>Order #{order.order_id.slice(0, 8)}...</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center space-x-2">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Customer:</span>
                      <span className="font-medium">{order.user_name}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Created:</span>
                      <span className="font-medium">
                        {formatDate(order.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 text-sm">
                    <span className="text-muted-foreground">Status:</span>
                    <span className="px-2 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-full text-xs font-medium capitalize">
                      {order.status}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              You will receive an email confirmation shortly with your order
              details.
            </p>
            <Button onClick={onClose} className="w-full" size="lg">
              Continue Shopping
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}