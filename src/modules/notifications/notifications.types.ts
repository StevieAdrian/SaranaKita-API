export const NOTIFICATION_TYPES = [
  'report_created',
  'report_status_changed',
  'report_commented',
  'report_recommended',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationData = {
  readonly reportId?: string;
};

export type AppNotification = {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly data: NotificationData;
  readonly readAt: string | null;
  readonly createdAt: string;
};

export type NotificationRow = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: NotificationData | null;
  read_at: string | null;
  created_at: string;
};
