"use client";

import { animate, motion, useMotionTemplate, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";

/**
 * Flagship hero: the hardware on a multi-plane 3D studio stage.
 *
 *   rig (perspective 1400px, tilt <= 4.5deg, scroll dolly 1 -> 1.06)
 *   +- backlight      translateZ(-60px)  studio softbox glow behind the subject
 *   +- floor          translateZ(0)      contact shadow, light pool, reflection
 *   +- subject        translateZ(40px)   cutout + masked specular sweep + cylinder fill
 *
 * All motion is driven by motion values (springs, scroll), written straight to the DOM:
 * no React state changes on pointer or scroll. Fine pointers steer the light with the cursor;
 * touch devices get a scroll-driven light sweep; reduced motion renders a static lit stage.
 */

export interface HeroStageProps {
  copy: { eyebrow: string; titleLight: string; titleBold: string; subtitle: string; backdrop: string };
  cta: { label: string; href: string };
  image: { src: string; mask: string; alt: string; width: number; height: number };
}

const SPRING = { stiffness: 120, damping: 28, mass: 1.2 };
const MAX_TILT_DEG = 4.5;
const DOLLY_DISTANCE = 400;
const REVEAL = { duration: 1.1, ease: [0.16, 1, 0.3, 1] as const };

/** Light modes: static (reduced motion), cursor-lit (fine pointer), scroll-lit (touch). */
const STATIC = 0;
const CURSOR = 1;
const SCROLL = 2;

export function HeroStage({ copy, cta, image }: HeroStageProps) {
  const reduced = useReducedMotion() ?? false;
  const mode = useMotionValue<number>(reduced ? STATIC : SCROLL);

  useEffect(() => {
    if (reduced) {
      mode.set(STATIC);
      return;
    }
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => mode.set(fine.matches ? CURSOR : SCROLL);
    update();
    fine.addEventListener("change", update);
    return () => fine.removeEventListener("change", update);
  }, [reduced, mode]);

  // ---- entrance: silhouette rim-light pass -> full studio light, once the image has decoded ----
  const brightness = useMotionValue(reduced ? 1 : 0.2);
  const contrast = useMotionValue(reduced ? 1 : 1.4);
  const glowOpacity = useMotionValue(reduced ? 1 : 0);
  const glowScale = useMotionValue(reduced ? 1 : 0.35);
  const subjectFilter = useMotionTemplate`brightness(${brightness}) contrast(${contrast})`;
  const revealed = useRef(false);

  function reveal() {
    if (revealed.current) return;
    revealed.current = true;
    if (reduced) {
      [brightness, contrast, glowOpacity, glowScale].forEach((value) => value.set(1));
      return;
    }
    animate(glowOpacity, 1, { ...REVEAL, duration: 0.8 });
    animate(glowScale, 1, REVEAL);
    animate(brightness, 1, { ...REVEAL, delay: 0.12 });
    animate(contrast, 1, { ...REVEAL, delay: 0.12 });
  }

  // Reduced motion resolves after the first render (it is unknown during SSR): settle at once.
  useEffect(() => {
    if (!reduced) return;
    revealed.current = true;
    [brightness, contrast, glowOpacity, glowScale].forEach((value) => value.set(1));
  }, [reduced, brightness, contrast, glowOpacity, glowScale]);

  // ---- inputs ------------------------------------------------------------------------------
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, SPRING);
  const springY = useSpring(pointerY, SPRING);
  const { scrollY } = useScroll();
  const dolly = useTransform(scrollY, [0, DOLLY_DISTANCE], [0, 1], { clamp: true });

  // Light position in [-1, 1]: the cursor on desktop, a scroll sweep on touch, fixed when static.
  const lightX = useTransform([springX, dolly, mode], ([x, p, m]: number[]) => (m === CURSOR ? x! : m === SCROLL ? -0.55 + p! * 1.1 : -0.3));
  const lightY = useTransform([springY, dolly, mode], ([y, p, m]: number[]) => (m === STATIC ? -0.2 : (m === CURSOR ? y! * 0.7 : 0) - 0.2 + p! * 0.5));

  // ---- camera ----------------------------------------------------------------------------
  const rotateY = useTransform([springX, mode], ([x, m]: number[]) => (m === CURSOR ? x! * MAX_TILT_DEG : 0));
  const rotateX = useTransform([springY, mode], ([y, m]: number[]) => (m === CURSOR ? -y! * MAX_TILT_DEG : 0));
  const scale = useTransform([dolly, mode], ([p, m]: number[]) => (m === STATIC ? 1 : 1 + p! * 0.06));
  // Rendered at 0.6x scroll speed: the page moves 1x, the typography counter-moves 0.4x.
  const backdropY = useTransform([scrollY, mode], ([y, m]: number[]) => (m === STATIC ? 0 : y! * 0.4));

  // ---- lighting ----------------------------------------------------------------------------
  // Centre moves within 38-62% / 30-58% and the ellipse (radius <= 36%) always fades out
  // before the plane's edge, so the softbox never shows a hard border.
  const glowX = useTransform(lightX, (x) => 50 + x * 12);
  const glowY = useTransform(lightY, (y) => 44 + y * 14);
  const backlight = useMotionTemplate`radial-gradient(36% 34% at ${glowX}% ${glowY}%, rgba(255, 246, 236, 0.20) 0%, rgba(255, 246, 236, 0.08) 45%, rgba(255, 246, 236, 0) 100%)`;
  // Anisotropic sweep: a narrow vertical band (brushed cylinder) that tracks the light.
  const sweepPosition = useTransform(lightX, (x) => `${50 + x * 36}% 0%`);
  const sweepOpacity = useTransform(lightY, (y) => 0.95 - Math.abs(y) * 0.35);
  // The contact shadow falls away from the light; the floor light pool follows it.
  const shadowX = useTransform(lightX, (x) => x * -26);
  const shadowScaleX = useTransform(lightX, (x) => 1 + Math.abs(x) * 0.12);
  const shadowOpacity = useTransform(lightY, (y) => 0.8 + y * 0.15);
  const poolX = useTransform(lightX, (x) => x * 46);

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (mode.get() !== CURSOR || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointerX.set(Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1)));
    pointerY.set(Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1)));
  }
  function onPointerLeave() {
    pointerX.set(0);
    pointerY.set(0);
  }

  const maskStyle = { maskImage: `url(${image.mask})`, WebkitMaskImage: `url(${image.mask})`, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" } as const;

  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-hero text-white" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      <div className="container-site grid items-center gap-6 pt-14 md:grid-cols-[1fr_auto] md:pt-0 lg:min-h-[632px]">
        <div className="order-2 pb-16 text-center md:order-1 md:pb-0 md:text-left">
          <p className="text-lg font-semibold text-white/40 md:text-2xl">{copy.eyebrow}</p>
          <h1 id="hero-title" className="mt-4 text-[56px] leading-[1.05] tracking-[-0.02em] md:mt-6 md:text-8xl">
            <span className="font-extralight">{copy.titleLight} </span>
            <span className="font-semibold">{copy.titleBold}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-[440px] text-base font-medium text-muted md:mx-0 md:mt-6 md:text-lg">{copy.subtitle}</p>
          <Button asChild variant="outline-light" size="lg" className="mt-8 md:mt-[46px]">
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        </div>

        {/* Stage */}
        <div className="relative order-1 mx-auto w-[260px] [perspective:1400px] sm:w-[320px] md:order-2 md:mt-10 md:w-[380px] lg:w-[430px]">
          {/* Spatial backdrop typography: behind the hardware, parallaxed at 0.6x scroll speed. */}
          <motion.p
            aria-hidden
            style={{ y: backdropY }}
            className="pointer-events-none absolute left-1/2 top-[58%] -z-10 -translate-x-1/2 -translate-y-1/2 select-none whitespace-nowrap text-[88px] font-semibold leading-none tracking-[-0.05em] text-white/[0.045] will-change-transform sm:text-[110px] md:text-[150px] lg:text-[176px]"
          >
            {copy.backdrop}
          </motion.p>
          <motion.div style={{ rotateX, rotateY, scale, transformStyle: "preserve-3d" }} className="relative will-change-transform">
            {/* Backlight: studio softbox, expands from a pinpoint on load. */}
            <motion.div
              aria-hidden
              data-hero-glow=""
              style={{ z: -60, background: backlight, opacity: glowOpacity, scale: glowScale }}
              className="pointer-events-none absolute -inset-[40%] will-change-transform"
            />

            {/* Floor (z = 0): light pool, contact shadow, reflection. */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-full" style={{ transform: "translateZ(0px)" }}>
              <motion.div
                style={{ x: poolX }}
                className="absolute left-[-20%] top-[-14px] h-16 w-[140%] rounded-[50%] bg-[radial-gradient(closest-side,rgba(255,246,236,0.07),rgba(255,246,236,0))] will-change-transform"
              />
              {/* Reflection shares the subject's light state, so it emerges from darkness with it. */}
              <motion.div
                data-hero-subject=""
                className="relative mx-auto w-full"
                style={{ filter: subjectFilter, aspectRatio: `${image.width} / ${image.height}`, maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0) 30%)", WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0) 30%)" }}
              >
                {/* Same src + sizes as the subject, so it reuses the one preloaded image. */}
                <Image src={image.src} alt="" fill priority sizes="(min-width: 1024px) 430px, (min-width: 768px) 380px, 260px" className="-scale-y-100 object-contain blur-[1.5px]" />
              </motion.div>
            </div>
            <motion.div
              aria-hidden
              style={{ x: shadowX, scaleX: shadowScaleX, opacity: shadowOpacity }}
              className="pointer-events-none absolute bottom-[-14px] left-[6%] h-7 w-[68%] rounded-[50%] bg-[radial-gradient(closest-side,rgba(0,0,0,0.85),rgba(0,0,0,0))] will-change-transform"
            />

            {/* Subject (z = 40px): emerges from darkness, then lit by the moving softbox. */}
            <motion.div data-hero-subject="" style={{ z: 40, filter: subjectFilter, aspectRatio: `${image.width} / ${image.height}` }} className="relative w-full">
              <Image
                src={image.src}
                alt={image.alt}
                fill
                priority
                sizes="(min-width: 1024px) 430px, (min-width: 768px) 380px, 260px"
                className="object-contain"
                ref={(node) => {
                  // Cached images can finish before React attaches onLoad.
                  if (node?.complete && node.naturalWidth > 0) reveal();
                }}
                onLoad={reveal}
                onError={reveal}
              />
              {/* Static fill light: makes the cylinder read as round against the dark set. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.07)_0%,rgba(255,255,255,0)_14%,rgba(255,255,255,0)_62%,rgba(255,255,255,0.035)_70%,rgba(255,255,255,0)_74%)] [mix-blend-mode:screen]"
                style={maskStyle}
              />
              {/* Specular sweep, clipped to the product silhouette. */}
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,rgba(255,255,255,0)_40%,rgba(255,255,255,0.05)_45%,rgba(255,255,255,0.20)_49.5%,rgba(255,255,255,0.05)_54%,rgba(255,255,255,0)_59%)] bg-[length:280%_100%] [mix-blend-mode:plus-lighter]"
                style={{ ...maskStyle, backgroundPosition: sweepPosition, opacity: sweepOpacity }}
              />
            </motion.div>
          </motion.div>
        </div>
      </div>
      {/* Without JavaScript the entrance never runs: show the fully lit stage. */}
      <noscript>
        <style>{"[data-hero-subject]{filter:none!important}[data-hero-glow]{opacity:1!important;transform:translateZ(-60px)!important}"}</style>
      </noscript>
      {/* Breathing room for the floor reflection under the stage. */}
      <div aria-hidden className="h-10 md:h-16" />
    </section>
  );
}
