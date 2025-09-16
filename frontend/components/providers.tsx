"use client"

import type React from "react"
import { CartProvider } from "@/lib/cart-context"
import { StoreProvider } from "@/context/StoreContext"
import { ChatProvider } from "@/context/ChatContext"
import { UserProvider } from "@/context/UserContext"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <UserProvider>
      <StoreProvider>
        <ChatProvider>
          <CartProvider>{children}</CartProvider>
        </ChatProvider>
      </StoreProvider>
    </UserProvider>
  )
}
