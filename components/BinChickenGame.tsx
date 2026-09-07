"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface BinChickenGameProps {
  suburbName?: string;
  isSuburbReady: boolean;
  onViewSuburb: () => void;
}

interface Obstacle {
  x: number;
  topHeight: number;
  bottomHeight: number;
  hasChip: boolean;
  chipCollected: boolean;
  passed: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
}

export function BinChickenIcon({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* Body */}
      <ellipse cx="28" cy="35" rx="17" ry="11" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1.5" />
      {/* Wing detail */}
      <path d="M20 33 C25 38 32 38 36 33" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
      {/* Black tail plumes */}
      <path d="M12 34 L5 32 L7 37 L5 41 L13 39 Z" fill="#0F172A" />
      {/* Curved Black Neck */}
      <path d="M40 33 Q48 25 43 17" stroke="#0F172A" strokeWidth="6" strokeLinecap="round" />
      {/* Head */}
      <circle cx="44" cy="17" r="5" fill="#0F172A" />
      {/* Signature curved scythe beak */}
      <path d="M47 18 Q55 21 59 31" stroke="#0F172A" strokeWidth="3" strokeLinecap="round" />
      {/* Eye */}
      <circle cx="45" cy="15.5" r="1.3" fill="#38BDF8" />
      {/* Spindly Legs */}
      <path d="M26 46 L24 57 M32 46 L32 57 M21 57 L25 57 M30 57 L34 57" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function BinChickenGame({
  suburbName,
  isSuburbReady,
  onViewSuburb,
}: BinChickenGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [gameState, setGameState] = useState<"idle" | "playing" | "gameover">("idle");
  const [soundEnabled, setSoundEnabled] = useState(false);

  // Audio Context (initialized on first user action to comply with browser autoplay policy)
  const audioCtxRef = useRef<AudioContext | null>(null);

  function playSound(type: "flap" | "score" | "crash") {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      if (type === "flap") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(280, now);
        osc.frequency.exponentialRampToValueAtTime(540, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === "score") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(587, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.06); // A5
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === "crash") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.25);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      }
    } catch {
      // Audio not supported or blocked
    }
  }

  // Load high score
  useEffect(() => {
    try {
      const saved = localStorage.getItem("suburb_bin_chicken_high");
      if (saved) setHighScore(parseInt(saved, 10) || 0);
    } catch {
      // ignore storage error
    }
  }, []);

  // Game physics parameters
  const gameStateRef = useRef({
    state: "idle" as "idle" | "playing" | "gameover",
    score: 0,
    birdY: 130,
    birdVelocity: 0,
    birdAngle: 0,
    obstacles: [] as Obstacle[],
    particles: [] as Particle[],
    bgOffset: 0,
    lastObstacleTime: 0,
    wingAngle: 0,
    gravity: 0.11,
    jumpStrength: -3.2,
    gapSize: 130,
  });

  const jump = useCallback(() => {
    const g = gameStateRef.current;
    if (g.state === "idle") {
      g.state = "playing";
      g.score = 0;
      g.birdY = 130;
      g.birdVelocity = g.jumpStrength;
      g.obstacles = [];
      g.particles = [];
      setScore(0);
      setGameState("playing");
      playSound("flap");
    } else if (g.state === "playing") {
      g.birdVelocity = g.jumpStrength;
      playSound("flap");
    } else if (g.state === "gameover") {
      g.state = "playing";
      g.score = 0;
      g.birdY = 130;
      g.birdVelocity = g.jumpStrength;
      g.obstacles = [];
      g.particles = [];
      setScore(0);
      setGameState("playing");
      playSound("flap");
    }
  }, [soundEnabled]);

  // If suburb is ready and user has not started playing, auto-reveal after a brief moment
  useEffect(() => {
    if (isSuburbReady && gameState === "idle") {
      const timer = setTimeout(() => {
        onViewSuburb();
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [isSuburbReady, gameState, onViewSuburb]);

  // Keyboard handler (Space / ArrowUp)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        jump();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [jump]);

  // Canvas loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let lastTime = performance.now();

    // Responsive setup
    const width = 360;
    const height = 280;
    canvas.width = width;
    canvas.height = height;

    function spawnObstacle() {
      const g = gameStateRef.current;
      const minHeight = 40;
      const maxHeight = height - g.gapSize - minHeight - 30;
      const topHeight = Math.floor(Math.random() * (maxHeight - minHeight + 1)) + minHeight;
      const bottomHeight = height - topHeight - g.gapSize - 20;

      g.obstacles.push({
        x: width + 20,
        topHeight,
        bottomHeight,
        hasChip: Math.random() < 0.5,
        chipCollected: false,
        passed: false,
      });
    }

    function createParticles(x: number, y: number, color: string, count = 6) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2.5 + 1;
        gameStateRef.current.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          size: Math.random() * 3.5 + 2,
          life: 1,
        });
      }
    }

    function drawBird(x: number, y: number, angle: number, wingAngle: number) {
      if (!ctx) return;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);

      // Body (White oval)
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 11, 0, 0, Math.PI * 2);
      ctx.fill();

      // Black neck & head
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.ellipse(13, -6, 7, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      // Curved Ibis Beak (The signature bin chicken feature)
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 3.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(18, -4);
      ctx.quadraticCurveTo(28, -2, 32, 10);
      ctx.stroke();

      // Eye
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.arc(15, -8, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(15.5, -8, 1, 0, Math.PI * 2);
      ctx.fill();

      // Flapping Wing
      ctx.save();
      ctx.translate(-2, 0);
      ctx.rotate(wingAngle);
      ctx.fillStyle = "#f1f5f9";
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 6, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Black tail feathers
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.moveTo(-13, -2);
      ctx.lineTo(-21, 2);
      ctx.lineTo(-19, 7);
      ctx.lineTo(-11, 4);
      ctx.closePath();
      ctx.fill();

      // Spindly legs
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-2, 10);
      ctx.lineTo(-3, 17);
      ctx.lineTo(1, 18);
      ctx.stroke();

      ctx.restore();
    }

    function drawWheelieBin(x: number, y: number, h: number, isTop: boolean) {
      if (!ctx) return;
      const binWidth = 38;

      ctx.save();
      if (isTop) {
        // Overhead powerline / street pole obstacle
        ctx.fillStyle = "#475569";
        ctx.fillRect(x + 15, 0, 8, h);
        // Crossbar
        ctx.fillStyle = "#64748b";
        ctx.fillRect(x + 4, h - 14, 30, 8);
        // Dangling wire
        ctx.strokeStyle = "#334155";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 6, h - 6);
        ctx.lineTo(x + 19, h);
        ctx.lineTo(x + 32, h - 6);
        ctx.stroke();
      } else {
        // Classic Aussie Wheelie Bin (Council Dark Green body with Yellow recycling or Red lid)
        const lidColor = ((Math.floor(x / 100) % 2 === 0)) ? "#eab308" : "#ef4444"; // Yellow or Red lid

        // Wheelie bin body
        ctx.fillStyle = "#14532d"; // Council green
        ctx.beginPath();
        ctx.moveTo(x + 3, y + 10);
        ctx.lineTo(x + binWidth - 3, y + 10);
        ctx.lineTo(x + binWidth - 6, y + h);
        ctx.lineTo(x + 6, y + h);
        ctx.closePath();
        ctx.fill();

        // Bin ribbed lines
        ctx.strokeStyle = "#166534";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 8, y + 25);
        ctx.lineTo(x + binWidth - 8, y + 25);
        ctx.moveTo(x + 9, y + 42);
        ctx.lineTo(x + binWidth - 9, y + 42);
        ctx.stroke();

        // Wheel at bottom
        ctx.fillStyle = "#1e293b";
        ctx.beginPath();
        ctx.arc(x + 8, y + h - 5, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#94a3b8";
        ctx.beginPath();
        ctx.arc(x + 8, y + h - 5, 2, 0, Math.PI * 2);
        ctx.fill();

        // Lid
        ctx.fillStyle = lidColor;
        ctx.beginPath();
        ctx.roundRect(x, y + 2, binWidth, 9, 3);
        ctx.fill();

        // Lid handle
        ctx.fillStyle = "#334155";
        ctx.fillRect(x + 12, y, 14, 3);
      }
      ctx.restore();
    }

    function drawChip(x: number, y: number) {
      if (!ctx) return;
      ctx.save();
      // Floating hot chip 🍟
      ctx.translate(x, y);
      ctx.rotate(0.3);
      ctx.fillStyle = "#facc15";
      ctx.strokeStyle = "#ca8a04";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(-4, -10, 8, 20, 2);
      ctx.fill();
      ctx.stroke();
      // Sparkle
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(-1, -6, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function gameLoop(now: number) {
      if (!ctx) return;
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const g = gameStateRef.current;

      // UPDATE
      if (g.state === "playing") {
        g.birdVelocity = Math.min(g.birdVelocity + g.gravity, 3.2);
        g.birdY += g.birdVelocity;
        g.birdAngle = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, g.birdVelocity * 0.08));
        g.wingAngle = Math.sin(now * 0.012) * 0.4;
        g.bgOffset = (g.bgOffset + 1.0) % width;

        // Spawn obstacles with generous spacing
        if (now - g.lastObstacleTime > 2600) {
          spawnObstacle();
          g.lastObstacleTime = now;
        }

        // Ground / Ceiling collision
        if (g.birdY > height - 32 || g.birdY < 12) {
          g.state = "gameover";
          setGameState("gameover");
          playSound("crash");
          createParticles(70, g.birdY, "#ef4444", 12);
        }

        // Update obstacles - gentler scroll speed
        const birdX = 70;
        const birdRadius = 7.5;

        for (let i = g.obstacles.length - 1; i >= 0; i--) {
          const obs = g.obstacles[i];
          obs.x -= 1.35;

          // Score when passed
          if (!obs.passed && obs.x + 38 < birdX) {
            obs.passed = true;
            g.score += 1;
            setScore(g.score);
            playSound("score");

            if (g.score > highScore) {
              setHighScore(g.score);
              try {
                localStorage.setItem("suburb_bin_chicken_high", String(g.score));
              } catch {
                // ignore
              }
            }
          }

          // Hot chip collision
          if (obs.hasChip && !obs.chipCollected) {
            const chipX = obs.x + 19;
            const chipY = obs.topHeight + g.gapSize / 2;
            const dist = Math.hypot(chipX - birdX, chipY - g.birdY);
            if (dist < 22) {
              obs.chipCollected = true;
              g.score += 3;
              setScore(g.score);
              playSound("score");
              createParticles(chipX, chipY, "#facc15", 10);
            }
          }

          // Bin collision with generous edge margin
          const binLeft = obs.x;
          const binRight = obs.x + 38;
          const topBottom = obs.topHeight;
          const bottomTop = height - obs.bottomHeight - 20;

          if (birdX + birdRadius > binLeft && birdX - birdRadius < binRight) {
            if (g.birdY - birdRadius < topBottom - 3 || g.birdY + birdRadius > bottomTop + 3) {
              g.state = "gameover";
              setGameState("gameover");
              playSound("crash");
              createParticles(birdX, g.birdY, "#cbd5e1", 12);
            }
          }

          // Remove off-screen obstacles
          if (obs.x < -50) {
            g.obstacles.splice(i, 1);
          }
        }
      } else if (g.state === "idle") {
        // Gentle hovering in place
        g.birdY = 130 + Math.sin(now * 0.004) * 8;
        g.wingAngle = Math.sin(now * 0.008) * 0.25;
        g.birdAngle = 0;
      }

      // Update particles
      for (let i = g.particles.length - 1; i >= 0; i--) {
        const p = g.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= dt * 2.2;
        if (p.life <= 0) g.particles.splice(i, 1);
      }

      // DRAW
      ctx.clearRect(0, 0, width, height);

      // Sky gradient
      const skyGradient = ctx.createLinearGradient(0, 0, 0, height);
      skyGradient.addColorStop(0, "#bae6fd"); // soft sky blue
      skyGradient.addColorStop(0.7, "#e0f2fe");
      skyGradient.addColorStop(1, "#f1f5f9");
      ctx.fillStyle = skyGradient;
      ctx.fillRect(0, 0, width, height);

      // Distant suburban skyline / clouds
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      ctx.beginPath();
      ctx.arc(60 - (g.bgOffset * 0.3) % width, 45, 22, 0, Math.PI * 2);
      ctx.arc(85 - (g.bgOffset * 0.3) % width, 40, 26, 0, Math.PI * 2);
      ctx.arc(110 - (g.bgOffset * 0.3) % width, 45, 20, 0, Math.PI * 2);
      ctx.arc(240 - (g.bgOffset * 0.3) % width, 60, 24, 0, Math.PI * 2);
      ctx.arc(270 - (g.bgOffset * 0.3) % width, 55, 28, 0, Math.PI * 2);
      ctx.fill();

      // Footpath & Road at bottom
      ctx.fillStyle = "#94a3b8"; // Footpath concrete
      ctx.fillRect(0, height - 26, width, 8);
      ctx.fillStyle = "#475569"; // Asphalt road
      ctx.fillRect(0, height - 18, width, 18);
      // Road dash line
      ctx.fillStyle = "#fef08a";
      for (let rx = 0; rx < width; rx += 36) {
        ctx.fillRect((rx - (g.bgOffset % 36)), height - 10, 20, 2.5);
      }

      // Obstacles
      for (const obs of g.obstacles) {
        drawWheelieBin(obs.x, 0, obs.topHeight, true);
        drawWheelieBin(obs.x, height - obs.bottomHeight - 20, obs.bottomHeight, false);
        if (obs.hasChip && !obs.chipCollected) {
          drawChip(obs.x + 19, obs.topHeight + g.gapSize / 2 + Math.sin(now * 0.008) * 4);
        }
      }

      // Particles
      for (const p of g.particles) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Bird
      drawBird(70, g.birdY, g.birdAngle, g.wingAngle);

      // Score in top corner while playing
      if (g.state === "playing" || g.state === "gameover") {
        ctx.fillStyle = "#0f172a";
        ctx.font = "900 20px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`🍟 ${g.score}`, 16, 32);
      }

      animId = requestAnimationFrame(gameLoop);
    }

    animId = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(animId);
  }, [highScore]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-3 sm:p-4 gap-3 select-none">
      {/* Top Notification if Suburb is Ready */}
      {isSuburbReady ? (
        <div className="w-full max-w-sm flex items-center justify-between p-2.5 px-3.5 bg-emerald-500 text-white rounded-xl shadow-lg animate-bounce transition-all">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold truncate">
            <span>✨</span>
            <span className="truncate">{suburbName || "Suburb"} scouted!</span>
          </div>
          <button
            onClick={onViewSuburb}
            className="px-3 py-1 bg-white text-emerald-700 text-xs font-black rounded-lg hover:bg-emerald-50 active:scale-95 transition-transform shrink-0 cursor-pointer shadow-sm"
          >
            View ➔
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between w-full max-w-sm px-1">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
            Scouting {suburbName ? `"${suburbName}"` : "suburb"}…
          </span>
          <span className="text-xs font-bold text-slate-400">
            Best: 🍟 {highScore}
          </span>
        </div>
      )}

      {/* Game Canvas Container */}
      <div className="relative w-full max-w-sm aspect-[4/3] rounded-2xl overflow-hidden shadow-md border border-sky-200 bg-sky-100 flex items-center justify-center">
        <canvas
          ref={canvasRef}
          onClick={jump}
          onTouchStart={(e) => {
            e.preventDefault();
            jump();
          }}
          className="w-full h-full cursor-pointer block touch-none"
        />

        {/* Audio toggle button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSoundEnabled((prev) => !prev);
          }}
          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/70 hover:bg-white text-slate-600 text-xs flex items-center justify-center shadow-xs cursor-pointer backdrop-blur-xs"
          title={soundEnabled ? "Mute audio" : "Enable sound effects"}
        >
          {soundEnabled ? "🔊" : "🔇"}
        </button>

        {/* Overlay for Idle State */}
        {gameState === "idle" && (
          <div
            onClick={jump}
            className="absolute inset-0 bg-slate-900/25 backdrop-blur-[2px] flex flex-col items-center justify-center text-center p-4 cursor-pointer"
          >
            <BinChickenIcon className="w-14 h-14 mb-1 drop-shadow-md" />
            <h3 className="text-white font-black text-lg tracking-tight drop-shadow-sm">
              Flappy Bin Chicken
            </h3>
            <p className="text-white/90 text-xs mt-1 font-medium max-w-[14rem] leading-relaxed drop-shadow-xs">
              Dodge council wheelie bins & snag hot chips while you wait!
            </p>
            <div className="mt-3 px-4 py-1.5 bg-white/90 hover:bg-white text-slate-800 text-xs font-bold rounded-xl shadow-md active:scale-95 transition-transform">
              Tap / Space to Flap
            </div>
          </div>
        )}

        {/* Overlay for Game Over State */}
        {gameState === "gameover" && (
          <div
            onClick={jump}
            className="absolute inset-0 bg-slate-900/35 backdrop-blur-[2px] flex flex-col items-center justify-center text-center p-4 cursor-pointer animate-in fade-in duration-200"
          >
            <span className="text-2xl mb-1">🗑️</span>
            <h3 className="text-white font-black text-base drop-shadow-sm">
              Bin Wiped Out!
            </h3>
            <p className="text-white/90 text-xs font-semibold mt-0.5">
              Score: 🍟 {score} {score >= highScore && score > 0 ? "🎉 NEW BEST!" : ""}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  jump();
                }}
                className="px-3.5 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-900 text-xs font-bold rounded-xl shadow-md active:scale-95 transition-transform"
              >
                Try Again
              </button>
              {isSuburbReady && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewSuburb();
                  }}
                  className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold rounded-xl shadow-md active:scale-95 transition-transform"
                >
                  View Suburb ➔
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Suburb ready quick jump footer button */}
      {isSuburbReady ? (
        <button
          onClick={onViewSuburb}
          className="w-full max-w-sm py-2 px-4 rounded-xl font-bold text-sm text-white bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-md active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <span>Explore {suburbName}</span>
          <span>➔</span>
        </button>
      ) : (
        <p className="text-[11px] text-slate-400 text-center">
          Tap canvas or press Spacebar to flap • Your suburb loads in the background
        </p>
      )}
    </div>
  );
}
