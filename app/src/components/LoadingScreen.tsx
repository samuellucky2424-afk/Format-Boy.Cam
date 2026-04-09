export default function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full border-4 border-blue-500 border-t-transparent animate-spin"></div>
        <p className="text-sm text-[#71717a]">Loading...</p>
      </div>
    </div>
  );
}
