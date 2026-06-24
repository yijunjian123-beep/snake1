import { burstUnit, clamp, easeOutCubic } from "./renderCanvasUtils";
import type { RenderQualityState } from "./renderQuality";
import type { Particle, RewardBurst } from "./renderState";

interface RenderFxOptions {
  quality: RenderQualityState;
}

export function drawRewardBursts(
  context: CanvasRenderingContext2D,
  rewardBursts: readonly RewardBurst[],
  options: RenderFxOptions,
): void {
  if (rewardBursts.length === 0) {
    return;
  }

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  const glowScale = options.quality.glowScale;

  for (const rewardBurst of rewardBursts) {
    const progress = clamp(1 - rewardBurst.life / rewardBurst.maxLife, 0, 1);
    const flashProgress = clamp(progress / 0.25, 0, 1);
    const ringProgress = clamp((progress - 0.11) / 0.61, 0, 1);
    const bladeProgress = clamp((progress - 0.17) / 0.83, 0, 1);
    const flashAlpha = Math.pow(1 - flashProgress, 2.1);
    const ringAlpha = Math.sin(ringProgress * Math.PI) * (1 - ringProgress * 0.12);
    const bladeAlpha = Math.pow(1 - bladeProgress, 1.24);

    if (flashAlpha > 0) {
      const flashRadius = rewardBurst.cellSize * (1.18 - flashProgress * 0.34);
      const flash = context.createRadialGradient(
        rewardBurst.x,
        rewardBurst.y,
        0,
        rewardBurst.x,
        rewardBurst.y,
        flashRadius,
      );

      flash.addColorStop(0, `rgba(255, 255, 255, ${0.94 * flashAlpha})`);
      flash.addColorStop(0.2, `rgba(219, 255, 82, ${0.72 * flashAlpha})`);
      flash.addColorStop(0.48, `rgba(0, 245, 255, ${0.28 * flashAlpha})`);
      flash.addColorStop(0.72, `rgba(255, 43, 214, ${0.08 * flashAlpha})`);
      flash.addColorStop(1, "rgba(0, 245, 255, 0)");

      context.globalAlpha = 1;
      context.fillStyle = flash;
      context.shadowColor = "#dbff52";
      context.shadowBlur = 34 * flashAlpha * glowScale;
      context.beginPath();
      context.arc(rewardBurst.x, rewardBurst.y, flashRadius * 1.22, 0, Math.PI * 2);
      context.fill();

      const starOuter = rewardBurst.cellSize * (0.96 - flashProgress * 0.18);
      const starInner = starOuter * 0.38;
      const starRotation = rewardBurst.angle + progress * 1.25;

      context.globalAlpha = 0.92 * flashAlpha;
      context.fillStyle = "#ffffff";
      context.shadowColor = "#ffffff";
      context.shadowBlur = 20 * flashAlpha * glowScale;
      context.beginPath();

      for (let point = 0; point < 16; point += 1) {
        const radius = point % 2 === 0 ? starOuter : starInner;
        const angle = starRotation + (point / 16) * Math.PI * 2;
        const x = rewardBurst.x + Math.cos(angle) * radius;
        const y = rewardBurst.y + Math.sin(angle) * radius;

        if (point === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      context.closePath();
      context.fill();
    }

    if (ringAlpha > 0) {
      const easedRing = easeOutCubic(ringProgress);
      const mainRadius = rewardBurst.cellSize * (0.85 + easedRing * 4.35);
      const cyanRadius = mainRadius * (0.93 + ringProgress * 0.04);
      const magentaRadius = mainRadius * (1.06 + ringProgress * 0.03);

      context.setLineDash([]);
      context.globalAlpha = 0.68 * ringAlpha;
      context.strokeStyle = "rgba(219, 255, 82, 0.92)";
      context.shadowColor = "#dbff52";
      context.shadowBlur = 24 * ringAlpha * glowScale;
      context.lineWidth = Math.max(1.25, rewardBurst.cellSize * (0.085 - ringProgress * 0.036));
      context.beginPath();
      context.arc(rewardBurst.x, rewardBurst.y, mainRadius, 0, Math.PI * 2);
      context.stroke();

      context.globalAlpha = 0.38 * ringAlpha;
      context.strokeStyle = "rgba(0, 245, 255, 0.88)";
      context.shadowColor = "#00f5ff";
      context.shadowBlur = 20 * ringAlpha * glowScale;
      context.lineWidth = Math.max(1, rewardBurst.cellSize * 0.042);
      context.beginPath();
      context.arc(
        rewardBurst.x,
        rewardBurst.y,
        cyanRadius,
        rewardBurst.secondaryAngle + ringProgress * 0.9,
        rewardBurst.secondaryAngle + Math.PI * 1.62 + ringProgress * 0.9,
      );
      context.stroke();

      context.globalAlpha = 0.3 * ringAlpha;
      context.strokeStyle = "rgba(255, 43, 214, 0.8)";
      context.shadowColor = "#ff2bd6";
      context.shadowBlur = 18 * ringAlpha * glowScale;
      context.beginPath();
      context.arc(
        rewardBurst.x,
        rewardBurst.y,
        magentaRadius,
        rewardBurst.secondaryAngle + Math.PI * 0.78 - ringProgress * 0.55,
        rewardBurst.secondaryAngle + Math.PI * 1.98 - ringProgress * 0.55,
      );
      context.stroke();
    }

    if (progress >= 0.17) {
      for (let index = 0; index < rewardBurst.rayCount; index += 1) {
        const lengthUnit = burstUnit(rewardBurst.seed, index + 1);
        const alphaUnit = burstUnit(rewardBurst.seed, index + 31);
        const angleJitter = (burstUnit(rewardBurst.seed, index + 61) - 0.5) * 0.28;
        const angle =
          rewardBurst.angle +
          (index / rewardBurst.rayCount) * Math.PI * 2 +
          angleJitter +
          bladeProgress * 0.08;
        const inner = rewardBurst.cellSize * (0.78 + bladeProgress * 0.58);
        const outer = rewardBurst.cellSize * (2.05 + bladeProgress * (2.25 + lengthUnit * 1.45));
        const startX = rewardBurst.x + Math.cos(angle) * inner;
        const startY = rewardBurst.y + Math.sin(angle) * inner;
        const endX = rewardBurst.x + Math.cos(angle) * outer;
        const endY = rewardBurst.y + Math.sin(angle) * outer;
        const rayAlpha = bladeAlpha * (0.24 + alphaUnit * 0.48);
        const rayHue = index % 5 === 0 ? "#ff2bd6" : index % 2 === 0 ? "#dbff52" : "#00f5ff";
        const rayGradient = context.createLinearGradient(startX, startY, endX, endY);

        rayGradient.addColorStop(0, "rgba(255, 255, 255, 0)");
        rayGradient.addColorStop(0.28, rayHue);
        rayGradient.addColorStop(1, "rgba(255, 255, 255, 0)");

        context.globalAlpha = rayAlpha;
        context.strokeStyle = rayGradient;
        context.shadowColor = rayHue;
        context.shadowBlur = 18 * rayAlpha * glowScale;
        context.lineWidth = Math.max(1, rewardBurst.cellSize * (0.036 + lengthUnit * 0.036) * (1 - bladeProgress * 0.34));
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.stroke();
      }
    }

    context.setLineDash([]);
  }

  context.restore();
}

export function drawParticles(
  context: CanvasRenderingContext2D,
  particles: readonly Particle[],
  options: RenderFxOptions,
): void {
  context.save();
  context.globalCompositeOperation = "lighter";

  for (const particle of particles) {
    const progress = clamp(particle.life / particle.maxLife, 0, 1);
    const radius = particle.radius * (0.62 + progress * 0.86);

    context.globalAlpha = progress;
    context.fillStyle = `hsl(${particle.hue} 100% ${58 + progress * 24}%)`;
    context.shadowColor = `hsl(${particle.hue} 100% 66%)`;
    context.shadowBlur = 18 * progress * options.quality.glowScale;
    context.beginPath();
    context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
    context.fill();

    context.globalAlpha = progress * 0.22;
    context.strokeStyle = `hsl(${particle.hue} 100% 72%)`;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(particle.x, particle.y);
    context.lineTo(particle.x - particle.vx * 0.028, particle.y - particle.vy * 0.028);
    context.stroke();
  }

  context.restore();
}
