import { RefreshCw, Save, Shield } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type AuditEntry } from '../lib/api';

export function SettingsPage() {
  const [status, setStatus] = useState<'online' | 'idle' | 'dnd' | 'invisible'>('online');
  const [activityType, setActivityType] = useState<
    'Playing' | 'Watching' | 'Listening' | 'Competing' | 'None'
  >('Watching');
  const [activityText, setActivityText] = useState('');
  const [allowGuildAdminBypass, setAllowGuildAdminBypass] = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [settings, audit] = await Promise.all([api.adminSettings(), api.auditLogs(60)]);
      setStatus(settings.presence.status);
      setActivityType(settings.presence.activityType);
      setActivityText(settings.presence.activityText);
      setAllowGuildAdminBypass(settings.allowGuildAdminBypass);
      setAuditLogs(audit.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSavePresence = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api.updatePresence({ status, activityType, activityText });
      setNotice('Bot presence updated live.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update presence');
    }
  };

  const handleSyncCommands = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await api.syncCommands();
      setNotice(`Synced ${res.count} slash command(s) with Discord.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync slash commands');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Bot Settings &amp; Audit Log</h1>
        <p className="text-sm text-slate-400">
          Configure bot Discord presence, permission fallbacks, slash commands, and review actions.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-sm text-rose-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3.5 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form
          onSubmit={handleSavePresence}
          className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4"
        >
          <h2 className="text-sm font-semibold text-white">Discord Presence &amp; Status</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Online Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                <option value="online">Online</option>
                <option value="idle">Idle</option>
                <option value="dnd">Do Not Disturb</option>
                <option value="invisible">Invisible</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Activity Type</label>
              <select
                value={activityType}
                onChange={(e) => setActivityType(e.target.value as typeof activityType)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                <option value="Watching">Watching</option>
                <option value="Playing">Playing</option>
                <option value="Listening">Listening</option>
                <option value="Competing">Competing</option>
                <option value="None">None</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Activity Text</label>
            <input
              value={activityText}
              onChange={(e) => setActivityText(e.target.value)}
              placeholder="Beacon • Homelab & Minecraft 24/7"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </div>

          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
          >
            <Save className="h-4 w-4" />
            <span>Save Presence</span>
          </button>
        </form>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Security &amp; Discord Sync</h2>

          <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={allowGuildAdminBypass}
              onChange={async (e) => {
                const next = e.target.checked;
                setAllowGuildAdminBypass(next);
                await api.updateGeneralSettings({ allowGuildAdminBypass: next });
                setNotice('Updated Discord server admin permission behavior.');
              }}
              className="mt-0.5 rounded border-slate-600 bg-slate-900 text-indigo-600"
            />
            <div>
              <div className="text-sm font-medium text-white flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-indigo-400" />
                <span>Allow Discord Server Admins in Slash Commands</span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                When enabled, members with Discord&apos;s native Administrator permission can run
                guild slash commands even without an explicit bot rule. Web dashboard access
                still requires explicit permission rules or Bot Owner status.
              </div>
            </div>
          </label>

          <button
            onClick={() => void handleSyncCommands()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-sm font-medium text-white transition"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Re-Sync Slash Commands with Discord</span>
          </button>
        </div>
      </div>

      {/* Audit Log */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 text-sm font-semibold text-white">
          Full Audit Log
        </div>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase border-b border-slate-800">
              <tr>
                <th className="px-4 py-2.5">Time</th>
                <th className="px-4 py-2.5">Actor</th>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5">Action</th>
                <th className="px-4 py-2.5">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {auditLogs.map((a) => (
                <tr key={a.id} className="hover:bg-slate-800/40">
                  <td className="px-4 py-2.5 font-mono text-slate-400">{a.createdAt}</td>
                  <td className="px-4 py-2.5 text-white font-medium">{a.actorName}</td>
                  <td className="px-4 py-2.5 text-slate-400 uppercase">{a.source}</td>
                  <td className="px-4 py-2.5 font-mono text-indigo-300">{a.action}</td>
                  <td className="px-4 py-2.5 text-slate-300">{a.target ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
