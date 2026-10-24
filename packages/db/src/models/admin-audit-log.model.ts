import mongoose, { Document, Schema } from 'mongoose';

/** Every change the owner makes in the admin app. Target names are snapshotted (groups get renamed / deleted). */
export interface IAdminAuditLog extends Document {
  createdAt: Date;
  /** e.g. "group.approve", "group.suspend", "group.delete", "settings.ai.update", "auth.login". */
  action: string;
  targetType: 'group' | 'user' | 'settings' | 'session' | null;
  targetId?: string | null;
  targetLabel?: string | null;
  reason?: string | null;
  /** Before/after values or counts (e.g. how many tasks a delete removed). */
  details?: Record<string, unknown> | null;
  ip?: string | null;
}

const AdminAuditLogSchema = new Schema<IAdminAuditLog>(
  {
    action: { type: String, required: true },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    targetLabel: { type: String, default: null },
    reason: { type: String, default: null, maxlength: 500 },
    details: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'admin_audit_logs' },
);

AdminAuditLogSchema.index({ createdAt: -1 });
AdminAuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export const AdminAuditLog = mongoose.model<IAdminAuditLog>('AdminAuditLog', AdminAuditLogSchema);
