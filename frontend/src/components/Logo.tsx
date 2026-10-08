import Image from 'next/image';

export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return <Image src="/icon-192.png" alt="" width={192} height={192} className={className} aria-hidden="true" />;
}

export function Logo({ compact = false, tagline = false, className = 'h-12 w-auto' }: { compact?: boolean; tagline?: boolean; className?: string }) {
  if (compact) return <LogoMark />;
  return (
    <div className="inline-flex flex-col items-center gap-1.5">
      <Image src="/logo-dark.png" alt="VITA EYE" width={1200} height={330} priority className={className} />
      {tagline && <p className="text-center text-xs tracking-[0.2em] text-cyan-200/70 uppercase">Intelligent Vision. Smarter Security.</p>}
    </div>
  );
}
