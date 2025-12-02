"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";
import Image from "next/image";

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
  created_at: Date | string;
  product: OrderProduct;
}

interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  image?: string;
}

interface ConfirmationOrder {
  order_id: string;
  status: string;
  product: OrderProduct;
}

interface TrackingLocation {
  country: string;
  region: string;
  city: string;
  lat: number;
  lng: number;
}

interface DeliveryAddress {
  full_name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

interface TrackingData {
  order_id: string;
  current_location?: TrackingLocation | null;
  delivery_address?: DeliveryAddress | null;
  created_at: string;
  status: string;
}

interface Message {
  type?: string;
  role?: string;
  content?: string;
  text?: string;
  timestamp?: string;
  products?: Product[];
  orders?: OrderStatus[];
  confirmation_state?: "accepted" | "declined" | null;
  confirmation_message?: string;
  confirmation_order?: ConfirmationOrder;
  confirmation_action?: string;
  hide_content?: boolean;
  reply_order?: OrderStatus | null;
  tracking_data?: TrackingData;
}

interface MiniChatHistoryProps {
  messageHistory: Message[] | null;
}

const formatCurrency = (amount: number, currency: string) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency,
  }).format(amount);
};

export const MiniChatHistory = memo(({ messageHistory }: MiniChatHistoryProps) => {
  if (!messageHistory || messageHistory.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic">
        No conversation history available
      </div>
    );
  }

  const recentMessages = messageHistory;

  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto p-2 bg-muted/10 rounded-md border border-border/50">
      {recentMessages.map((entry, index) => {
        const role = entry.type || entry.role || "message";
        const content = entry.content || entry.text || "";
        const isUser = role.toLowerCase().includes("user");

        return (
          <div key={index} className="space-y-1">
            {/* Confirmation State Display - Full Width */}
            {entry.confirmation_state && (
              <Card
                className={`border shadow-sm ${
                  entry.confirmation_state === "accepted"
                    ? "border-green-500/50 bg-green-50 dark:bg-green-900/20"
                    : "border-red-500/50 bg-red-50 dark:bg-red-900/20"
                }`}
              >
                <CardContent className="p-2">
                  <div className="flex items-center space-x-2">
                    {entry.confirmation_state === "accepted" ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                    )}
                    <div className="flex-1">
                      <p className="text-xs font-medium text-foreground">
                        {entry.confirmation_message ||
                          (entry.confirmation_state === "accepted"
                            ? "Confirmed"
                            : "Declined")}
                      </p>
                      {entry.confirmation_order && (
                        <p className="text-[10px] text-muted-foreground">
                          Order: {entry.confirmation_order.order_id.slice(0, 8)}...
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Regular Message Bubble */}
            {!entry.hide_content && !entry.confirmation_state && content && (
              <div
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                    isUser
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  <div className="font-medium text-[10px] mb-1 opacity-70">
                    {isUser ? "User" : "Assistant"}
                  </div>
                  <div className="prose prose-sm max-w-none">
                    <ReactMarkdown>{content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            )}

            {/* Product Cards */}
            {entry.products && entry.products.length > 0 && (
              <div className="space-y-1">
                {entry.products.map((product) => (
                  <Card
                    key={product.id}
                    className="border-0 shadow-sm bg-card"
                  >
                    <CardContent className="px-2 py-1.5">
                      <div className="flex items-center space-x-2">
                        <Image
                          src={product.image || "/placeholder.svg"}
                          alt={product.name}
                          width={40}
                          height={53}
                          className="w-8 h-11 object-cover rounded"
                          unoptimized={false}
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-[10px] text-card-foreground line-clamp-1">
                            {product.name}
                          </h4>
                          <span className="font-semibold text-primary text-[10px]">
                            {formatCurrency(product.price, product.currency)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Order Cards */}
            {entry.orders && entry.orders.length > 0 && (
              <div className="space-y-1">
                {entry.orders.map((order) => (
                  <Card
                    key={order.order_id}
                    className="border border-border/50 shadow-sm bg-card"
                  >
                    <CardContent className="px-2 py-1.5">
                      <div className="flex items-center space-x-2">
                        <Image
                          src={order.product.image || "/placeholder.svg"}
                          alt={order.product.name}
                          width={40}
                          height={53}
                          className="w-8 h-11 object-cover rounded"
                          unoptimized={false}
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-[10px] text-card-foreground line-clamp-1">
                            {order.product.name}
                          </h4>
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-primary text-[10px]">
                              {formatCurrency(
                                order.product.price,
                                order.product.currency
                              )}
                            </span>
                            <span className="text-[9px] text-muted-foreground">
                              {order.status}
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Selected Order (reply_order) */}
            {entry.reply_order && (
              <Card className="border-2 border-primary/50 shadow-sm bg-primary/5">
                <CardContent className="px-2 py-1.5">
                  <p className="text-[9px] font-medium text-primary mb-1">
                    Selected Order
                  </p>
                  <div className="flex items-center space-x-2">
                    <Image
                      src={entry.reply_order.product.image || "/placeholder.svg"}
                      alt={entry.reply_order.product.name}
                      width={40}
                      height={53}
                      className="w-8 h-11 object-cover rounded"
                      unoptimized={false}
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-[10px] text-card-foreground line-clamp-1">
                        {entry.reply_order.product.name}
                      </h4>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-primary text-[10px]">
                          {formatCurrency(
                            entry.reply_order.product.price,
                            entry.reply_order.product.currency
                          )}
                        </span>
                        <span className="text-[9px] text-muted-foreground">
                          {entry.reply_order.status}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Tracking Data */}
            {entry.tracking_data && (
              <Card className="border border-border/50 shadow-sm bg-card">
                <CardContent className="p-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-[9px] font-medium text-muted-foreground">
                      Order Tracking
                    </p>
                    <span className="text-[9px] font-medium text-primary">
                      {entry.tracking_data.status}
                    </span>
                  </div>

                  {entry.tracking_data.current_location && (
                    <div className="text-[10px] text-foreground">
                      <p className="font-medium">Current Location:</p>
                      <p className="text-muted-foreground">
                        {entry.tracking_data.current_location.city},{" "}
                        {entry.tracking_data.current_location.region},{" "}
                        {entry.tracking_data.current_location.country}
                      </p>
                    </div>
                  )}

                  {entry.tracking_data.delivery_address && (
                    <div className="text-[10px] text-foreground">
                      <p className="font-medium">Delivery Address:</p>
                      <p className="text-muted-foreground">
                        {entry.tracking_data.delivery_address.full_name}<br />
                        {entry.tracking_data.delivery_address.address_line1}
                        {entry.tracking_data.delivery_address.address_line2 && (
                          <>, {entry.tracking_data.delivery_address.address_line2}</>
                        )}<br />
                        {entry.tracking_data.delivery_address.city},{" "}
                        {entry.tracking_data.delivery_address.state}{" "}
                        {entry.tracking_data.delivery_address.postal_code}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        );
      })}
    </div>
  );
});

MiniChatHistory.displayName = "MiniChatHistory";
