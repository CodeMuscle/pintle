/**
 * @pintle/api → common module (the brief's "@app/api/common").
 * Global so every feature module gets TenantContextService, PrismaService and
 * EventBus by injection. Also registers the global success interceptor and
 * error-envelope filter.
 */
import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { AllExceptionsFilter } from "./all-exceptions.filter.js";
import { EventBus } from "./event-bus.js";
import { FeatureCache } from "./feature-cache.js";
import { IdempotencyService } from "./idempotency.service.js";
import { PrismaService } from "./prisma.service.js";
import { QueueEventsBridge } from "./queue-events-bridge.js";
import { ResponseInterceptor } from "./response.interceptor.js";
import { S3Service } from "./s3.service.js";
import { TenantContextService } from "./tenant-context.js";
import { UploadQueue } from "./upload-queue.js";

@Global()
@Module({
  providers: [
    TenantContextService,
    PrismaService,
    EventBus,
    FeatureCache,
    IdempotencyService,
    S3Service,
    UploadQueue,
    QueueEventsBridge,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
  exports: [
    TenantContextService,
    PrismaService,
    EventBus,
    FeatureCache,
    IdempotencyService,
    S3Service,
    UploadQueue,
  ],
})
export class CommonModule {}
