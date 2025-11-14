import type React from "react";
import type { Viewport } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { ThemeProvider } from "@/context/ThemeContext";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <Suspense fallback={null}>
          <ThemeProvider>
            <Providers>{children}</Providers>
          </ThemeProvider>
        </Suspense>
        <SpeedInsights />
      </body>
    </html>
  );
}
