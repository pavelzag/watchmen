"use client";

import { useEffect, useState } from "react";
import SplashScreen from "./SplashScreen";
import KeyboardShortcutsModal from "./KeyboardShortcutsModal";

const SESSION_KEY = "wm_splash_shown";

export default function PostLoginSplash({ showShortcutModal = false }: { showShortcutModal?: boolean }) {
  const [show, setShow] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    if (!sessionStorage.getItem(SESSION_KEY)) {
      sessionStorage.setItem(SESSION_KEY, "1");
      setShow(true);
    }
  }, []);

  return (
    <>
      {show && (
        <SplashScreen
          mode="signin"
          onDone={() => {
            setShow(false);
            if (showShortcutModal) setShowShortcuts(true);
          }}
        />
      )}
      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </>
  );
}
