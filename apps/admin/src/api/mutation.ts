import { type QueryKey, useMutation, useQueryClient } from '@tanstack/react-query';

import { getErrorMessage, getErrorStatus, getWarnings } from '@/lib/api-client';
import { toast } from '@/lib/toast';

interface AdminMutationOptions<TInput, TResult> {
  mutationFn: (input: TInput) => Promise<TResult>;
  /** Toast after success; a function gets the input (e.g. to name the group). */
  successMessage?: string | ((input: TInput, result: TResult) => string);
  /** Queries to refetch after success — and after a 409, when what we showed was stale. */
  invalidate: QueryKey[];
  onSuccess?: (result: TResult, input: TInput) => void;
}

/**
 * Every admin mutation behaves the same way: success → toast (+ any `warnings` from the server as a
 * warning toast) and refetch; 409 → the server's message ("This group is already active.") and refetch;
 * other errors → the server's message. 401 is handled globally (back to /login).
 */
export function useAdminMutation<TInput, TResult>(opts: AdminMutationOptions<TInput, TResult>) {
  const queryClient = useQueryClient();
  const refetch = () => Promise.all(opts.invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));

  return useMutation<TResult, unknown, TInput>({
    mutationFn: opts.mutationFn,
    onSuccess: (result, input) => {
      const message =
        typeof opts.successMessage === 'function' ? opts.successMessage(input, result) : opts.successMessage;
      if (message) toast.success(message);
      for (const warning of getWarnings(result)) toast.warning('Done, with a warning', warning);
      void refetch();
      opts.onSuccess?.(result, input);
    },
    onError: (error) => {
      const status = getErrorStatus(error);
      if (status === 401) return;
      if (status === 409) {
        toast.info('Already changed', `${getErrorMessage(error)} The page has been refreshed.`);
        void refetch();
        return;
      }
      toast.error('That didn’t work', getErrorMessage(error));
    },
  });
}
