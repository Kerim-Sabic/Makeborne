import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {canonicalSourceJson} from "./canonical-json";
import type {websiteBuildInput} from "./build-input";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
type Workload = ReturnType<typeof websiteBuildInput>;
const failure = (code: string) => Object.assign(new Error(code), {code});
const BuildReceiptSchema = z.object({schemaVersion: z.literal(1), artifactId: z.string().uuid(), revisionId: z.string().uuid(),
  version: z.number().int().positive(), sourceHash: hash, toolchainId: z.literal("react-vite-v1"), toolchainHash: hash,
  runtimeImageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  routes: z.array(z.object({path: z.string(), title: z.string()}).strict()).min(1).max(100),
  files: z.array(z.object({path: z.string().min(1).max(240), bytes: z.number().int().nonnegative().max(50_000_000), sha256: hash}).strict()).min(1).max(1000),
  buildHash: hash}).strict();
/** Shared byte-manifest validation for the compiler and private output store. */
export function parseBuildReceipt(input: unknown) {
  const receipt = BuildReceiptSchema.parse(input), {buildHash, ...identity} = receipt;
  if (buildHash !== createHash("sha256").update(canonicalSourceJson(identity)).digest("hex")
    || Buffer.byteLength(canonicalSourceJson(receipt)) > 262144) throw failure("BUILD_RECEIPT_IDENTITY_INVALID");
  const paths = new Set<string>(); let total = 0;
  for (const file of receipt.files) {
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file.path)
      || file.path.split("/").some(part => part === "." || part === ".." || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
      || file.path === "makeborne-build.json" || paths.has(file.path.toLowerCase())) throw failure("BUILD_RECEIPT_PATH_INVALID");
    paths.add(file.path.toLowerCase()); total += file.bytes;
  }
  if (!paths.has("index.html") || total > 50_000_000) throw failure("BUILD_RECEIPT_OUTPUT_INVALID");
  return receipt;
}

/** Bind a validated receipt to the exact saved source workload. */
export function validateBuildReceipt(input: unknown, workload: Workload) {
  const receipt = parseBuildReceipt(input);
  if (receipt.artifactId !== workload.artifactId || receipt.revisionId !== workload.revisionId || receipt.version !== workload.version
    || receipt.sourceHash !== workload.sourceHash || receipt.toolchainHash !== workload.toolchainHash
    || canonicalSourceJson(receipt.routes) !== canonicalSourceJson(workload.routes)) throw failure("BUILD_RECEIPT_IDENTITY_INVALID");
  return receipt;
}

export type BuildReceipt = z.infer<typeof BuildReceiptSchema>;
