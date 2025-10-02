"use client"

import type React from "react"
import { CartProvider } from "@/lib/cart-context"
import { StoreProvider } from "@/context/StoreContext"
import { ChatProvider } from "@/context/ChatContext"
import { UserProvider } from "@/context/UserContext"
import { Analytics } from "@vercel/analytics/next"
import { UserEntryModal } from "@/components/ui/user-entry-modal"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <UserProvider>
      <StoreProvider>
        <ChatProvider>
          <CartProvider>
            <UserEntryModal />
              {children}
            <Analytics />
          </CartProvider>
        </ChatProvider>
      </StoreProvider>
    </UserProvider>
  )
}
