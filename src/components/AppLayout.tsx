import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { getAuthLogoutUrl, isAuthCoreEnabled } from '../lib/codevertexAuth';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import {
  Plus,
  Users,
  LogOut,
  LayoutDashboard,
  CreditCard,
  Settings as SettingsIcon,
  Bell,
  Calendar,
  ContactRound,
  ChevronDown,
  CircleHelp,
  Receipt,
  CalendarCheck2,
  AlertTriangle,
  Loader2,
  FileText,
} from 'lucide-react';
import { Button } from './ui/Button';
import { MemberAvatar } from './MemberAvatar';
import { useUserProfile } from '../hooks/useUserProfile';
import { ProfileNameGate } from './ProfileNameGate';
import { useNotifications } from '../hooks/useNotifications';
import { notifyExpensesChanged } from '../lib/expenseEvents';
import { BillingGuardProvider } from '../features/billing/BillingGuardProvider';
import { LegalFooterLinks } from './LegalFooterLinks';
import {
  getHelpUrl,
  LOCAL_HELP_PATH,
  mapPathnameToHelpScreen,
  shouldUseLocalHelp,
} from '../lib/codevertexConfig';

interface AppLayoutProps {
  session: Session;
}

/** Definições acede-se pelo menu do avatar (canto superior direito). */
const NAV_DEFS = [
  { id: 'dashboard' as const, icon: LayoutDashboard, path: '/dashboard' },
  { id: 'groups' as const, icon: Users, path: '/groups' },
  { id: 'events' as const, icon: Calendar, path: '/events' },
  { id: 'reports' as const, icon: FileText, path: '/reports' },
  { id: 'expenses' as const, icon: CreditCard, path: '/expenses' },
  { id: 'contacts' as const, icon: ContactRound, path: '/people' },
];

function notificationIcon(type: string) {
  if (type === 'payment_request') return Receipt;
  if (type === 'settlement_confirmation_request') return Receipt;
  if (type === 'settlement_confirmed') return Receipt;
  if (type === 'event_ready_to_finalize') return CalendarCheck2;
  if (type === 'draft_expenses_need_review') return AlertTriangle;
  return Bell;
}

function formatNotificationDate(value: string, locale: string) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const diffMs = dt.getTime() - Date.now();
  const absSec = Math.abs(Math.round(diffMs / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (absSec < 60) return rtf.format(Math.round(diffMs / 1000), 'second');
  const absMin = Math.abs(Math.round(diffMs / 60000));
  if (absMin < 60) return rtf.format(Math.round(diffMs / 60000), 'minute');
  const absHours = Math.abs(Math.round(diffMs / 3600000));
  if (absHours < 24) return rtf.format(Math.round(diffMs / 3600000), 'hour');
  const absDays = Math.abs(Math.round(diffMs / 86400000));
  if (absDays < 7) return rtf.format(Math.round(diffMs / 86400000), 'day');
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' }).format(dt);
}

export function AppLayout({ session }: AppLayoutProps) {
  const { t, i18n } = useTranslation();
  const { profile, loading: profileLoading, saving: profileSaving, saveProfileFields } = useUserProfile(session.user.id);
  const location = useLocation();
  const navigate = useNavigate();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [actingNotificationId, setActingNotificationId] = useState<string | null>(null);
  const appLogoSrc = '/logo-splitly-app.png';

  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const {
    notifications,
    unreadCount,
    loading: notificationsLoading,
    error: notificationsError,
    refetch: refetchNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotifications(session);

  const activeTab = location.pathname.split('/')[1] || 'dashboard';

  const refreshGroupFromNotification = (item: any) => {
    const groupId =
      item?.data?.group_id ||
      item?.entity_id ||
      (() => {
        if (!item?.cta_url) return null;
        const m = String(item.cta_url).match(/\/groups\/([^/?#]+)/);
        return m?.[1] ?? null;
      })();
  
    if (!groupId) return;
  
    window.dispatchEvent(
      new CustomEvent('group-settlement-confirmed', {
        detail: { groupId },
      }),
    );
  
    notifyExpensesChanged({ groupId });
  };

  useEffect(() => {
    if (!userMenuOpen && !notificationsOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (userMenuRef.current?.contains(t)) return;
      if (notificationsRef.current?.contains(t)) return;
      setUserMenuOpen(false);
      setNotificationsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userMenuOpen, notificationsOpen]);

  const handleSignOut = async () => {
    localStorage.removeItem('splitly_last_group_id');
    await supabase.auth.signOut();
    if (isAuthCoreEnabled()) {
      window.location.href = getAuthLogoutUrl();
      return;
    }
    navigate('/');
  };

  const navItems = useMemo(
    () =>
      NAV_DEFS.map((d) => ({
        ...d,
        label: t(`layout.nav.${d.id}`),
      })),
    [t] 
  );

  const go = (path: string) => {
    navigate(path);
    setUserMenuOpen(false);
    setNotificationsOpen(false);
  };

  const openSupportAndHelp = () => {
    setUserMenuOpen(false);
    setNotificationsOpen(false);
    if (shouldUseLocalHelp()) {
      navigate(LOCAL_HELP_PATH);
      return;
    }
    const screen = mapPathnameToHelpScreen(location.pathname);
    const helpLocale =
      i18n.language === 'pt-PT' || i18n.language === 'pt-BR' || i18n.language === 'es'
        ? i18n.language
        : 'en';
    window.open(getHelpUrl(screen, helpLocale), '_blank', 'noopener,noreferrer');
  };

  const locale = useMemo(() => {
    if (i18n.language === 'pt-PT') return 'pt-PT';
    if (i18n.language === 'pt-BR') return 'pt-BR';
    if (i18n.language === 'es') return 'es';
    return 'en';
  }, [i18n.language]);

  const handleConfirmSettlementNotification = async (item: any) => {
    try {
      if (actingNotificationId) return;
  
      setActingNotificationId(item.id);
  
      const { data, error } = await supabase.functions.invoke(
        'confirm-settlement-request',
        {
          body: { notification_id: item.id },
        }
      );
  
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
  
      const groupId = item.data?.group_id ?? item.entity_id ?? null;
  
      try {
        await markAsRead(item.id);
      } catch {
        // noop
      }

      await refetchNotifications();

      if (groupId) {
        refreshGroupFromNotification({
          data: { group_id: groupId },
          entity_id: groupId,
        });
      }

      setNotificationsOpen(false);
    } catch (err) {
      console.error('confirm-settlement-request failed:', err);
    } finally {
      setActingNotificationId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex font-sans">
      <ProfileNameGate
        profile={profile}
        loading={profileLoading}
        saving={profileSaving}
        saveProfileFields={saveProfileFields}
      />
      {/* Desktop sidebar */}
      <aside className="w-64 bg-white border-r border-slate-100 flex-col hidden lg:flex sticky top-0 h-screen shrink-0">
        <div className="p-6 flex-1 flex flex-col min-h-0">
          <div className="mb-8">
            <img
              src={appLogoSrc}
              alt={t('brand.name')}
              className="h-16 sm:h-[4.5rem] w-auto object-contain"
            />
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                  activeTab === item.id
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto p-6 space-y-4 border-t border-slate-50">
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl text-sm font-semibold transition-all"
          >
            <LogOut className="w-5 h-5" />
            {t('layout.signOut')}
          </button>
        </div>
      </aside>

      {/* Tablet icon rail */}
      <aside className="hidden md:flex lg:hidden w-[4.5rem] bg-white border-r border-slate-100 flex-col items-center py-4 gap-2 sticky top-0 h-screen shrink-0 z-20">
        <div className="p-2 mb-2 flex justify-center">
          <img
            src={appLogoSrc}
            alt={t('brand.name')}
            className="h-12 w-12 sm:h-14 sm:w-14 object-contain"
          />
        </div>
        <nav className="flex flex-col items-center gap-1 flex-1 w-full px-1.5 min-h-0 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.label}
              onClick={() => navigate(item.path)}
              className={`w-11 h-11 flex items-center justify-center rounded-xl transition-all ${
                activeTab === item.id
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <item.icon className="w-5 h-5" />
            </button>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-2 pt-2 border-t border-slate-50 w-full px-1.5 pb-2">
          <button
            type="button"
            title={t('layout.signOut')}
            onClick={handleSignOut}
            className="w-11 h-11 flex items-center justify-center rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 min-h-screen">
        <header className="min-h-16 sm:h-20 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between gap-2 px-4 sm:px-6 lg:px-8 sticky top-0 z-30">
          <div className="flex items-center min-w-0 md:hidden">
            <img
              src={appLogoSrc}
              alt={t('brand.name')}
              className="h-12 sm:h-14 w-auto object-contain"
            />
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div ref={notificationsRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  const nextOpen = !notificationsOpen;
                  setNotificationsOpen(nextOpen);
                  setUserMenuOpen(false);
                
                  if (nextOpen) {
                    void refetchNotifications();
                  }
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all relative"
                aria-label={t('layout.notifications')}
                aria-expanded={notificationsOpen}
                aria-haspopup="menu"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center border-2 border-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <div className="absolute right-0 top-full mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-100 bg-white shadow-lg z-50">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-slate-900">{t('layout.notifications')}</p>
                      {unreadCount > 0 && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                          {unreadCount}
                        </span>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await markAllAsRead();
                          } catch {
                            // noop for v1
                          }
                        }}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                      >
                        {t('layout.markAllAsRead')}
                      </button>
                    )}
                  </div>
                  <div className="max-h-[22rem] overflow-y-auto">
                    {notificationsLoading ? (
                      <div className="px-4 py-6 text-sm text-slate-500 flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('layout.loadingNotifications')}
                      </div>
                    ) : notificationsError ? (
                      <div className="px-4 py-6 text-sm text-red-600">{notificationsError}</div>
                    ) : notifications.length === 0 ? (
                      <div className="px-4 py-6">
                        <p className="text-sm font-semibold text-slate-700">{t('layout.noNotifications')}</p>
                        <p className="mt-1 text-xs text-slate-500">{t('layout.notificationsEmptyHint')}</p>
                      </div>
                    ) : (
                      <ul className="py-1">
                        {notifications.map((item) => {
                          const Icon = notificationIcon(item.type);
                          const title =
  item.title ||
  (item.type === 'payment_request'
    ? t('layout.notificationTypePaymentRequest')
    : item.type === 'settlement_confirmation_request'
      ? 'Payment confirmation requested'
      : item.type === 'settlement_confirmed'
        ? 'Payment confirmed'
        : item.type === 'event_ready_to_finalize'
          ? t('layout.notificationTypeEventReady')
          : item.type === 'draft_expenses_need_review'
            ? t('layout.notificationTypeDraftReview')
            : t('layout.notificationTypeGeneral'));
                          return (
                            <li key={item.id}>
                              <button
  type="button"
  onClick={async (e) => {
    e.stopPropagation();

    if (item.type === 'settlement_confirmation_request') {
      await handleConfirmSettlementNotification(item);
      return;
    }

    try {
      await markAsRead(item.id);
    } catch {
      // noop
    }

    refreshGroupFromNotification(item);
    setNotificationsOpen(false);

    if (item.cta_url) {
      navigate(item.cta_url as string);
    }
  }}
                                className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 transition-colors ${
                                  item.is_read ? 'bg-white' : 'bg-blue-50/40'
                                }`}
                              >
                                <span className="mt-0.5 relative">
                                  <Icon className="w-4 h-4 text-slate-500" />
                                  {!item.is_read && <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-blue-600" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold text-slate-800 truncate">{title}</span>
                                  {item.body && <span className="mt-0.5 block text-xs text-slate-600 line-clamp-2">{item.body}</span>}
                                  <span className="mt-1 block text-[11px] text-slate-400">
                                    {formatNotificationDate(item.created_at, locale)}
                                  </span>
                                </span>
                                {item.cta_label && (
  <span
    className={`shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold ${
      actingNotificationId === item.id
        ? 'text-slate-400 opacity-60'
        : 'text-slate-700'
    }`}
  >
    {actingNotificationId === item.id ? '...' : item.cta_label}
  </span>
)}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((o) => !o)}
                className="flex items-center gap-1 rounded-full border-2 border-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2"
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                aria-label={t('layout.accountMenu')}
              >
                <span className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-100 overflow-hidden shrink-0 block">
                  <MemberAvatar
                    userId={session.user.id}
                    fullName={profile?.full_name ?? session.user.email}
                    avatarUrl={profile?.avatar_url}
                    size="md"
                    className="!w-full !h-full rounded-full border-0 object-cover"
                  />
                </span>
                <ChevronDown
                  className={`hidden sm:block w-4 h-4 text-slate-400 mr-0.5 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>
              {userMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-56 py-1 bg-white rounded-xl border border-slate-100 shadow-lg z-50"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={openSupportAndHelp}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 text-left"
                  >
                    <CircleHelp className="w-4 h-4" />
                    {t('layout.supportAndHelp')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => go('/settings')}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 text-left"
                  >
                    <SettingsIcon className="w-4 h-4" />
                    {t('settings.title')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => go('/groups')}
                    className="w-full sm:hidden flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 text-left"
                  >
                    <Plus className="w-4 h-4" />
                    {t('layout.createGroup')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      void handleSignOut();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 text-left"
                  >
                    <LogOut className="w-4 h-4" />
                    {t('layout.signOut')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 px-4 py-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 md:pb-6 lg:px-8 lg:py-8 lg:pb-8 max-w-6xl mx-auto w-full">
          <BillingGuardProvider
            defaultEmail={typeof session.user.email === 'string' ? session.user.email : ''}
            interestUserId={session.user.id}
          >
            <Outlet />
          </BillingGuardProvider>
        </div>

        <footer className="mt-auto flex flex-col items-center gap-2 px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 md:pb-8 lg:px-8 text-center text-slate-400 text-xs">
          <LegalFooterLinks />
          <p>
            {t('layout.loggedInAs')}{' '}
            <span className="text-slate-600 font-medium break-all">{session.user.email}</span>
          </p>
        </footer>

        {/* Mobile bottom navigation */}
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-100 px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          aria-label={t('layout.mainNav')}
        >
          <div className="flex items-center justify-around max-w-lg mx-auto">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className={`flex flex-col items-center justify-center gap-0.5 py-2 px-1.5 min-w-0 flex-1 rounded-xl transition-colors ${
                    active ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <item.icon className={`w-5 h-5 shrink-0 ${active ? 'stroke-[2.5]' : ''}`} />
                  <span className="text-[10px] font-semibold leading-tight truncate w-full text-center">
                    {t(`layout.navShort.${item.id}`)}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </main>
    </div>
  );
}
