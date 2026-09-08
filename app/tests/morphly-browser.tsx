import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { Toaster } from 'sonner';
import Dashboard from '../src/pages/Dashboard';
import '../src/index.css';

declare global {
  interface Window { morphlyTest: { starts: number; stops: number; prompt: string; authenticated: boolean; denyCamera: boolean } }
}
window.morphlyTest = { starts: 0, stops: 0, prompt: '', authenticated: false, denyCamera: false };
const canvas = document.createElement('canvas');
canvas.width = 640; canvas.height = 360;
const context = canvas.getContext('2d')!;
setInterval(() => { context.fillStyle = 'black'; context.fillRect(0, 0, 640, 360); }, 50);
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
  if (window.morphlyTest.denyCamera) throw new DOMException('Permission denied', 'NotAllowedError');
  return canvas.captureStream(20);
} });
Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [{ deviceId: 'fixture-camera', groupId: 'fixture', kind: 'videoinput', label: 'Integrated test camera' }] });
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/camera']}>
    <Routes><Route path="/camera" element={<Dashboard />} /><Route path="*" element={<Link to="/camera">Return to camera</Link>} /></Routes>
    <Toaster />
  </MemoryRouter>,
);
