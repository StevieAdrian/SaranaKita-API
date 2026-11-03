import type { ReportStatus } from '../report-feed.mapper';

export class ReportMonitoringStatisticsDto {
  total: number;
  completed: number;
  waitingVerification: number;
  inInspection: number;
  inRepair: number;
}

export class ReportMonitoringActivityDto {
  id: string;
  reportId: string;
  title: string;
  status: ReportStatus;
  date: string;
  activityType: 'created' | 'voted' | 'recommended' | 'status_changed';
  description: string;
}

export class ReportMonitoringResponseDto {
  statistics: ReportMonitoringStatisticsDto;
  activities: ReportMonitoringActivityDto[];
}
