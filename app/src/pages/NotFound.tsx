import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Home, ArrowLeft } from 'lucide-react';

function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#09090b] to-[#0f0f10] flex flex-col items-center justify-center text-center px-4">
      <div className="mb-8">
        <h1 className="text-[150px] font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-[#3f3f46] leading-none mb-4">
          404
        </h1>
        <div className="w-16 h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full mx-auto mb-6" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-3">Page Not Found</h2>
      <p className="text-[#a1a1aa] mb-8 max-w-md">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <Link to="/dashboard">
          <Button className="h-11 px-6 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-medium rounded-xl shadow-lg shadow-blue-500/20">
            <Home className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>
        <Button 
          variant="outline" 
          onClick={() => window.history.back()}
          className="h-11 px-6 border-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#18181b] rounded-xl"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Go Back
        </Button>
      </div>
    </div>
  );
}

export default NotFound;
