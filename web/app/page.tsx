'use client';

import { useState, useEffect } from 'react';
import { Play, Square, Wallet, DollarSign, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Purchase {
  id: number;
  token_symbol: string;
  token_mint: string;
  sol_amount: number;
  status: string;
  our_signature: string | null;
  failure_reason: string | null;
  created_at: string;
}

interface Status {
  isMonitoring: boolean;
  config: {
    watchAddresses: string[];
    purchaseAmountSOL: number;
    checkInterval: string;
    enableLiveTrading: boolean;
  };
}

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [watchAddresses, setWatchAddresses] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch status and purchases
  const fetchData = async () => {
    try {
      const [statusRes, purchasesRes] = await Promise.all([
        axios.get(`${API_URL}/api/status`),
        axios.get(`${API_URL}/api/purchases`),
      ]);
      
      setStatus(statusRes.data);
      setPurchases(purchasesRes.data.purchases || []);
      
      if (statusRes.data.config.watchAddresses.length > 0) {
        setWatchAddresses(statusRes.data.config.watchAddresses.join('\n'));
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      const addresses = watchAddresses.split('\n').filter(a => a.trim());
      await axios.post(`${API_URL}/api/start`, { watchAddresses: addresses });
      await fetchData();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
    setLoading(false);
  };

  const handleStop = async () => {
    setLoading(true);
    setError(null);
    try {
      await axios.post(`${API_URL}/api/stop`);
      await fetchData();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
    setLoading(false);
  };

  const isMonitoring = status?.isMonitoring || false;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-gray-900 dark:via-purple-900 dark:to-gray-900">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-2">
            <DollarSign className="w-12 h-12 text-green-500" />
            <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              10 Dollar Monster
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            Automatically buy $10 worth of new tokens from wallets you follow
          </p>
        </div>

        {/* Status Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className={`w-4 h-4 rounded-full ${isMonitoring ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                {isMonitoring ? 'Monitoring Active' : 'Monitoring Stopped'}
              </h2>
            </div>
            <div className="flex gap-3">
              {!isMonitoring ? (
                <button
                  onClick={handleStart}
                  disabled={loading}
                  className="flex items-center gap-2 px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold transition-all disabled:opacity-50 shadow-lg hover:shadow-xl transform hover:scale-105"
                >
                  <Play className="w-5 h-5" />
                  Start Monitoring
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  disabled={loading}
                  className="flex items-center gap-2 px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition-all disabled:opacity-50 shadow-lg hover:shadow-xl transform hover:scale-105"
                >
                  <Square className="w-5 h-5" />
                  Stop Monitoring
                </button>
              )}
            </div>
          </div>

          {/* Config Grid */}
          {status && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet className="w-5 h-5 text-blue-600" />
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Watching</span>
                </div>
                <p className="text-2xl font-bold text-gray-800 dark:text-white">
                  {status.config.watchAddresses.length} Wallets
                </p>
              </div>

              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-5 h-5 text-green-600" />
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Purchase Amount</span>
                </div>
                <p className="text-2xl font-bold text-gray-800 dark:text-white">
                  {status.config.purchaseAmountSOL} SOL
                </p>
              </div>

              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-5 h-5 text-purple-600" />
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Check Interval</span>
                </div>
                <p className="text-2xl font-bold text-gray-800 dark:text-white">
                  {status.config.checkInterval}
                </p>
              </div>
            </div>
          )}

          {/* Trading Mode Badge */}
          {status && (
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                status.config.enableLiveTrading 
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' 
                  : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
              }`}>
                {status.config.enableLiveTrading ? '🔴 LIVE TRADING' : '📝 PAPER TRADING'}
              </span>
            </div>
          )}
        </div>

        {/* Wallet Addresses Configuration */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 mb-6">
          <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
            <Wallet className="w-6 h-6 text-blue-500" />
            Wallet Addresses to Monitor
          </h3>
          <textarea
            value={watchAddresses}
            onChange={(e) => setWatchAddresses(e.target.value)}
            disabled={isMonitoring}
            placeholder="Enter wallet addresses (one per line)&#10;Example:&#10;7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU&#10;5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1"
            className="w-full h-32 px-4 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-blue-500 dark:bg-gray-700 dark:text-white font-mono text-sm disabled:opacity-50"
          />
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {isMonitoring 
              ? '⚠️ Stop monitoring to edit wallet addresses' 
              : 'Add wallet addresses you want to monitor (one per line)'}
          </p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-lg p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-red-500" />
            <p className="text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Purchase History */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6">
          <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-4">
            Purchase History
          </h3>
          
          {purchases.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              No purchases yet. Start monitoring to begin!
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {purchases.map((purchase) => (
                <div
                  key={purchase.id}
                  className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-4 flex-1">
                    {purchase.status === 'success' ? (
                      <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
                    )}
                    
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-gray-800 dark:text-white">
                          {purchase.token_symbol}
                        </span>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          {purchase.sol_amount} SOL
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        {purchase.token_mint.slice(0, 8)}...{purchase.token_mint.slice(-8)}
                      </div>
                      {purchase.failure_reason && (
                        <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                          {purchase.failure_reason}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(purchase.created_at).toLocaleDateString()}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(purchase.created_at).toLocaleTimeString()}
                    </div>
                    {purchase.our_signature && (
                      <a
                        href={`https://solscan.io/tx/${purchase.our_signature}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline"
                      >
                        View TX
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-gray-500 dark:text-gray-400 text-sm">
          <p>🤖 Powered by Solana & Jupiter</p>
        </div>
      </div>
    </div>
  );
}
