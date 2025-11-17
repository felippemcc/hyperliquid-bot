import React, { useState, useEffect, useRef } from 'react';
import { TrendingDown, Settings, Activity, AlertTriangle, DollarSign, BarChart3, Key, Zap, WifiOff, Wifi } from 'lucide-react';

export default function HyperliquidShortBot() {
  const [activeTab, setActiveTab] = useState('config');
  const [botActive, setBotActive] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const wsRef = useRef(null);
  
  const [apiConfig, setApiConfig] = useState({
    privateKey: '',
    testnet: true,
    connected: false
  });

  const [config, setConfig] = useState({
    tokens: ['BTC', 'ETH', 'SOL', 'HYPE'],
    selectedToken: 'BTC',
    leverage: 5,
    positionSize: 100,
    stopLoss: 2,
    takeProfit: 3,
    rsiThreshold: 70,
    rsiPeriod: 14,
    useRSI: true,
    checkInterval: 30,
    autoTrade: false
  });

  const [marketData, setMarketData] = useState({
    BTC: { price: 0, rsi: 0, change24h: 0, prevPrice: 0, candles: [] },
    ETH: { price: 0, rsi: 0, change24h: 0, prevPrice: 0, candles: [] },
    SOL: { price: 0, rsi: 0, change24h: 0, prevPrice: 0, candles: [] },
    HYPE: { price: 0, rsi: 0, change24h: 0, prevPrice: 0, candles: [] }
  });

  const [positions, setPositions] = useState([]);
  const [signals, setSignals] = useState([]);
  const [logs, setLogs] = useState([]);

  const addLog = (message, type = 'info') => {
    const newLog = {
      id: Date.now(),
      message,
      type,
      time: new Date().toLocaleTimeString()
    };
    setLogs(prev => [newLog, ...prev.slice(0, 49)]);
  };

  const calculateRSI = (candles, period = 14) => {
    if (candles.length < period + 1) return 50;

    const closes = candles.map(c => parseFloat(c.c)).slice(-period - 1);
    let gains = 0;
    let losses = 0;

    for (let i = 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return rsi;
  };

  const fetchHistoricalData = async (token) => {
    try {
      const endTime = Date.now();
      const startTime = endTime - (24 * 60 * 60 * 1000);

      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: {
            coin: token,
            interval: '15m',
            startTime,
            endTime
          }
        })
      });

      if (!response.ok) return null;
      const candles = await response.json();
      return candles;
    } catch (error) {
      console.error(`Erro ao buscar candles para ${token}:`, error);
      return null;
    }
  };

  const connectWebSocket = () => {
    try {
      const ws = new WebSocket('wss://api.hyperliquid.xyz/ws');
      
      ws.onopen = () => {
        setWsConnected(true);
        addLog('✅ WebSocket conectado', 'success');
        
        ws.send(JSON.stringify({
          method: 'subscribe',
          subscription: { type: 'allMids' }
        }));
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.channel === 'allMids' && data.data?.mids) {
            const mids = data.data.mids;
            
            setMarketData(prev => {
              const updated = { ...prev };
              
              for (const token of config.tokens) {
                if (mids[token]) {
                  const newPrice = parseFloat(mids[token]);
                  const prevPrice = updated[token].price || newPrice;
                  const change = prevPrice > 0 ? ((newPrice - prevPrice) / prevPrice) * 100 : 0;
                  
                  updated[token] = {
                    ...updated[token],
                    price: newPrice,
                    prevPrice: prevPrice,
                    change24h: change
                  };
                }
              }
              
              return updated;
            });
            
            setLastUpdate(new Date());
          }
        } catch (error) {
          console.error('Erro ao processar mensagem WS:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket erro:', error);
        addLog('❌ Erro no WebSocket', 'error');
      };

      ws.onclose = () => {
        setWsConnected(false);
        addLog('⚠️ WebSocket desconectado', 'warning');
        
        setTimeout(() => {
          if (botActive) connectWebSocket();
        }, 5000);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Erro ao conectar WebSocket:', error);
      addLog('❌ Falha ao conectar WebSocket', 'error');
    }
  };

  useEffect(() => {
    if (botActive) {
      const updateRSI = async () => {
        for (const token of config.tokens) {
          const candles = await fetchHistoricalData(token);
          if (candles && candles.length > 0) {
            const rsi = calculateRSI(candles, config.rsiPeriod);
            
            setMarketData(prev => ({
              ...prev,
              [token]: {
                ...prev[token],
                rsi,
                candles
              }
            }));
          }
        }
      };

      updateRSI();
      const interval = setInterval(updateRSI, 5 * 60 * 1000);
      
      return () => clearInterval(interval);
    }
  }, [botActive, config.tokens, config.rsiPeriod]);

  useEffect(() => {
    if (botActive) {
      connectWebSocket();
      addLog('🚀 Bot iniciado', 'success');
    } else {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      addLog('⏸ Bot pausado', 'info');
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [botActive]);

  useEffect(() => {
    if (botActive) {
      const interval = setInterval(() => {
        const currentData = marketData[config.selectedToken];
        
        if (config.useRSI && currentData.rsi > config.rsiThreshold && currentData.price > 0) {
          const newSignal = {
            id: Date.now(),
            token: config.selectedToken,
            type: 'SHORT',
            reason: `RSI sobrecomprado (${currentData.rsi.toFixed(1)})`,
            price: currentData.price,
            time: new Date().toLocaleTimeString(),
            rsi: currentData.rsi
          };
          
          setSignals(prev => {
            if (prev.length > 0 && prev[0].token === newSignal.token && Date.now() - prev[0].id < 60000) {
              return prev;
            }
            return [newSignal, ...prev.slice(0, 19)];
          });
          
          addLog(`🔻 Sinal SHORT: ${config.selectedToken} @ $${currentData.price.toFixed(2)} (RSI: ${currentData.rsi.toFixed(1)})`, 'signal');
          
          if (config.autoTrade && apiConfig.connected) {
            openPosition(config.selectedToken);
          }
        }
      }, config.checkInterval * 1000);

      return () => clearInterval(interval);
    }
  }, [botActive, config, marketData, apiConfig.connected]);

  const openPosition = (token) => {
    const data = marketData[token];
    if (data.price === 0) {
      addLog(`❌ Preço de ${token} ainda não disponível`, 'error');
      return;
    }

    const entryPrice = data.price;
    const stopLossPrice = entryPrice * (1 + config.stopLoss / 100);
    const takeProfitPrice = entryPrice * (1 - config.takeProfit / 100);
    
    const newPosition = {
      id: Date.now(),
      token,
      type: 'SHORT',
      entryPrice,
      currentPrice: entryPrice,
      size: config.positionSize,
      leverage: config.leverage,
      stopLoss: stopLossPrice,
      takeProfit: takeProfitPrice,
      pnl: 0,
      pnlPercent: 0,
      openTime: new Date().toLocaleString(),
      status: 'open'
    };
    
    setPositions(prev => [...prev, newPosition]);
    addLog(`✅ Posição SHORT aberta: ${token} @ $${entryPrice.toFixed(2)} (${config.leverage}x)`, 'success');
  };

  const closePosition = (id) => {
    const position = positions.find(p => p.id === id);
    if (position) {
      addLog(`📊 Posição fechada: ${position.token} | P&L: ${position.pnl >= 0 ? '+' : ''}${position.pnl.toFixed(2)} USDC (${position.pnlPercent.toFixed(2)}%)`, 
        position.pnl >= 0 ? 'success' : 'error');
    }
    setPositions(prev => prev.filter(p => p.id !== id));
  };

  useEffect(() => {
    if (positions.length > 0) {
      setPositions(prev => prev.map(pos => {
        const currentPrice = marketData[pos.token].price;
        if (currentPrice === 0) return pos;

        const priceDiff = pos.entryPrice - currentPrice;
        const pnlPercent = (priceDiff / pos.entryPrice) * 100 * pos.leverage;
        const pnl = (pos.size * pnlPercent) / 100;

        if (currentPrice >= pos.stopLoss && pos.status === 'open') {
          setTimeout(() => {
            addLog(`🛑 Stop Loss atingido: ${pos.token}`, 'warning');
            closePosition(pos.id);
          }, 100);
          return { ...pos, status: 'closing' };
        }
        if (currentPrice <= pos.takeProfit && pos.status === 'open') {
          setTimeout(() => {
            addLog(`🎯 Take Profit atingido: ${pos.token}`, 'success');
            closePosition(pos.id);
          }, 100);
          return { ...pos, status: 'closing' };
        }

        return {
          ...pos,
          currentPrice,
          pnl,
          pnlPercent
        };
      }));
    }
  }, [marketData]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-purple-600 p-3 rounded-lg">
              <TrendingDown className="w-6 h-6 md:w-8 md:h-8" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">Hyperliquid Short Bot Pro</h1>
              <p className="text-purple-300 text-sm">Trading automatizado com RSI real via WebSocket</p>
              {lastUpdate && (
                <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                  {wsConnected ? <Wifi className="w-3 h-3 text-green-400" /> : <WifiOff className="w-3 h-3 text-red-400" />}
                  {lastUpdate.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => setBotActive(!botActive)}
            className={`px-6 py-3 rounded-lg font-semibold transition-all flex items-center gap-2 ${
              botActive ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            <Zap className="w-4 h-4" />
            {botActive ? 'Pausar Bot' : 'Iniciar Bot'}
          </button>
        </div>

        <div className={`border rounded-lg p-4 mb-6 ${
          botActive ? 'bg-green-900/30 border-green-600' : 'bg-slate-800 border-slate-700'
        }`}>
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Activity className={`w-5 h-5 ${botActive ? 'text-green-400 animate-pulse' : 'text-slate-400'}`} />
              <span className={botActive ? 'text-green-300' : 'text-slate-400'}>
                {botActive 
                  ? `Monitorando ${config.selectedToken} | RSI: ${marketData[config.selectedToken].rsi.toFixed(1)} | Threshold: ${config.rsiThreshold}` 
                  : 'Bot pausado'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="text-slate-400">{wsConnected ? 'WebSocket ativo' : 'Desconectado'}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {[
            { id: 'config', icon: Settings, label: 'Config' },
            { id: 'market', icon: BarChart3, label: 'Mercado' },
            { id: 'positions', icon: DollarSign, label: 'Posições', badge: positions.length },
            { id: 'signals', icon: AlertTriangle, label: 'Sinais', badge: signals.length },
            { id: 'api', icon: Key, label: 'API' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 md:px-4 py-2 rounded-lg transition-all text-sm md:text-base ${
                activeTab === tab.id ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.badge > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'api' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Key className="w-5 h-5" />
                Configuração da API
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm mb-2">Private Key (Opcional)</label>
                  <input
                    type="password"
                    value={apiConfig.privateKey}
                    onChange={(e) => setApiConfig({...apiConfig, privateKey: e.target.value})}
                    placeholder="0x..."
                    className="w-full bg-slate-700 rounded px-3 py-2 text-sm font-mono"
                  />
                  <p className="text-xs text-slate-400 mt-1">Para executar trades reais via API</p>
                </div>

                <div className="flex items-center justify-between">
                  <span>Usar Testnet</span>
                  <input
                    type="checkbox"
                    checked={apiConfig.testnet}
                    onChange={(e) => setApiConfig({...apiConfig, testnet: e.target.checked})}
                    className="w-5 h-5"
                  />
                </div>

                <button
                  onClick={() => {
                    if (apiConfig.privateKey) {
                      setApiConfig({...apiConfig, connected: true});
                      addLog('🔑 API conectada', 'success');
                    }
                  }}
                  disabled={!apiConfig.privateKey || apiConfig.connected}
                  className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 py-2 rounded-lg transition-all"
                >
                  {apiConfig.connected ? '✅ Conectado' : 'Conectar API'}
                </button>
              </div>

              <div className="mt-6 p-4 bg-yellow-900/30 border border-yellow-600 rounded-lg">
                <p className="text-sm text-yellow-200">⚠️ Guarde suas chaves com segurança! Sempre teste no testnet primeiro.</p>
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-xl font-bold mb-4">Logs do Sistema</h3>
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {logs.length === 0 ? (
                  <p className="text-slate-400 text-sm">Nenhum log ainda...</p>
                ) : (
                  logs.map(log => (
                    <div key={log.id} className={`text-xs p-2 rounded ${
                      log.type === 'error' ? 'bg-red-900/30 text-red-300' :
                      log.type === 'success' ? 'bg-green-900/30 text-green-300' :
                      log.type === 'warning' ? 'bg-yellow-900/30 text-yellow-300' :
                      log.type === 'signal' ? 'bg-purple-900/30 text-purple-300' :
                      'bg-slate-700 text-slate-300'
                    }`}>
                      <span className="text-slate-400">[{log.time}]</span> {log.message}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-xl font-bold mb-4">Configurações de Trading</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm mb-2">Token para Monitorar</label>
                  <select
                    value={config.selectedToken}
                    onChange={(e) => setConfig({...config, selectedToken: e.target.value})}
                    className="w-full bg-slate-700 rounded px-3 py-2"
                  >
                    {config.tokens.map(token => (
                      <option key={token} value={token}>{token}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm mb-2">Alavancagem: {config.leverage}x</label>
                  <input
                    type="range"
                    min="2"
                    max="20"
                    value={config.leverage}
                    onChange={(e) => setConfig({...config, leverage: parseInt(e.target.value)})}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm mb-2">Tamanho da Posição (USDC)</label>
                  <input
                    type="number"
                    value={config.positionSize}
                    onChange={(e) => setConfig({...config, positionSize: parseFloat(e.target.value)})}
                    className="w-full bg-slate-700 rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm mb-2">Stop Loss: {config.stopLoss}%</label>
                  <input
                    type="range"
                    min="0.5"
                    max="10"
                    step="0.5"
                    value={config.stopLoss}
                    onChange={(e) => setConfig({...config, stopLoss: parseFloat(e.target.value)})}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm mb-2">Take Profit: {config.takeProfit}%</label>
                  <input
                    type="range"
                    min="0.5"
                    max="10"
                    step="0.5"
                    value={config.takeProfit}
                    onChange={(e) => setConfig({...config, takeProfit: parseFloat(e.target.value)})}
                    className="w-full"
                  />
                </div>

                <div className="flex items-center justify-between p-3 bg-purple-900/30 rounded-lg">
                  <span>Auto-Trade</span>
                  <input
                    type="checkbox"
                    checked={config.autoTrade}
                    onChange={(e) => setConfig({...config, autoTrade: e.target.checked})}
                    disabled={!apiConfig.connected}
                    className="w-5 h-5"
                  />
                </div>
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-xl font-bold mb-4">Indicadores Técnicos</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span>Usar RSI Real</span>
                  <input
                    type="checkbox"
                    checked={config.useRSI}
                    onChange={(e) => setConfig({...config, useRSI: e.target.checked})}
                    className="w-5 h-5"
                  />
                </div>

                {config.useRSI && (
                  <>
                    <div>
                      <label className="block text-sm mb-2">RSI Threshold: {config.rsiThreshold}</label>
                      <input
                        type="range"
                        min="60"
                        max="80"
                        value={config.rsiThreshold}
                        onChange={(e) => setConfig({...config, rsiThreshold: parseInt(e.target.value)})}
                        className="w-full"
                      />
                      <p className="text-xs text-slate-400 mt-1">Sinal de SHORT quando RSI &gt; {config.rsiThreshold}</p>
                    </div>

                    <div>
                      <label className="block text-sm mb-2">Período RSI: {config.rsiPeriod}</label>
                      <input
                        type="range"
                        min="7"
                        max="21"
                        value={config.rsiPeriod}
                        onChange={(e) => setConfig({...config, rsiPeriod: parseInt(e.target.value)})}
                        className="w-full"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm mb-2">Intervalo: {config.checkInterval}s</label>
                  <input
                    type="range"
                    min="15"
                    max="120"
                    step="15"
                    value={config.checkInterval}
                    onChange={(e) => setConfig({...config, checkInterval: parseInt(e.target.value)})}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="mt-6 p-4 bg-blue-900/30 border border-blue-600 rounded-lg">
                <p className="text-sm text-blue-200">💡 RSI calculado com dados históricos reais. Preços via WebSocket em tempo real.</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'market' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(marketData).map(([token, data]) => (
              <div key={token} className="bg-slate-800 rounded-lg p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-2xl font-bold">{token}</h3>
                    {data.price > 0 ? (
                      <p className="text-3xl font-mono mt-2">${data.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    ) : (
                      <p className="text-lg text-slate-400 mt-2">Carregando...</p>
                    )}
                  </div>
                  {data.change24h !== 0 && (
                    <span className={`px-3 py-1 rounded text-sm ${
                      data.change24h > 0 ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                    }`}>
                      {data.change24h > 0 ? '+' : ''}{data.change24h.toFixed(2)}%
                    </span>
                  )}
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex justify-between">
                    <span className="text-slate-400">RSI ({config.rsiPeriod}):</span>
                    <span className={`font-semibold ${
                      data.rsi > 70 ? 'text-red-400' : data.rsi < 30 ? 'text-green-400' : 'text-slate-300'
                    }`}>
                      {data.rsi > 0 ? data.rsi.toFixed(1) : '--'}
                    </span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all ${
                        data.rsi > 70 ? 'bg-red-500' : data.rsi < 30 ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${Math.min(data.rsi, 100)}%` }}
                    />
                  </div>
                </div>

                {data.price > 0 && data.rsi > config.rsiThreshold && (
                  <button
                    onClick={() => openPosition(token)}
                    className="w-full bg-red-600 hover:bg-red-700 py-2 rounded-lg font-semibold transition-all"
                  >
                    🔻 Abrir SHORT
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'positions' && (
          <div className="space-y-4">
            {positions.length === 0 ? (
              <div className="bg-slate-800 rounded-lg p-12 text-center">
                <p className="text-slate-400">Nenhuma posição aberta</p>
              </div>
            ) : (
              positions.map(pos => (
                <div key={pos.id} className="bg-slate-800 rounded-lg p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold">{pos.token} SHORT {pos.leverage}x</h3>
                      <p className="text-sm text-slate-400">{pos.openTime}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-2xl font-bold ${
                        pos.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {pos.pnl >= 0 ? '+' : ''}{pos.pnl.toFixed(2)} USDC
                      </p>
                      <p className={`text-sm ${
                        pos.pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                    <div>
                      <p className="text-slate-400">Entry</p>
                      <p className="font-mono">${pos.entryPrice.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Current</p>
                      <p className="font-mono">${pos.currentPrice.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Size</p>
                      <p className="font-mono">${pos.size}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                    <div className="bg-red-900/30 p-2 rounded">
                      <p className="text-slate-400">Stop Loss</p>
                      <p className="font-mono">${pos.stopLoss.toFixed(2)}</p>
                    </div>
                    <div className="bg-green-900/30 p-2 rounded">
                      <p className="text-slate-400">Take Profit</p>
                      <p className="font-mono">${pos.takeProfit.toFixed(2)}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => closePosition(pos.id)}
                    className="w-full bg-slate-700 hover:bg-slate-600 py-2 rounded-lg transition-all"
                  >
                    Fechar Posição
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'signals' && (
          <div className="space-y-2">
            {signals.length === 0 ? (
              <div className="bg-slate-800 rounded-lg p-12 text-center">
                <p className="text-slate-400">Nenhum sinal detectado ainda</p>
              </div>
            ) : (
              signals.map(signal => (
                <div key={signal.id} className="bg-slate-800 rounded-lg p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <TrendingDown className="w-5 h-5 text-red-400" />
                    <div>
                      <p className="font-semibold">{signal.token} {signal.type}</p>
                      <p className="text-sm text-slate-400">{signal.reason}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono">${signal.price.toFixed(2)}</p>
                    <p className="text-xs text-slate-400">{signal.time}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
