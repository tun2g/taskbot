import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import type { IApiToken } from '@/api/tokens';

interface RevokeTokenDialogProps {
  token: IApiToken;
  isRevoking: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function RevokeTokenDialog({ token, isRevoking, onConfirm, onClose }: RevokeTokenDialogProps) {
  return (
    <Dialog
      role="alertdialog"
      size="sm"
      hideClose
      title={`Revoke “${token.name}”?`}
      description="Claude Code / Cursor using this token will stop working immediately. This can't be undone."
      onClose={isRevoking ? () => {} : onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={isRevoking}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={isRevoking} loadingText="Revoking…">
            Revoke token
          </Button>
        </>
      }
    />
  );
}
