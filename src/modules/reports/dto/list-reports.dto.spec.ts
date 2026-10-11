import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListReportsQueryDto } from './list-reports.dto';

function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(ListReportsQueryDto, query);
  return { dto, errors: validateSync(dto) };
}

describe('ListReportsQueryDto', () => {
  it('defaults to latest, page 1, limit 20', () => {
    const { dto, errors } = parse({});
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 1, limit: 20, sort: 'latest' });
    expect(dto.status).toBeUndefined();
  });

  it('accepts comma-separated statuses', () => {
    const { dto, errors } = parse({ status: 'done, in_repair' });
    expect(errors).toHaveLength(0);
    expect(dto.status).toEqual(['done', 'in_repair']);
  });

  it('accepts repeated status params', () => {
    const { dto, errors } = parse({ status: ['done', 'rejected'] });
    expect(errors).toHaveLength(0);
    expect(dto.status).toEqual(['done', 'rejected']);
  });

  it.each([
    [{ status: 'done,hacked' }],
    [{ sort: 'random' }],
    [{ limit: '500' }],
  ])('rejects %p', (query) => {
    expect(parse(query).errors.length).toBeGreaterThan(0);
  });
});
