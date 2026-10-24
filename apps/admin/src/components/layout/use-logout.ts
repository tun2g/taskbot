import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { logout } from '@/api/auth';
import { getErrorMessage } from '@/lib/api-client';
import { toast } from '@/lib/toast';

/** Log out of this browser (or every browser), then go to the login page. */
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const logOut = async (everywhere: boolean) => {
    setBusy(true);
    try {
      await logout(everywhere);
      queryClient.clear();
      await navigate({ to: '/login', search: {} });
      if (everywhere)
        toast.success('Logged out everywhere', 'Every browser signed in to the admin app has been signed out.');
    } catch (e) {
      toast.error('Couldn’t log out', getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, logOut };
}
