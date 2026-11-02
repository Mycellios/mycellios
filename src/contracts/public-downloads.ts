import { z } from "zod";

export const PUBLIC_DOWNLOADS_SCHEMA = "mycellios-public-downloads/1";

export const publicDownloadAvailabilitySchema = z.object({
  schema: z.literal(PUBLIC_DOWNLOADS_SCHEMA),
  version: z.string().min(1),
  packages: z.array(z.object({
    id: z.enum(["windows-x64", "macos-arm64", "linux-x64"]),
    label: z.string().min(1),
    format: z.enum(["ZIP", "TAR.GZ", "MSI", "PKG", "DEB"]),
    fileName: z.string().min(1),
    path: z.string().startsWith("/downloads/"),
    available: z.boolean(),
  }).strict()).length(3),
}).strict();

export type PublicDownloadAvailability = z.infer<typeof publicDownloadAvailabilitySchema>;
export type PublicDownloadPackage = PublicDownloadAvailability["packages"][number];

export const publicWindowsInstallerIntegritySchema = z.object({
  schema: z.literal("mycellios-windows-installer-integrity/1"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  fileName: z.string().regex(/^mycellios-node-\d+\.\d+\.\d+-windows-x64\.msi$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
