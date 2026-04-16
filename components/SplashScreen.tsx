"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";

const MATRIX_CHARS = "アイウエオカキクケコサシスセソタチツテトナニヌネノ01100110$#@!%&*01001101ABCDEF><|{}[]";

const STATUS_SIGNIN = [
  "INITIALIZING WATCHMEN v0.4.0...",
  "LOADING SECURITY MODULES...",
  "ESTABLISHING ENCRYPTED CHANNEL...",
  "CONNECTING TO GCP / AWS APIS...",
  "LOADING IAM POLICY ENGINE...",
  "SCANNING INFRASTRUCTURE TOPOLOGY...",
  "CALIBRATING COMPLIANCE ENGINE...",
  "LOADING FINDINGS DATABASE...",
  "VERIFYING USER CREDENTIALS...",
  "SETTING UP SECURE CONTEXT...",
  "ACCESS GRANTED",
];

const STATUS_SIGNOUT = [
  "INITIATING SECURE LOGOUT SEQUENCE...",
  "FLUSHING SESSION TOKENS...",
  "CLEARING CREDENTIAL CACHE...",
  "REVOKING TEMPORARY ACCESS GRANTS...",
  "CLOSING ENCRYPTED API CHANNELS...",
  "PURGING LOCAL KEY STORES...",
  "WIPING MEMORY BUFFERS...",
  "UNREGISTERING CLOUD HOOKS...",
  "TERMINATING BACKGROUND WORKERS...",
  "ZEROING SENSITIVE DATA...",
  "SESSION TERMINATED",
];

function randomHex(bytes = 8) {
  return Array.from({ length: bytes }, () =>
    Math.floor(Math.random() * 0xff).toString(16).padStart(2, "0")
  ).join(" ");
}

export default function SplashScreen({
  mode = "signin",
  onDone,
}: {
  mode?: "signin" | "signout";
  onDone?: () => void;
}) {
  const STATUS_LINES = mode === "signout" ? STATUS_SIGNOUT : STATUS_SIGNIN;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusIdx, setStatusIdx] = useState(0);
  const [glitch, setGlitch] = useState(false);
  const [glitchSlice, setGlitchSlice] = useState({ top: 30, height: 10, offset: 0 });
  const [noiseLines, setNoiseLines] = useState<{ top: number; left: number; w: number; opacity: number }[]>([]);
  const [hexRows, setHexRows] = useState<string[]>([]);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  /* ── Matrix rain ────────────────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const fontSize = 13;
    const cols = Math.floor(window.innerWidth / fontSize);
    const drops: number[] = Array.from({ length: cols }, () => Math.random() * -80);

    let raf: number;
    let lastTime = 0;
    const fps = 24;
    const interval = 1000 / fps;

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      if (time - lastTime < interval) return;
      lastTime = time;

      ctx.fillStyle = "rgba(0,0,0,0.06)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < drops.length; i++) {
        const bright = Math.random();
        const alpha = bright > 0.97 ? 1 : bright > 0.6 ? 0.55 : 0.2;
        ctx.fillStyle = `rgba(0, 255, 65, ${alpha})`;
        ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
        const char = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
        ctx.fillText(char, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  /* ── Progress, glitch, noise ────────────────────────────────────────── */
  useEffect(() => {
    let p = 0;

    // Clear the post-login splash flag so it re-shows on next login
    if (mode === "signout") sessionStorage.removeItem("wm_splash_shown");

    // Seed initial hex rows now that we're on the client
    setHexRows(Array.from({ length: 5 }, () => randomHex(8)));

    // Hex dump refresher
    const hexTimer = setInterval(() => {
      setHexRows(Array.from({ length: 5 }, () => randomHex(8)));
    }, 120);

    // Horizontal noise lines
    const noiseTimer = setInterval(() => {
      setNoiseLines(
        Array.from({ length: Math.floor(Math.random() * 5) + 1 }, () => ({
          top: Math.random() * 100,
          left: Math.random() * 40,
          w: Math.random() * 55 + 10,
          opacity: Math.random() * 0.35 + 0.05,
        }))
      );
      setTimeout(() => setNoiseLines([]), 80);
    }, 350);

    // Glitch bursts
    const glitchTimer = setInterval(() => {
      setGlitchSlice({
        top: Math.random() * 70 + 5,
        height: Math.random() * 12 + 3,
        offset: (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 10 + 4),
      });
      setGlitch(true);
      setTimeout(() => setGlitch(false), 120);
    }, 600);

    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;

    // Progress counter — ~4 s to reach 100%, then 1.2 s pause, then 1 s fade = ~6 s total
    const progressTimer = setInterval(() => {
      p += Math.random() * 1.8 + 0.5;   // avg ≈ 1.4 per tick @ 70 ms → ~5 ticks/s → ~14%/s → ~7 s raw; clamp gives ≈4 s
      if (p >= 100) {
        p = 100;
        clearInterval(progressTimer);
        clearInterval(noiseTimer);
        clearInterval(glitchTimer);
        clearInterval(hexTimer);
        setStatusIdx(STATUS_LINES.length - 1);
        fadeTimer = setTimeout(() => setFading(true), 1200);
        doneTimer = setTimeout(() => {
          setVisible(false);
          onDoneRef.current?.();
        }, 2200);
        return;
      }
      setProgress(Math.min(Math.round(p), 100));
      const idx = Math.floor((p / 100) * (STATUS_LINES.length - 2));
      setStatusIdx(Math.min(idx, STATUS_LINES.length - 2));
    }, 70);

    return () => {
      clearInterval(progressTimer);
      clearInterval(noiseTimer);
      clearInterval(glitchTimer);
      clearInterval(hexTimer);
      if (fadeTimer) clearTimeout(fadeTimer);
      if (doneTimer) clearTimeout(doneTimer);
    };
  }, [STATUS_LINES.length, mode]);

  if (!visible) return null;

  const isAccessGranted = statusIdx === STATUS_LINES.length - 1;

  return (
    <>
      <style>{`
        @keyframes wm-scan {
          0%   { top: -4px; opacity: 0; }
          5%   { opacity: 1; }
          95%  { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes wm-flicker {
          0%,89%,91%,93%,100% { opacity: 1; }
          90%  { opacity: 0.75; }
          92%  { opacity: 0.9; }
        }
        @keyframes wm-pulse {
          0%,100% { filter: drop-shadow(0 0 14px #00ff4177) drop-shadow(0 0 36px #00ff4122); }
          50%     { filter: drop-shadow(0 0 24px #00ff41bb) drop-shadow(0 0 56px #00ff4144); }
        }
        @keyframes wm-cursor {
          0%,100% { opacity: 1; }
          50%     { opacity: 0; }
        }
        @keyframes wm-granted {
          0%   { letter-spacing: 2px; opacity: 0.4; }
          100% { letter-spacing: 8px; opacity: 1; }
        }
        @keyframes wm-corner-tl {
          0%   { width: 0;  height: 0; }
          50%  { width: 20px; height: 0; }
          100% { width: 20px; height: 20px; }
        }
        @keyframes wm-corner-br {
          0%   { width: 0; height: 0; }
          50%  { width: 20px; height: 0; }
          100% { width: 20px; height: 20px; }
        }
      `}</style>

      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "#000",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: fading ? 0 : 1,
          transition: fading ? "opacity 0.9s cubic-bezier(0.7,0,1,1)" : "opacity 0.2s",
          animation: "wm-flicker 5s linear infinite",
          overflow: "hidden",
        }}
      >
        {/* Matrix rain */}
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", inset: 0, opacity: 0.2, pointerEvents: "none" }}
        />

        {/* CRT scanlines */}
        <div
          style={{
            position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2,
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.22) 2px, rgba(0,0,0,0.22) 4px)",
          }}
        />

        {/* Moving scan beam */}
        <div
          style={{
            position: "absolute", left: 0, right: 0, height: "2px", zIndex: 3,
            background:
              "linear-gradient(90deg, transparent 0%, #00ff4133 20%, #00ff41bb 50%, #00ff4133 80%, transparent 100%)",
            animation: "wm-scan 3s linear infinite",
            pointerEvents: "none",
          }}
        />

        {/* Horizontal glitch noise lines */}
        {noiseLines.map((l, i) => (
          <div key={i} style={{
            position: "absolute", top: `${l.top}%`, left: `${l.left}%`,
            width: `${l.w}%`, height: "1px",
            background: `rgba(0,255,65,${l.opacity})`,
            pointerEvents: "none", zIndex: 4,
          }} />
        ))}

        {/* ── Main panel ── */}
        <div style={{ position: "relative", zIndex: 5, textAlign: "center", width: "320px" }}>

          {/* Top-left + top-right corner brackets */}
          <div style={{ position: "absolute", top: -20, left: -20, width: 20, height: 20,
            borderTop: "1px solid #00ff4166", borderLeft: "1px solid #00ff4166",
            animation: "wm-corner-tl 0.4s ease-out forwards" }} />
          <div style={{ position: "absolute", top: -20, right: -20, width: 20, height: 20,
            borderTop: "1px solid #00ff4166", borderRight: "1px solid #00ff4166",
            animation: "wm-corner-tl 0.4s ease-out forwards" }} />
          <div style={{ position: "absolute", bottom: -20, left: -20, width: 20, height: 20,
            borderBottom: "1px solid #00ff4166", borderLeft: "1px solid #00ff4166",
            animation: "wm-corner-br 0.4s ease-out forwards" }} />
          <div style={{ position: "absolute", bottom: -20, right: -20, width: 20, height: 20,
            borderBottom: "1px solid #00ff4166", borderRight: "1px solid #00ff4166",
            animation: "wm-corner-br 0.4s ease-out forwards" }} />

          {/* Logo */}
          <div style={{ position: "relative", display: "inline-block", marginBottom: 28 }}>
            <Image
              src="/watchmen-logo.png"
              alt="Watchmen"
              width={180}
              height={180}
              priority
              style={{
                animation: "wm-pulse 2.5s ease-in-out infinite",
                filter: glitch
                  ? "drop-shadow(0 0 6px #ff003366) drop-shadow(4px 0 0 #0055ff66) brightness(1.3) saturate(1.5)"
                  : undefined,
                transform: glitch ? `translateX(${glitchSlice.offset > 0 ? 3 : -3}px)` : "none",
                transition: "filter 0.06s, transform 0.06s",
              }}
            />

            {/* Glitch slice — displaced image strip */}
            {glitch && (
              <div style={{
                position: "absolute", inset: 0,
                backgroundImage: "url(/watchmen-logo.png)",
                backgroundSize: "contain",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
                clipPath: `inset(${glitchSlice.top}% 0 ${100 - glitchSlice.top - glitchSlice.height}% 0)`,
                transform: `translateX(${glitchSlice.offset}px)`,
                opacity: 0.7,
                mixBlendMode: "screen",
                filter: "hue-rotate(90deg) brightness(1.4)",
              }} />
            )}
          </div>

          {/* Status line */}
          <div style={{ marginBottom: 20, minHeight: 20 }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              letterSpacing: isAccessGranted ? undefined : 2,
              color: isAccessGranted
                ? (mode === "signout" ? "#ff3333" : "#00ff41")
                : "#00aa2b",
              textTransform: "uppercase",
              textShadow: isAccessGranted
                ? (mode === "signout" ? "0 0 12px #ff3333" : "0 0 12px #00ff41")
                : "none",
              animation: isAccessGranted ? "wm-granted 0.5s ease-out forwards" : undefined,
            }}>
              {STATUS_LINES[statusIdx]}
            </span>
            {!isAccessGranted && (
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: "#00ff41",
                animation: "wm-cursor 0.7s step-end infinite",
              }}>_</span>
            )}
          </div>

          {/* Progress bar */}
          <div style={{
            width: "100%", height: 2, background: "#0a1a0a",
            border: "1px solid #003010", position: "relative", overflow: "hidden",
            marginBottom: 8,
          }}>
            <div style={{
              position: "absolute", left: 0, top: 0, bottom: 0,
              width: `${progress}%`,
              background: "linear-gradient(90deg, #003a10 0%, #00ff41 100%)",
              boxShadow: "0 0 10px #00ff4199",
              transition: "width 0.055s linear",
            }} />
            {/* Shimmer on leading edge */}
            <div style={{
              position: "absolute", top: 0, bottom: 0, width: 8,
              left: `calc(${progress}% - 4px)`,
              background: "#ffffff44",
              filter: "blur(1px)",
              transition: "left 0.055s linear",
            }} />
          </div>

          {/* Percentage */}
          <p style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10, letterSpacing: 3,
            color: "#005c16", margin: 0,
          }}>
            {String(progress).padStart(3, "0")}%
          </p>
        </div>

        {/* Bottom-left hex dump */}
        <div style={{
          position: "absolute", bottom: 32, left: 24,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 8, color: "#002a0a", lineHeight: 1.8,
          pointerEvents: "none", zIndex: 5,
        }}>
          {hexRows.map((row, i) => <div key={i}>{`0x${(i * 0x40).toString(16).padStart(4, "0")}  ${row}`}</div>)}
        </div>

        {/* Bottom-right system info */}
        <div style={{
          position: "absolute", bottom: 32, right: 24, textAlign: "right",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 8, color: "#002a0a", lineHeight: 1.8,
          pointerEvents: "none", zIndex: 5,
        }}>
          <div>SYS: WATCHMEN-NODE-01</div>
          <div>KERNEL: 6.1.0-wm</div>
          {mode === "signout" ? (
            <>
              <div>SESSION: CLOSING ({progress}%)</div>
              <div>TOKENS: REVOKED</div>
              <div>NET: DISCONNECTING...</div>
            </>
          ) : (
            <>
              <div>UPTIME: {Math.floor(progress / 10)}s</div>
              <div>MEM: {Math.floor(progress * 4.2)}MB / 512MB</div>
              <div>NET: GCP/AWS [SECURE]</div>
            </>
          )}
        </div>

        {/* Top center title bar */}
        <div style={{
          position: "absolute", top: 20, left: 0, right: 0, textAlign: "center",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 8, letterSpacing: 5, color: "#003010",
          pointerEvents: "none", zIndex: 5,
        }}>
          // WATCHMEN CLOUD SECURITY PLATFORM //
        </div>
      </div>
    </>
  );
}
