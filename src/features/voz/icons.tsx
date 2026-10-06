import type { IconProps } from "@/components/ui/icons";

const svg = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
  "aria-hidden": true as const,
});

export function MicIcon({ size = 16, color = "currentColor", className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <rect x="9" y="3" width="6" height="11" rx="3" stroke={color} strokeWidth="2" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function StopIcon({ size = 14, color = "currentColor", className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill={color} />
    </svg>
  );
}

export function InfoIcon({ size = 14, color = "currentColor", className }: IconProps) {
  return (
    <svg {...svg(size)} className={className}>
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />
      <path d="M12 11v6M12 7.5v.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
