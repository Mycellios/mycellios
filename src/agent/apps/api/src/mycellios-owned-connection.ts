import type { SecretStore } from "@rakazo/adapter-kit";
import { parseModelSecret } from "@rakazo/adapters";
import { isMycelliosBaseUrl, OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";
import { newestModelCredentialOrder, type PrismaClient } from "@rakazo/db";

export async function ownedMycelliosConnection(
  { prisma, secrets }: { prisma: PrismaClient; secrets: SecretStore },
  userId: string,
) {
  const credentials = await prisma.userModelCredential.findMany({
    where: { userId, provider: OPENAI_COMPATIBLE_PROVIDER_ID },
    include: { userPreferences: { where: { userId } } },
    orderBy: newestModelCredentialOrder,
  });
  for (const credential of credentials) {
    const secret = await prisma.secret.findFirst({
      where: { id: credential.secretId, userId, spaceId: null },
      select: { ciphertext: true },
    });
    if (!secret) continue;
    const saved = parseModelSecret(await secrets.load(secret.ciphertext, credential.secretId));
    if (saved.kind === "openai_compatible" && isMycelliosBaseUrl(saved.baseUrl)) {
      return { credential, saved };
    }
  }
  return null;
}
