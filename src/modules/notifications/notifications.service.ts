import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SupabaseService } from '../../supabase/supabase.service';
import { NotificationsGateway } from './notifications.gateway';
import { FirebaseService } from '../../firebase/firebase.service';
import type {
  AppNotification,
  NotificationData,
  NotificationRow,
  NotificationType,
} from './notifications.types';

type CreateNotificationsInput = {
  readonly recipientIds: readonly string[];
  readonly actorId: string;
  readonly schoolId?: string | null;
  readonly reportId?: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly table = 'notifications';

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly gateway: NotificationsGateway,
    private readonly firebaseService: FirebaseService,
  ) {}

  async list(user: AuthUser, limit = 50): Promise<AppNotification[]> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from(this.table)
      .select('id, type, title, body, data, read_at, created_at')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 100));

    if (error) throw error;
    return (data ?? []).map((row) =>
      this.toNotification(row as NotificationRow),
    );
  }

  async unreadCount(user: AuthUser): Promise<{ count: number }> {
    const { count, error } = await this.supabaseService
      .getAdminClient()
      .from(this.table)
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', user.id)
      .is('read_at', null);

    if (error) throw error;
    return { count: count ?? 0 };
  }

  async markRead(
    user: AuthUser,
    notificationId: string,
  ): Promise<AppNotification> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from(this.table)
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('recipient_id', user.id)
      .is('read_at', null)
      .select('id, type, title, body, data, read_at, created_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      const { data: existing, error: existingError } =
        await this.supabaseService
          .getAdminClient()
          .from(this.table)
          .select('id, type, title, body, data, read_at, created_at')
          .eq('id', notificationId)
          .eq('recipient_id', user.id)
          .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) throw new NotFoundException('Notifikasi tidak ditemukan.');
      return this.toNotification(existing as NotificationRow);
    }
    return this.toNotification(data as NotificationRow);
  }

  async markAllRead(user: AuthUser): Promise<{ updated: number }> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from(this.table)
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', user.id)
      .is('read_at', null)
      .select('id');
    if (error) throw error;
    return { updated: data?.length ?? 0 };
  }

  async registerDeviceToken(userId: string, token: string): Promise<void> {
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('device_tokens')
      .upsert(
        {
          user_id: userId,
          token,
          platform: 'android',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'token' },
      );
    if (error) throw error;
  }

  async removeDeviceToken(userId: string, token: string): Promise<void> {
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('device_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('token', token);
    if (error) throw error;
  }

  async notifyReportCreated(input: {
    reportId: string;
    schoolId: string;
    actorId: string;
    reportTitle: string;
  }): Promise<void> {
    await this.safely(async () => {
      const client = this.supabaseService.getAdminClient();
      const [staffResult, adminResult] = await Promise.all([
        client.from('staff').select('user_id').eq('school_id', input.schoolId),
        client
          .from('user')
          .select('id, roles!inner(role_name)')
          .eq('roles.role_name', 'administrator'),
      ]);
      if (staffResult.error) throw staffResult.error;
      if (adminResult.error) throw adminResult.error;

      await this.createForRecipients({
        recipientIds: [
          ...(staffResult.data ?? []).map((row) => row.user_id as string),
          ...(adminResult.data ?? []).map((row) => row.id as string),
        ],
        actorId: input.actorId,
        schoolId: input.schoolId,
        reportId: input.reportId,
        type: 'report_created',
        title: 'Laporan baru',
        body: `Laporan “${input.reportTitle}” menunggu verifikasi.`,
      });
    });
  }

  async notifyReportStatusChanged(input: {
    reportId: string;
    reporterId: string;
    actorId: string;
    reportTitle: string;
    statusName: string;
  }): Promise<void> {
    await this.safely(async () => {
      const recipientIds = await this.getStatusRecipientIds(
        input.reportId,
        input.reporterId,
      );
      await this.createForRecipients({
        recipientIds,
        actorId: input.actorId,
        reportId: input.reportId,
        type: 'report_status_changed',
        title: 'Status laporan diperbarui',
        body: `Laporan “${input.reportTitle}” sekarang ${input.statusName}.`,
      });
    });
  }

  async notifyReportCommented(input: {
    reportId: string;
    reporterId: string;
    actorId: string;
    reportTitle: string;
  }): Promise<void> {
    await this.safely(() =>
      this.createForRecipients({
        recipientIds: [input.reporterId],
        actorId: input.actorId,
        reportId: input.reportId,
        type: 'report_commented',
        title: 'Komentar baru',
        body: `Ada komentar baru pada laporan “${input.reportTitle}”.`,
      }),
    );
  }

  async notifyReportRecommended(input: {
    reportId: string;
    reporterId: string;
    actorId: string;
    reportTitle: string;
  }): Promise<void> {
    await this.safely(() =>
      this.createForRecipients({
        recipientIds: [input.reporterId],
        actorId: input.actorId,
        reportId: input.reportId,
        type: 'report_recommended',
        title: 'Laporan direkomendasikan',
        body: `Guru merekomendasikan laporan “${input.reportTitle}”.`,
      }),
    );
  }

  private async safely(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Unable to create notification: ${message}`);
    }
  }

  private async getStatusRecipientIds(
    reportId: string,
    reporterId: string,
  ): Promise<string[]> {
    const client = this.supabaseService.getAdminClient();
    const [votes, recommendations] = await Promise.all([
      client.from('reports_votes').select('user_id').eq('report_id', reportId),
      client
        .from('recommendations')
        .select('guru_id')
        .eq('report_id', reportId),
    ]);
    if (votes.error) throw votes.error;
    if (recommendations.error) throw recommendations.error;

    return [
      reporterId,
      ...(votes.data ?? []).map((vote) => vote.user_id as string),
      ...(recommendations.data ?? []).map(
        (recommendation) => recommendation.guru_id as string,
      ),
    ];
  }

  private async createForRecipients(
    input: CreateNotificationsInput,
  ): Promise<void> {
    const recipientIds = [...new Set(input.recipientIds)].filter(
      (id) => id && id !== input.actorId,
    );
    if (recipientIds.length === 0) return;

    const data: NotificationData = input.reportId
      ? { reportId: input.reportId }
      : {};
    const { data: created, error } = await this.supabaseService
      .getAdminClient()
      .from(this.table)
      .insert(
        recipientIds.map((recipientId) => ({
          recipient_id: recipientId,
          actor_id: input.actorId,
          school_id: input.schoolId ?? null,
          report_id: input.reportId ?? null,
          type: input.type,
          title: input.title,
          body: input.body,
          data,
        })),
      )
      .select('id, recipient_id, type, title, body, data, read_at, created_at');

    if (error) {
      this.logger.error(`Unable to persist notifications: ${error.message}`);
      return;
    }
    for (const row of created ?? []) {
      this.gateway.emitToUser(
        row.recipient_id as string,
        this.toNotification(row as NotificationRow),
      );
    }
    await this.sendPushNotifications(created ?? []);
  }

  private async sendPushNotifications(
    notifications: ReadonlyArray<NotificationRow & { recipient_id: string }>,
  ): Promise<void> {
    if (notifications.length === 0) return;
    const recipientIds = [
      ...new Set(notifications.map((row) => row.recipient_id)),
    ];
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('device_tokens')
      .select('token')
      .in('user_id', recipientIds);
    if (error) {
      this.logger.error(`Unable to load FCM tokens: ${error.message}`);
      return;
    }

    const tokens = (data ?? []).map((row) => row.token as string);
    const first = notifications[0];
    if (!first || tokens.length === 0) return;
    const invalidTokens = await this.firebaseService.sendToTokens(tokens, {
      title: first.title,
      body: first.body,
      data: {
        type: first.type,
        reportId: first.data?.reportId ?? '',
      },
    });
    if (invalidTokens.length > 0) {
      const { error: deleteError } = await this.supabaseService
        .getAdminClient()
        .from('device_tokens')
        .delete()
        .in('token', invalidTokens);
      if (deleteError) {
        this.logger.error(
          `Unable to remove invalid FCM tokens: ${deleteError.message}`,
        );
      }
    }
  }

  private toNotification(row: NotificationRow): AppNotification {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      data: row.data ?? {},
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  }
}
