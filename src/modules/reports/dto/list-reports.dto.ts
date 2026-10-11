import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { REPORT_STATUSES, type ReportStatus } from '../report-feed.mapper';

export const REPORT_SORTS = [
  'latest',
  'oldest',
  'most_votes',
  'least_votes',
  'most_recommendations',
] as const;

export type ReportSort = (typeof REPORT_SORTS)[number];

function toList(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value === undefined || value === null || value === ''
    ? undefined
    : value;
}

export class ListReportsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @Transform(({ value }) => toList(value))
  @ArrayMaxSize(REPORT_STATUSES.length)
  @IsIn(REPORT_STATUSES, { each: true })
  status?: ReportStatus[];

  @IsOptional()
  @IsIn(REPORT_SORTS)
  sort: ReportSort = 'latest';
}

export class PopularReportsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 5;

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
