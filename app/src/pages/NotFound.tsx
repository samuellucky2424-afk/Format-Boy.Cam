import { useNavigate } from 'react-router-dom';
import { CosmicButton } from '@/components/ui/cosmic-button';
import { TextureButton } from '@/components/ui/texture-button';
import { TextureOverlay } from '@/components/ui/texture-overlay';
import { Home, ArrowLeft } from 'lucide-react';

function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 text-center">
      <TextureOverlay texture="grid" opacity={0.08} className="[mask-image:radial-gradient(circle_at_center,black,transparent_70%)]" />
      <div className="mb-8">
        <h1 className="mb-4 bg-gradient-to-b from-foreground to-muted-foreground bg-clip-text text-[150px] font-black leading-none text-transparent">
          404
        </h1>
        <div className="mx-auto mb-6 h-1 w-16 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-3">Page Not Found</h2>
      <p className="mb-8 max-w-md text-muted-foreground">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <CosmicButton as="button" onClick={() => navigate('/dashboard')}>
          <Home className="size-4" />
          Back to Dashboard
        </CosmicButton>
        <TextureButton
          variant="secondary"
          size="lg"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="size-4" />
          Go Back
        </TextureButton>
      </div>
    </div>
  );
}

export default NotFound;
