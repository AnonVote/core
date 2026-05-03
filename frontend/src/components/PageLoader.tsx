import { useEffect, useRef } from "react";

export default function PageLoader() {
  const groupRef = useRef<SVGGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const SVG_NS = "http://www.w3.org/2000/svg";
    const config = {
      particleCount: 76,
      trailSpan: 0.31,
      durationMs: 5300,
      rotationDurationMs: 28000,
      pulseDurationMs: 4400,
      strokeWidth: 4.6,
      roseA: 9.2,
      roseABoost: 0.6,
      roseBreathBase: 0.72,
      roseBreathBoost: 0.28,
      roseScale: 3.25,
      point(progress: number, detailScale: number) {
        const t = progress * Math.PI * 2;
        const a = config.roseA + detailScale * config.roseABoost;
        const r =
          a *
          (config.roseBreathBase + detailScale * config.roseBreathBoost) *
          Math.cos(3 * t);
        return {
          x: 50 + Math.cos(t) * r * config.roseScale,
          y: 50 + Math.sin(t) * r * config.roseScale,
        };
      },
    };

    const group = groupRef.current;
    const path = pathRef.current;
    if (!group || !path) {
      return;
    }

    path.setAttribute("stroke-width", String(config.strokeWidth));

    // Create particles
    const particles = Array.from({ length: config.particleCount }, () => {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("fill", "currentColor");
      group.appendChild(circle);
      return circle;
    });

    function normalizeProgress(p: number) {
      return ((p % 1) + 1) % 1;
    }

    function getDetailScale(time: number) {
      const pulseProgress =
        (time % config.pulseDurationMs) / config.pulseDurationMs;
      const pulseAngle = pulseProgress * Math.PI * 2;
      return 0.52 + ((Math.sin(pulseAngle + 0.55) + 1) / 2) * 0.48;
    }

    function getRotation(time: number) {
      return (
        -((time % config.rotationDurationMs) / config.rotationDurationMs) * 360
      );
    }

    function buildPath(detailScale: number, steps = 480) {
      return Array.from({ length: steps + 1 }, (_, index) => {
        const point = config.point(index / steps, detailScale);
        return `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
      }).join(" ");
    }

    function getParticle(index: number, progress: number, detailScale: number) {
      const tailOffset = index / (config.particleCount - 1);
      const point = config.point(
        normalizeProgress(progress - tailOffset * config.trailSpan),
        detailScale,
      );
      const fade = Math.pow(1 - tailOffset, 0.56);
      return {
        x: point.x,
        y: point.y,
        radius: 0.9 + fade * 2.7,
        opacity: 0.04 + fade * 0.96,
      };
    }

    const startedAt = performance.now();
    let animationId: number;

    function render(now: number) {
      const time = now - startedAt;
      const progress = (time % config.durationMs) / config.durationMs;
      const detailScale = getDetailScale(time);
      group!.setAttribute("transform", `rotate(${getRotation(time)} 50 50)`);
      path!.setAttribute("d", buildPath(detailScale));
      particles.forEach((node, index) => {
        const particle = getParticle(index, progress, detailScale);
        node.setAttribute("cx", particle.x.toFixed(2));
        node.setAttribute("cy", particle.y.toFixed(2));
        node.setAttribute("r", particle.radius.toFixed(2));
        node.setAttribute("opacity", particle.opacity.toFixed(3));
      });
      animationId = requestAnimationFrame(render);
    }

    animationId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        backgroundColor: "var(--surface-base)",
        zIndex: 9999,
      }}
    >
      <div style={{ width: "64px", height: "64px" }}>
        <svg
          viewBox="0 0 256 256"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            width: "100%",
            height: "100%",
            color: "var(--brand-primary)",
          }}
        >
          <path
            d="M 64 128 C 64 163.346 92.654 192 128 192 L 128 256 C 57.308 256 0 198.692 0 128 Z M 192 128 C 192 163.346 220.654 192 256 192 L 256 256 C 185.308 256 128 198.692 128 128 Z M 64 0 C 64 35.346 92.654 64 128 64 L 128 128 C 57.308 128 0 70.692 0 0 Z M 192 0 C 192 35.346 220.654 64 256 64 L 256 128 C 185.308 128 128 70.692 128 0 Z"
            fill="currentColor"
          />
        </svg>
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-base)",
          color: "var(--ink-muted)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        AnonVote
      </div>
    </div>
  );
}
