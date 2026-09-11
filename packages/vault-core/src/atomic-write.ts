import fs from "node:fs/promises";
import path from "node:path";

export async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, filePath);
}

export async function atomicWriteBytes(
  filePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, filePath);
}
