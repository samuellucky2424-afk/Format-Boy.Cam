interface LoadingProps {
  size?: 'sm' | 'md' | 'lg';
  fullScreen?: boolean;
  text?: string;
}

export function Loading({ size = 'md', fullScreen = false, text }: LoadingProps) {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-3',
    lg: 'w-12 h-12 border-4',
  };

  const spinner = (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className={`${sizeClasses[size]} rounded-full border-blue-500 border-t-transparent animate-spin`} />
      {text && <p className="text-sm text-[#71717a]">{text}</p>}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        {spinner}
      </div>
    );
  }

  return spinner;
}

export function PageLoading() {
  return <Loading fullScreen text="Loading..." />;
}
