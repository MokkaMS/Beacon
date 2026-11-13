export interface AuthUser {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string;
  isBotOwner: boolean;
  isDevBypass?: boolean;
  guildIds: string[];
}

export interface EffectivePermissions {
  isOwner: boolean;
  isGlobalAdmin: boolean;
  permissions: string[];
  adminGuildIds: string[];
}

export interface AuthStatus {
  authenticated: boolean;
  user: AuthUser | null;
  effectivePermissions: EffectivePermissions | null;
  oauthConfigured: boolean;
  devBypassAllowed: boolean;
  botInviteUrl: string | null;
}

export interface PermissionDef {
  key: string;
  label: string;
  description: string;
  moduleId?: string;
}

export interface ModuleInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  enabled: boolean;
  defaultEnabled: boolean;
  core: boolean;
  ui?: {
    navPath?: string;
    navLabel?: string;
    icon?: string;
    core?: boolean;
  };
  permissions: PermissionDef[];
  commands: { name: string; description: string; requiredPermission?: string }[];
}

export interface LogEntry {
  id: number;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface AuditEntry {
  id: number;
  actorId: string;
  actorName: string;
  source: string;
  guildId: string | null;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface UserPermissionRecord {
  id: number;
  guildId: string;
  userId: string;
  usernameCache: string;
  permissions: string[];
  isAdmin: boolean;
  note: string;
  updatedAt: string;
}

export interface RolePermissionRecord {
  id: number;
  guildId: string;
  roleId: string;
  roleNameCache: string;
  permissions: string[];
  isAdmin: boolean;
  updatedAt: string;
}

export interface GuildSummary {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number;
  ownerId: string;
  channelCount: number;
  roleCount: number;
  disabledModules: string[];
}

export interface GuildDetail {
  guild: {
    id: string;
    name: string;
    iconUrl: string | null;
    memberCount: number;
    ownerId: string;
    logChannelId: string | null;
    disabledModules: string[];
  };
  channels: { id: string; name: string; type: string; isText: boolean; parentId: string | null }[];
  roles: { id: string; name: string; color: string; position: number; managed: boolean }[];
  members: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    roles: string[];
    isAdmin: boolean;
    joinedAt: string | null;
    timedOutUntil: string | null;
  }[];
}

export interface McServer {
  id: number;
  name: string;
  host: string;
  port: number;
  edition: 'java' | 'bedrock';
  pollIntervalSec: number;
  enabled: boolean;
  guildId: string | null;
  alertChannelId: string | null;
  statusChannelId: string | null;
  statusMessageId: string | null;
  notifyOffline: boolean;
  notifyPlayers: boolean;
  rconConfigured: boolean;
  rconPort: number | null;
  lastOnline: boolean | null;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastPlayerCount: number;
  lastMaxPlayers: number;
  lastVersion: string | null;
  lastMotd: string | null;
  lastFavicon: string | null;
  onlinePlayers: { username: string; joined_at: string }[];
  uptime24hPct: number;
  avgLatency24hMs: number | null;
}

export interface McHistoryResponse {
  summary: {
    totalChecks: number;
    uptimePct: number;
    avgLatencyMs: number | null;
    peakPlayers: number;
  };
  points: {
    timestamp: string;
    online: boolean;
    latencyMs: number | null;
    playerCount: number;
    maxPlayers: number;
  }[];
  incidents: { type: 'online' | 'offline'; at: string; message: string | null }[];
}

export interface McPlayerOverview {
  id: number;
  username: string;
  uuid: string | null;
  firstSeen: string;
  lastSeen: string;
  totalPlaytimeSeconds: number;
  sessionCount: number;
  onlineNow: boolean;
  activeServerId: number | null;
  activeServerName: string | null;
}

export interface McPlayerDetail {
  player: {
    id: number;
    username: string;
    uuid: string | null;
    firstSeen: string;
    lastSeen: string;
    totalPlaytimeSeconds: number;
    sessionCount: number;
  };
  sessions: {
    id: number;
    server_id: number;
    server_name: string;
    joined_at: string;
    left_at: string | null;
    duration_seconds: number;
  }[];
  serverBreakdown: {
    server_id: number;
    server_name: string;
    sessions: number;
    playtime_seconds: number;
  }[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export const api = {
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  devLogin: () => request<{ ok: boolean }>('/api/auth/dev-login', { method: 'POST' }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  overview: () =>
    request<{
      bot: {
        ready: boolean;
        tag: string | null;
        avatarUrl: string | null;
        pingMs: number | null;
        guildsCount: number;
        uptimeSec: number;
        configured: boolean;
      };
      system: {
        platform: string;
        arch: string;
        nodeVersion: string;
        processRssMb: number;
        hostTotalMemMb: number;
        hostUsedMemMb: number;
        loadAvg1m: number;
      };
      modules: { total: number; enabled: number; list: ModuleInfo[] };
      recentAudit: AuditEntry[];
    }>('/api/overview'),

  logs: (limit = 120) => request<{ logs: LogEntry[] }>(`/api/logs?limit=${limit}`),

  modules: () => request<{ modules: ModuleInfo[] }>('/api/modules'),
  setModuleEnabled: (id: string, enabled: boolean) =>
    request<{ module: ModuleInfo }>(`/api/modules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),

  // Admin: Permissions
  permissionDefinitions: () =>
    request<{ definitions: PermissionDef[] }>('/api/modules/admin/permissions/definitions'),
  userPermissions: (guildId?: string) =>
    request<{ users: UserPermissionRecord[]; botOwnerIds: string[] }>(
      `/api/modules/admin/permissions/users${guildId ? `?guildId=${encodeURIComponent(guildId)}` : ''}`,
    ),
  upsertUserPermission: (payload: {
    guildId: string;
    userId: string;
    usernameCache?: string;
    permissions: string[];
    isAdmin: boolean;
    note?: string;
  }) =>
    request<{ user: UserPermissionRecord }>('/api/modules/admin/permissions/users', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteUserPermission: (guildId: string, userId: string) =>
    request<{ deleted: boolean }>(
      `/api/modules/admin/permissions/users/${encodeURIComponent(guildId)}/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ),

  rolePermissions: (guildId?: string) =>
    request<{ roles: RolePermissionRecord[] }>(
      `/api/modules/admin/permissions/roles${guildId ? `?guildId=${encodeURIComponent(guildId)}` : ''}`,
    ),
  upsertRolePermission: (payload: {
    guildId: string;
    roleId: string;
    roleNameCache?: string;
    permissions: string[];
    isAdmin: boolean;
  }) =>
    request<{ role: RolePermissionRecord }>('/api/modules/admin/permissions/roles', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteRolePermission: (guildId: string, roleId: string) =>
    request<{ deleted: boolean }>(
      `/api/modules/admin/permissions/roles/${encodeURIComponent(guildId)}/${encodeURIComponent(roleId)}`,
      { method: 'DELETE' },
    ),

  // Admin: Guilds / Servers
  guilds: () => request<{ guilds: GuildSummary[]; ready: boolean }>('/api/modules/admin/guilds'),
  guildDetail: (guildId: string, memberQuery = '') =>
    request<GuildDetail>(
      `/api/modules/admin/guilds/${encodeURIComponent(guildId)}?memberQuery=${encodeURIComponent(memberQuery)}`,
    ),
  updateGuildSettings: (
    guildId: string,
    payload: { logChannelId?: string | null; moduleToggles?: Record<string, boolean> },
  ) =>
    request<{ ok: boolean; disabledModules: string[] }>(
      `/api/modules/admin/guilds/${encodeURIComponent(guildId)}/settings`,
      { method: 'PATCH', body: JSON.stringify(payload) },
    ),
  announce: (
    guildId: string,
    payload: {
      channelId: string;
      title?: string;
      message: string;
      color?: string;
      useEmbed: boolean;
    },
  ) =>
    request<{ ok: boolean }>(`/api/modules/admin/guilds/${encodeURIComponent(guildId)}/announce`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  memberAction: (
    guildId: string,
    userId: string,
    payload: {
      action: 'add_role' | 'remove_role' | 'timeout' | 'kick' | 'ban' | 'nickname';
      roleId?: string;
      durationMinutes?: number;
      nickname?: string;
      reason?: string;
    },
  ) =>
    request<{ ok: boolean }>(
      `/api/modules/admin/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/action`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  // Admin: Settings & Audit
  adminSettings: () =>
    request<{
      presence: {
        status: 'online' | 'idle' | 'dnd' | 'invisible';
        activityType: 'Playing' | 'Watching' | 'Listening' | 'Competing' | 'None';
        activityText: string;
      };
      allowGuildAdminBypass: boolean;
    }>('/api/modules/admin/settings'),
  updatePresence: (payload: {
    status: 'online' | 'idle' | 'dnd' | 'invisible';
    activityType: 'Playing' | 'Watching' | 'Listening' | 'Competing' | 'None';
    activityText: string;
  }) =>
    request<{ ok: boolean }>('/api/modules/admin/settings/presence', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  updateGeneralSettings: (payload: { allowGuildAdminBypass: boolean }) =>
    request<{ ok: boolean }>('/api/modules/admin/settings/general', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  syncCommands: () =>
    request<{ ok: boolean; count: number }>('/api/modules/admin/sync-commands', {
      method: 'POST',
    }),
  auditLogs: (limit = 50) =>
    request<{ logs: AuditEntry[] }>(`/api/modules/admin/audit-logs?limit=${limit}`),

  // Minecraft
  mcServers: () => request<{ servers: McServer[] }>('/api/modules/minecraft/servers'),
  mcCreateServer: (payload: Record<string, unknown>) =>
    request<{ server: McServer }>('/api/modules/minecraft/servers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  mcUpdateServer: (id: number, payload: Record<string, unknown>) =>
    request<{ server: McServer }>(`/api/modules/minecraft/servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  mcDeleteServer: (id: number) =>
    request<{ deleted: boolean }>(`/api/modules/minecraft/servers/${id}`, {
      method: 'DELETE',
    }),
  mcPollServer: (id: number) =>
    request<{ server: McServer }>(`/api/modules/minecraft/servers/${id}/poll`, {
      method: 'POST',
    }),
  mcServerHistory: (id: number, hours: number) =>
    request<McHistoryResponse>(`/api/modules/minecraft/servers/${id}/history?hours=${hours}`),
  mcRcon: (id: number, command: string) =>
    request<{ output: string }>(`/api/modules/minecraft/servers/${id}/rcon`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    }),
  mcPlayers: (serverId?: number, search = '') => {
    const params = new URLSearchParams();
    if (serverId) params.set('serverId', String(serverId));
    if (search.trim()) params.set('search', search.trim());
    return request<{ players: McPlayerOverview[] }>(
      `/api/modules/minecraft/players?${params.toString()}`,
    );
  },
  mcPlayerDetail: (username: string) =>
    request<McPlayerDetail>(`/api/modules/minecraft/players/${encodeURIComponent(username)}`),
};

export function formatDurationSeconds(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
