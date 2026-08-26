import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

export type CosmicButtonProps<E extends 'a' | 'button' = 'a'> = {
  as?: E;
  contentClassName?: string;
} & ComponentPropsWithoutRef<E>;

export function CosmicButton<E extends 'a' | 'button' = 'a'>({
  as,
  className,
  contentClassName,
  children,
  ...props
}: CosmicButtonProps<E>) {
  const Element = as ?? 'a';
  const baseClassName = cn(
    'group/cosmic relative inline-flex min-h-11 min-w-11 items-stretch justify-center rounded-[14px] p-[2px] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40',
    className,
  );
  const content = (
    <>
      <span className="absolute inset-0 overflow-hidden rounded-[14px] transition-all duration-300 ease-out group-hover/cosmic:inset-[-2px]">
        <span className="animate-cosmic-spin absolute inset-[-200%] bg-[conic-gradient(from_0deg,#67e8f9,#6197ff,#8b5cf6,#6197ff,#67e8f9)] opacity-90" />
      </span>
      <span className="absolute inset-0 overflow-hidden rounded-[14px] opacity-50 mix-blend-overlay transition-all duration-300 ease-out group-hover/cosmic:inset-[-2px]">
        <span className="animate-cosmic-spin-slow absolute inset-[-200%] bg-[conic-gradient(from_180deg,#dbeafe_0%,transparent_30%,#67e8f9_50%,transparent_70%,#8b5cf6_100%)]" />
      </span>
      <span
        className={cn(
          'relative z-10 flex min-h-10 w-full items-center justify-center gap-2 overflow-hidden rounded-[12px] bg-background px-5 py-2 text-sm font-semibold tracking-tight text-foreground transition-colors before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_50%_0%,rgba(97,151,255,0.18),transparent_65%)] group-hover/cosmic:bg-panel group-active/cosmic:scale-[0.985]',
          contentClassName,
        )}
      >
        <span className="relative z-10 inline-flex items-center justify-center gap-2">{children}</span>
      </span>
    </>
  );

  if (Element === 'button') {
    return (
      <button
        type="button"
        className={baseClassName}
        {...(props as ComponentPropsWithoutRef<'button'>)}
      >
        {content}
      </button>
    );
  }

  const { href, ...anchorProps } = props as ComponentPropsWithoutRef<'a'>;
  return (
    <a className={baseClassName} href={href} {...anchorProps}>
      {content}
    </a>
  );
}
