/** The Weave mark, drawn as `app/icon.svg` draws it. */
export function WeaveMark({size = 22, className}: {size?: number; className?: string}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="14" fill="#000000" />
      <path d="M16 48.78 8 15.22H16.83L22.85 43.03L21.43 41.98H25.15L23.54 43.03L28.09 16.41H35.03L28.74 48.78ZM35.95 48.78 29.2 16.41H36.51L41.84 43.03L40.23 41.98H43.72L42.53 43.03L47.72 15.22H56L48.97 48.78Z" fill="#ffffff" />
    </svg>
  );
}
