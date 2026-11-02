import "./auth-mushroom.css";

export function AuthMushroom({ variant = "mushroom" }: { variant?: "mycelium" | "mushroom" }) {
  const mycelium = variant === "mycelium";
  return (
    <div className="flex h-[74px] w-[74px] items-center justify-center rounded-full bg-muted" aria-hidden="true">
      <svg className="auth-mushroom" data-mascot={variant} width="48" height="48" viewBox="0 0 64 64" fill="none">
        {mycelium ? <>
          <g className="auth-mycelium-branches">
            <path d="M30 21C32 14 24 9 27 4M29 11 35 5M27 8 20 7" />
            <path d="M40 26C46 25 43 18 51 16s6-6 7-9M49 17c1-5-2-8-1-12" />
            <path d="M24 25c-7 1-6-8-12-8S6 12 5 8M16 21 7 24" />
            <path d="M24 34c-6-1-8 6-16 3l-4 3M14 38l-2 7" />
            <path d="M26 42c-3 4-1 10-9 12l-7 4M21 52l2 8" />
            <path d="M37 42c2 8 12 3 14 11l4 7M47 48l10-1" />
          </g>
          <path className="auth-mushroom-body" d="M23 27c0-6 4-10 9-10s9 4 9 10v8c0 6-4 10-9 10s-9-4-9-10v-8Z" />
        </> : <>
          <path className="auth-mushroom-body" d="M26 30h12l3 21c.5 3.5-2 6-5.5 6h-7c-3.5 0-6-2.5-5.5-6l3-21Z" />
          <path className="auth-mushroom-body" d="M6 28C7 16 18 7 32 7s25 9 26 21c.3 4-2.5 7-6.5 7h-39C8.5 35 5.7 32 6 28Z" />
        </>}
        <g className="auth-mushroom-gaze">
          <g className="auth-mushroom-blink auth-mushroom-eyes">
            <rect x="26" y={mycelium ? 29 : 40} width="3.5" height="8" rx="1.75" />
            <rect x="34.5" y={mycelium ? 29 : 40} width="3.5" height="8" rx="1.75" />
          </g>
        </g>
      </svg>
    </div>
  );
}
