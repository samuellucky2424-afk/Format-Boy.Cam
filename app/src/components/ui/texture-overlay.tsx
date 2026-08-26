import { cn } from '@/lib/utils';

export type TextureType = 'dots' | 'grid' | 'noise' | 'diagonal' | 'paperGrain' | 'none';

const texturePatterns: Record<TextureType, string> = {
  dots: 'bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.32)_1px,transparent_0)] bg-[length:8px_8px]',
  grid: 'bg-[linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] bg-[length:16px_16px]',
  noise: 'bg-[radial-gradient(circle_at_2px_2px,rgba(255,255,255,0.24)_1px,transparent_0)] bg-[length:6px_6px]',
  diagonal:
    'bg-[repeating-linear-gradient(-45deg,rgba(255,255,255,0.16),rgba(255,255,255,0.16)_1px,transparent_1px,transparent_6px)]',
  paperGrain:
    'bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.1)_0px,transparent_1px,transparent_3px),repeating-linear-gradient(90deg,rgba(255,255,255,0.08)_0px,transparent_1px,transparent_4px),repeating-linear-gradient(45deg,rgba(255,255,255,0.04)_0px,transparent_1px,transparent_5px)]',
  none: '',
};

export function TextureOverlay({
  texture,
  opacity = 1,
  className,
}: {
  texture: TextureType;
  opacity?: number;
  className?: string;
}) {
  if (texture === 'none') return null;

  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0', texturePatterns[texture], className)}
      style={{ opacity }}
    />
  );
}
