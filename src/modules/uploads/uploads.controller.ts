import {
  BadRequestException,
  Controller,
  FileTypeValidator,
  HttpStatus,
  MaxFileSizeValidator,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const REPORT_IMAGE_FOLDER = 'saranakita/reports';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

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
}
