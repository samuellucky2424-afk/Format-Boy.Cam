import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const textureButtonVariants = cva(
  'group/texture-button relative inline-flex shrink-0 rounded-[11px] p-px transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:saturate-0 disabled:opacity-30',
  {
    variants: {
      variant: {
        primary: 'bg-gradient-to-b from-blue-300/70 via-blue-500/90 to-blue-700/90',
        accent: 'bg-gradient-to-b from-cyan-300/70 via-blue-500/90 to-indigo-600/90',
        secondary: 'bg-gradient-to-b from-white/12 to-white/[0.035]',
        destructive: 'bg-gradient-to-b from-red-300/80 via-red-500 to-red-700',
        minimal: 'bg-gradient-to-b from-white/[0.08] to-white/[0.02]',
        icon: 'rounded-[10px] bg-gradient-to-b from-white/10 to-white/[0.025]',
      },
      size: {
        sm: 'rounded-[8px]',
        default: 'rounded-[11px]',
        lg: 'rounded-[13px]',
        icon: 'rounded-[10px]',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

const textureButtonInnerVariants = cva(
  'relative flex h-full w-full items-center justify-center overflow-hidden font-medium transition duration-150 before:pointer-events-none before:absolute before:inset-0 before:opacity-[0.018] before:[background-image:repeating-linear-gradient(45deg,currentColor_0,currentColor_1px,transparent_1px,transparent_6px)] group-active/texture-button:translate-y-px',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-b from-blue-500 to-blue-700 text-white group-hover/texture-button:from-blue-400 group-hover/texture-button:to-blue-600',
        accent:
          'bg-gradient-to-b from-cyan-500 to-blue-700 text-white group-hover/texture-button:from-cyan-400 group-hover/texture-button:to-blue-600',
        secondary:
          'bg-gradient-to-b from-panel to-background text-foreground group-hover/texture-button:from-accent group-hover/texture-button:to-panel',
        destructive:
          'bg-gradient-to-b from-red-500/90 to-red-700/90 text-white group-hover/texture-button:from-red-400 group-hover/texture-button:to-red-600',
        minimal:
          'bg-gradient-to-b from-panel/80 to-background/90 text-muted-foreground group-hover/texture-button:text-foreground',
        icon:
          'rounded-[9px] bg-gradient-to-b from-panel to-background text-muted-foreground group-hover/texture-button:text-foreground',
      },
      size: {
        sm: 'min-h-8 gap-1.5 rounded-[7px] px-3 text-xs',
        default: 'min-h-9 gap-2 rounded-[10px] px-4 text-sm',
        lg: 'min-h-11 gap-2 rounded-[12px] px-5 text-sm',
        icon: 'size-8 rounded-[9px] p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

export interface TextureButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof textureButtonVariants> {
  asChild?: boolean;
  contentClassName?: string;
}

const TextureButton = React.forwardRef<HTMLButtonElement, TextureButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'default',
      asChild = false,
      className,
      contentClassName,
      type,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(textureButtonVariants({ variant, size }), className)}
        {...props}
      >
        <span className={cn(textureButtonInnerVariants({ variant, size }), contentClassName)}>
          {children}
        </span>
      </Comp>
    );
  },
);

TextureButton.displayName = 'TextureButton';

export { TextureButton, textureButtonVariants };
