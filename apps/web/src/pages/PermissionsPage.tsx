import { Plus, ShieldCheck, Trash2, UserCheck, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  api,
  type GuildDetail,
  type GuildSummary,
  type PermissionDef,
  type RolePermissionRecord,
  type UserPermissionRecord,
} from '../lib/api';

export function PermissionsPage() {
  const [definitions, setDefinitions] = useState<PermissionDef[]>([]);
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [selectedGuildId, setSelectedGuildId] = useState<string>('*');
  const [guildDetail, setGuildDetail] = useState<GuildDetail | null>(null);

  const [users, setUsers] = useState<UserPermissionRecord[]>([]);
  const [roles, setRoles] = useState<RolePermissionRecord[]>([]);
  const [botOwners, setBotOwners] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // User form state
  const [userIdInput, setUserIdInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [userIsAdmin, setUserIsAdmin] = useState(false);
  const [userSelectedPerms, setUserSelectedPerms] = useState<string[]>(['admin.view']);
  const [userNote, setUserNote] = useState('');

  // Role form state
  const [roleIdInput, setRoleIdInput] = useState('');
  const [roleIsAdmin, setRoleIsAdmin] = useState(false);
  const [roleSelectedPerms, setRoleSelectedPerms] = useState<string[]>(['minecraft.view']);

  const loadAll = async (scopeGuildId = selectedGuildId) => {
    try {
      const [defsRes, guildsRes, usersRes, rolesRes] = await Promise.all([
        api.permissionDefinitions(),
        api.guilds(),
        api.userPermissions(scopeGuildId === '*' ? undefined : scopeGuildId),
        api.rolePermissions(scopeGuildId === '*' ? undefined : scopeGuildId),
      ]);
      setDefinitions(defsRes.definitions);
      setGuilds(guildsRes.guilds);
      setUsers(usersRes.users);
      setBotOwners(usersRes.botOwnerIds);
      setRoles(rolesRes.roles);
      setError(null);

      if (scopeGuildId !== '*') {
        const detail = await api.guildDetail(scopeGuildId);
        setGuildDetail(detail);
      } else {
        setGuildDetail(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load permissions');
    }
  };

  useEffect(() => {
    void loadAll(selectedGuildId);
  }, [selectedGuildId]);

  const togglePerm = (list: string[], setList: (v: string[]) => void, key: string) => {
    setList(list.includes(key) ? list.filter((p) => p !== key) : [...list, key]);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.upsertUserPermission({
        guildId: selectedGuildId,
        userId: userIdInput.trim(),
        usernameCache: usernameInput.trim(),
        permissions: userSelectedPerms,
        isAdmin: userIsAdmin,
        note: userNote.trim(),
      });
      setUserIdInput('');
      setUsernameInput('');
      setUserNote('');
      setUserIsAdmin(false);
      await loadAll(selectedGuildId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save user permissions');
    }
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedGuildId === '*' || !roleIdInput) return;
    setError(null);
    try {
      const roleObj = guildDetail?.roles.find((r) => r.id === roleIdInput);
      await api.upsertRolePermission({
        guildId: selectedGuildId,
        roleId: roleIdInput,
        roleNameCache: roleObj?.name ?? '',
        permissions: roleSelectedPerms,
        isAdmin: roleIsAdmin,
      });
      setRoleIdInput('');
      setRoleIsAdmin(false);
      await loadAll(selectedGuildId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save role permissions');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Discord User &amp; Role Permissions</h1>
          <p className="text-sm text-slate-400">
            Control who can access the Admin Web-Page and run privileged bot commands.
          </p>
        </div>

        <select
          value={selectedGuildId}
          onChange={(e) => setSelectedGuildId(e.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="*">Global Scope (All Servers)</option>
          {guilds.map((g) => (
            <option key={g.id} value={g.id}>
              Server: {g.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-3.5 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Bot Owners Banner */}
      <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-indigo-400 shrink-0" />
          <div className="text-sm">
            <span className="font-semibold text-white">Configured Bot Owners (.env): </span>
            <span className="text-indigo-200 font-mono text-xs">
              {botOwners.length > 0 ? botOwners.join(', ') : 'None configured'}
            </span>
          </div>
        </div>
        <span className="text-xs text-indigo-300/80">
          Bot Owners always bypass all permission checks.
        </span>
      </div>

      {/* User Permissions Section */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <form
          onSubmit={handleSaveUser}
          className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4 h-fit"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <UserCheck className="h-4 w-4 text-indigo-400" />
            <span>Grant Discord User Permissions</span>
          </div>

          {guildDetail && guildDetail.members.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Quick-pick server member (optional)
              </label>
              <select
                value=""
                onChange={(e) => {
                  const m = guildDetail.members.find((x) => x.id === e.target.value);
                  if (m) {
                    setUserIdInput(m.id);
                    setUsernameInput(m.username);
                  }
                }}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
              >
                <option value="">Select member from {guildDetail.guild.name}...</option>
                {guildDetail.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} (@{m.username})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-400 mb-1">Discord User ID</label>
            <input
              required
              value={userIdInput}
              onChange={(e) => setUserIdInput(e.target.value)}
              placeholder="e.g. 123456789012345678"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white font-mono"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Label / Note (optional)</label>
            <input
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              placeholder="e.g. Minecraft Moderator"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </div>

          <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={userIsAdmin}
              onChange={(e) => setUserIsAdmin(e.target.checked)}
              className="rounded border-slate-600 bg-slate-950 text-indigo-600"
            />
            <span className="font-medium">Full Admin for this scope</span>
          </label>

          {!userIsAdmin && (
            <div className="space-y-2 pt-1 max-h-60 overflow-y-auto pr-1">
              <div className="text-xs font-medium text-slate-400">Granular Permissions</div>
              {definitions.map((def) => (
                <label
                  key={def.key}
                  className="flex items-start gap-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 cursor-pointer hover:border-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={userSelectedPerms.includes(def.key)}
                    onChange={() =>
                      togglePerm(userSelectedPerms, setUserSelectedPerms, def.key)
                    }
                    className="mt-0.5 rounded border-slate-600 bg-slate-900 text-indigo-600"
                  />
                  <div>
                    <div className="text-xs font-semibold text-white">
                      {def.label}{' '}
                      <span className="font-mono text-[10px] text-indigo-300">({def.key})</span>
                    </div>
                    <div className="text-[11px] text-slate-400">{def.description}</div>
                  </div>
                </label>
              ))}
            </div>
          )}

          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2.5 text-sm font-semibold text-white transition"
          >
            <Plus className="h-4 w-4" />
            <span>Save User Rule</span>
          </button>
        </form>

        <div className="lg:col-span-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="text-sm font-semibold text-white mb-4">
            Assigned Discord User Rules ({users.length})
          </h2>
          {users.length === 0 ? (
            <div className="text-sm text-slate-500 py-8 text-center">
              No custom user permission rules configured yet.
            </div>
          ) : (
            <div className="space-y-3">
              {users.map((u) => (
                <div
                  key={`${u.guildId}-${u.userId}`}
                  className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 flex items-start justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white text-sm">
                        {u.usernameCache || u.userId}
                      </span>
                      <span className="font-mono text-xs text-slate-400">{u.userId}</span>
                      <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-800 text-slate-300">
                        {u.guildId === '*' ? 'Global' : `Guild ${u.guildId}`}
                      </span>
                      {u.isAdmin && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          Admin
                        </span>
                      )}
                    </div>
                    {u.note && <div className="text-xs text-slate-400 mt-1">{u.note}</div>}
                    {!u.isAdmin && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {u.permissions.map((p) => (
                          <span
                            key={p}
                            className="px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-200 font-mono text-[11px]"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      await api.deleteUserPermission(u.guildId, u.userId);
                      await loadAll(selectedGuildId);
                    }}
                    className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition shrink-0"
                    title="Revoke rule"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Role Permissions Section (visible when a specific guild is chosen) */}
      {selectedGuildId !== '*' && guildDetail && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <form
            onSubmit={handleSaveRole}
            className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-4 h-fit"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Users className="h-4 w-4 text-sky-400" />
              <span>Grant Discord Role Permissions ({guildDetail.guild.name})</span>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Discord Role</label>
              <select
                required
                value={roleIdInput}
                onChange={(e) => setRoleIdInput(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                <option value="">Choose a role...</option>
                {guildDetail.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    @{r.name}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={roleIsAdmin}
                onChange={(e) => setRoleIsAdmin(e.target.checked)}
                className="rounded border-slate-600 bg-slate-950 text-indigo-600"
              />
              <span className="font-medium">Server Admin for this bot</span>
            </label>

            {!roleIsAdmin && (
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {definitions.map((def) => (
                  <label
                    key={def.key}
                    className="flex items-center gap-2 text-xs text-slate-200 py-1 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={roleSelectedPerms.includes(def.key)}
                      onChange={() =>
                        togglePerm(roleSelectedPerms, setRoleSelectedPerms, def.key)
                      }
                      className="rounded border-slate-600 bg-slate-950 text-indigo-600"
                    />
                    <span>{def.label}</span>
                    <span className="font-mono text-[10px] text-slate-400">({def.key})</span>
                  </label>
                ))}
              </div>
            )}

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-500 py-2.5 text-sm font-semibold text-white transition"
            >
              <Plus className="h-4 w-4" />
              <span>Save Role Rule</span>
            </button>
          </form>

          <div className="lg:col-span-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <h2 className="text-sm font-semibold text-white mb-4">
              Assigned Role Rules ({roles.length})
            </h2>
            {roles.length === 0 ? (
              <div className="text-sm text-slate-500 py-8 text-center">
                No role permission rules for this server yet.
              </div>
            ) : (
              <div className="space-y-3">
                {roles.map((r) => (
                  <div
                    key={`${r.guildId}-${r.roleId}`}
                    className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 flex items-start justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-sm">
                          @{r.roleNameCache || r.roleId}
                        </span>
                        {r.isAdmin && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-500/20 text-emerald-300">
                            Server Admin
                          </span>
                        )}
                      </div>
                      {!r.isAdmin && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {r.permissions.map((p) => (
                            <span
                              key={p}
                              className="px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-200 font-mono text-[11px]"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={async () => {
                        await api.deleteRolePermission(r.guildId, r.roleId);
                        await loadAll(selectedGuildId);
                      }}
                      className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
