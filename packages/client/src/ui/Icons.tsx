/**
 * Local SVG icons. No icon font, no CDN, no sprite fetch (spec section 41).
 * Every glyph is inline markup so it works with zero network access.
 */

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
});

export function LockIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function UnlockIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.5-1.9" />
      <circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function GavelIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 21h9" />
      <path d="M13.5 4.5 19.5 10.5" />
      <rect x="9.8" y="3.2" width="7" height="4" rx="1" transform="rotate(45 13.3 5.2)" />
      <path d="M11 9.5 5.5 15a2 2 0 0 0 2.8 2.8L14 12.3" />
    </svg>
  );
}

export function TrendUpIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 17.5 9.5 11l4 4L21 7.5" />
      <path d="M15 7.5h6v6" />
    </svg>
  );
}

export function ClockIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function AlertIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 4.5 21 19.5H3L12 4.5Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CheckIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

export function CrossIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

export function UsersIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5c0-3.1 2.7-5 6-5s6 1.9 6 5" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 5.8" />
      <path d="M17.5 14.9c2.1.5 3.5 1.9 3.5 4.6" />
    </svg>
  );
}

export function DiamondIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3 21 10.5 12 21 3 10.5 12 3Z" />
      <path d="M3 10.5h18M12 3v18" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Round 3 additions
 *
 * The design pass flagged emoji-as-icons as an anti-pattern: they render
 * inconsistently across machines and carry no accessible meaning. Every
 * pictogram below is inline SVG so the projector looks identical on any
 * laptop, offline.
 * ------------------------------------------------------------------ */

export function FlameIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3s4.5 3.6 4.5 8a4.5 4.5 0 0 1-9 0c0-1.6.6-2.9 1.3-3.9.4 1 1 1.6 1.7 1.9C10.2 6.9 12 5 12 3Z" />
      <path d="M8.5 15.5a5.5 5.5 0 0 0 7 0" />
    </svg>
  );
}

export function TrophyIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4.5A2.5 2.5 0 0 0 7 10.5M17 6h2.5A2.5 2.5 0 0 1 17 10.5" />
      <path d="M10 14h4l.5 4h-5l.5-4ZM8 20h8" />
    </svg>
  );
}

export function MedalIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="15" r="5" />
      <path d="M12 13.2 12.7 14.6 14.2 14.8 13.1 15.9 13.4 17.4 12 16.7 10.6 17.4 10.9 15.9 9.8 14.8 11.3 14.6 12 13.2Z" />
      <path d="M8.5 3.5 10.5 9M15.5 3.5 13.5 9" />
    </svg>
  );
}

export function BrainIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9.5 4.5a2.5 2.5 0 0 0-2.4 3.2A2.5 2.5 0 0 0 5 10.2c0 1 .6 1.9 1.4 2.3A2.5 2.5 0 0 0 8.6 16c.3 1.2 1.4 2 2.6 2a2 2 0 0 0 .8-.2V4.7a2 2 0 0 0-2.5-.2Z" />
      <path d="M14.5 4.5a2.5 2.5 0 0 1 2.4 3.2A2.5 2.5 0 0 1 19 10.2c0 1-.6 1.9-1.4 2.3A2.5 2.5 0 0 1 15.4 16c-.3 1.2-1.4 2-2.6 2a2 2 0 0 1-.8-.2V4.7a2 2 0 0 1 2.5-.2Z" />
    </svg>
  );
}

export function TargetIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BoltIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M13 3 5.5 13.5H11L10.5 21 18.5 10.5H13L13 3Z" />
    </svg>
  );
}

export function EyeOffIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.3A9.5 9.5 0 0 1 12 6.2c5 0 8.5 5.8 8.5 5.8a15 15 0 0 1-2.6 3.3" />
      <path d="M6.2 8.1A15.6 15.6 0 0 0 3.5 12S7 17.8 12 17.8c1.2 0 2.3-.3 3.3-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

export function ChartIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <rect x="7.5" y="12" width="3" height="5" rx="0.6" />
      <rect x="13" y="8" width="3" height="9" rx="0.6" />
      <rect x="18" y="14" width="2.5" height="3" rx="0.6" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
    </svg>
  );
}

export function DomainIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4.5 7.5 12 3.5l7.5 4v9L12 20.5 4.5 16.5v-9Z" />
      <path d="M4.5 7.5 12 11.5l7.5-4M12 11.5v9" />
    </svg>
  );
}

/** The printed key an operator reads aloud before a question opens. */
export function KeyIcon({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9" />
      <path d="M17.5 12v3.5" />
      <path d="M20.5 12v2.5" />
    </svg>
  );
}
