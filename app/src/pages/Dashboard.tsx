import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Play, Square, Clock, Zap, Monitor, Plus, Coins, Minus, X, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { apiFetch } from '@/lib/api-client';
import { ROUTES } from '@/lib/routes';
import { isFiniteNumber } from '@/lib/utils';

interface RealtimeClient {
  disconnect: () => void;
  set: (config: { prompt?: string; enhance?: boolean; image?: string | Blob | File }) => Promise<void>;
  setPrompt: (text: string, options?: { enhance?: boolean }) => Promise<void>;
}

const PREVIEW_WINDOW_NAME = 'format-boy-preview';
const PREVIEW_WINDOW_FEATURES = 'popup=yes,width=1280,height=720,minWidth=640,minHeight=360,resizable=yes,scrollbars=no';

async function apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `API Error: ${response.statusText}`);
  }
  return response.json();
}

function Dashboard() {
  const { user } = useAuth();
  const { credits, setCredits, setSessionStatus } = useApp();
  const navigate = useNavigate();
  const [isStreaming, setIsStreaming] = useState(false);
  const [isObsMode, setIsObsMode] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
    const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  // Default prompt since the new UI doesn't have an input field yet
  const [prompt] = useState('A person looking professional');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const outputVideoRef = useRef<HTMLVideoElement>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const realtimeClientRef = useRef<RealtimeClient | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewWindowRef = useRef<Window | null>(null);

  const CREDITS_PER_SECOND = 2;
  const POLLING_INTERVAL = 1000;

  const getPreviewUrl = useCallback(() => {
    const previewUrl = new URL(window.location.href);
    previewUrl.hash = '/preview';
    return previewUrl.toString();
  }, []);

  const closeObsPreviewWindow = useCallback((updateState = true) => {
    const previewWindow = previewWindowRef.current;

    if (previewWindow && !previewWindow.closed) {
      previewWindow.close();
    }

    previewWindowRef.current = null;

    if (updateState) {
      setIsObsMode(false);
    }
  }, []);

  const openObsPreviewWindow = useCallback(() => {
    const existingWindow = previewWindowRef.current;

    if (existingWindow && !existingWindow.closed) {
      existingWindow.focus();
      setIsObsMode(true);
      return;
    }

    const previewWindow = window.open(
      getPreviewUrl(),
      PREVIEW_WINDOW_NAME,
      PREVIEW_WINDOW_FEATURES
    );

    if (!previewWindow) {
      toast.error('Could not open the OBS preview window.');
      return;
    }

    previewWindowRef.current = previewWindow;
    previewWindow.focus();
    setIsObsMode(true);
    toast.success('OBS can now capture the "Format-Boy preview" window.');
  }, [getPreviewUrl]);

  const handleObsPreviewToggle = useCallback(() => {
    if (previewWindowRef.current && !previewWindowRef.current.closed) {
      closeObsPreviewWindow();
      return;
    }

    openObsPreviewWindow();
  }, [closeObsPreviewWindow, openObsPreviewWindow]);

  const handleWindowControl = (action: 'minimize' | 'maximize' | 'close') => {
    if (typeof (window as any).require !== 'undefined') {
      const { ipcRenderer } = (window as any).require('electron');
      ipcRenderer.send(`window-${action}`);
    }
  };

  useEffect(() => {
        return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (realtimeClientRef.current) {
        realtimeClientRef.current.disconnect();
      }
      closeObsPreviewWindow(false);
    };
  }, [closeObsPreviewWindow]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isObsMode) {
        closeObsPreviewWindow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeObsPreviewWindow, isObsMode]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (previewWindowRef.current && previewWindowRef.current.closed) {
        previewWindowRef.current = null;
        setIsObsMode(false);
      }
    }, 500);

    return () => window.clearInterval(intervalId);
  }, []);

  const enumerateCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setCameraDevices(videoDevices);
      if (videoDevices.length > 0 && !selectedCameraId) {
        const builtin = videoDevices.find(d =>
          d.label.toLowerCase().includes('integrated') ||
          d.label.toLowerCase().includes('built-in') ||
          d.label.toLowerCase().includes('facetime') ||
          d.label.toLowerCase().includes('internal')
        );
        setSelectedCameraId(builtin?.deviceId || videoDevices[0].deviceId);
      }
    } catch (err) {
      console.error('Failed to enumerate cameras:', err);
    }
  }, [selectedCameraId]);

  useEffect(() => {
    enumerateCameras();
    navigator.mediaDevices.addEventListener('devicechange', enumerateCameras);
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerateCameras);
  }, [enumerateCameras]);

    useEffect(() => {
    if (isStreaming && outputVideoRef.current) {
      outputVideoRef.current.play().catch((err) => console.error('Play failed after streaming activated:', err));
    }
  }, [isStreaming]);

  

  const startWebcam = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { max: 30, ideal: 24 },
          facingMode: 'user'
        },
        audio: false
      };
      if (selectedCameraId) {
        (constraints.video as MediaTrackConstraints).deviceId = { exact: selectedCameraId };
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      webcamStreamRef.current = stream;
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (error) {
      console.error('Webcam error:', error);
      toast.error('Failed to access webcam. Please allow camera permissions.');
      return null;
    }
  };

  const stopWebcam = () => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }
    if (webcamVideoRef.current) {
      webcamVideoRef.current.srcObject = null;
    }
  };

  const connectToDecart = async (stream: MediaStream, apiToken: string): Promise<RealtimeClient | null> => {
    try {
      const { createDecartClient, models } = await import('@decartai/sdk');
      
      const client = createDecartClient({
        apiKey: apiToken
      });
      
      const model = models.realtime('lucy_2_rt');

      const realtimeClient = await client.realtime.connect(stream, {
        model,
        onRemoteStream: (editedStream: MediaStream) => {
          const video = outputVideoRef.current;
          if (!video) return;

          if (video.srcObject) {
            video.srcObject = null;
          }

          video.srcObject = editedStream;
          video.playbackRate = 1.0;
          (video as any).latencyHint = 'interactive';

          video.onloadedmetadata = () => {
            video.play().catch(() => {});
          };

          if (video.readyState >= 2) {
            video.play().catch(() => {});
          }
        },
        initialState: {
          prompt: {
            text: prompt,
            enhance: true
          }
        }
      });

      realtimeClientRef.current = realtimeClient as any;
      toast.success('Connected to AI!');

      try {
        if (uploadedImage) {
          const imgResponse = await fetch(uploadedImage);
          const imgBlob = await imgResponse.blob();
          await (realtimeClient as any).set({
            prompt: prompt,
            enhance: true,
            image: imgBlob
          });
        } else {
          await (realtimeClient as any).setPrompt(prompt, { enhance: true });
        }
      } catch (setError) {
        console.error('[Decart] Failed to apply initial transformation:', setError);
      }

      return realtimeClient as any;
    } catch (error: any) {
      console.error('[Decart] SDK error:', error);
      toast.error('Failed to connect to AI');
      
      if (outputVideoRef.current) {
        outputVideoRef.current.srcObject = stream;
        outputVideoRef.current.play().catch(() => {});
      }
      
      const mockClient: RealtimeClient = {
        disconnect: () => {},
        set: async () => {},
        setPrompt: async () => {}
      };
      
      realtimeClientRef.current = mockClient;
      return mockClient;
    }
  };

  const disconnectFromDecart = () => {
    if (realtimeClientRef.current) {
      realtimeClientRef.current.disconnect();
      realtimeClientRef.current = null;
    }
    if (outputVideoRef.current) {
      outputVideoRef.current.srcObject = null;
    }
  };

  const pollSessionStatus = useCallback(async () => {
    try {
      const response = await apiRequest<{ credits?: number; secondsUsed: number; creditsUsed?: number; remainingCredits?: number; shouldStop: boolean; forceEnd?: boolean }>(`/session-status?userId=${user?.id}`);
      const latestCredits = isFiniteNumber(response.remainingCredits)
        ? response.remainingCredits
        : isFiniteNumber(response.credits)
          ? response.credits
          : null;

      if (isFiniteNumber(latestCredits)) {
        setCredits(latestCredits);
      } else {
        console.error('Invalid credit response', response);
      }

      if (response.shouldStop || response.forceEnd) {
        await handleStop(false);
        toast.error('Session auto-ended - Insufficient credits');
      }
    } catch (error) {
      console.error('Poll error:', error);
    }
  }, [setCredits, user?.id]);

  const handleStart = async () => {
    setIsLoading(true);
    try {
      const [startResponse, stream] = await Promise.all([
        apiRequest<{ allowed: boolean; token?: string; error?: string; credits?: number; maxSeconds?: number }>('/start-session', {
          method: 'POST',
          body: JSON.stringify({ userId: user?.id })
        }).catch(e => {
          throw e; // Handled by outer catch
        }),
        startWebcam()
      ]);
        
      if (!startResponse.allowed) {
        toast.error(startResponse.error || 'Insufficient credits');
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
        setIsLoading(false);
        return;
      }

      if (isFiniteNumber(startResponse.credits)) {
        setCredits(startResponse.credits);
      } else if (startResponse.credits !== undefined) {
        console.error('Invalid credit response', startResponse);
      }
        
      const sessionToken = startResponse.token || '';

      if (!stream) {
        setIsLoading(false);
        return;
      }

      await connectToDecart(stream, sessionToken);

      setIsStreaming(true);
      setSessionStatus('LIVE');
      await pollSessionStatus();
      
      try {
        pollIntervalRef.current = setInterval(pollSessionStatus, POLLING_INTERVAL);
      } catch {
        console.warn('Polling not available');
      }
      
    } catch (error) {
      console.error('Start session error:', error);
      toast.error('Failed to start session');
      stopWebcam();
      disconnectFromDecart();
    }
    setIsLoading(false);
  };

  async function handleStop(showToast = true) {
    try {
      const response = await apiRequest<{ remainingCredits?: number }>('/end-session', {
        method: 'POST',
        body: JSON.stringify({ userId: user?.id })
      });
      
      if (response && isFiniteNumber(response.remainingCredits)) {
        setCredits(response.remainingCredits);
      } else if (response && response.remainingCredits !== undefined) {
        console.error('Invalid credit response', response);
      }
    } catch (error) {
      console.error('Stop session error:', error);
    }

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    disconnectFromDecart();
    stopWebcam();
    
    setIsStreaming(false);
    setSessionStatus('IDLE');
    
    if (showToast) {
      toast.info('Session stopped');
    }
  }

  const applyTransformation = async (imageUrl: string | null) => {
    if (!realtimeClientRef.current) return;
    
    try {
      if (imageUrl) {
        toast.info('Applying image transformation...');
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        await realtimeClientRef.current.set({
          prompt: prompt,
          enhance: true,
          image: blob
        });
        toast.success('Image applied to stream!');
      } else {
        await realtimeClientRef.current.setPrompt(prompt, { enhance: true });
      }
    } catch (err) {
      console.error('Failed to apply transformation:', err);
      toast.error('Failed to update stream with image');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const result = reader.result as string;
        setUploadedImage(result);
        if (isStreaming) {
          await applyTransformation(result);
        } else {
          toast.success('Image selected. Click Start to begin streaming.');
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const getRemainingSeconds = () => {
    return Math.floor(credits / CREDITS_PER_SECOND);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `~${mins}m ${secs}s`;
    }
    return `~${secs}s`;
  };

  return (
    <div className="w-screen h-screen bg-[#111111] flex flex-col font-sans text-white overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 flex-shrink-0 relative z-10 app-region-drag">
        <div className="flex items-center gap-[2px]">
          <img src="./logo.png" alt="Logo" className="w-8 h-8 object-cover rounded-full mr-2" />
          <span className="text-xl font-bold tracking-widest text-[#FFFFFF]">FORMAT-BOY</span>
          <span className="text-xl font-medium tracking-widest text-[#71717A]">.CAM</span>
        </div>
        <div className="flex items-center gap-1 app-region-no-drag">
          <button title="Minimize" aria-label="Minimize" onClick={() => handleWindowControl('minimize')} className="p-2 text-[#71717A] hover:text-white transition-colors focus:outline-none">
            <Minus className="w-[18px] h-[18px]" />
          </button>
          <button title="Maximize" aria-label="Maximize" onClick={() => handleWindowControl('maximize')} className="p-2 text-[#71717A] hover:text-white transition-colors focus:outline-none">
            <Square className="w-[15px] h-[15px]" />
          </button>
          <button title="Close" aria-label="Close" onClick={() => handleWindowControl('close')} className="p-2 text-[#71717A] hover:text-[#FFFFFF] hover:bg-red-500 rounded transition-colors focus:outline-none">
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative flex items-center justify-center bg-[#171717] rounded-tl-lg rounded-tr-lg border-t border-l border-r border-[#222222] sm:mx-0 mx-0 mt-2 overflow-hidden shadow-inner">
         <video 
            id="output"
            ref={outputVideoRef}
            autoPlay 
            playsInline
            muted
            className={`w-full h-full object-contain ${isStreaming ? 'block' : 'hidden'} will-change-transform [transform:translateZ(0)] [backface-visibility:hidden] [image-rendering:auto]`}
          />

         {!isStreaming && (
            <div className="flex flex-col items-center justify-center gap-6 p-8">
               <div className="w-16 h-16 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center overflow-hidden shadow-lg">
                 <img src="./logo.png" alt="Logo" className="w-full h-full object-cover" />
               </div>
               <div className="flex flex-col items-center gap-2">
                 <h2 className="text-lg font-semibold text-[#e5e5e5]">
                   {user?.name ? `Welcome, ${user.name}` : 'Welcome to Format-Boy'}
                 </h2>
                 <p className="text-sm text-[#71717a] text-center max-w-xs">
                   Click <span className="text-[#22C55E] font-semibold">Start</span> below to begin your AI-powered camera session
                 </p>
               </div>
               <div className="flex items-center gap-2 mt-2 px-4 py-2 rounded-md bg-[#111111] border border-[#222222]">
                 <Monitor className="w-4 h-4 text-[#525252]" />
                 <span className="text-xs font-medium tracking-wider text-[#525252] uppercase">Camera Feed Offline</span>
               </div>
            </div>
         )}
         
         <input
            type="file"
            title="Upload image"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
            id="image-upload"
          />
      </main>

      {/* Bottom Bar */}
      <footer className="h-[52px] bg-[#0A0A0A] flex items-stretch justify-between px-0 flex-shrink-0 relative z-10">
         <div className="flex items-center gap-1.5 px-4">
            <button 
              onClick={handleStart}
              disabled={isStreaming || isLoading}
              className={`h-[34px] px-3.5 rounded-sm flex items-center gap-2 border transition-all ${
                isStreaming 
                  ? 'bg-[#122A1F] border-[#133C29] text-[#22C55E] opacity-50' 
                  : 'bg-[#122A1F] border-[#133C29] text-[#22C55E] hover:bg-[#153828]'
              }`}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span className="font-semibold text-[13px] tracking-wide">{isLoading ? 'STARTING' : 'Start'}</span>
            </button>

            <button 
              onClick={() => { void handleStop(); }}
              disabled={!isStreaming}
              className="h-[34px] px-3.5 flex items-center gap-2 rounded-sm border bg-[#1E1E1E] border-[#2A2A2A] text-[#737373] hover:text-[#A3A3A3] transition-all"
            >
              <Square className="w-3.5 h-3.5 fill-current opacity-70" />
              <span className="font-medium text-[13px]">Stop</span>
            </button>

            <button 
              onClick={handleObsPreviewToggle}
              className={`h-[34px] px-3.5 flex items-center gap-2 rounded-sm border transition-all ml-2 ${
                isObsMode
                  ? 'bg-[#122A1F] border-[#133C29] text-[#22C55E]'
                  : 'bg-[#122A1F] border-[#133C29] text-[#22C55E] hover:bg-[#153828]'
              }`}
            >
              <Monitor className="w-3.5 h-3.5 opacity-80" />
              <span className="font-medium text-[13px]">{isObsMode ? 'OBS Preview On' : 'OBS Preview'}</span>
            </button>

             <button 
               onClick={() => fileInputRef.current?.click()}
               className="h-[34px] px-3.5 flex items-center gap-2 rounded-sm border bg-[#1E1E1E] border-[#2A2A2A] text-[#737373] hover:text-[#A3A3A3] transition-all"
             >
               <Upload className="w-3.5 h-3.5 opacity-80" />
               <span className="font-medium text-[13px]">{uploadedImage ? 'Change Image' : 'Upload Image'}</span>
             </button>

            {cameraDevices.length > 1 && (
              <select
                value={selectedCameraId}
                onChange={(e) => setSelectedCameraId(e.target.value)}
                title="Select camera"
                className="h-[34px] px-2 rounded-sm border bg-[#1E1E1E] border-[#2A2A2A] text-[#A3A3A3] text-[12px] ml-1 cursor-pointer focus:outline-none focus:border-[#3A3A3A]"
              >
                {cameraDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${cameraDevices.indexOf(device) + 1}`}
                  </option>
                ))}
              </select>
            )}
         </div>

         <div className="flex items-center h-full">
             <div className="flex items-center h-full gap-2 px-5">
                <Zap className="w-3.5 h-3.5 text-[#F59E0B] fill-[#F59E0B]" />
                <div className="flex flex-col justify-center gap-[2px]">
                   <span className="text-[8px] text-[#A1A1AA] font-bold tracking-widest uppercase">Usage Rate</span>
                   <div className="flex items-baseline gap-1">
                      <span className="text-xs font-bold text-[#E5E5E5] uppercase">2 credits</span>
                      <span className="text-[9px] text-[#737373] font-medium">/sec</span>
                   </div>
                </div>
                <button
                  onClick={() => navigate(ROUTES.PROTECTED.SETTINGS)}
                  title="Open settings"
                  aria-label="Open settings"
                  className="ml-2 h-[28px] w-[28px] rounded-sm border border-[#2A2A2A] bg-[#1E1E1E] text-[#A1A1AA] hover:bg-[#252525] hover:text-white transition-colors flex items-center justify-center"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
             </div>
            
            <div className="flex items-center h-full gap-3 px-5 border-l border-[#222222]">
               <div className="flex flex-col justify-center gap-[2px]">
                  <span className="text-[8px] text-[#A1A1AA] font-bold tracking-widest uppercase">Credits</span>
                  <div className="flex items-center gap-1.5">
                    <Coins className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-bold text-[#22C55E]">{Math.round(credits).toLocaleString()}</span>
                  </div>
               </div>
               <button 
                  onClick={() => navigate('/subscription')}
                  className="h-[28px] px-2.5 bg-[#FFFFFF] text-[#000000] hover:bg-[#E5E5E5] transition-colors rounded-sm text-[11px] font-bold flex items-center gap-1 shadow-sm ml-1"
               >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" />
                  Buy Credits
               </button>
            </div>

            <div className="flex items-center h-full gap-3 px-5 border-l border-[#0F284B] bg-[#0E1524] min-w-[140px]">
               <Clock className="w-4 h-4 text-[#3B82F6] stroke-[2.5]" />
               <div className="flex flex-col justify-center gap-[2px]">
                  <span className="text-[8px] text-[#60A5FA] font-bold tracking-widest uppercase">Remaining</span>
                  <span className="text-xs font-bold text-[#E5E5E5]">{formatTime(getRemainingSeconds())}</span>
               </div>
            </div>
         </div>
      </footer>
    </div>
  );
}

export default Dashboard;

