import {
  Activity,
  Clock,
  Gamepad2,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { MetricAreaChart } from '../components/Charts';
import {
  api,
  formatDurationSeconds,
  type GuildSummary,
  type McHistoryResponse,
  type McPlayerDetail,
  type McPlayerOverview,
  type McServer,
} from '../lib/api';

interface MinecraftPageProps {
  canManage: boolean;
  canRcon: boolean;
}

export function MinecraftPage({ canManage, canRcon }: MinecraftPageProps) {
  const [tab, setTab] = useState<'servers' | 'players'>('servers');
  const [servers, setServers] = useState<McServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  const [historyHours, setHistoryHours] = useState<number>(24);
  const [history, setHistory] = useState<McHistoryResponse | null>(null);
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [guildChannels, setGuildChannels] = useState<{ id: string; name: string }[]>([]);

  // Players tab state
  const [players, setPlayers] = useState<McPlayerOverview[]>([]);
  const [playerSearch, setPlayerSearch] = useState('');
  const [playerFilterServer, setPlayerFilterServer] = useState<number | undefined>(undefined);
  const [playerDetail, setPlayerDetail] = useState<McPlayerDetail | null>(null);

  // Add server modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [formName, setFormName] = useState('');
  const [formHost, setFormHost] = useState('');
  const [formPort, setFormPort] = useState(25565);
  const [formEdition, setFormEdition] = useState<'java' | 'bedrock'>('java');
  const [formPoll, setFormPoll] = useState(60);
  const [formGuildId, setFormGuildId] = useState('');
  const [formAlertChannelId, setFormAlertChannelId] = useState('');
  const [formNotifyOffline, setFormNotifyOffline] = useState(true);
  const [formNotifyPlayers, setFormNotifyPlayers] = useState(false);
  const [formRconPort, setFormRconPort] = useState('');
  const [formRconPassword, setFormRconPassword] = useState('');

  // RCON console
  const [rconCmd, setRconCmd] = useState('');
  const [rconOutput, setRconOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadServers = async () => {
    try {
      const [srvRes, gRes] = await Promise.all([api.mcServers(), api.guilds()]);
      setServers(srvRes.servers);
      setGuilds(gRes.guilds);
      if (!selectedServerId && srvRes.servers.length > 0) {
        setSelectedServerId(srvRes.servers[0].id);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Minecraft servers');
    }
  };

  const loadHistory = async (serverId: number, hours: number) => {
    try {
      const res = await api.mcServerHistory(serverId, hours);
      setHistory(res);
    } catch {
      setHistory(null);
    }
  };

  const loadPlayers = async () => {
    try {
      const res = await api.mcPlayers(playerFilterServer, playerSearch);
      setPlayers(res.players);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load player history');
    }
  };

  useEffect(() => {
    void loadServers();
    const timer = setInterval(() => void loadServers(), 20000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (selectedServerId) {
      void loadHistory(selectedServerId, historyHours);
    }
  }, [selectedServerId, historyHours]);

  useEffect(() => {
    if (tab === 'players') {
      void loadPlayers();
    }
  }, [tab, playerFilterServer]);

  useEffect(() => {
    if (!formGuildId) {
      setGuildChannels([]);
      return;
    }
    api
      .guildDetail(formGuildId)
      .then((d) => setGuildChannels(d.channels.filter((c) => c.isText)))
      .catch(() => setGuildChannels([]));
  }, [formGuildId]);

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.mcCreateServer({
        name: formName.trim(),
        host: formHost.trim(),
        port: Number(formPort),
        edition: formEdition,
        pollIntervalSec: Number(formPoll),
        guildId: formGuildId || null,
        alertChannelId: formAlertChannelId || null,
        notifyOffline: formNotifyOffline,
        notifyPlayers: formNotifyPlayers,
        rconPort: formRconPort ? Number(formRconPort) : null,
        rconPassword: formRconPassword || null,
      });
      setShowAddModal(false);
      setFormName('');
      setFormHost('');
      setFormRconPassword('');
      setSelectedServerId(res.server.id);
      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add Minecraft server');
    }
  };

  const handleRconSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedServerId || !rconCmd.trim()) return;
    setRconOutput('Running...');
    try {
      const res = await api.mcRcon(selectedServerId, rconCmd.trim());
      setRconOutput(res.output);
      setRconCmd('');
    } catch (err) {
      setRconOutput(`Error: ${err instanceof Error ? err.message : 'RCON failed'}`);
    }
  };

  const selectedServer = servers.find((s) => s.id === selectedServerId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Minecraft 24/7 Monitoring</h1>
          <p className="text-sm text-slate-400">
            Real-time server status, uptime &amp; latency charts, and player playtime history.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setTab('servers')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                tab === 'servers' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Servers ({servers.length})
            </button>
            <button
              onClick={() => setTab('players')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                tab === 'players' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Player History
            </button>
          </div>

          {canManage && (
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-white transition"
            >
              <Plus className="h-4 w-4" />
              <span>Add Server</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-sm text-rose-200">
          {error}
        </div>
      )}

      {tab === 'servers' ? (
        servers.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-10 text-center space-y-3">
            <Gamepad2 className="h-10 w-10 text-emerald-400 mx-auto" />
            <div className="text-base font-semibold text-white">
              No Minecraft servers monitored yet
            </div>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Add your Java or Bedrock Minecraft servers to monitor uptime 24/7, record player
              sessions, and send Discord alerts.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Server Cards List */}
            <div className="space-y-3">
              {servers.map((srv) => (
                <div
                  key={srv.id}
                  onClick={() => setSelectedServerId(srv.id)}
                  className={`cursor-pointer rounded-2xl border p-4 transition ${
                    selectedServerId === srv.id
                      ? 'border-indigo-500 bg-indigo-950/30'
                      : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {srv.lastFavicon ? (
                        <img
                          src={srv.lastFavicon}
                          alt={srv.name}
                          className="h-11 w-11 rounded-xl border border-slate-700 shrink-0"
                        />
                      ) : (
                        <div className="h-11 w-11 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                          <Gamepad2 className="h-5 w-5 text-emerald-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                              srv.lastOnline === true
                                ? 'bg-emerald-400'
                                : srv.lastOnline === false
                                  ? 'bg-rose-500'
                                  : 'bg-slate-500'
                            }`}
                          />
                          <span className="font-semibold text-white text-sm truncate">
                            {srv.name}
                          </span>
                        </div>
                        <div className="text-xs font-mono text-slate-400 truncate">
                          {srv.host}:{srv.port}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xs font-semibold text-white">
                        {srv.lastPlayerCount}/{srv.lastMaxPlayers}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {srv.lastLatencyMs !== null ? `${srv.lastLatencyMs} ms` : 'offline'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                    <span>24h Uptime: {srv.uptime24hPct}%</span>
                    <span>{srv.lastVersion ?? srv.edition.toUpperCase()}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Selected Server Detail */}
            {selectedServer && (
              <div className="lg:col-span-2 space-y-5">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-xl font-bold text-white">{selectedServer.name}</h2>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            selectedServer.lastOnline
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {selectedServer.lastOnline ? 'Online' : 'Offline'}
                        </span>
                      </div>
                      {selectedServer.lastMotd && (
                        <p className="text-xs text-slate-300 mt-1.5 whitespace-pre-line">
                          {selectedServer.lastMotd}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          await api.mcPollServer(selectedServer.id);
                          await loadServers();
                          await loadHistory(selectedServer.id, historyHours);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Poll Now</span>
                      </button>

                      {canManage && (
                        <button
                          onClick={async () => {
                            if (confirm(`Delete monitored server "${selectedServer.name}"?`)) {
                              await api.mcDeleteServer(selectedServer.id);
                              setSelectedServerId(null);
                              await loadServers();
                            }
                          }}
                          className="p-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300"
                          title="Delete server"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Online players strip */}
                  <div className="mt-4 pt-4 border-t border-slate-800">
                    <div className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      <span>
                        Currently Online ({selectedServer.onlinePlayers.length} tracked /{' '}
                        {selectedServer.lastPlayerCount} reported)
                      </span>
                    </div>
                    {selectedServer.onlinePlayers.length === 0 ? (
                      <div className="text-xs text-slate-500">No players currently online.</div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {selectedServer.onlinePlayers.map((p) => (
                          <button
                            key={p.username}
                            onClick={async () => {
                              const d = await api.mcPlayerDetail(p.username);
                              setPlayerDetail(d);
                            }}
                            className="inline-flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500 text-xs text-white transition"
                          >
                            <img
                              src={`https://mc-heads.net/avatar/${encodeURIComponent(p.username)}/24`}
                              alt={p.username}
                              className="h-4 w-4 rounded"
                            />
                            <span>{p.username}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* History Window & Charts */}
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Activity className="h-4 w-4 text-indigo-400" />
                      <span>Server History &amp; Telemetry</span>
                    </div>
                    <div className="flex gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                      {[
                        [1, '1h'],
                        [24, '24h'],
                        [168, '7d'],
                        [720, '30d'],
                      ].map(([hrs, label]) => (
                        <button
                          key={hrs}
                          onClick={() => setHistoryHours(Number(hrs))}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                            historyHours === hrs
                              ? 'bg-indigo-600 text-white'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {history && (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
                          <div className="text-xs text-slate-400">Uptime</div>
                          <div className="text-lg font-bold text-emerald-400">
                            {history.summary.uptimePct}%
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
                          <div className="text-xs text-slate-400">Avg Latency</div>
                          <div className="text-lg font-bold text-white">
                            {history.summary.avgLatencyMs !== null
                              ? `${history.summary.avgLatencyMs} ms`
                              : '—'}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
                          <div className="text-xs text-slate-400">Peak Players</div>
                          <div className="text-lg font-bold text-indigo-400">
                            {history.summary.peakPlayers}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <MetricAreaChart
                          title="Player Count"
                          points={history.points}
                          valueKey="playerCount"
                          color="#6366f1"
                        />
                        <MetricAreaChart
                          title="Ping Latency"
                          points={history.points}
                          valueKey="latencyMs"
                          unit=" ms"
                          color="#10b981"
                        />
                      </div>

                      {history.incidents.length > 0 && (
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                          <div className="text-xs font-semibold text-white mb-2">
                            Recent Status Transitions
                          </div>
                          <div className="space-y-1.5 max-h-40 overflow-y-auto text-xs">
                            {history.incidents.map((inc, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between text-slate-300"
                              >
                                <span>
                                  {inc.type === 'online' ? '🟢 Came Online' : '🔴 Went Offline'}
                                  {inc.message ? ` (${inc.message})` : ''}
                                </span>
                                <span className="font-mono text-slate-500">{inc.at}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Optional RCON Console */}
                {selectedServer.rconConfigured && canRcon && (
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Terminal className="h-4 w-4 text-amber-400" />
                      <span>RCON Console</span>
                    </div>
                    <form onSubmit={handleRconSubmit} className="flex gap-2">
                      <input
                        value={rconCmd}
                        onChange={(e) => setRconCmd(e.target.value)}
                        placeholder="e.g. list, tps, say Hello from Beacon!"
                        className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-white"
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white"
                      >
                        Run
                      </button>
                    </form>
                    {rconOutput && (
                      <pre className="rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs font-mono text-slate-200 whitespace-pre-wrap">
                        {rconOutput}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      ) : (
        /* Player History Tab */
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="h-4 w-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void loadPlayers();
                }}
                placeholder="Search Minecraft username..."
                className="w-full rounded-xl border border-slate-700 bg-slate-900 pl-9 pr-3 py-2 text-sm text-white"
              />
            </div>

            <select
              value={playerFilterServer ?? ''}
              onChange={(e) =>
                setPlayerFilterServer(e.target.value ? Number(e.target.value) : undefined)
              }
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <option value="">All Monitored Servers</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <button
              onClick={() => void loadPlayers()}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white"
            >
              Search
            </button>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-950/60 text-xs uppercase text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-5 py-3">Player</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Total Playtime</th>
                    <th className="px-5 py-3">Sessions</th>
                    <th className="px-5 py-3">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {players.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                        No tracked players match your filter yet.
                      </td>
                    </tr>
                  ) : (
                    players.map((p) => (
                      <tr
                        key={p.id}
                        onClick={async () => {
                          const d = await api.mcPlayerDetail(p.username);
                          setPlayerDetail(d);
                        }}
                        className="hover:bg-slate-800/50 cursor-pointer transition"
                      >
                        <td className="px-5 py-3 font-medium text-white">
                          <div className="flex items-center gap-2.5">
                            <img
                              src={`https://mc-heads.net/avatar/${encodeURIComponent(p.username)}/32`}
                              alt={p.username}
                              className="h-7 w-7 rounded-md"
                            />
                            <span>{p.username}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {p.onlineNow ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                              Online ({p.activeServerName})
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">Offline</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-200 font-medium">
                          {formatDurationSeconds(p.totalPlaytimeSeconds)}
                        </td>
                        <td className="px-5 py-3 text-slate-400">{p.sessionCount}</td>
                        <td className="px-5 py-3 text-xs font-mono text-slate-400">
                          {p.lastSeen}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add Server Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleAddServer}
            className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Add Minecraft Server</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Display Name</label>
                <input
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Homelab Survival"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Edition</label>
                <select
                  value={formEdition}
                  onChange={(e) => {
                    const ed = e.target.value as 'java' | 'bedrock';
                    setFormEdition(ed);
                    setFormPort(ed === 'bedrock' ? 19132 : 25565);
                  }}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  <option value="java">Java Edition</option>
                  <option value="bedrock">Bedrock Edition</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">Host / IP</label>
                <input
                  required
                  value={formHost}
                  onChange={(e) => setFormHost(e.target.value)}
                  placeholder="mc.yourdomain.com or 192.168.1.50"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Port</label>
                <input
                  type="number"
                  required
                  value={formPort}
                  onChange={(e) => setFormPort(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Poll Interval (sec)</label>
                <input
                  type="number"
                  min={10}
                  max={3600}
                  value={formPoll}
                  onChange={(e) => setFormPoll(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Discord Server (alerts)</label>
                <select
                  value={formGuildId}
                  onChange={(e) => setFormGuildId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  <option value="">None</option>
                  {guilds.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {formGuildId && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">Alert Channel</label>
                <select
                  value={formAlertChannelId}
                  onChange={(e) => setFormAlertChannelId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  <option value="">Select channel...</option>
                  {guildChannels.map((c) => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-wrap gap-4 text-xs text-slate-200">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formNotifyOffline}
                  onChange={(e) => setFormNotifyOffline(e.target.checked)}
                />
                <span>Alert on Online/Offline</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formNotifyPlayers}
                  onChange={(e) => setFormNotifyPlayers(e.target.checked)}
                />
                <span>Alert on Player Join/Leave</span>
              </label>
            </div>

            <div className="pt-2 border-t border-slate-800 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  RCON Port (optional)
                </label>
                <input
                  type="number"
                  value={formRconPort}
                  onChange={(e) => setFormRconPort(e.target.value)}
                  placeholder="25575"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  RCON Password (optional)
                </label>
                <input
                  type="password"
                  value={formRconPassword}
                  onChange={(e) => setFormRconPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-700 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white"
              >
                Start 24/7 Monitoring
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Player Detail Modal */}
      {playerDetail && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img
                  src={`https://mc-heads.net/avatar/${encodeURIComponent(playerDetail.player.username)}/64`}
                  alt={playerDetail.player.username}
                  className="h-12 w-12 rounded-xl"
                />
                <div>
                  <h2 className="text-lg font-bold text-white">
                    {playerDetail.player.username}
                  </h2>
                  <div className="text-xs text-slate-400">
                    Total Playtime: {formatDurationSeconds(playerDetail.player.totalPlaytimeSeconds)}{' '}
                    • {playerDetail.player.sessionCount} sessions
                  </div>
                </div>
              </div>
              <button
                onClick={() => setPlayerDetail(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase">
                Per-Server Breakdown
              </div>
              {playerDetail.serverBreakdown.map((b) => (
                <div
                  key={b.server_id}
                  className="flex items-center justify-between rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2 text-xs"
                >
                  <span className="font-medium text-white">{b.server_name}</span>
                  <span className="text-slate-300">
                    {formatDurationSeconds(b.playtime_seconds)} ({b.sessions} sessions)
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                <span>Recent Sessions</span>
              </div>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {playerDetail.sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2 text-xs"
                  >
                    <div>
                      <span className="font-medium text-white">{s.server_name}</span>
                      <div className="text-slate-400 font-mono text-[11px]">{s.joined_at}</div>
                    </div>
                    <span className="text-slate-300">
                      {s.left_at ? formatDurationSeconds(s.duration_seconds) : '🟢 Active'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
