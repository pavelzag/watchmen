"use client";

import { useEffect, useState } from "react";
import SplashScreen from "./SplashScreen";

const SESSION_KEY = "wm_splash_shown";

export default function PostLoginSplash() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!sessionStorage.getItem(SESSION_KEY)) {
      sessionStorage.setItem(SESSION_KEY, "1");
      setShow(true);
    }
  }, []);

  if (!show) return null;
  return <SplashScreen mode="signin" />;
}
