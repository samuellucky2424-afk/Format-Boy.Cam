import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useUI } from '@/context/UIContext';

export default function Layout() {
  const { sidebarOpen } = useUI();

  return (
    <div className="flex min-h-screen bg-[#09090b] overflow-x-hidden">
      <Sidebar />
      <main 
        className={`flex-1 transition-all duration-300 ease-in-out ${
          sidebarOpen ? 'lg:pl-56' : 'pl-0'
        }`}
      >
        <div className={`p-5 lg:p-8 transition-all duration-300 w-full ${!sidebarOpen ? 'pt-24 lg:pt-24' : 'pt-24 lg:pt-8'}`}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
