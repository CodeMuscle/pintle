/**
 * Zod validation pipe. The monorepo's DTOs are Zod schemas in
 * @pintle/contracts (Module 2 decision — there are no class-validator
 * classes), so request validation integrates Zod rather than class-validator.
 *
 * Usage (per-param, the idiomatic Nest pattern):
 *   create(@Body(new ZodValidationPipe(CreateInvitationRequestSchema)) dto: …)
 *
 * A ZodError thrown here is turned into a VALIDATION_FAILED envelope with
 * field-level details by AllExceptionsFilter.
 */
import { Injectable, PipeTransform } from "@nestjs/common";
import type { ZodSchema, z } from "zod";

@Injectable()
export class ZodValidationPipe<S extends ZodSchema> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    return this.schema.parse(value);
  }
}
