/**
 * OpenTelemetry bootstrap. Imported for its side effect at the very top of
 * main.ts (before Nest/Fastify) so auto-instrumentation can patch http, pg
 * (Postgres) and ioredis/redis. Exporter is the console for now — swap the
 * SpanProcessor for an OTLP exporter when an observability backend exists
 * (tech-stack.csv: OpenTelemetry → Grafana/Tempo).
 */
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";

// Self-starting side effect. ESM evaluates imports in source order, so
// main.ts must `import "./otel.js"` as its FIRST import — that guarantees the
// SDK is running before @nestjs (and thus http/pg/redis) are imported, which
// is what require-in-the-middle instrumentation needs.
function startOtel(): void {
  if (process.env.OTEL_SDK_DISABLED === "true") return;

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "pintle-api",
    traceExporter: new ConsoleSpanExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Noisy and rarely useful locally.
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  try {
    sdk.start();
    process.once("SIGTERM", () => {
      void sdk.shutdown().finally(() => process.exit(0));
    });
  } catch (err) {
    // Tracing must never take the process down.
    console.error("[otel] failed to start", err);
  }
}

startOtel();
