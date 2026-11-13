import {
  Blocks,
  Hash,
  Megaphone,
  Search,
  Send,
  Server,
  Shield,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  api,
  type GuildDetail,
  type GuildSummary,
  type ModuleInfo,
} from '../lib/api';

export function ServersPage() {
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [botReady, setBotReady] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GuildDetail | null>(null);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [subTab, setSubTab] = useState<'announce' | 'members' | 'settings'>('announce');
  const [memberQuery, setMemberQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Announce form
  const [channelId, setChannelId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [useEmbed, setUseEmbed] = useState(true);

  const loadGuilds = async () => {
    try {
      const [gRes, mRes] = await Promise.all([api.guilds(), api.modules()]);
      setGuilds(gRes.guilds);
      setBotReady(gRes.ready);
      setModules(mRes.modules);
      if (!selectedId && gRes.guilds.length > 0) {
        setSelectedId(gRes.guilds[0].id);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load servers');
    }
  };

  const loadDetail = async (id: string, query = memberQuery) => {
    try {
      const res = await api.guildDetail(id, query);
      setDetail(res);
      const firstText = res.channels.find((c) => c.isText);
      if (firstText && !channelId) setChannelId(firstText.id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load server details');
    }
  };

  useEffect(() => {
    void loadGuilds();
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId, '');
  }, [selectedId]);

  const handleSendAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !channelId) return;
    setError(null);
    setNotice(null);
    try {
      await api.announce(selectedId, {
        channelId,
        title: title.trim() || undefined,
        message,
        color,
        useEmbed,
      });
      setTitle('');
      setMessage('');
      setNotice('Announcement sent to Discord channel.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send announcement');
    }
  };

  const handleMemberAction = async (
    userId: string,
    action: 'add_role' | 'remove_role' | 'timeout' | 'kick' | 'ban' | 'nickname',
    extra: Record<string, unknown> = {},
  ) => {
    if (!selectedId) return;
    setError(null);
    setNotice(null);
    try {
      await api.memberAction(selectedId, userId, { action, ...extra });
      setNotice(`Executed "${action}" successfully.`);
      await loadDetail(selectedId, memberQuery);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const handleToggleGuildModule = async (moduleId: string, currentlyEnabled: boolean) => {
    if (!selectedId) return;
    try {
      await api.updateGuildSettings(selectedId, {
        moduleToggles: { [moduleId]: !currentlyEnabled },
      });
      await loadDetail(selectedId, memberQuery);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle server module');
    }
  };

  if (!botReady) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-6 text-sm text-amber-200">
        Discord client is not connected yet. Configure <code>DISCORD_TOKEN</code> in{' '}
        <code>.env</code> and invite the bot to a server to manage guilds here.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Discord Server Management</h1>
        <p className="text-sm text-slate-400">
          Manage channels, send announcements, moderate members &amp; roles, and toggle modules per server.
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

      {guilds.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center text-sm text-slate-400">
          The bot is not in any Discord servers yet. Use the Invite Bot link on the Overview page.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Guild Selector */}
          <div className="space-y-2">
            {guilds.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  setSelectedId(g.id);
                  setChannelId('');
                }}
                className={`w-full flex items-center gap-3 p-3 rounded-2xl border text-left transition ${
                  selectedId === g.id
                    ? 'border-indigo-500 bg-indigo-950/40 text-white'
                    : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700'
                }`}
              >
                {g.iconUrl ? (
                  <img src={g.iconUrl} alt={g.name} className="h-10 w-10 rounded-xl" />
                ) : (
                  <div className="h-10 w-10 rounded-xl bg-slate-800 flex items-center justify-center">
                    <Server className="h-5 w-5 text-slate-400" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{g.name}</div>
                  <div className="text-xs text-slate-400">{g.memberCount} members</div>
                </div>
              </button>
            ))}
          </div>

          {/* Guild Workspace */}
          {detail && (
            <div className="lg:col-span-3 space-y-5">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white">{detail.guild.name}</h2>
                  <div className="text-xs text-slate-400">
                    ID: <span className="font-mono">{detail.guild.id}</span> •{' '}
                    {detail.channels.length} channels • {detail.roles.length} roles
                  </div>
                </div>

                <div className="flex gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                  {(
                    [
                      ['announce', 'Announcements', Megaphone],
                      ['members', 'Members & Roles', Users],
                      ['settings', 'Server Modules', Blocks],
                    ] as const
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      onClick={() => setSubTab(id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                        subTab === id
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {subTab === 'announce' && (
                <form
                  onSubmit={handleSendAnnouncement}
                  className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Hash className="h-4 w-4 text-indigo-400" />
                    <span>Send Message / Embed to Channel</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Target Channel</label>
                      <select
                        required
                        value={channelId}
                        onChange={(e) => setChannelId(e.target.value)}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                      >
                        {detail.channels
                          .filter((c) => c.isText)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              #{c.name}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="flex items-end gap-4">
                      <label className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer pb-2">
                        <input
                          type="checkbox"
                          checked={useEmbed}
                          onChange={(e) => setUseEmbed(e.target.checked)}
                          className="rounded border-slate-600 bg-slate-950 text-indigo-600"
                        />
                        <span>Send as Rich Embed</span>
                      </label>
                      {useEmbed && (
                        <input
                          type="color"
                          value={color}
                          onChange={(e) => setColor(e.target.value)}
                          className="h-9 w-12 rounded-lg border border-slate-700 bg-slate-950 cursor-pointer"
                          title="Embed Color"
                        />
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Title (optional)</label>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Server Maintenance Notice"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Message</label>
                    <textarea
                      required
                      rows={4}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Write your announcement (Discord markdown supported)..."
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>

                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition"
                  >
                    <Send className="h-4 w-4" />
                    <span>Send to Discord</span>
                  </button>
                </form>
              )}

              {subTab === 'members' && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="h-4 w-4 text-slate-500 absolute left-3 top-2.5" />
                      <input
                        value={memberQuery}
                        onChange={(e) => setMemberQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && selectedId) {
                            void loadDetail(selectedId, memberQuery);
                          }
                        }}
                        placeholder="Search member by username or ID and press Enter..."
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-sm text-white"
                      />
                    </div>
                    <button
                      onClick={() => selectedId && void loadDetail(selectedId, memberQuery)}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm text-white"
                    >
                      Search
                    </button>
                  </div>

                  <div className="space-y-2.5 max-h-[32rem] overflow-y-auto pr-1">
                    {detail.members.map((m) => (
                      <div
                        key={m.id}
                        className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={m.avatarUrl}
                            alt={m.username}
                            className="h-9 w-9 rounded-full"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-white truncate">
                                {m.displayName}
                              </span>
                              <span className="text-xs text-slate-400">@{m.username}</span>
                              {m.isAdmin && (
                                <span title="Discord Admin">
                                  <Shield className="h-3.5 w-3.5 text-amber-400" />
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {m.roles.map((rId) => {
                                const role = detail.roles.find((r) => r.id === rId);
                                if (!role) return null;
                                return (
                                  <button
                                    key={rId}
                                    onClick={() =>
                                      void handleMemberAction(m.id, 'remove_role', { roleId: rId })
                                    }
                                    title="Click to remove role"
                                    className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-300 border border-slate-700"
                                  >
                                    {role.name} ×
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) {
                                void handleMemberAction(m.id, 'add_role', {
                                  roleId: e.target.value,
                                });
                                e.target.value = '';
                              }
                            }}
                            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                          >
                            <option value="">+ Add Role</option>
                            {detail.roles
                              .filter((r) => !r.managed && !m.roles.includes(r.id))
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                          </select>

                          <button
                            onClick={() =>
                              void handleMemberAction(m.id, 'timeout', { durationMinutes: 10 })
                            }
                            className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs"
                          >
                            Timeout 10m
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Kick ${m.username} from ${detail.guild.name}?`)) {
                                void handleMemberAction(m.id, 'kick');
                              }
                            }}
                            className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs"
                          >
                            Kick
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {subTab === 'settings' && (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Server Audit / Bot Log Channel
                    </label>
                    <select
                      value={detail.guild.logChannelId ?? ''}
                      onChange={async (e) => {
                        if (!selectedId) return;
                        await api.updateGuildSettings(selectedId, {
                          logChannelId: e.target.value || null,
                        });
                        await loadDetail(selectedId);
                      }}
                      className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    >
                      <option value="">Disabled</option>
                      {detail.channels
                        .filter((c) => c.isText)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            #{c.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-400">
                      Per-Server Module Overrides
                    </div>
                    {modules
                      .filter((m) => !m.core)
                      .map((m) => {
                        const enabledOnGuild =
                          m.enabled && !detail.guild.disabledModules.includes(m.id);
                        return (
                          <div
                            key={m.id}
                            className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3.5"
                          >
                            <div>
                              <div className="text-sm font-semibold text-white">{m.name}</div>
                              <div className="text-xs text-slate-400">{m.description}</div>
                            </div>
                            <button
                              disabled={!m.enabled}
                              onClick={() => void handleToggleGuildModule(m.id, enabledOnGuild)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                                !m.enabled
                                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                  : enabledOnGuild
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-slate-800 text-slate-300 border border-slate-700'
                              }`}
                            >
                              {!m.enabled
                                ? 'Globally Off'
                                : enabledOnGuild
                                  ? 'Enabled'
                                  : 'Disabled'}
                            </button>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
