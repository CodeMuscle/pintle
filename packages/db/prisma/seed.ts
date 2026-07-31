/**
 * Demo seed — idempotent. Creates one tenant, one operator user (+ owner
 * membership), default tenant settings, and a global CRM destination schema.
 *
 *   pnpm --filter @pintle/db seed
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

// Prisma 7 driver adapter (schema has no `url` anymore).
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// The demo operator's email. Override to match your Clerk user's primary
// email so the AuthGuard (Clerk email → local user) resolves to this seeded
// owner: `SEED_DEMO_EMAIL=you@example.com pnpm --filter @pintle/db seed`.
const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL ?? "demo@pintle.dev";

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      name: "Acme Inc",
      slug: "acme",
      plan: "growth",
      status: "active",
      primaryRegion: "ap-south-1",
    },
  });

  await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      defaultTimezone: "Asia/Kolkata",
      dataRetentionDays: 90,
      defaultProductType: "crm",
      allowCustomerComments: true,
      piiMaskingEnabled: true,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      fullName: "Demo Operator",
      status: "active",
    },
  });

  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      userId: user.id,
      role: "owner",
      status: "active",
      joinedAt: new Date(),
    },
  });

  // Global CRM destination schema (tenant_id = NULL). NULLs don't compare
  // equal, so a composite-unique upsert can't dedupe it — guard by findFirst.
  const existingCrm = await prisma.destinationSchema.findFirst({
    where: { tenantId: null, productType: "crm", version: "1" },
  });
  if (!existingCrm) {
    await prisma.destinationSchema.create({
      data: {
        tenantId: null,
        productType: "crm",
        version: "1",
        status: "active",
        schemaJson: {
          fields: [
            { fieldKey: "email", dataType: "string", isRequired: true },
            { fieldKey: "fullName", dataType: "string", isRequired: true },
            { fieldKey: "company", dataType: "string", isRequired: false },
            { fieldKey: "status", dataType: "enum", isRequired: true },
          ],
        },
      },
    });
  }

  console.log(
    `Seeded tenant=${tenant.slug} (id=${tenant.id}) user=${user.email} (id=${user.id}) role=owner + global CRM destination schema v1`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
