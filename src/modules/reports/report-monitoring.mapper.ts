import { toReportStatus } from './report-feed.mapper';

import type { ReportMonitoringActivityDto } from './dto/report-monitoring.dto';

type Related<T> = T | T[] | null | undefined;

export type MonitoringReportRow = {
  id: string;
  title: string;
  created_at: string;
  reporter_id: string;
  school_id: string;
  status: Related<{ status_name: string | null }>;
};

type MonitoringActivityType = ReportMonitoringActivityDto['activityType'];

const ACTIVITY_DESCRIPTIONS: Record<MonitoringActivityType, string> = {
  created: 'Laporan dibuat',
  voted: 'Laporan didukung',
  recommended: 'Laporan direkomendasikan',
  status_changed: 'Status laporan berubah',
};

export function mapMonitoringActivity(
  report: MonitoringReportRow,
  activityType: MonitoringActivityType,
  date: string,
): ReportMonitoringActivityDto {
  const status = Array.isArray(report.status)
    ? report.status[0]?.status_name
    : report.status?.status_name;

  return {
    id: `${activityType}-${report.id}-${date}`,
    reportId: report.id,
    title: report.title,
    status: toReportStatus(status),
    date,
    activityType,
    description: ACTIVITY_DESCRIPTIONS[activityType],
  };
}
