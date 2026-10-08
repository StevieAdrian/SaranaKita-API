import { INestApplication } from '@nestjs/common';
import { Controller, Get, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

@Module({ controllers: [HealthController] })
class HealthModule {}

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  afterEach(async () => {
    await app.close();
  });
});
