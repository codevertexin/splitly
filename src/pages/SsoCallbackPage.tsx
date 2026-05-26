import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { APP_CODE } from '../lib/codevertexConfig';
import {
  clearStoredSsoReturnTo,
  getStoredSsoReturnTo,
} from '../lib/ssoReturnTo';
import { getPendingGroupInviteToken } from '../lib/groupInviteToken';
import { BrandLogo } from '../components/BrandLogo';

type SsoCompleteSuccess = {
  ok: true;
  access_token: string;
  refresh_token: string;
  local_user_id?: string;
  codevertex_user_id?: string;
  email?: string;
  has_session?: boolean;
};

type SsoCompleteError = {
  ok: false;
  step?: string;
  code?: string;
  message?: string;
};

type SsoCompleteResponse = SsoCompleteSuccess | SsoCompleteError;

const TICKET_DONE_PREFIX = 'splitly_sso_ticket_done:';

function ticketDoneKey(ticket: string): string {
  return `${TICKET_DONE_PREFIX}${ticket}`;
}

function wasTicketConsumed(ticket: string): boolean {
  try {
    return sessionStorage.getItem(ticketDoneKey(ticket)) === '1';
  } catch {
    return false;
  }
}

function markTicketConsumed(ticket: string): void {
  try {
    sessionStorage.setItem(ticketDoneKey(ticket), '1');
  } catch {
    /* ignore */
  }
}

async function resolveSsoCompletePayload(
  data: unknown,
  fnError: unknown,
): Promise<SsoCompleteResponse | null> {
  if (data && typeof data === 'object') {
    return data as SsoCompleteResponse;
  }
  if (fnError && typeof fnError === 'object' && 'context' in fnError) {
    const res = (fnError as { context?: Response }).context;
    if (res && typeof res.json === 'function') {
      try {
        return (await res.json()) as SsoCompleteResponse;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function resolvePostLoginPath(): string {
  const pendingInvite = getPendingGroupInviteToken();
  if (pendingInvite) {
    return `/invite/${encodeURIComponent(pendingInvite)}`;
  }
  return getStoredSsoReturnTo();
}

export function SsoCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const ticket = searchParams.get('ticket')?.trim();
    const app = searchParams.get('app')?.trim().toUpperCase();

    if (!ticket) {
      setError(t('sso.callback.missingTicket'));
      return;
    }

    if (app && app !== APP_CODE) {
      setError(t('sso.callback.invalidApp', { app: app ?? '' }));
      return;
    }

    if (wasTicketConsumed(ticket)) {
      clearStoredSsoReturnTo();
      navigate(resolvePostLoginPath(), { replace: true });
      return;
    }

    void (async () => {
      try {
        const { data, error: fnError } = await supabase.functions.invoke('sso-complete', {
          body: { ticket },
        });

        const payload = await resolveSsoCompletePayload(data, fnError);

        if (!payload || payload.ok !== true) {
          const errPayload = payload as SsoCompleteError | null;
          const message =
            errPayload?.message ||
            (fnError instanceof Error ? fnError.message : null) ||
            t('sso.callback.genericError');
          setError(message);
          return;
        }

        const { error: sessionError } = await supabase.auth.setSession({
          access_token: payload.access_token,
          refresh_token: payload.refresh_token,
        });

        if (sessionError) {
          setError(sessionError.message);
          return;
        }

        markTicketConsumed(ticket);
        const destination = resolvePostLoginPath();
        clearStoredSsoReturnTo();
        navigate(destination, { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : t('sso.callback.genericError'));
      }
    })();
  }, [navigate, searchParams, t]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <BrandLogo className="mb-8 h-16 w-auto max-w-[min(92vw,18rem)]" />
      {error ? (
        <div className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-6 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-500" />
          <h1 className="text-lg font-semibold text-slate-900">{t('sso.callback.errorTitle')}</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="mt-6 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {t('sso.callback.backToLogin')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-slate-600">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm">{t('sso.callback.signingIn')}</p>
        </div>
      )}
    </div>
  );
}
