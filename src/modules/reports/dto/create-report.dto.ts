import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateReportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  location!: string;

  @IsUUID()
  categoryId!: string;

  @IsDateString({ strict: true })
  brokenDate!: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  imageUrl?: string;

  @ValidateIf((dto: CreateReportDto) => dto.imageUrl !== undefined)
  @IsString()
  @IsNotEmpty()
  imagePublicId?: string;
}
