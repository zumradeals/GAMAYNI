import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Server, Plus, Copy, Circle } from 'lucide-react';

export function Servers() {
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [serverName, setServerName] = useState('');

  const loadServers = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('servers')
      .select('*')
      .order('created_at', { ascending: false });
    setServers(data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadServers();
  }, []);

  const createServer = async () => {
    if (!serverName) return;

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    await supabase.from('servers').insert({
      user_id: userData.user.id,
      name: serverName,
      hostname: '',
      ip: '0.0.0.0',
      status: 'offline',
    });

    setServerName('');
    setShowForm(false);
    loadServers();
  };

  const copyInstallCommand = (token: string) => {
    const installUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/runner-install?token=${token}`;
    const command = `curl -sSL "${installUrl}" | sudo bash`;
    navigator.clipboard.writeText(command);
    alert('Install command copied to clipboard!');
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 rounded-lg shadow-xl p-6 border border-slate-700">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Server className="w-6 h-6" />
            Servers
          </h2>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Server
          </button>
        </div>

        {showForm && (
          <div className="mb-6 p-4 bg-slate-700 rounded-lg">
            <input
              type="text"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              placeholder="Server name (e.g., production-web-01)"
              className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={createServer}
                disabled={!serverName}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-slate-400">Loading servers...</p>
        ) : servers.length === 0 ? (
          <p className="text-slate-400">No servers yet. Add your first server to get started.</p>
        ) : (
          <div className="space-y-3">
            {servers.map((server) => (
              <div
                key={server.id}
                className="bg-slate-700 rounded-lg p-4 border border-slate-600"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <Circle
                      className={`w-3 h-3 ${
                        server.status === 'online' ? 'fill-green-500 text-green-500' : 'fill-slate-500 text-slate-500'
                      }`}
                    />
                    <h3 className="text-lg font-semibold text-white">{server.name}</h3>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm ${
                    server.status === 'online' ? 'bg-green-900/50 text-green-300' : 'bg-slate-600 text-slate-300'
                  }`}>
                    {server.status}
                  </span>
                </div>
                <div className="text-sm text-slate-400 space-y-1">
                  <p>Hostname: {server.hostname || 'Not set'}</p>
                  <p>IP: {server.ip || 'Not set'}</p>
                  <p>Last heartbeat: {server.last_heartbeat ? new Date(server.last_heartbeat).toLocaleString() : 'Never'}</p>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-600">
                  <button
                    onClick={() => copyInstallCommand(server.token)}
                    className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                    Copy Install Command
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
