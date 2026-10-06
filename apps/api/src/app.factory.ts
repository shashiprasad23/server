import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppConfig } from './config/config';
import { AppModule, AppOverrides } from './app.module';

export async function createApp(config: AppConfig, overrides: AppOverrides = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config, overrides), {
    rawBody: true,
    logger: process.env.NODE_ENV === 'test' ? ['error', 'warn'] : undefined,
  });
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  app.enableShutdownHooks();
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('ATLAS-I API').setDescription('AI-native internal sales CRM').setVersion('0.1.0').addBearerAuth().build(),
  );
  SwaggerModule.setup('docs', app, doc);
  return app;
}
