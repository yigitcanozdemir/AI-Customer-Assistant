"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import {
  ShoppingBag,
  Package,
  RotateCcw,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  X,
} from "lucide-react";

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const onboardingSteps = [
  {
    title: "Welcome to Your AI Shopping Assistant",
    description: "Experience how AI handles product questions, order tracking, and returns across multiple demo stores.",
    icon: Sparkles,
    features: [
      "Explore product inquiries across four different demo stores",
      "See how AI provides real-time order tracking and delivery updates",
      "Experience guided return and cancellation workflows",
      "Test personalized product recommendations in action",
    ],
  },
  {
    title: "Exploring Products",
    description: "Interact with products and see how AI responds to various questions.",
    icon: ShoppingBag,
    features: [
      "Click the chat icon on any product to start a conversation",
      "Ask about sizing, colors, materials, or styling tips",
      "Request similar products with 'Show me similar items'",
      "Test availability queries like 'Is this available in medium?'",
    ],
  },
  {
    title: "Tracking Orders",
    description: "See how AI provides order status and delivery information.",
    icon: Package,
    features: [
      "Say 'Track my order' to view demo order history",
      "Select an order to see real-time location tracking",
      "Ask 'Where is my order?' for detailed shipping status",
      "Experience automated delivery updates and estimates",
    ],
  },
  {
    title: "Returns & Cancellations",
    description: "Test how AI guides users through post-purchase processes.",
    icon: RotateCcw,
    features: [
      "Select an order and say 'I want to return this'",
      "Try 'Can I cancel my order?' to see eligibility checks",
      "Experience confirmation prompts and validation steps",
      "See immediate feedback when actions are processed",
    ],
  },
];

export function OnboardingModal({ isOpen, onClose }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = () => {
    if (currentStep < onboardingSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleClose();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleClose = () => {
    setCurrentStep(0);
    onClose();
  };

  const step = onboardingSteps[currentStep];
  const Icon = step.icon;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent
        className="sm:max-w-[95vw] md:max-w-[600px] max-h-[90vh] p-0 gap-0 bg-background border-border flex flex-col"
        showCloseButton={false}
      >
        <VisuallyHidden>
          <DialogTitle>How to Use - {step.title}</DialogTitle>
        </VisuallyHidden>

        {/* Header */}
        <div className="relative bg-gradient-to-r from-primary/10 via-primary/5 to-background p-4 sm:p-6 border-b border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="absolute top-4 right-4 w-8 h-8 p-0 text-foreground hover:text-primary bg-transparent hover:bg-transparent transition-colors"
          >
            <X className="w-4 h-4" />
          </Button>

          <div className="flex items-start sm:items-center space-x-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg sm:text-2xl font-bold text-foreground leading-tight">
                {step.title}
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Step {currentStep + 1} of {onboardingSteps.length}
              </p>
            </div>
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0">
          <p className="text-sm sm:text-base text-foreground mb-4 sm:mb-6 leading-relaxed">
            {step.description}
          </p>

          <div className="space-y-2 sm:space-y-3">
            {step.features.map((feature, index) => (
              <Card
                key={index}
                className="border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <CardContent className="p-3 sm:p-4 flex items-start space-x-3">
                  <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-foreground leading-relaxed flex-1">
                    {feature}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Progress Dots */}
        <div className="flex-shrink-0 flex justify-center space-x-2 py-3 sm:py-4 border-t border-border bg-muted/10">
          {onboardingSteps.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentStep(index)}
              className={`h-2 rounded-full transition-all ${
                index === currentStep
                  ? "bg-primary w-6 sm:w-8"
                  : "bg-muted-foreground/30 hover:bg-muted-foreground/50 w-2"
              }`}
              aria-label={`Go to step ${index + 1}`}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex items-center justify-between p-4 sm:p-6 border-t border-border bg-muted/20">
          <Button
            variant="ghost"
            onClick={handlePrevious}
            disabled={currentStep === 0}
            className="text-foreground hover:text-primary bg-transparent hover:bg-transparent transition-colors disabled:opacity-50 h-9 sm:h-10 px-3 sm:px-4 text-sm"
          >
            <ChevronLeft className="w-4 h-4 mr-1 text-current" />
            <span className="hidden sm:inline">Previous</span>
            <span className="sm:hidden">Prev</span>
          </Button>

          <Button
            onClick={handleNext}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium h-9 sm:h-10 px-4 sm:px-6 text-sm"
          >
            {currentStep === onboardingSteps.length - 1 ? (
              "Get Started"
            ) : (
              <>
                <span className="hidden sm:inline">Next</span>
                <span className="sm:hidden">Next</span>
                <ChevronRight className="w-4 h-4 ml-1" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
