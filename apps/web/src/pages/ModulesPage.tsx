import { Blocks, Lock, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type ModuleInfo } from '../lib/api';

interface ModulesPageProps {
  onModulesChanged: () => void;
}

export function ModulesPage({ onModulesChanged }: ModulesPageProps) {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await api.modules();
      setModules(res.modules);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load modules');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleModule = async (mod: ModuleInfo) => {
    setBusyId(mod.id);
    setError(null);
    try {
      await api.setModuleEnabled(mod.id, !mod.enabled);
      await load();
      onModulesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update module');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Modular Plugin System</h1>
        <p className="text-sm text-slate-400">
          Enable or disable modules dynamically without restarting the bot container.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {modules.map((mod) => (
          <div
            key={mod.id}
            className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between gap-4"
          >
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <Blocks className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-white">{mod.name}</h2>
                      <span className="text-[11px] font-mono text-slate-400">
                        v{mod.version}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">
                      ID: <code className="text-slate-300">{mod.id}</code> • By {mod.author}
                    </div>
                  </div>
                </div>

                {mod.core ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-slate-800 text-slate-300">
                    <Lock className="h-3 w-3" />
                    Core
                  </span>
                ) : (
                  <button
                    disabled={busyId === mod.id}
                    onClick={() => void toggleModule(mod)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                      mod.enabled
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30'
                        : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    {busyId === mod.id ? '...' : mod.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                )}
              </div>

              <p className="text-sm text-slate-300 mt-3">{mod.description}</p>
            </div>

            <div className="space-y-2 pt-3 border-t border-slate-800/80 text-xs">
              {mod.commands.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-400">Commands:</span>
                  {mod.commands.map((c) => (
                    <span
                      key={c.name}
                      className="px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 font-mono text-indigo-300"
                    >
                      /{c.name}
                    </span>
                  ))}
                </div>
              )}
              {mod.permissions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-400">Permissions:</span>
                  {mod.permissions.map((p) => (
                    <span
                      key={p.key}
                      className="px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 font-mono text-slate-300"
                    >
                      {p.key}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add new module guide */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-white mb-2">
          <Terminal className="h-4 w-4 text-indigo-400" />
          <span>Creating a New Module</span>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          Run the built-in module generator on your dev machine or homelab to scaffold a new
          auto-discovered module with commands, events, migrations, permissions, and API routes:
        </p>
        <pre className="rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs font-mono text-emerald-300 overflow-x-auto">
          npm run create-module proxmox-status
        </pre>
      </div>
    </div>
  );
}
