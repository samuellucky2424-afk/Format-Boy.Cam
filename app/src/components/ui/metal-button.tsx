import type { ComponentProps, CSSProperties } from 'react';
import { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { MetalFx, type MetalFxProps, type MetalFxVariant } from 'metal-fx';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const metalSurfaceVariants = cva('transition-colors', {
  variants: {
    variant: {
      default: '!bg-primary !text-primary-foreground hover:!bg-primary/80',
      outline: '!bg-background !text-foreground hover:!bg-input/50',
      secondary: '!bg-secondary !text-secondary-foreground hover:!bg-secondary/80',
      ghost: '!bg-transparent !text-foreground hover:!bg-muted/50',
      destructive: '!bg-destructive/15 !text-red-300 hover:!bg-destructive/25',
      link: '!bg-transparent !text-primary',
    },
  },
  defaultVariants: { variant: 'default' },
});

type MetalSurfaceVariant = NonNullable<VariantProps<typeof metalSurfaceVariants>['variant']>;

type MetalShellProps = Pick<
  MetalFxProps,
  | 'preset'
  | 'theme'
  | 'strength'
  | 'paused'
  | 'borderRadius'
  | 'disableGlow'
  | 'reflectionTargets'
  | 'shaderScale'
  | 'ringCssPx'
  | 'scale'
  | 'normalizeHostStyles'
> & {
  metalVariant?: MetalFxVariant;
  metalFxClassName?: string;
  metalFxStyle?: CSSProperties;
};

export type MetalButtonProps = ComponentProps<typeof Button> & MetalShellProps;
export type MetalIconButtonProps = MetalButtonProps;

export const MetalButton = forwardRef<HTMLDivElement, MetalButtonProps>(
  function MetalButton(
    {
      metalVariant = 'button',
      metalFxClassName,
      metalFxStyle,
      preset = 'silver',
      theme = 'dark',
      strength = 0.72,
      paused,
      borderRadius,
      disableGlow,
      reflectionTargets,
      shaderScale,
      ringCssPx,
      scale,
      normalizeHostStyles = true,
      variant = 'outline',
      className,
      ...buttonProps
    },
    ref,
  ) {
    return (
      <MetalFx
        borderRadius={borderRadius}
        className={cn(
          '!inline-flex !w-fit min-w-0 flex-col items-stretch !overflow-visible leading-none',
          normalizeHostStyles && metalSurfaceVariants({ variant: variant as MetalSurfaceVariant }),
          metalFxClassName,
        )}
        disableGlow={disableGlow}
        normalizeHostStyles={normalizeHostStyles}
        paused={paused}
        preset={preset}
        ref={ref}
        reflectionTargets={reflectionTargets}
        ringCssPx={ringCssPx}
        scale={scale}
        shaderScale={shaderScale}
        strength={strength}
        style={metalFxStyle}
        theme={theme}
        variant={metalVariant}
      >
        <Button
          className={cn(
            normalizeHostStyles &&
              '!border-0 !bg-transparent !shadow-none hover:!bg-transparent aria-expanded:!bg-transparent',
            className,
          )}
          variant={variant}
          {...buttonProps}
        />
      </MetalFx>
    );
  },
);

MetalButton.displayName = 'MetalButton';

export const MetalIconButton = forwardRef<HTMLDivElement, MetalIconButtonProps>(
  function MetalIconButton({ size = 'icon-sm', metalVariant = 'circle', className, ...props }, ref) {
    return (
      <MetalButton
        ref={ref}
        size={size}
        metalVariant={metalVariant}
        className={cn('!leading-none [&_svg]:block [&_svg]:shrink-0', className)}
        {...props}
      />
    );
  },
);

MetalIconButton.displayName = 'MetalIconButton';
