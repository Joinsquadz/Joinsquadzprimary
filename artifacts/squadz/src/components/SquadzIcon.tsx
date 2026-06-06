export function SquadzIcon({ size = 88, style = {} }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", flexShrink: 0, ...style }}
    >
      <defs>
        <linearGradient id="sq-zg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FF5C3A" />
          <stop offset="100%" stopColor="#FFB547" />
        </linearGradient>
        <linearGradient id="sq-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1E1E2E" />
          <stop offset="100%" stopColor="#0A0A14" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="512" height="512" rx="114" fill="url(#sq-bg)" />
      <path
        d="M 81,81 L 431,81 L 431,151 L 151,361 L 431,361 L 431,431 L 81,431 L 81,361 L 361,151 L 81,151 Z"
        fill="url(#sq-zg)"
      />
    </svg>
  );
}
