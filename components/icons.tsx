/** COPIED from the premium app (components/icons.tsx); sales-desk icons appended at the end. */
import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

/** Placeholder brand mark — a geometric house/roof outline. No wordmark. */
export function LogoMark(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-9" />
      <path d="M9.5 20v-6h5v6" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.3-4.3" />
    </svg>
  );
}

export function HeartIcon(props: IconProps & { filled?: boolean }) {
  const { filled, ...rest } = props;
  return (
    <svg {...base(rest)} fill={filled ? "currentColor" : "none"}>
      <path d="M12 20.5s-7.5-4.7-9.8-9.3C.6 7.7 2.2 4.5 5.5 3.8c2-.4 3.9.5 5 2.1a5.6 5.6 0 0 1 1.5-1.6c1.4-1 3.4-1.2 5-.5 2.7 1.2 3.7 4.5 2.3 7.4C17 16 12 20.5 12 20.5Z" />
    </svg>
  );
}

export function CompareIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="7" height="16" rx="1.5" />
      <rect x="14" y="4" width="7" height="16" rx="1.5" />
      <path d="M6.5 9v2M17.5 9v2" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.5 7.5 0 0 0 0-3l1.8-1.4-1.7-3-2.1.6a7.6 7.6 0 0 0-2.6-1.5L14.3 3h-4.6l-.5 2.2a7.6 7.6 0 0 0-2.6 1.5l-2.1-.6-1.7 3 1.8 1.4a7.5 7.5 0 0 0 0 3l-1.8 1.4 1.7 3 2.1-.6c.8.66 1.66 1.17 2.6 1.5l.5 2.2h4.6l.5-2.2a7.6 7.6 0 0 0 2.6-1.5l2.1.6 1.7-3Z" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 21s7-6.3 7-11.5A7 7 0 0 0 5 9.5C5 14.7 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.3" />
    </svg>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v11" />
      <path d="m8.5 6.5 3.5-3.5 3.5 3.5" />
      <path d="M6 12.5H5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6.5a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function MapIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  );
}

export function GalleryIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 17.7l-1.6-5.5L5 10.6 10.4 9 12 3.5Z" />
      <path d="M18.5 15.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z" />
    </svg>
  );
}

export function StarIcon(props: IconProps & { filled?: boolean }) {
  const { filled = true, ...rest } = props;
  return (
    <svg {...base(rest)} fill={filled ? "currentColor" : "none"}>
      <path d="m12 3.6 2.5 5.3 5.6.8-4.1 4 1 5.7-5-2.7-5 2.7 1-5.7-4.1-4 5.6-.8L12 3.6Z" />
    </svg>
  );
}

export function BriefcaseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="7.5" width="18" height="13" rx="2" />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
      <path d="M3 12.5h18" />
    </svg>
  );
}

/** Fractional investing — a rising trend line. */
export function InvestIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 19.5h18" />
      <path d="M6 16.5V13" />
      <path d="M11 16.5V9.5" />
      <path d="M16 16.5v-5" />
      <path d="M20.5 5.5 14 10l-3-2.5L6.5 11" />
      <path d="M17.5 5h3v3" />
    </svg>
  );
}

/** Escrow / trustee protection. */
export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5l7 2.5v5.5c0 4.2-2.9 7.3-7 8.5-4.1-1.2-7-4.3-7-8.5V6l7-2.5Z" />
      <path d="m9.25 12 2 2 3.5-3.75" />
    </svg>
  );
}

/** A legal document. */
export function DocIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3.5h7L18.5 9v11.5h-12.5Z" />
      <path d="M13 3.5V9h5.5" />
      <path d="M9 13h6" />
      <path d="M9 16.5h4" />
    </svg>
  );
}

/** Cap table / ownership split. */
export function PieIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v8.5h8.5" />
    </svg>
  );
}

/** Alerts / notifications. */
export function BellIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4a5.5 5.5 0 0 0-5.5 5.5c0 3-1 4.5-2 5.5h15c-1-1-2-2.5-2-5.5A5.5 5.5 0 0 0 12 4Z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </svg>
  );
}

/** Follow / watch a locality, builder or project. */
export function EyeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

/** Saved search / bookmark. */
export function BookmarkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6.5 4h11v16l-5.5-4-5.5 4Z" />
    </svg>
  );
}

/** Edit a label. */
export function PencilIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20h4L19.5 8.5a2.12 2.12 0 0 0-3-3L5 17v3Z" />
      <path d="M14.5 5.5l4 4" />
    </svg>
  );
}

/** Delete. */
export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l.9 12a1 1 0 0 0 1 1h7.2a1 1 0 0 0 1-1L17.5 7" />
    </svg>
  );
}

/** Messages / inquiries. */
export function MessageIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5V16.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

/** Download a file. */
export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 19.5h14" />
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21" />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}

// ─── Sales-desk icons (same stroke recipe) ──────────────────────────────────

export function InboxIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 13.5 6.2 5.6A1.5 1.5 0 0 1 7.6 4.5h8.8a1.5 1.5 0 0 1 1.4 1.1L20 13.5" />
      <path d="M4 13.5V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18v-4.5h-4.5l-1.2 2h-4.6l-1.2-2Z" />
    </svg>
  );
}

export function BoardIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4.5" width="5" height="15" rx="1.2" />
      <rect x="9.75" y="4.5" width="5" height="10" rx="1.2" />
      <rect x="16" y="4.5" width="4.5" height="7" rx="1.2" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.3" />
    </svg>
  );
}

export function PulseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m4 12 16-8-6 16-2.5-6.5Z" />
      <path d="M11.5 13.5 20 4" />
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M8 3.5v4M16 3.5v4M4 10h16" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function BuildingIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 15 5v15.5M15 10h3.5A1.5 1.5 0 0 1 20 11.5v9M3 20.5h18" />
      <path d="M8.5 7.5h3M8.5 11h3M8.5 14.5h3" />
    </svg>
  );
}

export function RouteIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="18" r="2.25" />
      <circle cx="18" cy="6" r="2.25" />
      <path d="M8.25 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.75" />
    </svg>
  );
}

export function WandIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m4 20 11-11M14 4.5v3M17.5 8h3M18.6 4.9l-2.1 2.1M12.5 6.5l5 5" />
    </svg>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

export function GaugeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 15a8 8 0 1 1 16 0" />
      <path d="m12 15 4-5" />
      <circle cx="12" cy="15" r="1.2" />
    </svg>
  );
}

export function FlameIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 21a6 6 0 0 0 6-6c0-3.5-2.5-5.5-3.5-8-.5 2-1.8 3-3 3.5C11 8 10.5 5.5 11 3c-3 2-5 5.5-5 9.5V15a6 6 0 0 0 6 6Z" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4 3 19.5h18Z" />
      <path d="M12 10v4.5M12 17v.1" />
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 18.5V6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v8a1.5 1.5 0 0 1-1.5 1.5H8Z" />
    </svg>
  );
}

export function EmptyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 10h8M8 14h5" />
    </svg>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="18" cy="12" r="1" />
    </svg>
  );
}

/** Agent harness: an orchestrator node with its agents. */
export function AgentsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <circle cx="5" cy="5.5" r="1.8" />
      <circle cx="19" cy="5.5" r="1.8" />
      <circle cx="5" cy="18.5" r="1.8" />
      <circle cx="19" cy="18.5" r="1.8" />
      <path d="M6.4 6.8 9.8 10M17.6 6.8 14.2 10M6.4 17.2 9.8 14M17.6 17.2 14.2 14" />
    </svg>
  );
}
