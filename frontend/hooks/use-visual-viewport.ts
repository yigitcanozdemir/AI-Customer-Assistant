"use client";

import { useEffect, useState } from "react";

export function useVisualViewport() {
  const [viewport, setViewport] = useState({ height: 0, keyboardInset: 0 });

  useEffect(() => {
    const update = () => {
      const visualViewport = window.visualViewport;
      const height = visualViewport?.height ?? window.innerHeight;
      setViewport({
        height,
        keyboardInset: Math.max(window.innerHeight - height, 0),
      });
    };

    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return viewport;
}
