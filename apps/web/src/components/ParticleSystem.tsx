import { useEffect, useRef } from "react";

type ParticleMode = "snow" | "rain" | "confetti" | "sparkles" | "matrix";

type ParticleBurst = {
  key: number;
  mode?: ParticleMode;
  count?: number;
  intensity?: number;
  origin?: { x: number; y: number };
};

interface ParticleSystemProps {
  mode: ParticleMode;
  active: boolean;
  intensity?: number; // 0 to 1 (or higher for extreme)
  burst?: ParticleBurst | null;
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  vRotation: number;
  life: number;
  maxLife: number;
  shape: "square" | "circle" | "char";
  char?: string;
}

const MATRIX_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export default function ParticleSystem({ mode, active, intensity = 0.5, burst, className }: ParticleSystemProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const frameRef = useRef<number>(0);
  const lastBurstKeyRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener("resize", handleResize);

    const resolveOrigin = (origin: ParticleBurst["origin"] | undefined) => {
      if (!origin) return { x: width / 2, y: height / 2 };
      const ox = Number.isFinite(origin.x) ? origin.x : 0.5;
      const oy = Number.isFinite(origin.y) ? origin.y : 0.5;
      return { x: clamp01(ox) * width, y: clamp01(oy) * height };
    };

    const createParticle = (overrideMode?: ParticleMode, origin?: ParticleBurst["origin"], burstSpawn = false): Particle => {
      const currentMode = overrideMode ?? mode;
      const center = resolveOrigin(origin);
      let x = Math.random() * width;
      let y = currentMode === "rain" || currentMode === "matrix" ? -20 : currentMode === "confetti" ? height : Math.random() * height;
      
      let vx = 0;
      let vy = 0;
      let size = 0;
      let color = "#FFF";
      let life = 100;
      let shape: Particle["shape"] = "square";
      let char: string | undefined;

      if (currentMode === "snow") {
        vx = (Math.random() - 0.5) * 0.5;
        vy = Math.random() * 0.5 + 0.2;
        size = Math.random() * 2 + 1;
        color = `rgba(255, 255, 255, ${Math.random() * 0.5 + 0.1})`;
        life = 1000; // Long life
      } else if (currentMode === "rain") {
        vx = (Math.random() - 0.5) * 0.2;
        vy = Math.random() * 10 + 5;
        size = Math.random() * 1 + 0.5;
        color = `rgba(100, 200, 255, ${Math.random() * 0.3 + 0.1})`;
        life = 200;
        shape = "circle"; // elongated later
      } else if (currentMode === "matrix") {
        vx = 0;
        vy = Math.random() * 5 + 2;
        size = Math.random() * 14 + 10;
        // Green matrix code
        color = `rgba(0, 255, 70, ${Math.random() * 0.8 + 0.2})`; 
        life = 300;
        shape = "char";
        char = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
      } else if (currentMode === "confetti") {
        // Explode from bottom or center
        const centerX = width / 2;
        const centerY = height / 2;
        const baseX = burstSpawn ? center.x : centerX;
        const baseY = burstSpawn ? center.y : centerY;
        x = baseX + (Math.random() - 0.5) * 100; // Start near center
        y = baseY + (Math.random() - 0.5) * 100;
        
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * (burstSpawn ? 18 : 15) + (burstSpawn ? 8 : 5);
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
        
        size = Math.random() * 8 + 4;
        const colors = ["#ef4444", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ffffff"];
        color = colors[Math.floor(Math.random() * colors.length)];
        life = (burstSpawn ? 120 : 100) + Math.random() * 60;
        shape = Math.random() > 0.5 ? "square" : "circle";
      } else if (currentMode === "sparkles") {
        vx = (Math.random() - 0.5) * 2;
        vy = (Math.random() - 0.5) * 2;
        size = Math.random() * 3 + 1;
        color = `rgba(234, 179, 8, ${Math.random()})`; // Gold
        life = (burstSpawn ? 70 : 40) + Math.random() * 30;
        shape = "circle";
        if (burstSpawn) {
          x = center.x + (Math.random() - 0.5) * 160;
          y = center.y + (Math.random() - 0.5) * 120;
          vx = (Math.random() - 0.5) * 6;
          vy = (Math.random() - 0.5) * 6;
        }
      }

      return {
        x,
        y,
        vx,
        vy,
        size,
        color,
        rotation: Math.random() * 360,
        vRotation: (Math.random() - 0.5) * 10,
        life,
        maxLife: life,
        shape,
        char
      };
    };

    const update = () => {
      ctx.clearRect(0, 0, width, height);

      if (!active && particlesRef.current.length === 0) return;

      // Spawn new particles
      if (active) {
        const spawnCount = Math.floor(intensity * (mode === "confetti" ? 2 : mode === "matrix" ? 1 : 1));
        if (Math.random() < intensity) {
           for(let i=0; i<spawnCount + 1; i++) {
               particlesRef.current.push(createParticle());
           }
        }
      }

      // Update and draw existing particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.life--;
        
        if (p.life <= 0) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vRotation;

        // Gravity/Friction adjustments
        if (mode === "confetti") {
          p.vy += 0.2; // Gravity
          p.vx *= 0.96; // Air resistance
          p.vy *= 0.96;
        } else if (mode === "sparkles") {
            p.vx *= 0.9;
            p.vy *= 0.9;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = p.life / p.maxLife;

        if (p.shape === "square") {
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        } else if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
        } else if (p.shape === "char" && p.char) {
            ctx.font = `${p.size}px monospace`;
            ctx.fillStyle = p.color;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            // Randomly flip character sometimes for glitch effect
            if (Math.random() > 0.95) {
               ctx.fillStyle = "#FFF";
            }
            ctx.fillText(p.char, 0, 0);
        }

        ctx.restore();
      }

      frameRef.current = requestAnimationFrame(update);
    };

    if (burst && burst.key !== lastBurstKeyRef.current) {
      const burstMode = burst.mode ?? mode;
      const burstIntensity = typeof burst.intensity === "number" ? Math.max(0, burst.intensity) : intensity;
      const baseCount = Math.floor(18 + burstIntensity * 36);
      const burstCount = Math.max(6, Math.floor(burst.count ?? baseCount));
      for (let i = 0; i < burstCount; i += 1) {
        particlesRef.current.push(createParticle(burstMode, burst.origin, true));
      }
      lastBurstKeyRef.current = burst.key;
    }

    update();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(frameRef.current);
    };
  }, [mode, active, intensity, burst?.key]);

  return <canvas ref={canvasRef} className={className} style={{ pointerEvents: 'none', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />;
}
