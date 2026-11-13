import { useEffect, useState } from 'react';
import { Layout, type NavTab } from './components/Layout';
import { api, type AuthStatus, type ModuleInfo } from './lib/api';
import { LoginPage } from './pages/LoginPage';
import { MinecraftPage } from './pages/MinecraftPage';
import { ModulesPage } from './pages/ModulesPage';
import { OverviewPage } from './pages/OverviewPage';
import { PermissionsPage } from './pages/PermissionsPage';
import { ServersPage } from './pages/ServersPage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [activeTab, setActiveTab] = useState<NavTab>('overview');

  const errorParam = new URLSearchParams(window.location.search).get('error');

  const loadSession = async () => {
    const status = await api.authStatus();
    setAuthStatus(status);
    if (status.authenticated) {
      try {
        const modRes = await api.modules();
        setModules(modRes.modules);
      } catch {
        setModules([]);
      }
    }
  };

  useEffect(() => {
    void loadSession();
  }, []);

  if (!authStatus) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-sm text-slate-400">
        Loading Beacon Admin...
      </div>
    );
  }

  if (!authStatus.authenticated || !authStatus.user) {
    return (
      <LoginPage
        authStatus={authStatus}
        errorParam={errorParam}
        onLoggedIn={() => void loadSession()}
      />
    );
  }

  const perms = authStatus.effectivePermissions;
  const hasPerm = (key: string) =>
    Boolean(
      perms?.isOwner ||
        perms?.isGlobalAdmin ||
        perms?.permissions.includes('*') ||
        perms?.permissions.includes(key),
    );

  const mcModule = modules.find((m) => m.id === 'minecraft');
  const minecraftEnabled = mcModule ? mcModule.enabled : true;

  return (
    <Layout
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      user={authStatus.user}
      permissions={perms}
      minecraftEnabled={minecraftEnabled}
      onLogout={async () => {
        await api.logout();
        setAuthStatus({ ...authStatus, authenticated: false, user: null });
      }}
    >
      {activeTab === 'overview' && <OverviewPage botInviteUrl={authStatus.botInviteUrl} />}
      {activeTab === 'servers' && <ServersPage />}
      {activeTab === 'permissions' && <PermissionsPage />}
      {activeTab === 'minecraft' && (
        <MinecraftPage
          canManage={hasPerm('minecraft.manage')}
          canRcon={hasPerm('minecraft.rcon')}
        />
      )}
      {activeTab === 'modules' && (
        <ModulesPage onModulesChanged={() => void loadSession()} />
      )}
      {activeTab === 'settings' && <SettingsPage />}
    </Layout>
  );
}
