import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getStoredGroupInviteToken, clearGroupInviteToken } from '../lib/groupInvite';

export function AcceptInvitePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const token = getStoredGroupInviteToken();
      if (!token) {
        setError('No invite found');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('accept-invite', {
        body: { token },
      });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      clearGroupInviteToken();

      // redirecionar para grupo
      window.location.href = `/groups/${data.group_id}`;
    };

    run();
  }, []);

  if (loading) return <div>A entrar no grupo...</div>;
  if (error) return <div>Erro: {error}</div>;

  return null;
}