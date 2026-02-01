import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { FileText, Circle } from 'lucide-react';

export function Contracts() {
  const [contracts, setContracts] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    const [contractsRes, serversRes] = await Promise.all([
      supabase.from('contracts').select('*').order('created_at', { ascending: false }),
      supabase.from('servers').select('*'),
    ]);
    setContracts(contractsRes.data || []);
    setServers(serversRes.data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const assignServer = async (contractId: string, serverId: string) => {
    await supabase
      .from('contracts')
      .update({ server_id: serverId, updated_at: new Date().toISOString() })
      .eq('id', contractId);
    loadData();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING':
        return 'bg-yellow-900/50 text-yellow-300';
      case 'CLAIMED':
        return 'bg-blue-900/50 text-blue-300';
      case 'SUCCESS':
        return 'bg-green-900/50 text-green-300';
      case 'FAILED':
        return 'bg-red-900/50 text-red-300';
      default:
        return 'bg-slate-600 text-slate-300';
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 rounded-lg shadow-xl p-6 border border-slate-700">
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          <FileText className="w-6 h-6" />
          Contracts
        </h2>

        {loading ? (
          <p className="text-slate-400">Loading contracts...</p>
        ) : contracts.length === 0 ? (
          <p className="text-slate-400">No contracts yet. Forge your first contract in the Factory tab.</p>
        ) : (
          <div className="space-y-3">
            {contracts.map((contract) => {
              const server = servers.find((s) => s.id === contract.server_id);
              return (
                <div
                  key={contract.id}
                  className="bg-slate-700 rounded-lg p-4 border border-slate-600"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-semibold text-white font-mono">
                        {contract.id.slice(0, 8)}...
                      </h3>
                      <p className="text-sm text-slate-400">
                        {contract.hfc_json?.header?.template_slug || 'Unknown template'}
                      </p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-sm ${getStatusColor(contract.status)}`}>
                      {contract.status}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm text-slate-400 mb-3">
                    <p>Created: {new Date(contract.created_at).toLocaleString()}</p>
                    {contract.claimed_at && (
                      <p>Claimed: {new Date(contract.claimed_at).toLocaleString()}</p>
                    )}
                    <p>
                      Server: {server ? (
                        <span className="flex items-center gap-2 inline-flex">
                          <Circle
                            className={`w-2 h-2 ${
                              server.status === 'online' ? 'fill-green-500 text-green-500' : 'fill-slate-500 text-slate-500'
                            }`}
                          />
                          {server.name}
                        </span>
                      ) : (
                        'Not assigned'
                      )}
                    </p>
                  </div>

                  {contract.status === 'PENDING' && !contract.server_id && (
                    <div className="pt-3 border-t border-slate-600">
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Assign to server:
                      </label>
                      <select
                        onChange={(e) => assignServer(contract.id, e.target.value)}
                        className="w-full px-4 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Select a server...
                        </option>
                        {servers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.status})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {contract.execution_logs && (
                    <div className="mt-3 pt-3 border-t border-slate-600">
                      <details>
                        <summary className="text-sm text-slate-300 cursor-pointer hover:text-white">
                          View logs
                        </summary>
                        <pre className="mt-2 bg-slate-900 p-3 rounded text-xs text-slate-300 overflow-x-auto max-h-60">
                          {contract.execution_logs.logs || 'No logs available'}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
