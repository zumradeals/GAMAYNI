import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Hammer, Download, Copy } from 'lucide-react';

export function Factory() {
  const [domain, setDomain] = useState('example.com');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const forgeContract = async () => {
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) throw new Error('Not authenticated');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hamayni-factory`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            template_slug: 'hamayni.nginx.standalone',
            inputs: { domain },
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to forge contract');
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to forge contract');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  const downloadScript = () => {
    if (!result) return;
    const blob = new Blob([result.compiled_script], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hamayni-${result.contract_id}.sh`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 rounded-lg shadow-xl p-6 border border-slate-700">
        <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
          <Hammer className="w-6 h-6" />
          Contract Factory
        </h2>

        <p className="text-slate-400 mb-6">
          Forge a new HFC contract from the Nginx template. This will generate a signed contract
          and compiled Bash script.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Domain Name
            </label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Template
            </label>
            <input
              type="text"
              value="hamayni.nginx.standalone"
              disabled
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-400"
            />
          </div>

          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <button
            onClick={forgeContract}
            disabled={loading || !domain}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Hammer className="w-5 h-5" />
            {loading ? 'Forging Contract...' : 'Forge Contract'}
          </button>
        </div>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="bg-green-900/50 border border-green-700 text-green-200 px-4 py-3 rounded-lg">
            Contract forged successfully! Contract ID: <code className="font-mono">{result.contract_id}</code>
          </div>

          <div className="bg-slate-800 rounded-lg shadow-xl p-6 border border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">Compiled Bash Script</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => copyToClipboard(result.compiled_script)}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                >
                  <Copy className="w-4 h-4" />
                  Copy
                </button>
                <button
                  onClick={downloadScript}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
              </div>
            </div>
            <pre className="bg-slate-900 p-4 rounded-lg overflow-x-auto text-sm text-slate-300 max-h-96">
              {result.compiled_script}
            </pre>
          </div>

          <div className="bg-slate-800 rounded-lg shadow-xl p-6 border border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">HFC JSON Contract</h3>
              <button
                onClick={() => copyToClipboard(JSON.stringify(result.hfc_json, null, 2))}
                className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                <Copy className="w-4 h-4" />
                Copy
              </button>
            </div>
            <pre className="bg-slate-900 p-4 rounded-lg overflow-x-auto text-sm text-slate-300 max-h-96">
              {JSON.stringify(result.hfc_json, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
