import * as React from 'react';
import { cn } from '@/lib/utils';

type TextureCardProps = React.HTMLAttributes<HTMLDivElement> & {
  contentClassName?: string;
};

const TextureCard = React.forwardRef<HTMLDivElement, TextureCardProps>(
  ({ className, contentClassName, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.045] to-white/[0.015] p-px',
        className,
      )}
      {...props}
    >
      <div className="relative isolate h-full overflow-hidden rounded-[15px] border border-black/45 bg-gradient-to-b from-panel/80 to-background/90 text-card-foreground">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.014] [background-image:repeating-linear-gradient(45deg,currentColor_0,currentColor_1px,transparent_1px,transparent_7px)]"
        />
        <div className={cn('relative z-10 h-full', contentClassName)}>{children}</div>
      </div>
    </div>
  ),
);

TextureCard.displayName = 'TextureCard';

const TextureCardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-6 pt-6', className)} {...props} />
  ),
);
TextureCardHeader.displayName = 'TextureCardHeader';

const TextureCardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-lg font-semibold leading-tight text-foreground', className)} {...props} />
  ),
);
TextureCardTitle.displayName = 'TextureCardTitle';

const TextureCardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
TextureCardDescription.displayName = 'TextureCardDescription';

const TextureCardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-6 py-4', className)} {...props} />
  ),
);
TextureCardContent.displayName = 'TextureCardContent';

const TextureCardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center justify-between gap-2 px-6 py-4', className)} {...props} />
  ),
);
TextureCardFooter.displayName = 'TextureCardFooter';

function TextureSeparator({ className }: { className?: string }) {
  return <div className={cn('h-px bg-gradient-to-r from-transparent via-white/10 to-transparent', className)} />;
}

export {
  TextureCard,
  TextureCardHeader,
  TextureCardTitle,
  TextureCardDescription,
  TextureCardContent,
  TextureCardFooter,
  TextureSeparator,
};
