import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateReportRecommendationDto {
  @IsString()
  @MinLength(10)
  @MaxLength(300)
  reason!: string;
}
