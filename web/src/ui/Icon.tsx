import type { SVGProps } from "react";

const paths: Record<string, React.ReactNode> = {
  score: (
    <>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 18l4.5-6" />
      <circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  mix: (
    <>
      <path d="M6 4v16M12 4v16M18 4v16" />
      <rect x="4" y="13" width="4" height="3" rx="1" fill="var(--bg)" />
      <rect x="10" y="7" width="4" height="3" rx="1" fill="var(--bg)" />
      <rect x="16" y="11" width="4" height="3" rx="1" fill="var(--bg)" />
    </>
  ),
  devices: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M11 17.5h2" />
    </>
  ),
  master: (
    <>
      <path d="M3 12h3l2-5 3 10 3-13 2.5 8H21" />
    </>
  ),
  versions: (
    <>
      <path d="M4 7h11M4 12h16M4 17h8" />
      <path d="M17 4l3 3-3 3" />
    </>
  ),
  stems: (
    <>
      <path d="M4 6h16M4 10h12M4 14h14M4 18h9" />
    </>
  ),
  lyrics: (
    <>
      <path d="M5 5h14M5 9.5h10M5 14h14M5 18.5h7" />
    </>
  ),
  topline: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
    </>
  ),
  voice: (
    <>
      <path d="M4 12h1.5M7.5 8v8M11 5v14M14.5 9v6M18 7v10M20.5 12H20" />
    </>
  ),
  ai: (
    <>
      <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="7" y="5.5" width="3.2" height="13" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.8" y="5.5" width="3.2" height="13" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  loop: (
    <>
      <path d="M17 3l3 3-3 3" />
      <path d="M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3" />
      <path d="M4 18h12a4 4 0 0 0 4-4v-1" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  spark: (
    <>
      <path d="M12 4v4M12 16v4M4 12h4M16 12h4" />
    </>
  ),
  server: (
    <>
      <rect x="4" y="4" width="16" height="7" rx="2" />
      <rect x="4" y="13" width="16" height="7" rx="2" />
      <path d="M8 7.5h.01M8 16.5h.01" />
    </>
  ),
  record: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />,
  menu: <path d="M4 8h16M4 16h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </>
  ),
  headphones: (
    <>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3.5" y="14" width="4" height="6" rx="1.5" />
      <rect x="16.5" y="14" width="4" height="6" rx="1.5" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
