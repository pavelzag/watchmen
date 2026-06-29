"use client";

import { useEffect } from "react";

export default function DemoAutoSubmit() {
  useEffect(() => {
    (document.getElementById("demo-enter-form") as HTMLFormElement | null)?.requestSubmit();
  }, []);

  return null;
}
