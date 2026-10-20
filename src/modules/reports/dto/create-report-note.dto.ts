import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateReportNoteDto {
  @IsString({ message: 'Catatan harus berupa teks.' })
  @IsNotEmpty({ message: 'Catatan tidak boleh kosong.' })
  @MaxLength(300, {
    message: 'Catatan maksimal 300 karakter.',
  })
  note_text!: string;
}
