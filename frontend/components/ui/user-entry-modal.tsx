"use client";

import type React from "react";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, User, MapPin } from "lucide-react";
import { useUser } from "@/context/UserContext";

export function UserEntryModal() {
  const { isUserSet, setUser } = useUser();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isUserSet) {
      requestGeolocation();
    }
  }, [mounted, isUserSet]);

  useEffect(() => {
    if (!mounted || isUserSet || typeof window === "undefined") return;

    const updateViewportMetrics = () => {
      if (window.visualViewport) {
        setViewportHeight(window.visualViewport.height);
        const inset = Math.max(
          window.innerHeight - window.visualViewport.height,
          0
        );
        setKeyboardInset(inset);
      } else {
        setViewportHeight(window.innerHeight);
        setKeyboardInset(0);
      }
    };

    const lockBody = () => {
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.width = "100%";
      document.body.style.height = "100vh";
    };

    const unlockBody = () => {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.width = "";
      document.body.style.height = "";
    };

    const handleResize = () => {
      setViewportWidth(window.innerWidth);
      updateViewportMetrics();
    };

    updateViewportMetrics();
    setViewportWidth(window.innerWidth);
    lockBody();

    window.visualViewport?.addEventListener("resize", updateViewportMetrics);
    window.visualViewport?.addEventListener("scroll", updateViewportMetrics);
    window.addEventListener("resize", handleResize);

    return () => {
      window.visualViewport?.removeEventListener("resize", updateViewportMetrics);
      window.visualViewport?.removeEventListener("scroll", updateViewportMetrics);
      window.removeEventListener("resize", handleResize);
      unlockBody();
    };
  }, [mounted, isUserSet]);

  const requestGeolocation = async () => {
    try {
      const geo = await fetch("/api/get-geo").then((res) => res.json());
      sessionStorage.setItem("user-geo", JSON.stringify(geo));
    } catch (error) {
      console.error("Failed to get geolocation:", error);
    }
  };

  if (!mounted || isUserSet) return null;

  const MOBILE_BREAKPOINT = 640;
  const TABLET_BREAKPOINT = 1024;
  const isMobileViewport = viewportWidth < MOBILE_BREAKPOINT;
  const isTabletViewport =
    viewportWidth >= MOBILE_BREAKPOINT && viewportWidth < TABLET_BREAKPOINT;

  const isKeyboardOpen = keyboardInset > 0;
  const shouldForceFullScreen =
    isMobileViewport || (isKeyboardOpen && viewportWidth < TABLET_BREAKPOINT);
  const containerHeight = viewportHeight ? `${viewportHeight}px` : "100vh";
  const defaultCardMaxHeight = viewportHeight
    ? `min(90vh, ${viewportHeight - 32}px)`
    : "90vh";
  const showCompactNotices = isMobileViewport;
  const showHeaderSubtext = !isMobileViewport || !isKeyboardOpen;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;

    setIsSubmitting(true);
    setUser(firstName.trim(), lastName.trim());
    setIsSubmitting(false);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex w-full items-start justify-center bg-black/60 backdrop-blur-sm"
      style={{
        height: containerHeight,
        minHeight: containerHeight,
        alignItems: shouldForceFullScreen ? "flex-start" : "center",
        paddingLeft: shouldForceFullScreen ? 0 : "1.5rem",
        paddingRight: shouldForceFullScreen ? 0 : "1.5rem",
        paddingTop: shouldForceFullScreen
          ? 0
          : isTabletViewport
          ? "3rem"
          : "4rem",
        paddingBottom: shouldForceFullScreen
          ? `${Math.max(keyboardInset, 16)}px`
          : "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)",
      }}
    >
      <Card
        className={`mx-auto flex w-full flex-col overflow-hidden shadow-2xl ${
          shouldForceFullScreen ? "" : "rounded-2xl"
        }`}
        style={{
          maxWidth: shouldForceFullScreen ? "100%" : "420px",
          maxHeight: shouldForceFullScreen
            ? containerHeight
            : defaultCardMaxHeight,
          height: shouldForceFullScreen ? containerHeight : undefined,
          borderRadius: shouldForceFullScreen ? 0 : undefined,
        }}
      >
        <CardHeader
          className={`text-center ${
            shouldForceFullScreen ? "px-4 pt-4 pb-2" : "px-6 pt-6 pb-4"
          }`}
        >
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <User className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-lg font-modern-heading sm:text-xl">
            Welcome
          </CardTitle>
          {showHeaderSubtext && (
            <p className="mt-2 text-sm text-muted-foreground">
              Please enter your name to continue.
            </p>
          )}
        </CardHeader>

        <CardContent className="flex-1 space-y-4 overflow-y-auto px-4 pb-6 sm:px-6">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="firstName" className="text-sm font-medium">
                First Name *
              </Label>
              <Input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Enter your first name"
                required
                className="h-10"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName" className="text-sm font-medium">
                Last Name *
              </Label>
              <Input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Enter your last name"
                required
                className="h-10"
              />
            </div>

            <Button
              type="submit"
              className="w-full h-11 text-sm font-semibold"
              disabled={!firstName.trim() || !lastName.trim() || isSubmitting}
            >
              {isSubmitting ? "Setting up..." : "Continue"}
            </Button>
          </form>

          {showCompactNotices ? (
            <>
              <details className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-200">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  Demo Platform Notice
                </summary>
                <div className="px-3 pb-3">
                  This system is a demonstration of a Retrieval-Augmented Generation (RAG)
                  e-commerce experience. It does not represent a real store, and any personal
                  data you enter will be automatically deleted when you close your browser tab.
                </div>
              </details>
              <details className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20 text-xs text-blue-800 dark:text-blue-200">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium">
                  <MapPin className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  Location Data
                </summary>
                <div className="px-3 pb-3">
                  We collect your approximate location for order tracking and delivery purposes. This
                  data is stored temporarily and deleted when you close the tab.
                </div>
              </details>
            </>
          ) : (
            <>
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-amber-800 dark:text-amber-200">
                  <p className="font-medium mb-1">Demonstration Platform Notice</p>
                  <p>
                    This system is a demonstration of a Retrieval-Augmented
                    Generation (RAG) e-commerce experience. It does not represent a
                    real store, and any personal data you enter will be
                    automatically deleted when you close your browser tab.
                  </p>
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start space-x-2">
                <MapPin className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-blue-800 dark:text-blue-200">
                  <p className="font-medium mb-1">Location Data</p>
                  <p>
                    We collect your approximate location for order tracking and
                    delivery purposes. This data is stored temporarily and deleted
                    when you close the tab.
                  </p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
