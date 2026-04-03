import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Enable raw body globally
  });

  // Preserve raw body for Stripe webhook signature verification
  app.use('/subscriptions/webhook', express.raw({ type: 'application/json' }));

  app.enableCors({
    origin: [process.env.WEB_URL],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT || 8080, '0.0.0.0');
}
bootstrap();
