import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Play, Square, Clock, Zap, Monitor, Settings, Plus, Camera, Coins } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { apiFetch } from '@/lib/api-client';
import { VirtualCameraService } from '@/services/VirtualCameraService';

interface RealtimeClient {
  disconnect: () => void;
  set: (config: { prompt?: string; enhance?: boolean; image?: string | Blob | File }) => Promise<void>;
  setPrompt: (text: string, options?: { enhance?: boolean }) => Promise<void>;
}

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
  const [isVirtualCamActive, setIsVirtualCamActive] = useState(false);
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
  const virtualCamRef = useRef<VirtualCameraService | null>(null);

  const CREDITS_PER_SECOND = 2;
  const POLLING_INTERVAL = 10000; // 10s to reduce network/CPU overhead during streaming

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
      if (virtualCamRef.current) {
        virtualCamRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isObsMode) {
        setIsObsMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isObsMode]);

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
    } else if (!isStreaming) {
      if (virtualCamRef.current) {
        virtualCamRef.current.stop();
        virtualCamRef.current = null;
      }
      setIsVirtualCamActive(false);
    }
  }, [isStreaming]);

  const toggleVirtualCamera = async (activate?: boolean) => {
    const shouldActivate = activate !== undefined ? activate : !isVirtualCamActive;
    
    if (shouldActivate) {
      if (!outputVideoRef.current) return;
      
      virtualCamRef.current = new VirtualCameraService();
      const stream = await virtualCamRef.current.start(outputVideoRef.current);
      
      if (stream) {
        setIsVirtualCamActive(true);
        // Notify Electron main process
        try {
          // @ts-ignore - electron bridge
          if (window.electron) {
            // @ts-ignore
            await window.electron.invoke('virtual-camera:start');
          }
        } catch (e) { console.log('Electron bridge not available'); }
        
        toast.success('Virtual Camera started - Select "Morphly Virtual Cam" in your app');
      }
    } else {
      if (virtualCamRef.current) {
        virtualCamRef.current.stop();
        virtualCamRef.current = null;
      }
      setIsVirtualCamActive(false);
      
      try {
        // @ts-ignore
        if (window.electron) {
          // @ts-ignore
          await window.electron.invoke('virtual-camera:stop');
        }
      } catch (e) {}
      
      toast.info('Virtual Camera stopped');
    }
  };

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
      const response = await apiRequest<{ credits?: number; balance?: number; secondsUsed: number; creditsUsed?: number; cost?: number; remainingCredits?: number; remainingBalance?: number; shouldStop: boolean; forceEnd?: boolean }>(`/session-status?userId=${user?.id}`);
      
      const latestCredits =
        response.remainingCredits !== undefined
          ? response.remainingCredits
          : response.credits !== undefined
            ? response.credits
            : response.remainingBalance !== undefined
              ? response.remainingBalance
              : response.balance || 0;
      setCredits(latestCredits);

      if (response.shouldStop || response.forceEnd) {
        handleStop();
        toast.error('Session auto-ended - Insufficient credits');
      }
    } catch (error) {
      console.error('Poll error:', error);
    }
  }, []);

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

      // Update credits from server response
      if (startResponse.credits !== undefined) {
        setCredits(startResponse.credits);
      }
        
      const sessionToken = startResponse.token || '';

      if (!stream) {
        setIsLoading(false);
        return;
      }

      await connectToDecart(stream, sessionToken);

      setIsStreaming(true);
      setSessionStatus('LIVE');
      
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

  const handleStop = async () => {
    try {
      const response = await apiRequest<{ remainingCredits?: number; remainingBalance?: number }>('/end-session', { 
        method: 'POST',
        body: JSON.stringify({ userId: user?.id })
      });
      
      // Update credits from server response
      if (response) {
        const latestCredits = response.remainingCredits ?? response.remainingBalance;
        if (latestCredits !== undefined) {
          setCredits(latestCredits);
        }
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
    
    toast.info('Session stopped');
  };

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
      <header className="flex items-center justify-between px-6 py-4 flex-shrink-0 relative z-10">
        <div className="flex items-center gap-[2px]">
          <span className="text-xl font-bold tracking-widest text-[#FFFFFF]">MORPHLY</span>
          <span className="text-xl font-medium tracking-widest text-[#71717A]">.CAM</span>
        </div>
        <button title="Settings" className="p-2 text-[#71717A] hover:text-white transition-colors">
          <Settings className="w-[18px] h-[18px]" />
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative flex items-center justify-center bg-[#171717] rounded-tl-lg rounded-tr-lg border-t border-l border-r border-[#222222] sm:mx-0 mx-0 mt-2 overflow-hidden shadow-inner">
         <video 
            id="output"
            ref={outputVideoRef}
            autoPlay 
            playsInline
            muted
            className={isObsMode ? "w-full h-full object-cover" : "w-full h-full object-contain"}
            style={{ 
              display: isStreaming ? 'block' : 'none', 
              willChange: 'transform', 
              transform: 'translateZ(0)',
              backfaceVisibility: 'hidden',
              imageRendering: 'auto'
            }}
          />

         {!isStreaming && (
            <div className="flex flex-col items-center justify-center text-[#3F3F46] gap-5">
               <Monitor className="w-[50px] h-[50px] stroke-[1]" />
               <span className="text-xs font-semibold tracking-[0.2em] text-[#4A4A4A]">CAMERA FEED OFFLINE</span>
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
              onClick={handleStop}
              disabled={!isStreaming}
              className={`h-[34px] px-3.5 flex items-center gap-2 rounded-sm border bg-[#1E1E1E] border-[#2A2A2A] text-[#737373] hover:text-[#A3A3A3] transition-all`}
            >
              <Square className="w-3.5 h-3.5 fill-current opacity-70" />
              <span className="font-medium text-[13px]">Stop</span>
            </button>

            <button 
              onClick={() => setIsObsMode(!isObsMode)}
              className="h-[34px] px-3.5 flex items-center gap-2 rounded-sm border bg-[#1E1E1E] border-[#2A2A2A] text-[#737373] hover:text-[#A3A3A3] transition-all ml-2"
            >
              <Monitor className="w-3.5 h-3.5 opacity-80" />
              <span className="font-medium text-[13px]">OBS</span>
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

            <button 
              onClick={() => toggleVirtualCamera()}
              disabled={!isStreaming}
              className={`h-[34px] px-3.5 flex items-center gap-2 rounded-sm border transition-all ml-1 ${
                isVirtualCamActive 
                  ? 'bg-[#122A1F] border-[#133C29] text-[#22C55E]' 
                  : 'bg-[#1E1E1E] border-[#2A2A2A] text-[#737373] hover:text-[#A3A3A3]'
              }`}
            >
              <Camera className="w-3.5 h-3.5 opacity-80" />
              <span className="font-medium text-[13px]">{isVirtualCamActive ? 'Cam Active' : 'Virtual Cam'}</span>
            </button>
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
