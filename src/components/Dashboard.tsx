import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Factory } from './Factory';
import { Servers } from './Servers';
import { Contracts } from './Contracts';
import { LogOut } from 'lucide-react';

export function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'factory' | 'servers' | 'contracts'>('factory');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <header className="bg-slate-800/50 border-b border-slate-700 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">HAMAYNI Engine</h1>
            <p className="text-slate-400 text-sm">Infrastructure Contract Platform v3.1</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-slate-400 text-sm">{user?.email}</span>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('factory')}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'factory'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Factory
          </button>
          <button
            onClick={() => setActiveTab('servers')}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'servers'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Servers
          </button>
          <button
            onClick={() => setActiveTab('contracts')}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'contracts'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            Contracts
          </button>
        </div>

        {activeTab === 'factory' && <Factory />}
        {activeTab === 'servers' && <Servers />}
        {activeTab === 'contracts' && <Contracts />}
      </div>
    </div>
  );
}
