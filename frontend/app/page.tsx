// File: frontend/app/page.tsx
"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import type React from "react";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search,
  ShoppingBag,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Store as StoreIcon,
} from "lucide-react";
import { useStore } from "@/context/StoreContext";
import { useCart } from "@/context/CartContext";
import { ShoppingCart } from "@/components/ui/shopping-cart";
import { ChatSidebar } from "@/components/ui/chat-sidebar";
import { useChat } from "@/context/ChatContext";
import { ThemeSelector } from "@/components/ui/theme-selector";
import { FlaggedSessionsButton } from "@/components/ui/flagged-sessions";

const apiUrl = process.env.NEXT_PUBLIC_API_URL;

interface ProductVariant {
  id: string;
  color?: string;
  size?: string;
  stock: number;
  available: boolean;
}

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  originalPrice?: number;
  currency: string;
  inStock: boolean;
  image: string;
  images: string[];
  variants: ProductVariant[];
  sizes: string[];
  colors: string[];
}

const stores = [
  "Aurora Style",
  "Luna Apperal",
  "Celeste Wear",
  "Dayifuse Fashion",
];

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

export default function Store() {
  const [windowWidth, setWindowWidth] = useState(1200);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const { store: selectedStore, setStore } = useStore();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<{
    [key: string]: number;
  }>({});
  const [isLoading, setIsLoading] = useState(true);
  const [storePopoverOpen, setStorePopoverOpen] = useState(false);
  const [hasProcessedUrlStore, setHasProcessedUrlStore] = useState(false);
  const { addItem, openCart, toggleCart, state } = useCart();

  const {
    messages,
    isAssistantOpen,
    setIsAssistantOpen,
    setMessages,
    setSelectedProduct,
  } = useChat();
  const storePopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        storePopoverRef.current &&
        !storePopoverRef.current.contains(event.target as Node)
      ) {
        setStorePopoverOpen(false);
      }
    };

    if (storePopoverOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [storePopoverOpen]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const storeFromUrl = urlParams.get("store");

    if (
      storeFromUrl &&
      stores.includes(storeFromUrl) &&
      storeFromUrl !== selectedStore
    ) {
      setStore(storeFromUrl);
    }
    setHasProcessedUrlStore(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasProcessedUrlStore) return;

    const fetchProducts = async () => {
      try {
        setIsLoading(true);
        const res = await fetch(
          `${apiUrl}/events/products?store=${selectedStore}`,
          {
            headers: {
              Authorization: "Bearer your-secret-token",
            },
          }
        );

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data: Product[] = await res.json();
        setProducts(data);
      } catch (err) {
        console.error("Error fetching products from backend:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProducts();
  }, [selectedStore, hasProcessedUrlStore]);

  const filteredDresses = (products ?? []).filter(
    (dress) =>
      dress.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dress.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const fetchProductById = async (id: string) => {
    try {
      const res = await fetch(`${apiUrl}/events/products/${id}`, {
        headers: {
          Authorization: "Bearer your-secret-token",
        },
      });
      if (!res.ok) throw new Error("Failed to fetch product details");
      const data: Product = await res.json();
      setSelectedProduct(data);
    } catch (err) {
      console.error("Error fetching product details", err);
      const localProduct = products?.find((p) => p.id === id);
      if (localProduct) {
        setSelectedProduct(localProduct);
      }
    }
  };

  const openGeneralChat = () => {
    setSelectedProduct(null);

    if (messages.length === 0) {
      setMessages([
        {
          id: "1",
          type: "assistant",
          content: `Hello! Welcome to ${selectedStore}. How can I help you today?`,
          timestamp: new Date(),
          suggestions: [
            "I'm looking for a dress",
            "Help me track my order",
          ],
        },
      ]);
    }

    setIsAssistantOpen((prev) => !prev);
  };

  const openProductChat = (product: Product) => {
    setSelectedProduct(product);
    fetchProductById(product.id);

    const productMessage = {
      id: Date.now().toString(),
      type: "assistant" as const,
      content: `I see you're interested in the ${product.name}. What would you like to know?`,
      timestamp: new Date(),
      products: [product],
      suggestions: [
        "What sizes are available?",
        "How does this dress fit?",
        "What occasions is this perfect for?",
        "Show me similar products",
      ],
      is_user_added: true,
    };

    setMessages((prev) => {
      let normalizedMessages = prev;

      if (prev.length === 0) {
        normalizedMessages = [
          {
            id: "0",
            type: "assistant" as const,
            content: `Hello! Welcome to ${selectedStore}. How can I help you today?`,
            timestamp: new Date(),
          },
        ];
      }

      const lastMessage = normalizedMessages[normalizedMessages.length - 1];
      const shouldReplaceLastProduct =
        lastMessage?.type === "assistant" &&
        lastMessage.products?.length &&
        lastMessage.is_user_added === true;

      if (shouldReplaceLastProduct) {
        return [...normalizedMessages.slice(0, -1), productMessage];
      }

      return [...normalizedMessages, productMessage];
    });

    setIsAssistantOpen(true);
  };

  const openProductPage = (productId: string) => {
    const url = new URL(`/product/${productId}`, window.location.origin);
    url.searchParams.set("store", selectedStore);
    url.searchParams.delete("product");
    url.searchParams.delete("chat");
    window.location.href = url.toString();
  };

  const nextImage = (productId: string, images: string[]) => {
    setCurrentImageIndex((prev) => ({
      ...prev,
      [productId]: ((prev[productId] || 0) + 1) % images.length,
    }));
  };

  const prevImage = (productId: string, images: string[]) => {
    setCurrentImageIndex((prev) => ({
      ...prev,
      [productId]: ((prev[productId] || 0) - 1 + images.length) % images.length,
    }));
  };

  const handleAddToCart = (dress: Product, e: React.MouseEvent) => {
    e.stopPropagation();
    const firstAvailableColor = dress.colors[0] || "Default";
    const firstAvailableSize =
      dress.variants.find((v) => v.color === firstAvailableColor)?.size || "M";
    const selectedVariant = dress.variants.find(
      (v) => v.color === firstAvailableColor && v.size === firstAvailableSize
    );
    if (!selectedVariant) return;

    addItem({
      productId: dress.id,
      name: dress.name,
      price: dress.price,
      currency: dress.currency,
      image: dress.image,
      size: firstAvailableSize,
      color: firstAvailableColor,
      inStock: dress.inStock,
      variantId: selectedVariant.id,
    });

    openCart();
  };

  const MAX_SIDE_WIDTH = 450;
  const bothPanelsOpen = isAssistantOpen && state.isOpen;

  let sideWidth;

  if (windowWidth < 1024) {
    sideWidth = windowWidth;
  } else if (bothPanelsOpen && windowWidth >= 1024 && windowWidth < 1200) {
    sideWidth = windowWidth / 2;
  } else {
    sideWidth = MAX_SIDE_WIDTH;
  }

  const totalOffset =
    windowWidth >= 1024
      ? (isAssistantOpen ? sideWidth : 0) + (state.isOpen ? sideWidth : 0)
      : 0;

  const cartRight = state.isOpen ? 0 : -sideWidth;
  const sidebarRight = isAssistantOpen
    ? state.isOpen
      ? sideWidth
      : 0
    : -sideWidth;

  const HORIZONTAL_PADDING = 24 * 2;
  const MAX_COLUMNS = 4;
  const MIN_CARD_MOBILE = 160;
  const MIN_CARD_TABLET = 220;
  const MIN_CARD_DESKTOP = 250;

  const availableContentWidth = Math.max(
    0,
    windowWidth - totalOffset - HORIZONTAL_PADDING
  );

  const minCardWidth =
    windowWidth < 640
      ? MIN_CARD_MOBILE
      : windowWidth < 1024
      ? MIN_CARD_TABLET
      : MIN_CARD_DESKTOP;

  let gridCols =
    availableContentWidth < minCardWidth
      ? 1
      : Math.floor(availableContentWidth / minCardWidth);

  if (windowWidth < 640) {
    gridCols = Math.min(Math.max(1, gridCols), 2);
  } else {
    gridCols = Math.min(Math.max(1, gridCols), MAX_COLUMNS);
  }

  const gridTemplate = `repeat(${gridCols}, minmax(0, 1fr))`;
  const shouldShowGrid =
    availableContentWidth >= minCardWidth &&
    !(bothPanelsOpen && windowWidth >= 1024 && windowWidth < 1200);

  return (
    <div className="min-h-screen bg-background">
      {shouldShowGrid && (
        <>
          <header
            className="sticky top-0 z-40 w-full border-b backdrop-blur-xl transition-all duration-300"
            style={{
              paddingLeft: "1.5rem",
              paddingRight: `calc(${totalOffset}px + 1.5rem)`,
              backgroundColor: "rgba(255, 255, 255, 0.8)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
            }}
          >
            <div className="max-w-[2000px] mx-auto">
              <div className="flex h-16 items-center justify-center space-x-2">
                <div className="flex items-center space-x-2">
                  <div className="relative" ref={storePopoverRef}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-10 w-10 p-0 text-foreground hover:text-primary bg-transparent hover:bg-transparent transition-colors"
                      onClick={() => setStorePopoverOpen(!storePopoverOpen)}
                    >
                      <StoreIcon className="w-6 h-6" />
                    </Button>

                    {storePopoverOpen && (
                      <div className="absolute top-full mt-2 left-0 w-48 bg-background border border-border rounded-lg shadow-lg z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                        {stores.map((store) => (
                          <button
                            key={store}
                            onClick={() => {
                              setStore(store);
                              const url = new URL(window.location.href);
                              url.searchParams.set("store", store);
                              window.history.replaceState(
                                {},
                                "",
                                url.toString()
                              );
                              setStorePopoverOpen(false);
                            }}
                            className="block w-full text-left px-4 py-3 text-sm hover:text-primary hover:bg-muted/50 bg-transparent transition-colors first:rounded-t-lg last:rounded-b-lg"
                          >
                            {store}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-1">
                  <Button
                    onClick={() => setIsSearchOpen(!isSearchOpen)}
                    variant="ghost"
                    size="sm"
                    className="h-10 w-10 p-0 text-foreground hover:text-primary bg-transparent hover:bg-transparent transition-colors"
                  >
                    <Search className="w-6 h-6" />
                  </Button>

                  <ThemeSelector />
                  <FlaggedSessionsButton />

                  <Button
                    onClick={() => openGeneralChat()}
                    variant="ghost"
                    size="sm"
                    className="h-10 w-10 p-0 text-foreground hover:text-primary bg-transparent hover:bg-transparent transition-colors"
                  >
                    <MessageCircle className="w-6 h-6" />
                  </Button>

                  <Button
                    onClick={toggleCart}
                    variant="ghost"
                    size="sm"
                    className="h-10 w-10 p-0 relative text-foreground hover:text-primary bg-transparent hover:bg-transparent transition-colors"
                  >
                    <ShoppingBag className="w-6 h-6" />
                    {state.totalItems > 0 && (
                      <Badge
                        variant="destructive"
                        className="absolute -top-1 -right-1 w-4 h-4 p-0 flex items-center justify-center text-[10px]"
                      >
                        {state.totalItems}
                      </Badge>
                    )}
                  </Button>
                </div>
              </div>

              <div
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{
                  maxHeight: isSearchOpen ? "60px" : "0px",
                  opacity: isSearchOpen ? 1 : 0,
                }}
              >
                <div className="pb-3 pt-1">
                  <div className="relative w-full">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <Input
                      type="text"
                      placeholder="Search products..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 h-9 text-sm bg-muted/30 border-0 focus-visible:ring-1"
                      autoFocus={isSearchOpen}
                    />
                  </div>
                </div>
              </div>
            </div>
          </header>

          <main
            className="py-8 transition-all duration-300"
            style={{
              paddingLeft: "1.5rem",
              paddingRight: `calc(${totalOffset}px + 1.5rem)`,
            }}
          >
            <div className="max-w-full px-4 sm:px-6 md:px-8 mx-auto">
              {isLoading ? (
                <div className="min-h-screen flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading products...</p>
                  </div>
                </div>
              ) : (
                <div
                  className="grid gap-6"
                  style={{
                    gridTemplateColumns: gridTemplate,
                    transition: "grid-template-columns 250ms ease",
                  }}
                >
                  {filteredDresses.map((dress) => (
                    <Card
                      key={dress.id}
                      className="group overflow-hidden border-0 shadow-sm hover:shadow-lg transition-all duration-300 bg-card cursor-pointer"
                      onClick={() => openProductPage(dress.id)}
                    >
                      <div className="aspect-[3/4] overflow-hidden bg-muted/20 relative">
                        <Image
                          src={
                            dress.images && dress.images.length > 0
                              ? dress.images[currentImageIndex[dress.id] || 0]
                              : dress.image || "/placeholder.svg"
                          }
                          alt={dress.name}
                          width={600}
                          height={1200}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          unoptimized={false}
                        />

                        {dress.images && dress.images.length > 1 && (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="absolute left-2 top-1/2 transform -translate-y-1/2 w-8 h-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 hover:bg-black/90 border-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                prevImage(dress.id, dress.images);
                              }}
                            >
                              <ChevronLeft className="w-5 h-5 text-white" />
                            </Button>

                            <Button
                              variant="secondary"
                              size="sm"
                              className="absolute right-2 top-1/2 transform -translate-y-1/2 w-8 h-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 hover:bg-black/90 border-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                nextImage(dress.id, dress.images);
                              }}
                            >
                              <ChevronRight className="w-5 h-5 text-white" />
                            </Button>

                            <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {dress.images.map((_, index) => (
                                <div
                                  key={index}
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    index === (currentImageIndex[dress.id] || 0)
                                      ? "bg-black w-8"
                                      : "bg-black/60"
                                  }`}
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </div>

                      <CardContent className="p-4">
                        <div className="space-y-2">
                          <h3 className="font-medium text-sm text-card-foreground line-clamp-2 leading-snug sm:h-auto h-[2.5rem]">
                            {dress.name}
                          </h3>

                          <div className="flex items-center justify-between min-h-[1.5rem]">
                            <div className="space-x-2">
                              <span className="font-semibold text-card-foreground">
                                {formatCurrency(dress.price, dress.currency)}
                              </span>
                              {dress.originalPrice && (
                                <span className="text-sm text-muted-foreground line-through">
                                  {formatCurrency(
                                    dress.originalPrice,
                                    dress.currency
                                  )}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex space-x-2 pt-2">
                            <Button
                              size="sm"
                              className="flex-1 h-8 text-xs min-w-0 sm:min-w-[100px] bg-primary hover:bg-primary/90 transition-colors"
                              onClick={(e) => handleAddToCart(dress, e)}
                            >
                              <ShoppingBag className="w-3 h-3 flex-shrink-0" />
                              <span className="hidden sm:inline ml-1 truncate">
                                Add to Cart
                              </span>
                            </Button>

                            <Button
                              onClick={(e) => {
                                e.stopPropagation();
                                openProductChat(dress);
                              }}
                              variant="outline"
                              size="sm"
                              className="h-8 w-8 p-0 flex-shrink-0 border-primary/30 hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors"
                              aria-label="Chat about product"
                            >
                              <MessageCircle className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {!isLoading && filteredDresses.length === 0 && (
                <div className="text-center py-16">
                  <p className="text-lg text-muted-foreground mb-4">
                    No products found matching your search.
                  </p>
                  <Button
                    onClick={() => setSearchQuery("")}
                    variant="outline"
                    className="hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    Clear Search
                  </Button>
                </div>
              )}
            </div>
          </main>
        </>
      )}
      <ShoppingCart right={cartRight} sideWidth={sideWidth} />
      <ChatSidebar right={sidebarRight} sideWidth={sideWidth} />
    </div>
  );
}