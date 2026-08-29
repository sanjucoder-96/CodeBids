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
