import { useEffect, useRef, useState } from 'react';

function PreviewWindow() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastStreamRef = useRef<MediaStream | null>(null);
  const [hasStream, setHasStream] = useState(false);

  useEffect(() => {
    document.title = 'Format-Boy preview';
  }, []);

  useEffect(() => {
    const syncFromDashboard = () => {
      const previewVideo = videoRef.current;

      if (!previewVideo) {
        return;
      }

      const openerWindow = window.opener as Window | null;

      if (!openerWindow || openerWindow.closed) {
        if (previewVideo.srcObject) {
          previewVideo.srcObject = null;
        }

        lastStreamRef.current = null;
        setHasStream(false);
        return;
      }

      const sourceVideo = openerWindow.document.getElementById('output') as HTMLVideoElement | null;
      const sourceStream = (sourceVideo?.srcObject as MediaStream | null) ?? null;

      if (sourceStream !== lastStreamRef.current) {
        previewVideo.srcObject = sourceStream;
        lastStreamRef.current = sourceStream;
      }

      setHasStream(Boolean(sourceStream));

      if (sourceStream && previewVideo.paused) {
        previewVideo.play().catch(() => {});
      }
    };

    syncFromDashboard();
    const intervalId = window.setInterval(syncFromDashboard, 250);

    return () => {
      window.clearInterval(intervalId);

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, []);

  return (
    <div className="w-screen h-screen bg-black overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full ${hasStream ? 'block object-contain' : 'hidden'}`}
      />

      {!hasStream && (
        <div className="w-full h-full flex items-center justify-center bg-black text-center px-6">
          <div className="max-w-md">
            <h1 className="text-white text-3xl font-semibold tracking-[0.08em] uppercase">Format-Boy preview</h1>
            <p className="mt-4 text-sm text-[#A1A1AA]">
              Waiting for the live output stream. Open this window from the dashboard OBS Preview button and start streaming.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default PreviewWindow;
