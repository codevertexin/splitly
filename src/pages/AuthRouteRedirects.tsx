import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  getAuthLoginUrl,
  getAuthProfileManageUrl,
  getAuthRegisterUrl,
} from '../lib/codevertexAuth';

function Redirecting({ messageKey }: { messageKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="flex flex-col items-center gap-3 text-slate-600">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden />
        <p className="text-sm">{t(messageKey)}</p>
      </div>
    </div>
  );
}

export function LoginRedirectPage() {
  useEffect(() => {
    window.location.replace(getAuthLoginUrl());
  }, []);
  return <Redirecting messageKey="auth.redirectingToSecureLogin" />;
}

export function RegisterRedirectPage() {
  useEffect(() => {
    window.location.replace(getAuthRegisterUrl());
  }, []);
  return <Redirecting messageKey="auth.redirectingToSecureLogin" />;
}

export function ProfileRedirectPage() {
  useEffect(() => {
    window.location.replace(getAuthProfileManageUrl());
  }, []);
  return <Redirecting messageKey="auth.redirectingToSecureLogin" />;
}
