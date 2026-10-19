import { IsIn } from 'class-validator';

export const REPORT_STATUS_NAMES = [
  'Menunggu Verifikasi',
  'Dalam Pemeriksaan',
  'Dalam Perbaikan',
  'Ditolak',
  'Selesai',
] as const;

export class UpdateReportStatusDto {
  @IsIn(REPORT_STATUS_NAMES)
  statusName!: (typeof REPORT_STATUS_NAMES)[number];
}
