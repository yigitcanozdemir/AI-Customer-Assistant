"use client";

import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/next";
import { CartProvider } from "@/lib/cart-context";
import { StoreProvider } from "../context/StoreContext";
import { ChatProvider } from "@/context/ChatContext"
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});


export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Suspense fallback={null}>
          <StoreProvider>
            <ChatProvider>
              <CartProvider>{children}</CartProvider>
            </ChatProvider>
          </StoreProvider>
        </Suspense>
        <Analytics />
      </body>
    </html>
  );
}
