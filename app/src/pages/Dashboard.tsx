import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Play, Square, Clock, Zap, Monitor, Plus, Coins, Minus, X, Settings, Eye, EyeOff, Camera } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { apiFetch, getApiUrl } from '@/lib/api-client';
import { ROUTES } from '@/lib/routes';
import { VirtualCameraService } from '@/services/VirtualCameraService';
import { isFiniteNumber } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { morphlySession, morphlyDiagnostic, morphlyErrorMessage } from '@/lib/morphly-session';
import { LIVE_MODELS, loadLiveModel, saveLiveModel, type LiveModelId } from '@/lib/live-models';
import { applyMorphlyInput } from '@/lib/morphly-input';

const PREVIEW_WINDOW_NAME = 'format-boy-preview';
const PREVIEW_WINDOW_FEATURES = 'popup=yes,width=1280,height=720,minWidth=640,minHeight=360,resizable=yes,scrollbars=no';
const MORPHLY_SDK_URL = 'https://morphly.fun/sdk/morphly.js';
// Capture preferences; the selected model determines the actual output profile.
const MORPHLY_REALTIME_WIDTH = 1280;
const MORPHLY_REALTIME_HEIGHT = 720;
const MORPHLY_REALTIME_FPS = 30;
const MORPHLY_OUTPUT_RESOLUTION = '1080p';
const MORPHLY_MAX_SESSION_SECONDS = 30;
const MORPHLY_FIRST_FRAME_TIMEOUT_MS = 20_000;

function isVirtualCameraSource(device: MediaDeviceInfo) {
  const label = device.label.toLowerCase();
  return label.includes('call me') || label.includes('format-boy cam') || label.includes('windows virtual camera');
}

function getPreferredCameraId(devices: MediaDeviceInfo[]) {
  const builtin = devices.find((device) => {
    const label = device.label.toLowerCase();
    return label.includes('integrated') ||
      label.includes('built-in') ||
      label.includes('facetime') ||
      label.includes('internal');
  });

  return builtin?.deviceId || devices[0]?.deviceId || '';
}

async function apiRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(endpoint, {
    retries: options?.method === 'POST' ? 0 : undefined,
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw Object.assign(new Error(errorData.error || errorData.message || `API Error: ${response.statusText}`), {
      code: errorData.code, status: response.status,
    });
  }
  return response.json();
}

function emitElectronLog(level: 'log' | 'info' | 'warn' | 'error', message: string, data?: unknown) {
  try {
    if (typeof window !== 'undefined' && typeof window.require !== 'undefined') {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('renderer-log', { level, message, data });
    }
  } catch {
    // Ignore logging bridge failures.
  }
}


function Dashboard() {
  const { user } = useAuth();
  const { credits, access, setCredits, setSessionStatus } = useApp();
  const navigate = useNavigate();
  const phase = useSyncExternalStore(morphlySession.subscribe, morphlySession.getSnapshot);
  const isStreaming = phase === 'live';
  const isLoading = phase === 'starting';
  const isStopping = phase === 'stopping';
  const stopPending = phase === 'stop-pending';
  const mountedRef = useRef(true);
  const [isObsMode, setIsObsMode] = useState(false);
  const [isGhostMode, setIsGhostMode] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const uploadedImageRef = useRef<File | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [cameraDiscoveryMessage, setCameraDiscoveryMessage] = useState('Finding cameras...');
  const [liveModel, setLiveModel] = useState<LiveModelId>(() => loadLiveModel());
  const prompt = 'Become the character in the reference image';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const outputVideoRef = useRef<HTMLVideoElement>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const virtualCameraRef = useRef<VirtualCameraService | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewWindowRef = useRef<Window | null>(null);

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
    toast.success('OBS can now capture the "CALL ME preview" window.');
  }, [getPreviewUrl]);

  const handleObsPreviewToggle = useCallback(() => {
    if (previewWindowRef.current && !previewWindowRef.current.closed) {
      closeObsPreviewWindow();
      return;
    }

    openObsPreviewWindow();
  }, [closeObsPreviewWindow, openObsPreviewWindow]);

  const handleGhostModeToggle = useCallback(() => {
    const newValue = !isGhostMode;
    setIsGhostMode(newValue);
    
    if (typeof window.require !== 'undefined') {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('toggle-capture-protection', { isProtected: newValue });
      
      if (newValue) {
        toast.success("Ghost Mode ON: App is now invisible to OBS Display Capture");
      } else {
        toast.info("Ghost Mode OFF: App is visible again");
      }
    }
  }, [isGhostMode]);

  const handleWindowControl = (action: 'minimize' | 'maximize' | 'close') => {
    if (typeof window.require !== 'undefined') {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send(`window-${action}`);
    }
  };

  const startVirtualCamera = useCallback((video: HTMLVideoElement | null) => {
    if (!video) {
      return;
    }

    if (!virtualCameraRef.current) {
      virtualCameraRef.current = new VirtualCameraService();
    }

    void virtualCameraRef.current.start(video).catch((error) => {
      console.error('Virtual camera start error:', error);
    });
  }, []);

  const stopVirtualCamera = useCallback(() => {
    virtualCameraRef.current?.stop();
    virtualCameraRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      void morphlySession.stop().catch(() => {
        toast.error('Stop is pending. Return to the camera to Retry Stop.', {
          id: 'morphly-stop-pending',
          duration: Infinity,
          action: { label: 'Retry Stop', onClick: () => { void morphlySession.stop().catch(() => {}); } },
        });
      });
      webcamStreamRef.current?.getTracks().forEach((track) => track.stop());
      stopVirtualCamera();
      closeObsPreviewWindow(false);
    };
  }, [closeObsPreviewWindow, stopVirtualCamera, user?.id]);

  useEffect(() => {
    setSessionStatus(isStreaming ? 'LIVE' : 'IDLE');
  }, [isStreaming, setSessionStatus]);

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

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    let isCancelled = false;

    if (!mediaDevices?.enumerateDevices || !mediaDevices?.getUserMedia) {
      setCameraDiscoveryMessage('Camera access is unavailable');
      return;
    }

    const applyCameraList = (devices: MediaDeviceInfo[]) => {
      const videoDevices = devices
        .filter((device) => device.kind === 'videoinput')
        .filter((device) => !isVirtualCameraSource(device));

      if (!isCancelled) {
        setCameraDevices(videoDevices);
        setCameraDiscoveryMessage(videoDevices.length > 0 ? '' : 'No camera detected');
        setSelectedCameraId((currentCameraId) => {
          const selectedStillAvailable = videoDevices.some(
            (device) => device.deviceId === currentCameraId
          );
          return selectedStillAvailable ? currentCameraId : getPreferredCameraId(videoDevices);
        });
      }

      return videoDevices;
    };

    const enumerateCameras = async () => {
      const devices = await mediaDevices.enumerateDevices();
      return {
        allVideoDevices: devices.filter((device) => device.kind === 'videoinput'),
        selectableCameras: applyCameraList(devices)
      };
    };

    const refreshCameras = async () => {
      try {
        await enumerateCameras();
      } catch (error) {
        console.error('Failed to enumerate cameras:', error);
        if (!isCancelled) {
          setCameraDevices([]);
          setSelectedCameraId('');
          setCameraDiscoveryMessage('Could not load cameras');
        }
      }
    };

    const initializeCameras = async () => {
      try {
        const initialResult = await enumerateCameras();
        const permissionIsNeeded =
          initialResult.allVideoDevices.length === 0 ||
          initialResult.allVideoDevices.some((device) => !device.label);

        if (!permissionIsNeeded) {
          return;
        }

        // Request camera access only from Start. Labels are refreshed after
        // permission is granted; opening the dashboard does not start capture.
        if (!isCancelled) {
          setCameraDiscoveryMessage('Press Start to allow camera access');
        }
      } catch (error) {
        console.error('Failed to initialize cameras:', error);
        if (!isCancelled) {
          setCameraDevices([]);
          setSelectedCameraId('');
          setCameraDiscoveryMessage('Could not load cameras');
        }
      }
    };

    const handleDeviceChange = () => {
      void refreshCameras();
    };

    void initializeCameras();
    mediaDevices.addEventListener('devicechange', handleDeviceChange);

    return () => {
      isCancelled = true;
      mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, []);

    useEffect(() => {
    if (isStreaming && outputVideoRef.current) {
      outputVideoRef.current.play().catch((err) => console.error('Play failed after streaming activated:', err));
    }
  }, [isStreaming]);

    const playPreviewVideo = useCallback(async (video: HTMLVideoElement | null, context: string) => {
      if (!video) return;

      try {
        await video.play();
      } catch (error) {
        console.error(`${context} play failed:`, error);
      }
    }, []);

  const startWebcam = async () => {
    try {
        const buildVideoConstraints = (): MediaTrackConstraints => {
          const videoConstraints: MediaTrackConstraints = {
            width: { ideal: MORPHLY_REALTIME_WIDTH },
            height: { ideal: MORPHLY_REALTIME_HEIGHT },
            frameRate: { ideal: MORPHLY_REALTIME_FPS, max: MORPHLY_REALTIME_FPS }
          };

          if (selectedCameraId) {
            videoConstraints.deviceId = { exact: selectedCameraId };
          } else {
            videoConstraints.facingMode = 'user';
          }

          return videoConstraints;
        };

        const stream = await navigator.mediaDevices.getUserMedia({
          video: buildVideoConstraints(),
          audio: false,
        });

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.contentHint = 'motion';
        emitElectronLog('info', '[Morphly] Camera input ready', videoTrack.getSettings());
      }

      webcamStreamRef.current = stream;
      morphlySession.own(stream);
      // Camera labels may have been hidden before this user-granted capture.
      void navigator.mediaDevices.enumerateDevices().then((devices) => {
        if (mountedRef.current) {
          setCameraDevices(devices.filter((device) => device.kind === 'videoinput' && !isVirtualCameraSource(device)));
          setCameraDiscoveryMessage('');
        }
      }).catch(() => {});
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
          void playPreviewVideo(webcamVideoRef.current, 'Hidden webcam preview');
      }
      if (outputVideoRef.current) {
        // Never expose the unprocessed camera through the visible output or
        // virtual camera while Morphly is connecting.
        outputVideoRef.current.pause();
        outputVideoRef.current.srcObject = null;
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

  const connectToMorphly = async (stream: MediaStream, userId: string) => {
    const attempt = morphlySession.attempt;
    const video = outputVideoRef.current;
    if (!video) throw Object.assign(new Error(), { code: 'VIDEO_PLAYBACK_FAILED' });
    const { createMorphlyClient } = await import(/* @vite-ignore */ MORPHLY_SDK_URL)
      .catch(() => { throw Object.assign(new Error(), { code: 'SDK_LOAD_FAILED' }); });
    if (morphlySession.cancelled) return;
    const client = createMorphlyClient({
      tokenEndpoint: `${getApiUrl('/morphly-token')}?userId=${encodeURIComponent(userId)}`,
      tokenEndpointHeaders: async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw Object.assign(new Error(), { code: 'APP_LOGIN_REQUIRED', status: 401 });
        return { Authorization: `Bearer ${session.access_token}` };
      },
    });
    const initialImage = uploadedImageRef.current ?? undefined;
    if (morphlySession.cancelled) return;
    const session = await client.realtime.connect(stream, {
      output: video,
      model: LIVE_MODELS[liveModel].apiModel,
      prompt: liveModel === 'm2' ? undefined : prompt,
      image: initialImage,
      editingType: liveModel === 'm2' ? 'subject_replacement' : undefined,
      audio: false,
      enhancePrompt: true,
      resolution: MORPHLY_OUTPUT_RESOLUTION,
      maxSessionSeconds: MORPHLY_MAX_SESSION_SECONDS,
      onStateChange: (state: string) => {
        if (attempt !== morphlySession.attempt) return;
        if (state === 'disconnected' || state === 'failed') {
          // SDK also stops on expiry/disconnection. Await that same stop object.
          void handleStop(false);
        }
      },
      onError: (error: unknown) => {
        if (attempt !== morphlySession.attempt) return;
        emitElectronLog('error', '[Morphly]', morphlyDiagnostic(error));
      },
    });
    morphlySession.attach(session);
    // Explicitly apply the latest selection to the connected engine. The file
    // may have changed while camera capture or SDK connection was pending.
    let appliedImage: File | null = null;
    while (!morphlySession.cancelled && uploadedImageRef.current && uploadedImageRef.current !== appliedImage) {
      const image = uploadedImageRef.current;
      await applyMorphlyInput(session, liveModel, prompt, image);
      appliedImage = image;
    }
    session.on('balance', (value: unknown) => {
      if (attempt !== morphlySession.attempt) return;
      morphlySession.updateBalance(value);
    });
    session.on('lowCredit', () => {
      if (attempt !== morphlySession.attempt) return;
      if (mountedRef.current) toast.warning('Live session credits are running low.');
    });
    session.on('creditsExhausted', () => {
      if (attempt !== morphlySession.attempt) return;
      if (mountedRef.current) toast.error('Live session credits are exhausted. Stopping the session.');
      void handleStop(false);
    });
    if (morphlySession.cancelled) return;
    // The SDK attaches and plays the actual output. Dark video is valid video.
    // Start the frame deadline only AFTER SDK connection/session creation.
    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (morphlySession.cancelled) {
          window.clearInterval(timer);
          resolve();
        } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
          window.clearInterval(timer);
          resolve();
        } else if (Date.now() - startedAt >= MORPHLY_FIRST_FRAME_TIMEOUT_MS) {
          window.clearInterval(timer);
          reject(Object.assign(new Error(), { code: 'OUTPUT_TIMEOUT' }));
        }
      }, 100);
    });
    if (!morphlySession.cancelled) startVirtualCamera(video);
  };

  const pollSessionStatus = async () => {
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
        emitElectronLog('warn', '[Session] Auto-stopping from status poll', response);
        await handleStop(false);
        toast.error('Session auto-ended - Insufficient credits');
      }
    } catch (error) {
      console.error('Poll error:', error);
      emitElectronLog('error', '[Session] Poll error', String(error));
    }
  };

  const handleStart = async () => {
    if (!user?.id) {
      toast.error('Please sign in before starting a session.');
      return;
    }
    if (liveModel === 'm2' && !uploadedImage) {
      toast.error('M2.5 needs an uploaded reference image before you start.');
      return;
    }
    if (!morphlySession.begin()) return; // Synchronous guard against double clicks.
    let live = false;
    try {
      const stream = await startWebcam();
      if (!stream || morphlySession.cancelled) return;
      const sessionResponse = await apiRequest<{ allowed: boolean; error?: string; credits?: number }>('/start-session', {
        method: 'POST',
        body: JSON.stringify({ userId: user.id }),
      });
      if (!sessionResponse.allowed) {
        throw Object.assign(new Error(sessionResponse.error || 'Unable to start the session.'), {
          code: 'APP_SESSION_REJECTED',
        });
      }
      morphlySession.onCleanup(async () => {
        const response = await apiRequest<{ remainingCredits?: number }>('/end-session', {
          method: 'POST', body: JSON.stringify({ userId: user.id }),
        });
        if (isFiniteNumber(response.remainingCredits)) setCredits(response.remainingCredits);
      });
      if (isFiniteNumber(sessionResponse.credits)) setCredits(sessionResponse.credits);
      if (morphlySession.cancelled) return;
      await connectToMorphly(stream, user.id);
      if (morphlySession.cancelled) return;
      live = true;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      // This is the existing app wallet policy, separate from SDK-owned Morphly billing.
      pollIntervalRef.current = setInterval(() => { void pollSessionStatus(); }, POLLING_INTERVAL);
      toast.success(`Connected with ${LIVE_MODELS[liveModel].label}`);
    } catch (error) {
      const message = morphlyErrorMessage(error);
      emitElectronLog('error', '[Morphly] Start failed', morphlyDiagnostic(error));
      if (mountedRef.current) {
        toast.error(message);
      }
    } finally {
      morphlySession.finishStart(live);
      if (!live || morphlySession.cancelled) await handleStop(false);
    }
  };

  async function handleStop(showToast = true) {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    stopVirtualCamera();
    stopWebcam();
    try {
      await morphlySession.stop();
      toast.dismiss('morphly-stop-pending');
      if (outputVideoRef.current) outputVideoRef.current.srcObject = null;
      if (mountedRef.current && showToast) {
        toast.info('Session stopped; settlement may still be pending.');
      }
    } catch (error) {
      if (mountedRef.current) {
        toast.error(morphlyErrorMessage(error));
      }
    }
  }

  const applyTransformation = async (image: File) => {
    if (!morphlySession.session) return;
    
    try {
      toast.info('Applying reference image...');
      await applyMorphlyInput(morphlySession.session, liveModel, prompt, image);
      toast.success('Reference image sent.');
    } catch (err) {
      emitElectronLog('error', '[Morphly] Image update failed', morphlyDiagnostic(err));
      toast.error('Failed to update stream with image');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadedImageRef.current = file;
      setUploadedImage(file);
      if (isStreaming) {
        await applyTransformation(file);
      } else {
        toast.success(isLoading ? 'Image selected. It will be applied when connected.' : 'Image selected. Click Start to begin streaming.');
      }
    }
  };

  return (
    <div className="w-screen h-screen bg-[#111111] flex flex-col font-sans text-white overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 flex-shrink-0 relative z-10 app-region-drag">
        <div className="flex items-center gap-[2px]">
          <img src="./logo.png" alt="Logo" className="w-8 h-8 object-cover rounded-full mr-2" />
          <span className="text-xl font-bold tracking-widest text-[#FFFFFF]">CALL ME</span>
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
          ref={webcamVideoRef}
          autoPlay
          playsInline
          muted
          className="hidden"
         />

         <video 
            id="output"
            ref={outputVideoRef}
            autoPlay 
            playsInline
            muted
            className={`w-full h-full object-contain ${isStreaming || isLoading ? 'block' : 'hidden'} will-change-transform [transform:translateZ(0)] [backface-visibility:hidden] [image-rendering:auto]`}
          />

         {!isStreaming && !isLoading && (
            <div className="flex flex-col items-center justify-center gap-6 p-8">
               <div className="w-16 h-16 rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center overflow-hidden shadow-lg">
                 <img src="./logo.png" alt="Logo" className="w-full h-full object-cover" />
               </div>
               <div className="flex flex-col items-center gap-2">
                 <h2 className="text-lg font-semibold text-[#e5e5e5]">
                   {user?.name ? `Welcome, ${user.name}` : 'Welcome to CALL ME'}
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
      <footer className="min-h-[52px] bg-[#0A0A0A] flex flex-wrap items-stretch justify-between px-0 flex-shrink-0 relative z-10">
         <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 px-3 py-2">
            <button 
              onClick={handleStart}
              disabled={phase !== 'idle'}
              className={`h-[34px] shrink-0 px-3.5 rounded-sm flex items-center gap-2 border transition-all ${
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
              disabled={phase === 'idle' || isStopping}
              className="h-[34px] shrink-0 px-3.5 flex items-center gap-2 rounded-sm border bg-[#1E1E1E] border-[#2A2A2A] text-[#737373] hover:text-[#A3A3A3] transition-all"
            >
              <Square className="w-3.5 h-3.5 fill-current opacity-70" />
              <span className="font-medium text-[13px]">{stopPending ? 'Retry Stop' : isStopping ? 'Stopping...' : 'Stop'}</span>
            </button>

            <div className="ml-1 flex h-[34px] min-w-[140px] max-w-[220px] flex-1 items-center rounded-sm border border-[#2A2A2A] bg-[#1E1E1E] text-[#A3A3A3] focus-within:border-[#3A3A3A]">
              <Camera className="ml-2 h-3.5 w-3.5 shrink-0 opacity-80" />
              <select
                value={selectedCameraId}
                onChange={(event) => setSelectedCameraId(event.target.value)}
                disabled={cameraDevices.length === 0 || phase !== 'idle'}
                title={isStreaming ? 'Stop the session to change camera' : cameraDiscoveryMessage || 'Select camera'}
                aria-label="Camera input"
                className="h-full min-w-0 flex-1 cursor-pointer bg-transparent px-2 text-[12px] text-[#A3A3A3] focus:outline-none disabled:cursor-not-allowed disabled:text-[#666666]"
              >
                {cameraDevices.length === 0 ? (
                  <option value="">{cameraDiscoveryMessage}</option>
                ) : (
                  cameraDevices.map((device, index) => (
                    <option
                      key={device.deviceId || `${device.groupId}-${index}`}
                      value={device.deviceId}
                    >
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>

            <label className="ml-1 flex h-[34px] shrink-0 items-center rounded-sm border border-[#2A2A2A] bg-[#1E1E1E] px-2 text-[#A3A3A3]">
              <span className="sr-only">Model</span>
              <select
                aria-label="Model"
                value={liveModel}
                disabled={phase !== 'idle'}
                title={phase === 'idle' ? 'Choose M2.1 or M2.5' : 'Stop the session to change model'}
                onChange={(event) => {
                  const next: LiveModelId = event.target.value === 'm2' ? 'm2' : 'm1';
                  setLiveModel(next);
                  saveLiveModel(next);
                }}
                className="h-full cursor-pointer bg-transparent text-[12px] text-[#A3A3A3] focus:outline-none disabled:cursor-not-allowed disabled:text-[#666666]"
              >
                <option value="m1">{LIVE_MODELS.m1.label}</option>
                <option value="m2">{LIVE_MODELS.m2.label}</option>
              </select>
            </label>

            <button 
              onClick={handleObsPreviewToggle}
              title={isObsMode ? 'Close OBS preview' : 'Open OBS preview'}
              className={`h-[34px] shrink-0 px-3 flex items-center gap-2 rounded-sm border transition-all ml-1 ${
                isObsMode
                  ? 'bg-[#122A1F] border-[#133C29] text-[#22C55E]'
                  : 'bg-[#1E1E1E] border-[#2A2A2A] text-[#737373] hover:text-[#A3A3A3]'
              }`}
            >
              <Monitor className="w-3.5 h-3.5 opacity-80" />
              <span className="hidden font-medium text-[13px] min-[1200px]:inline">{isObsMode ? 'OBS Preview On' : 'OBS Preview'}</span>
            </button>

             <button 
               onClick={handleGhostModeToggle}
               title={isGhostMode ? "Make app visible to OBS again" : "Hide app from OBS Screen Capture"}
               className={`h-[34px] shrink-0 px-3 flex items-center gap-2 rounded-sm border transition-all ml-1 ${
                 isGhostMode
                   ? 'bg-[#2A1215] border-[#3C1318] text-[#EF4444]'
                   : 'bg-[#1E1E1E] border-[#2A2A2A] text-[#737373] hover:text-[#A3A3A3]'
               }`}
             >
               {isGhostMode ? <EyeOff className="w-3.5 h-3.5 opacity-80" /> : <Eye className="w-3.5 h-3.5 opacity-80" />}
               <span className="hidden font-medium text-[13px] min-[1200px]:inline">{isGhostMode ? 'Ghost Mode On' : 'Ghost Mode'}</span>
              </button>

             <button 
               onClick={() => fileInputRef.current?.click()}
               title={uploadedImage ? `Change reference image: ${uploadedImage.name}` : 'Upload image'}
               className="h-[34px] shrink-0 px-3 flex items-center gap-2 rounded-sm border bg-[#1E1E1E] border-[#2A2A2A] text-[#737373] hover:text-[#A3A3A3] transition-all ml-1"
             >
               <Upload className="w-3.5 h-3.5 opacity-80" />
               <span className="hidden font-medium text-[13px] min-[1200px]:inline">{uploadedImage ? 'Change Image' : 'Upload Image'}</span>
             </button>
         </div>

         <div className="flex shrink-0 items-center h-full">
             <div className="flex items-center h-full gap-2 px-3 min-[1360px]:px-5">
                <div className="hidden items-center gap-2 min-[1360px]:flex">
                  <Zap className="w-3.5 h-3.5 text-[#F59E0B] fill-[#F59E0B]" />
                  <div className="flex flex-col justify-center gap-[2px]">
                   <span className="text-[8px] text-[#A1A1AA] font-bold tracking-widest uppercase">App usage rate</span>
                   <div className="flex items-baseline gap-1">
                      <span className="text-xs font-bold text-[#E5E5E5] uppercase">2 credits</span>
                      <span className="text-[9px] text-[#737373] font-medium">/sec</span>
                   </div>
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
            
            <div className="flex items-center h-full gap-3 px-3 border-l border-[#222222] min-[1200px]:px-5">
               <div className="flex flex-col justify-center gap-[2px]">
                  <span className="text-[8px] text-[#A1A1AA] font-bold tracking-widest uppercase">{access.active ? access.label : 'No active plan'}</span>
                  <div className="flex items-center gap-1.5">
                    <Coins className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-bold text-[#22C55E]">{access.active ? access.planName || access.label : `${Math.round(credits).toLocaleString()} credits left`}</span>
                  </div>
               </div>
               <button 
                  onClick={() => navigate('/subscription')}
                  className="h-[28px] px-2.5 bg-[#FFFFFF] text-[#000000] hover:bg-[#E5E5E5] transition-colors rounded-sm text-[11px] font-bold flex items-center gap-1 shadow-sm ml-1"
               >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" />
                  Plans
               </button>
            </div>

            <div className="hidden items-center h-full gap-3 px-5 border-l border-[#0F284B] bg-[#0E1524] min-w-[140px] min-[1000px]:flex">
               <Clock className="w-4 h-4 text-[#3B82F6] stroke-[2.5]" />
               <div className="flex flex-col justify-center gap-[2px]">
                  <span className="text-[8px] text-[#60A5FA] font-bold tracking-widest uppercase">Session limit</span>
                  <span className="text-xs font-bold text-[#E5E5E5]">{MORPHLY_MAX_SESSION_SECONDS}s</span>
               </div>
            </div>
          </div>
       </footer>


     </div>
  );
}

export default Dashboard;

