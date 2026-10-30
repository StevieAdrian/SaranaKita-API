import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CompleteGoogleProfileDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  username: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  firstName: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  dateOfBirth: string;

  @IsString()
  @IsNotEmpty()
  class: string;

  @IsString()
  @IsNotEmpty()
  gender: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
