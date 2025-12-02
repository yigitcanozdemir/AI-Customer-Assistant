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
  Shield,
  User,
  Globe,
  Mail,
  Code2,
} from "lucide-react";
import { EXTERNAL_LINKS, TECH_STACK } from "@/lib/external-links";

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const onboardingSteps = [
  {
    title: "AI Shopping Assistant",
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
  {
    title: "Safety & Moderation System",
    description: "Explore how AI detects and handles inappropriate usage in real-time.",
    icon: Shield,
    features: [
      "Test prompt injection detection with sample attacks",
      "Try off-topic questions to see context validation",
      "Experience abusive language filtering and warnings",
      "Chat locks after two violations to demonstrate security",
      "View flagged sessions in the demo admin panel",
      "System also flags insufficient context without locking chat",
    ],
  },
  {
    title: "About This Project and Me",
    description: "A production-ready demonstration of AI-powered customer service using RAG pipelines and LLM orchestration.",
    icon: User,
    features: [],
    isAboutPage: true,
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

          {step.isAboutPage ? (
            <div className="space-y-6">
              <p className="text-sm text-foreground leading-relaxed">
                Hey, I am Yiğit Can, an AI Engineer helping startups and businesses turn AI ideas into production-ready systems.
                My work focuses on RAG pipelines, LLM orchestration, and agentic workflows that support real operations.
                If you&apos;re looking to bring AI into real operations, I&apos;d be glad to talk about how these systems could help move your business forward.
              </p>

              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <Button
                  variant="outline"
                  className="border-primary/30 hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors h-auto py-2.5 px-3"
                  onClick={() => window.open(EXTERNAL_LINKS.website, '_blank')}
                >
                  <div className="flex flex-col items-center text-center space-y-1">
                    <Globe className="w-4 h-4" />
                    <span className="text-xs font-medium">Website</span>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="border-primary/30 hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors h-auto py-2.5 px-3"
                  onClick={() => window.open(EXTERNAL_LINKS.linkedin, '_blank')}
                >
                  <div className="flex flex-col items-center text-center space-y-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                    </svg>
                    <span className="text-xs font-medium">LinkedIn</span>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="border-primary/30 hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors h-auto py-2.5 px-3"
                  onClick={() => window.open(EXTERNAL_LINKS.github, '_blank')}
                >
                  <div className="flex flex-col items-center text-center space-y-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                    <span className="text-xs font-medium">GitHub</span>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="border-primary/30 hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-colors h-auto py-2.5 px-3"
                  onClick={() => window.open(`mailto:${EXTERNAL_LINKS.email}`)}
                >
                  <div className="flex flex-col items-center text-center space-y-1">
                    <Mail className="w-4 h-4" />
                    <span className="text-xs font-medium">Email</span>
                  </div>
                </Button>
              </div>

              <div className="pt-4 border-t border-border">
                <div className="flex items-center space-x-2 mb-3">
                  <Code2 className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Tech Stack</h3>
                </div>

                <div className="space-y-2.5">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Frontend</p>
                    <div className="flex flex-wrap gap-1.5">
                      {TECH_STACK.frontend.map((tech) => (
                        <span key={tech} className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded">
                          {tech}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Backend</p>
                    <div className="flex flex-wrap gap-1.5">
                      {TECH_STACK.backend.map((tech) => (
                        <span key={tech} className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded">
                          {tech}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">AI & Deployment</p>
                    <div className="flex flex-wrap gap-1.5">
                      {[...TECH_STACK.ai, ...TECH_STACK.deployment].map((tech) => (
                        <span key={tech} className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded">
                          {tech}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
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
          )}
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
