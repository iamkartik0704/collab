import {
  Battery,
  Camera,
  Cpu,
  Gamepad2,
  HardDrive,
  Headphones,
  Monitor,
  ScanFace,
  Smartphone,
  Tablet,
  Watch,
  Weight,
  type LucideIcon,
} from "lucide-react";
import type { SVGProps } from "react";
import type { HighlightSpec } from "@/types/catalog";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  smartphone: Smartphone,
  monitor: Monitor,
  watch: Watch,
  camera: Camera,
  headphones: Headphones,
  "gamepad-2": Gamepad2,
  tablet: Tablet,
};

export function CategoryIcon({ iconKey, className }: { iconKey: string | null; className?: string }) {
  const Icon = (iconKey && CATEGORY_ICONS[iconKey]) || Smartphone;
  return <Icon className={className} strokeWidth={1.5} aria-hidden />;
}

const SPEC_ICONS: Record<HighlightSpec["icon"], LucideIcon> = {
  screen: Smartphone,
  display: Monitor,
  cpu: Cpu,
  cores: Cpu,
  camera: Camera,
  "front-camera": ScanFace,
  battery: Battery,
  storage: HardDrive,
  weight: Weight,
};

export function SpecIcon({ icon, className }: { icon: HighlightSpec["icon"]; className?: string }) {
  const Icon = SPEC_ICONS[icon];
  return <Icon className={className} strokeWidth={1.5} aria-hidden />;
}

/** Brand marks (lucide ships no brand icons). */
export function SocialIcon({ network, ...props }: SVGProps<SVGSVGElement> & { network: "x" | "facebook" | "tiktok" | "instagram" }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true, ...props };
  switch (network) {
    case "x":
      return (
        <svg {...common}>
          <path d="M17.75 3h3.07l-6.71 7.67L22 21h-6.18l-4.84-6.33L5.44 21H2.37l7.18-8.2L2 3h6.34l4.37 5.78L17.75 3Zm-1.08 16.18h1.7L7.4 4.73H5.57l11.1 14.45Z" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...common}>
          <path d="M13.5 21v-7.5h2.53l.38-2.93H13.5V8.7c0-.85.24-1.42 1.45-1.42h1.55V4.66A20.7 20.7 0 0 0 14.24 4.5c-2.24 0-3.77 1.37-3.77 3.88v2.19H7.94v2.93h2.53V21h3.03Z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common}>
          <path d="M16.6 3c.32 2.06 1.53 3.46 3.4 3.62v2.97a7.04 7.04 0 0 1-3.37-.98v5.86c0 3.41-2.47 5.53-5.37 5.53A5.27 5.27 0 0 1 6 14.72c0-3.36 2.83-5.6 6.2-5.08v3.08c-1.53-.38-3.14.4-3.14 2 0 1.24.98 2.2 2.17 2.2 1.36 0 2.26-.94 2.26-2.5V3h3.1Z" />
        </svg>
      );
    case "instagram":
      return (
        <svg {...common}>
          <path d="M12 7.2A4.8 4.8 0 1 0 12 16.8 4.8 4.8 0 0 0 12 7.2Zm0 7.9a3.1 3.1 0 1 1 0-6.2 3.1 3.1 0 0 1 0 6.2Zm6.1-8.1a1.12 1.12 0 1 1-2.24 0 1.12 1.12 0 0 1 2.24 0ZM21.5 8.1c-.06-1.5-.4-2.83-1.5-3.92S17.5 2.74 16 2.67c-1.55-.09-6.2-.09-7.75 0-1.5.07-2.83.41-3.92 1.5S2.9 6.6 2.83 8.1c-.09 1.55-.09 6.2 0 7.75.07 1.5.41 2.83 1.5 3.92s2.42 1.43 3.92 1.5c1.55.09 6.2.09 7.75 0 1.5-.07 2.83-.41 3.92-1.5s1.44-2.42 1.5-3.92c.09-1.55.09-6.2 0-7.75Zm-2 9.5a3.17 3.17 0 0 1-1.79 1.79c-1.24.49-4.18.38-5.55.38s-4.32.11-5.55-.38a3.17 3.17 0 0 1-1.79-1.79c-.49-1.24-.38-4.18-.38-5.55s-.11-4.32.38-5.55A3.17 3.17 0 0 1 6.6 4.71c1.24-.49 4.18-.38 5.55-.38s4.32-.11 5.55.38a3.17 3.17 0 0 1 1.79 1.79c.49 1.24.38 4.18.38 5.55s.11 4.32-.38 5.55Z" />
        </svg>
      );
  }
}
