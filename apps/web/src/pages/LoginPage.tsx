import { ExternalLink, Radio, ShieldAlert, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { api, type AuthStatus } from '../lib/api';

interface LoginPageProps {
  authStatus: AuthStatus;
  errorParam: string | null;
  onLoggedIn: () => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  access_denied:
    'Your Discord account does not have permission to access this Admin Web-Page. Ask a Bot Owner to grant your Discord ID or Role permissions.',
  oauth_failed: 'Discord OAuth2 login was cancelled or failed state verification.',
  oauth_token_failed: 'Failed to exchange Discord authorization code. Check Client Secret & Redirect URI.',
  oauth_user_failed: 'Could not read your Discord profile.',
  oauth_exception: 'Unexpected authentication error. Check server logs.',
};

export function LoginPage({ authStatus, errorParam, onLoggedIn }: LoginPageProps) {
  const [loadingDev, setLoadingDev] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  const handleDevLogin = async () => {
    setLoadingDev(true);
    setDevError(null);
    try {
      await api.devLogin();
      onLoggedIn();
    } catch (err) {
      setDevError(err instanceof Error ? err.message : 'Dev login failed');
    } finally {
      setLoadingDev(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-14 w-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 mb-4">
            <Radio className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-white">Beacon Admin</h1>
          <p className="text-sm text-slate-400 mt-1">
            Modular Discord Bot, Server Control &amp; 24/7 Minecraft Monitoring
          </p>
        </div>

        {(errorParam || devError) && (
          <div className="mb-5 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3.5 text-sm text-rose-200 flex gap-2.5">
            <ShieldAlert className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
            <div>{devError ?? ERROR_MESSAGES[errorParam!] ?? 'Authentication failed.'}</div>
          </div>
        )}

        {authStatus.oauthConfigured ? (
          <a
            href="/api/auth/login"
            className="w-full inline-flex items-center justify-center gap-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-4 transition shadow-lg shadow-indigo-950/50"
          >
            <span>Continue with Discord</span>
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : (
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-4 text-xs text-amber-200 space-y-2 mb-4">
            <div className="font-semibold text-amber-100">Discord OAuth2 Setup Needed</div>
            <p className="text-amber-200/80 leading-relaxed">
              Set <code className="text-white">DISCORD_CLIENT_ID</code>,{' '}
              <code className="text-white">DISCORD_CLIENT_SECRET</code>,{' '}
              <code className="text-white">DISCORD_REDIRECT_URI</code>, and{' '}
              <code className="text-white">BOT_OWNER_IDS</code> in your <code className="text-white">.env</code> file.
            </p>
          </div>
        )}

        {authStatus.devBypassAllowed && (
          <button
            onClick={handleDevLogin}
            disabled={loadingDev}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium py-2.5 px-4 transition disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4 text-amber-400" />
            <span>{loadingDev ? 'Signing in...' : 'Local Dev Admin Login'}</span>
          </button>
        )}

        {authStatus.botInviteUrl && (
          <div className="mt-6 pt-5 border-t border-slate-800 text-center">
            <a
              href={authStatus.botInviteUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-slate-400 hover:text-indigo-400 inline-flex items-center gap-1 transition"
            >
              <span>Invite Bot to a Discord Server</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
