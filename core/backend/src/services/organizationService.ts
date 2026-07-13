import { prisma } from "../prisma/client";
import bcrypt from "bcrypt";
import { badRequest, notFound } from "../utils/errors";

/**
 * Update organization name or email
 */
export async function updateOrg(
  orgId: string,
  data: { name?: string; email?: string },
) {
  return prisma.organization.update({
    where: { id: orgId },
    data: {
      ...(data.name && { name: data.name }),
      ...(data.email && { email: data.email }),
    },
  });
}

/**
 * Change organization password
 */
export async function changeOrgPassword(
  orgId: string,
  currentPassword: string,
  newPassword: string,
) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw notFound("Organization not found");

  const valid = await bcrypt.compare(currentPassword, org.passwordHash);
  if (!valid) throw badRequest("Current password is incorrect");

  const hash = await bcrypt.hash(newPassword, 12);
  await prisma.organization.update({
    where: { id: orgId },
    data: { passwordHash: hash },
  });
}

/**
 * Delete organization account and all associated data
 */
export async function deleteOrgAccount(orgId: string) {
  const ballots = await prisma.ballot.findMany({
    where: { organizationId: orgId },
  });

  for (const ballot of ballots) {
    await prisma.auditEvent.deleteMany({ where: { ballotId: ballot.id } });
    await prisma.result.deleteMany({ where: { ballotId: ballot.id } });
    await prisma.vote.deleteMany({ where: { ballotId: ballot.id } });
    await prisma.option.deleteMany({ where: { ballotId: ballot.id } });
    await prisma.voterToken.deleteMany({ where: { ballotId: ballot.id } });
  }

  await prisma.ballot.deleteMany({ where: { organizationId: orgId } });
  await prisma.session.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
}
