// File: frontend/app/product/[id]/page.tsx
"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ShoppingBag,
  ArrowLeft,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useStore } from "@/context/StoreContext";
import { useCart } from "@/context/CartContext";
import { ShoppingCart } from "@/components/ui/shopping-cart";
import { ChatSidebar } from "@/components/ui/chat-sidebar";
import { useChat } from "@/context/ChatContext";
import { useCallback } from "react";

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

export default function ProductPage() {
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  const params = useParams();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedSize, setSelectedSize] = useState<string>("");
  const [selectedColor, setSelectedColor] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const { store: currentStore, setStore } = useStore();
  const { addItem, openCart, state, toggleCart } = useCart();

  const {
    messages,
    setMessages,
    setIsAssistantOpen,
    setSelectedProduct,
    isAssistantOpen,
  } = useChat();

  const getImagesForColor = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (color: string) => {
      if (!product) return [];
      return product.images && product.images.length > 0
        ? product.images
        : [product.image];
    },
    [product]
  );

  const getCurrentVariant = () => {
    if (!product || !selectedColor || !selectedSize) return null;
    return product.variants.find(
      (v) => v.color === selectedColor && v.size === selectedSize
    );
  };

  const isCurrentVariantInStock = () => {
    const variant = getCurrentVariant();
    if (variant) {
      return variant.available && variant.stock > 0;
    }
    return product?.inStock || false;
  };

  const getAvailableSizesForColor = useCallback(
    (color: string) => {
      if (!product) return [];
      return product.variants
        .filter((v) => v.color === color && v.available && v.stock > 0)
        .map((v) => v.size)
        .filter((size, index, arr) => arr.indexOf(size) === index);
    },
    [product]
  );
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  useEffect(() => {
    const fetchProduct = async () => {
      try {
        setIsLoading(true);
        const res = await fetch(`${apiUrl}/events/products/${params.id}`, {
          headers: {
            Authorization: "Bearer your-secret-token",
          },
        });
        if (!res.ok) throw new Error("Failed to fetch product");
        const data: Product = await res.json();
        setProduct(data);
      } catch (err) {
        console.error("Error fetching product, using mock data:", err);
      } finally {
        setIsLoading(false);
      }
    };

    if (params.id) {
      fetchProduct();
    }
  }, [params.id]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const storeParam = urlParams.get("store");
    if (storeParam) {
      setStore(storeParam);
    }
  }, [setStore]);

  useEffect(() => {
    if (product) {
      if (product.colors.length > 0) {
        setSelectedColor(product.colors[0]);
        const availableSizes = getAvailableSizesForColor(product.colors[0]);
        if (availableSizes.length > 0) {
          setSelectedSize(availableSizes[0] || "");
        } else if (product.sizes.length > 0) {
          setSelectedSize(product.sizes[0] || "");
        }
      }
    }
  }, [product, getAvailableSizesForColor]);

  const sortSizes = (sizes: string[]): string[] => {
    const clothingSizeOrder: { [key: string]: number } = {
      XXS: 1,
      XS: 2,
      S: 3,
      M: 4,
      L: 5,
      XL: 6,
      XXL: 7,
      XXXL: 8,
      "2XS": 1,
      "3XS": 0,
      "2XL": 7,
      "3XL": 8,
      "4XL": 9,
      "5XL": 10,
    };

    return [...sizes].sort((a, b) => {
      const aUpper = a.toUpperCase();
      const bUpper = b.toUpperCase();

      if (
        clothingSizeOrder[aUpper] !== undefined &&
        clothingSizeOrder[bUpper] !== undefined
      ) {
        return clothingSizeOrder[aUpper] - clothingSizeOrder[bUpper];
      }

      const aNum = parseFloat(a);
      const bNum = parseFloat(b);

      if (!isNaN(aNum) && !isNaN(bNum)) {
        return aNum - bNum;
      }

      return a.localeCompare(b);
    });
  };

  const sortedSizes = product ? sortSizes(product.sizes) : [];

  useEffect(() => {
    if (product) {
      setSelectedImage(0);
    }
  }, [product]);

  const handleChatOpen = () => {
    setSelectedProduct(null);

    if (messages.length === 0) {
      setMessages([
        {
          id: "1",
          type: "assistant",
          content: `Hello! Welcome to ${currentStore}. How can I help you today?`,
          timestamp: new Date(),
          suggestions: [
            "Show me your latest products",
            "I'm looking for a dress",
            "Help me track my order",
          ],
        },
      ]);
    }

    setIsAssistantOpen((prev) => !prev);
  };

  const handleAskQuestion = () => {
    if (!product) return;

    setSelectedProduct(product);

    const productMessage = {
      id: Date.now().toString(),
      type: "assistant" as const,
      content: `I see you're interested in the ${product.name}. I can help with sizing, colors, or styling tips.`,
      timestamp: new Date(),
      products: [product],
      suggestions: [
        "What sizes are available?",
        "How does this dress fit?",
        "Show similar products",
      ],
    };

    if (messages.length === 0) {
      setMessages([
        {
          id: "0",
          type: "assistant" as const,
          content: `Hello! Welcome to ${currentStore}. How can I help you today?`,
          timestamp: new Date(),
        },
        productMessage,
      ]);
    } else {
      setMessages((prev) => [...prev, productMessage]);
    }

    setIsAssistantOpen((prev) => !prev);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <main
          className="transition-all duration-300 ease-in-out flex items-center justify-center"
          style={{
            minHeight: "calc(100vh - 4rem)",
            paddingLeft: "1.5rem",
            paddingRight: "1.5rem",
          }}
        >
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading product...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Product Not Found</h1>
          <Button
            onClick={() => {
              if (window.history.length > 1) {
                router.back();
              } else {
                const urlParams = new URLSearchParams(window.location.search);
                const storeParam = urlParams.get("store") || currentStore;
                router.push(`/?store=${encodeURIComponent(storeParam)}`);
              }
            }}
            variant="outline"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Store
          </Button>
        </div>
      </div>
    );
  }

  const handleAddToCart = () => {
    if (!product || !selectedColor || !selectedSize) return;

    const selectedVariant = getCurrentVariant();
    if (!selectedVariant) return;
    addItem({
      productId: product.id,
      name: product.name,
      price: product.price,
      currency: product.currency,
      image: currentImages[0] || product.image,
      size: selectedSize,
      color: selectedColor,
      inStock: selectedVariant.available,
      quantity,
      variantId: selectedVariant.id,
    });

    openCart();
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

  const cartRight = state.isOpen ? 0 : -sideWidth;
  const sidebarRight = isAssistantOpen
    ? state.isOpen
      ? sideWidth
      : 0
    : -sideWidth;

  const shouldShowContent = !(
    bothPanelsOpen &&
    windowWidth >= 1024 &&
    windowWidth < 1400
  );

  const currentImages = getImagesForColor(selectedColor);
  const currentVariant = getCurrentVariant();

  return (
    <div className="min-h-screen bg-background">
      {shouldShowContent && (
        <>
          <header
            className="sticky top-0 z-40 w-full border-b bg-background backdrop-blur-xl transition-all duration-300 ease-in-out"
            style={{
              paddingLeft: "1.5rem",
              paddingRight: `calc(${totalOffset}px + 1.5rem)`,
              backgroundColor: "rgba(255, 255, 255, 0.8)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
            }}
          >
            <div className="max-w-[2000px] mx-auto">
              <div className="flex h-16 items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Button
                    onClick={() => {
                      if (window.history.length > 1) {
                        router.back();
                      } else {
                        const urlParams = new URLSearchParams(
                          window.location.search
                        );
                        const storeParam =
                          urlParams.get("store") || currentStore;
                        router.push(
                          `/?store=${encodeURIComponent(storeParam)}`
                        );
                      }
                    }}
                    variant="ghost"
                    size="sm"
                    className="h-10 w-10 p-0 bg-transparent hover:bg-transparent text-foreground hover:text-primary transition-colors"
                  >
                    <ArrowLeft className="w-6 h-6 mr-2" />
                    Back
                  </Button>
                </div>

                <div className="flex items-center space-x-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleChatOpen}
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
            </div>
          </header>

          <main
            className="py-8 transition-all duration-300 ease-in-out"
            style={{
              paddingLeft: "1.5rem",
              paddingRight: `calc(${totalOffset}px + 1.5rem)`,
            }}
          >
            <div className="max-w-[2000px] mx-auto">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div className="space-y-4 max-w-[800px]">
                  <div className="aspect-[3/4] overflow-hidden rounded-lg bg-muted/20 relative group">
                    <Image
                      src={
                        currentImages[selectedImage] ||
                        product.image ||
                        "/placeholder.svg"
                      }
                      alt={product.name}
                      width={400}
                      height={600}
                      priority
                      className="w-full h-full object-cover"
                      unoptimized={true}
                    />
                    {currentImages.length > 1 && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 p-0 bg-black/70 hover:bg-black/90 shadow-lg border-0"
                          onClick={() =>
                            setSelectedImage(
                              (selectedImage - 1 + currentImages.length) %
                                currentImages.length
                            )
                          }
                        >
                          <ChevronLeft className="w-5 h-5 text-white" />
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 p-0 bg-black/70 hover:bg-black/90 shadow-lg border-0"
                          onClick={() =>
                            setSelectedImage(
                              (selectedImage + 1) % currentImages.length
                            )
                          }
                        >
                          <ChevronRight className="w-5 h-5 text-white" />
                        </Button>

                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex space-x-2">
                          {currentImages.map((_, index) => (
                            <button
                              key={index}
                              onClick={() => setSelectedImage(index)}
                              className={`w-2 h-2 rounded-full transition-all ${
                                selectedImage === index
                                  ? "bg-black w-8"
                                  : "bg-black/60"
                              }`}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <h1 className="text-3xl font-bold text-foreground mb-2 font-modern-heading">
                      {product.name}
                    </h1>

                    <div className="flex items-center space-x-4 mb-4"></div>

                    <div className="flex items-center space-x-4 mb-6">
                      <span className="text-3xl font-semibold text-foreground">
                        {formatCurrency(product.price, product.currency)}
                      </span>
                      {product.originalPrice && (
                        <span className="text-xl text-muted-foreground line-through">
                          {formatCurrency(
                            product.originalPrice,
                            product.currency
                          )}
                        </span>
                      )}
                      {product.originalPrice && (
                        <Badge variant="destructive" className="text-xs">
                          Save{" "}
                          {Math.round(
                            ((product.originalPrice - product.price) /
                              product.originalPrice) *
                              100
                          )}
                          %
                        </Badge>
                      )}
                    </div>

                    <p className="text-muted-foreground leading-relaxed font-modern-body">
                      {product.description}
                    </p>
                  </div>

                  <div className="mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAskQuestion}
                      className="border-primary/30 hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors"
                    >
                      <MessageCircle className="w-4 h-4 mr-2" />
                      Ask Question About This Product
                    </Button>
                  </div>
                  <Separator />
                  {product.colors.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-medium text-foreground">
                        Color: {selectedColor}
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {product.colors.map((color) => {
                          const isSelected = selectedColor === color;
                          return (
                            <Button
                              key={color}
                              variant={isSelected ? "default" : "outline"}
                              size="sm"
                              onClick={() => {
                                setSelectedColor(color);
                                const availableSizes =
                                  getAvailableSizesForColor(color);
                                setSelectedSize(availableSizes[0] || "");
                              }}
                              className={`
                            min-w-[80px]
                            ${
                              isSelected
                                ? "bg-primary text-primary-foreground hover:opacity-100"
                                : "hover:bg-primary/10 hover:text-primary hover:border-primary/50"
                            }
                          `}
                            >
                              {color}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {product.sizes.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-medium text-foreground">
                          Size: {selectedSize}
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {sortedSizes.map((size) => {
                          const sizeVariant = product.variants.find(
                            (v) => v.color === selectedColor && v.size === size
                          );
                          const isAvailable = sizeVariant
                            ? sizeVariant.available && sizeVariant.stock > 0
                            : false;
                          const isSelected = selectedSize === size;
                          const isLongSize = size.length > 4;

                          return (
                            <Button
                              key={size}
                              variant={isSelected ? "default" : "outline"}
                              size="sm"
                              onClick={() => setSelectedSize(size)}
                              disabled={!isAvailable}
                              className={`
                            h-12 ${isLongSize ? "px-4 min-w-[100px]" : "w-12"}
                            ${
                              !isAvailable
                                ? "opacity-50 cursor-not-allowed"
                                : ""
                            }
                            ${
                              isSelected
                                ? "bg-primary text-primary-foreground hover:opacity-100"
                                : "hover:bg-primary/10 hover:text-primary hover:border-primary/50"
                            }
                          `}
                            >
                              <span className={isLongSize ? "text-xs" : ""}>
                                {size}
                              </span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center border rounded-md">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setQuantity(Math.max(1, quantity - 1))}
                          className="h-10 w-10 p-0"
                        >
                          -
                        </Button>
                        <span className="w-12 text-center text-sm font-medium">
                          {quantity}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const maxStock = currentVariant?.stock || 10;
                            setQuantity(Math.min(maxStock, quantity + 1));
                          }}
                          className="h-10 w-10 p-0"
                        >
                          +
                        </Button>
                      </div>

                      <div className="flex-1 flex space-x-3">
                        <Button
                          className="flex-1"
                          disabled={
                            !isCurrentVariantInStock() ||
                            !selectedColor ||
                            !selectedSize
                          }
                          size="lg"
                          onClick={handleAddToCart}
                        >
                          <ShoppingBag className="w-4 h-4 mr-2" />
                          {isCurrentVariantInStock()
                            ? "Add to Cart"
                            : "Out of Stock"}
                        </Button>
                      </div>
                    </div>

                    {!isCurrentVariantInStock() &&
                      selectedColor &&
                      selectedSize && (
                        <div className="text-sm text-destructive">
                          {currentVariant
                            ? `This size is out of stock (${currentVariant.stock} remaining)`
                            : "This combination is not available"}
                        </div>
                      )}

                    {isCurrentVariantInStock() && currentVariant && (
                      <div className="text-sm text-muted-foreground">
                        {currentVariant.stock} items in stock
                      </div>
                    )}
                  </div>
                  <div className="space-y-4"></div>
                </div>
              </div>
            </div>
          </main>
        </>
      )}
      <ShoppingCart right={cartRight} sideWidth={sideWidth} />
      <ChatSidebar right={sidebarRight} sideWidth={sideWidth} />
    </div>
  );
}
