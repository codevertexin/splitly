import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
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
  MoreVertical,
  ContactRound,
  ChevronDown,
  CircleHelp,
} from 'lucide-react';
import { Button } from './ui/Button';
import { MemberAvatar } from './MemberAvatar';
import { useUserProfile } from '../hooks/useUserProfile';

interface AppLayoutProps {
  session: Session;
}

/** Definições acede-se pelo menu do avatar (canto superior direito). */
const NAV_DEFS = [
  { id: 'dashboard' as const, icon: LayoutDashboard, path: '/dashboard' },
  { id: 'groups' as const, icon: Users, path: '/groups' },
  { id: 'events' as const, icon: Calendar, path: '/events' },
  { id: 'expenses' as const, icon: CreditCard, path: '/expenses' },
  { id: 'contacts' as const, icon: ContactRound, path: '/people' },
];

export function AppLayout({ session }: AppLayoutProps) {
  const { t } = useTranslation();
  const { profile } = useUserProfile(session.user.id);
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const appLogoSrc = '/logo-splitly-app.png';

  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const activeTab = location.pathname.split('/')[1] || 'dashboard';

  useEffect(() => {
    if (!mobileMenuOpen && !userMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (mobileMenuRef.current?.contains(t)) return;
      if (userMenuRef.current?.contains(t)) return;
      setMobileMenuOpen(false);
      setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mobileMenuOpen, userMenuOpen]);

  const handleSignOut = async () => {
    localStorage.removeItem('splitly_last_group_id');
    await supabase.auth.signOut();
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
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex font-sans">
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
          <Button onClick={() => navigate('/groups')} variant="outline" className="w-full">
            <Plus className="w-4 h-4 mr-2" />
            Create a Group
          </Button>

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
            title="Create a Group"
            onClick={() => navigate('/groups')}
            className="w-11 h-11 flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-50 hover:text-blue-600 transition-all"
          >
            <Plus className="w-5 h-5" />
          </button>
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
            <button
              type="button"
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all relative"
              aria-label={t('layout.notifications')}
            >
              <Bell className="w-5 h-5" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
            </button>

            <div ref={mobileMenuRef} className="relative md:hidden">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((o) => !o)}
                className="p-2 text-slate-500 hover:bg-slate-50 rounded-xl transition-all"
                aria-expanded={mobileMenuOpen}
                aria-label={t('layout.menu')}
              >
                <MoreVertical className="w-5 h-5" />
              </button>
              {mobileMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-52 py-1 bg-white rounded-xl border border-slate-100 shadow-lg z-50">
                  <button
                    type="button"
                    onClick={() => go('/groups')}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 text-left"
                  >
                    <Plus className="w-4 h-4" />
                    {t('layout.createGroup')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
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
                    onClick={() => go('/help')}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 text-left"
                  >
                    <CircleHelp className="w-4 h-4" />
                    {t('layout.help')}
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
          <Outlet />
        </div>

        <footer className="mt-auto px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-2 sm:px-6 md:pb-8 lg:px-8 text-center text-slate-400 text-xs">
          Logged in as{' '}
          <span className="text-slate-600 font-medium break-all">{session.user.email}</span>
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
