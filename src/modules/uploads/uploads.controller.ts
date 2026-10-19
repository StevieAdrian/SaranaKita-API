import { BadRequestException, Controller, FileTypeValidator, HttpStatus, MaxFileSizeValidator, ParseFilePipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { Public } from '../../common/decorators/public.decorator';
import { AVATAR_IMAGE_FOLDER, MAX_IMAGE_BYTES, REPORT_IMAGE_FOLDER } from './uploads.constants';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly cloudinaryService: CloudinaryService) { }

  @Post('report-image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  uploadReportImage(
    @UploadedFile(
      new ParseFilePipe({
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        validators: [
          new MaxFileSizeValidator({
            maxSize: MAX_IMAGE_BYTES,
            message: 'Ukuran foto maksimal 5 MB.',
          }),
          new FileTypeValidator({
            fileType: /^image\/(jpeg|png|webp|heic|heif)$/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('File is required');
    }
    return this.cloudinaryService.uploadImage(file.buffer, REPORT_IMAGE_FOLDER);
  }

  @Public()
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  uploadAvatar(
    @UploadedFile(
      new ParseFilePipe({
        errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        validators: [
          new MaxFileSizeValidator({
            maxSize: MAX_IMAGE_BYTES,
            message: 'Ukuran foto maksimal 5 MB.',
          }),
          new FileTypeValidator({
            fileType: /^image\/(jpeg|png|webp|heic|heif)$/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Query('username') username?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('File is required');
    }
    const cleanUsername = username?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const publicId = cleanUsername ? `avatar-${cleanUsername}` : undefined;

    return this.cloudinaryService.uploadImage(file.buffer, AVATAR_IMAGE_FOLDER, publicId);
  }
}

