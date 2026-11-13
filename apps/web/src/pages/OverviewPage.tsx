import {
  Activity,
  Blocks,
  Cpu,
  ExternalLink,
  RefreshCw,
  Server,
  Terminal,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, formatDurationSeconds, type AuditEntry, type LogEntry } from '../lib/api';

interface OverviewPageProps {
  botInviteUrl: string | null;
}

export function OverviewPage({ botInviteUrl }: OverviewPageProps) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.overview>> | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [overviewRes, logsRes] = await Promise.all([api.overview(), api.logs(100)]);
      setData(overviewRes);
      setLogs(logsRes.logs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load overview');
    }
  };

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 15000);

    const sse = new EventSource('/api/logs/stream');
    sse.onmessage = (evt) => {
      try {
        const entry = JSON.parse(evt.data) as LogEntry;
        setLogs((prev) => [...prev.slice(-149), entry]);
      } catch {
        // ignore keepalive
      }
    };

    return () => {
      clearInterval(interval);
      sse.close();
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-rose-200 text-sm">
        {error}
      </div>
    );
  }

  if (!data) {
    return <div className="text-sm text-slate-400">Loading dashboard overview...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard Overview</h1>
          <p className="text-sm text-slate-400">
            Live bot telemetry, homelab resource usage, and real-time logs.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {botInviteUrl && (
            <a
              href={botInviteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 transition"
            >
              <span>Invite Bot</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white transition"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>Discord Gateway</span>
            <Activity className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                data.bot.ready ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
            <span className="text-lg font-bold text-white">
              {data.bot.ready ? data.bot.tag : data.bot.configured ? 'Connecting...' : 'Web-Only'}
            </span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Ping: {data.bot.pingMs !== null ? `${data.bot.pingMs} ms` : '—'} • Up{' '}
            {formatDurationSeconds(data.bot.uptimeSec)}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>Discord Servers</span>
            <Server className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-white">{data.bot.guildsCount}</div>
          <div className="text-xs text-slate-400 mt-1">Connected guilds</div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>Loaded Modules</span>
            <Blocks className="h-4 w-4 text-violet-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            {data.modules.enabled} / {data.modules.total}
          </div>
          <div className="text-xs text-slate-400 mt-1">Active plugins</div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-2">
            <span>Homelab Container</span>
            <Cpu className="h-4 w-4 text-sky-400" />
          </div>
          <div className="text-2xl font-bold text-white">{data.system.processRssMb} MB</div>
          <div className="text-xs text-slate-400 mt-1">
            Host RAM {data.system.hostUsedMemMb}/{data.system.hostTotalMemMb} MB • Load{' '}
            {data.system.loadAvg1m}
          </div>
        </div>
      </div>

      {/* Live Logs + Recent Audit */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/70 flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Terminal className="h-4 w-4 text-indigo-400" />
              <span>Live Bot Logs</span>
            </div>
            <span className="text-xs text-emerald-400 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Streaming
            </span>
          </div>
          <div className="p-4 font-mono text-xs space-y-1.5 max-h-96 overflow-y-auto bg-slate-950/60 rounded-b-2xl">
            {logs.length === 0 ? (
              <div className="text-slate-500">No log entries yet.</div>
            ) : (
              logs
                .slice()
                .reverse()
                .map((log) => (
                  <div key={log.id} className="flex gap-2 leading-relaxed">
                    <span className="text-slate-500 shrink-0">
                      {log.timestamp.slice(11, 19)}
                    </span>
                    <span
                      className={`uppercase font-semibold shrink-0 w-12 ${
                        log.level === 'error'
                          ? 'text-rose-400'
                          : log.level === 'warn'
                            ? 'text-amber-400'
                            : 'text-sky-400'
                      }`}
                    >
                      {log.level}
                    </span>
                    <span className="text-indigo-300 shrink-0">[{log.scope}]</span>
                    <span className="text-slate-200 break-all">{log.message}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-800 text-sm font-semibold text-white">
            Recent Audit Trail
          </div>
          <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
            {data.recentAudit.length === 0 ? (
              <div className="text-xs text-slate-500">No audit actions recorded yet.</div>
            ) : (
              data.recentAudit.map((entry: AuditEntry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">{entry.action}</span>
                    <span className="text-slate-500">{entry.createdAt.slice(5, 16)}</span>
                  </div>
                  <div className="text-slate-400 mt-1">
                    By <span className="text-slate-200">{entry.actorName}</span>
                    {entry.target ? ` → ${entry.target}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
