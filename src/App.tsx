import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { applyPreferredLanguageFromProfile } from './hooks/useUserProfile';
import { Auth } from './components/Auth';
import { AppLayout } from './components/AppLayout';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { GroupsPage } from './features/groups/GroupsPage';
import { GroupDetailPage } from './features/groups/GroupDetailPage';
import { ExpensesPage } from './features/expenses/ExpensesPage';
import { EventsPage } from './features/events/EventsPage';
import { EventDetailPage } from './features/events/EventDetailPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { ContactsPage } from './features/contacts/ContactsPage';
import { PeopleDetailPage } from './features/people/PeopleDetailPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { HelpRedirectPage } from './pages/HelpRedirectPage';
import { LegalPage } from './pages/LegalPage';
import {
  LoginRedirectPage,
  ProfileRedirectPage,
  RegisterRedirectPage,
} from './pages/AuthRouteRedirects';
import { Session } from '@supabase/supabase-js';
import { Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { InviteEntryPage } from './features/groups/InviteEntryPage';
import { SsoCallbackPage } from './pages/SsoCallbackPage';
import { DevLoginPage } from './pages/DevLoginPage';
import { BrandLogo } from './components/BrandLogo';
import { AppInviteRefCapture } from './components/AppInviteRefCapture';
import { clearStoredAppInviteRef, getStoredAppInviteRef } from './lib/appInviteRef';
import {
  clearPendingGroupInviteToken,
  getPendingGroupInviteToken,
} from './lib/groupInviteToken';

/** Legacy Auth Core paths that omitted `/sso` — preserve query (ticket, app). */
function LegacySsoCallbackRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={`/sso/callback${search}${hash}`} replace />;
}

function isSsoCallbackLocation(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path === '/sso/callback' || path === '/callback';
}

function PublicSsoRoutes() {
  return (
    <Routes>
      <Route path="/callback" element={<LegacySsoCallbackRedirect />} />
      <Route path="/sso/callback" element={<SsoCallbackPage />} />
    </Routes>
  );
}

export default function App() {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function syncLanguageFromProfile(userId: string) {
      const { data } = await supabase
        .from('profiles')
        .select('preferred_language')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled) return;
      await applyPreferredLanguageFromProfile(data?.preferred_language);
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
        setSession(null);
      } else {
        setSession(nextSession ?? null);
      }
      const uid = nextSession?.user?.id;
      if (uid) void syncLanguageFromProfile(uid);
    });

    supabase.auth.getSession().then(({ data: { session: initial } }) => {
      if (cancelled) return;
      setSession(initial);
      setLoading(false);
      if (initial?.user?.id) void syncLanguageFromProfile(initial.user.id);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !session?.user?.id) return;
    const inviterId = getStoredAppInviteRef();
    if (!inviterId || inviterId === session.user.id) {
      if (inviterId === session.user.id) clearStoredAppInviteRef();
      return;
    }

    let cancelled = false;
    void (async () => {
      const { error } = await supabase.functions.invoke('accept-app-invite', {
        body: { inviter_id: inviterId },
      });
      if (cancelled) return;
      if (!error) clearStoredAppInviteRef();
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const token = getPendingGroupInviteToken();
    if (!token) return;
    clearPendingGroupInviteToken();
    const targetPath = `/invite/${encodeURIComponent(token)}`;
    if (window.location.pathname !== targetPath) {
      window.location.replace(targetPath);
    }
  }, [session?.user?.id]);

  if (loading && isSsoCallbackLocation()) {
    return (
      <BrowserRouter>
        <PublicSsoRoutes />
      </BrowserRouter>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-slate-50 text-center">
        <BrandLogo className="h-12 sm:h-14 w-auto max-w-[min(100vw,18rem)] mx-auto mb-6" />
        <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mb-6">
          <AlertCircle className="w-8 h-8 text-blue-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">{t('app.configTitle')}</h1>
        <p className="text-slate-600 mb-8 max-w-md">{t('app.configBody')}</p>

        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm text-left w-full max-w-md space-y-4">
          <h2 className="font-semibold text-slate-900">{t('app.setupInstructions')}</h2>
          <ol className="list-decimal list-inside space-y-3 text-sm text-slate-600">
            <li>
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline inline-flex items-center gap-1"
              >
                {t('app.setupStep1')} <ExternalLink className="w-3 h-3" />
              </a>
            </li>
            <li>{t('app.setupStep2')}</li>
            <li>{t('app.setupStep3')}</li>
            <li>{t('app.setupStep4')}</li>
            <li>
              {t('app.setupStep5')}
              <ul className="mt-2 space-y-1 font-mono text-xs bg-slate-50 p-2 rounded-lg border border-slate-100 list-none">
                <li>VITE_SUPABASE_URL</li>
                <li>VITE_SUPABASE_ANON_KEY</li>
              </ul>
            </li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <AppInviteRefCapture />
      <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
        <Routes>
          <Route path="/callback" element={<LegacySsoCallbackRedirect />} />
          <Route path="/sso/callback" element={<SsoCallbackPage />} />
          <Route path="/login" element={<LoginRedirectPage />} />
          <Route path="/register" element={<RegisterRedirectPage />} />
          <Route path="/profile" element={<ProfileRedirectPage />} />
          <Route path="/help" element={<HelpRedirectPage />} />
          {import.meta.env.DEV && (
            <Route path="/dev-login" element={<DevLoginPage />} />
          )}
          <Route path="/invite/:token" element={<InviteEntryPage session={session} />} />
          {!session ? (
            <Route path="*" element={<Auth />} />
          ) : (
            <Route path="/" element={<AppLayout session={session} />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage session={session} />} />
              <Route path="groups" element={<GroupsPage session={session} />} />
              <Route path="groups/:id" element={<GroupDetailPage session={session} />} />
              <Route path="contacts" element={<Navigate to="/people" replace />} />
              <Route path="people" element={<ContactsPage session={session} />} />
              <Route path="people/:personId" element={<PeopleDetailPage session={session} />} />
              <Route path="expenses" element={<ExpensesPage session={session} />} />
              <Route path="events" element={<EventsPage session={session} />} />
              <Route path="reports" element={<ReportsPage session={session} />} />
              <Route path="events/:id" element={<EventDetailPage session={session} />} />
              <Route path="settings" element={<SettingsPage session={session} />} />
              <Route path="help" element={<HelpRedirectPage />} />
              <Route path="legal/:topic" element={<LegalPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          )}
        </Routes>
      </div>
    </BrowserRouter>
  );
}
