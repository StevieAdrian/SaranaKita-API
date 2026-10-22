import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateEvaluasiDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rate: number;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  notes?: string;
}
