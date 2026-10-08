import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { PaginatedResult, PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UsersService {
  private readonly table = 'profiles';

  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll(
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<UserEntity>> {
    const { page, limit, search } = query;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let builder = this.supabaseService
      .getAdminClient()
      .from(this.table)
      .select('*', { count: 'exact' });

    if (search) {
      builder = builder.ilike('full_name', `%${search}%`);
    }

    const { data, count, error } = await builder.range(from, to);

    if (error) {
      throw error;
    }

    const total = count ?? 0;

    return {
      items: (data as UserEntity[]) ?? [],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<UserEntity> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from(this.table)
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`User ${id} not found`);
    }

    return data as UserEntity;
  }

  async create(dto: CreateUserDto): Promise<UserEntity> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from(this.table)
      .insert({
        email: dto.email,
        full_name: dto.fullName,
        role: dto.role ?? 'user',
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return data as UserEntity;
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    await this.findOne(id);

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from(this.table)
      .update({
        full_name: dto.fullName,
        role: dto.role,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return data as UserEntity;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    const { error } = await this.supabaseService
      .getAdminClient()
      .from(this.table)
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }
  }
}
