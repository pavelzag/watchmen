"use client";

import { createContext, useContext } from "react";

const DemoModeContext = createContext(false);

export function DemoModeProvider({
  demoMode,
  children,
}: {
  demoMode: boolean;
  children: React.ReactNode;
}) {
  return <DemoModeContext.Provider value={demoMode}>{children}</DemoModeContext.Provider>;
}

export function useDemoMode() {
  return useContext(DemoModeContext);
}
