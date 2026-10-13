import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateReportCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  commentText!: string;
}
