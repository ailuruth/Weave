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
      <g fill="none" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 18L23.5 45.5" stroke="#E5E517" />
        <path d="M23.5 45.5L32 27.5" stroke="#17E517" />
        <path d="M32 27.5L40.5 45.5" stroke="#17E5E5" />
        <path d="M40.5 45.5L49.5 18" stroke="#E517E5" />
      </g>
    </svg>
  );
}
