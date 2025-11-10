"use client";

import React, { useState, useRef, useEffect } from "react";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/context/ThemeContext";

const themes = [
  { name: "ocean", label: "Ocean Cyan", color: "#0891b2" },
  { name: "purple", label: "Purple Elegance", color: "#8b5cf6" },
  { name: "emerald", label: "Emerald Fresh", color: "#10b981" },
  { name: "rose", label: "Rose Luxury", color: "#f43f5e" },
] as const;

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="ghost"
        size="sm"
        className="h-10 w-10 p-0 text-foreground hover:text-primary bg-transparent hover:bg-transparent transition-colors"
        aria-label="Change theme"
      >
        <Palette className="w-6 h-6" />
      </Button>

      {isOpen && (
        <div className="absolute left-1/2 -translate-x-1/2 mt-2 w-48 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="p-2">
            <div className="text-xs font-semibold text-muted-foreground px-2 py-1.5">
              Select Theme
            </div>
            {themes.map((t) => (
              <button
                key={t.name}
                onClick={() => {
                  setTheme(t.name);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-md transition-colors ${
                  theme === t.name
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted text-foreground"
                }`}
              >
                <div
                  className="w-4 h-4 rounded-full border-2 border-border flex-shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                <span className="text-sm font-medium">{t.label}</span>
                {theme === t.name && (
                  <svg
                    className="w-4 h-4 ml-auto flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
