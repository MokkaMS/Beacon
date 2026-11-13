import {
  Activity,
  Blocks,
  Gamepad2,
  LogOut,
  Menu,
  Radio,
  Server,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { AuthUser, EffectivePermissions } from '../lib/api';

export type NavTab =
  | 'overview'
  | 'servers'
  | 'permissions'
  | 'minecraft'
  | 'modules'
  | 'settings';

interface LayoutProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  user: AuthUser;
  permissions: EffectivePermissions | null;
  minecraftEnabled: boolean;
  onLogout: () => void;
  children: ReactNode;
}

export function Layout({
  activeTab,
  onSelectTab,
  user,
  permissions,
  minecraftEnabled,
  onLogout,
  children,
}: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const hasPerm = (key: string) =>
    Boolean(
      permissions?.isOwner ||
        permissions?.isGlobalAdmin ||
        permissions?.permissions.includes('*') ||
        permissions?.permissions.includes(key),
    );

  const navItems: { id: NavTab; label: string; icon: typeof Activity; visible: boolean }[] = [
    { id: 'overview', label: 'Overview', icon: Activity, visible: true },
    {
      id: 'servers',
      label: 'Server Management',
      icon: Server,
      visible: hasPerm('admin.servers') || (permissions?.adminGuildIds.length ?? 0) > 0,
    },
    {
      id: 'permissions',
      label: 'User Permissions',
      icon: ShieldCheck,
      visible: hasPerm('admin.permissions'),
    },
    {
      id: 'minecraft',
      label: 'Minecraft 24/7',
      icon: Gamepad2,
      visible: minecraftEnabled && hasPerm('minecraft.view'),
    },
    {
      id: 'modules',
      label: 'Modules',
      icon: Blocks,
      visible: hasPerm('admin.modules') || hasPerm('admin.view'),
    },
    {
      id: 'settings',
      label: 'Bot Settings',
      icon: Settings,
      visible: hasPerm('admin.settings') || hasPerm('admin.view'),
    },
  ];

  const SidebarContent = (
    <div className="flex h-full flex-col justify-between bg-slate-900/95 border-r border-slate-800 p-4">
      <div>
        <div className="flex items-center justify-between px-2 py-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white leading-tight">Beacon</div>
              <div className="text-xs text-slate-400">Modular Admin</div>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="space-y-1">
          {navItems
            .filter((item) => item.visible)
            .map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onSelectTab(item.id);
                    setMobileOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
                    active
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-950/50'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </nav>
      </div>

      <div className="pt-4 border-t border-slate-800">
        <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <img
            src={user.avatarUrl}
            alt={user.username}
            className="h-9 w-9 rounded-full border border-slate-700"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-white truncate">
              {user.globalName ?? user.username}
            </div>
            <div className="text-xs text-slate-400 truncate">
              {user.isBotOwner ? 'Bot Owner' : 'Discord Admin'}
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Sign out"
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {SidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 h-full">{SidebarContent}</div>
          <div
            className="flex-1 bg-black/60 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg text-slate-300 hover:bg-slate-800"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold text-sm">Beacon Admin</span>
          <img
            src={user.avatarUrl}
            alt={user.username}
            className="h-8 w-8 rounded-full border border-slate-700"
          />
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
