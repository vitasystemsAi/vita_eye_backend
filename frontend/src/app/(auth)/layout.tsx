import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(37,99,235,0.18),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div className="relative w-full max-w-xl">
        <div className="pointer-events-none absolute -inset-6 rounded-[2rem] bg-[radial-gradient(ellipse_at_center,rgba(34,211,238,0.12),transparent_70%)] blur-2xl" />
        <div className="relative overflow-hidden rounded-2xl border border-cyan-400/15 bg-[linear-gradient(160deg,#0f1a30_0%,#0a1222_45%,#070c17_100%)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.03)_inset] backdrop-blur">
          <div className="h-1 bg-gradient-to-r from-transparent via-cyan-400/80 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.16),transparent_70%)]" />
          <div className="relative flex flex-col items-center border-b border-white/5 px-8 pt-10 pb-8 sm:px-12">
            <Logo tagline className="h-auto w-[calc(100vw-6rem)] max-w-[26rem]" />
          </div>
          <div className="relative px-8 py-8 sm:px-12 sm:py-10">{children}</div>
        </div>
        <p className="relative mt-6 text-center text-xs text-ink-400">
          Authorized personnel only. All access is logged and audited.
        </p>
      </div>
    </main>
  );
}
