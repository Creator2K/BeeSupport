import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export function portablePath(value, legacy = false) {
  if (typeof value !== "string") throw new Error("Invalid backup file path.");
  const key = legacy ? value.replaceAll("\\", "/") : value;
  const parts = key.split("/");
  if (!key || /[\\:<>"|?*\x00-\x1f]/.test(key) || parts.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)))
    throw new Error("Unsafe or non-portable backup file path.");
  return key;
}

export async function noLinks(absolute) {
  const full = path.resolve(absolute);
  let current = path.parse(full).root;
  for (const part of full.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("Symbolic links/junctions are not supported in backup or restore paths.");
  }
  return full;
}

export async function newDestination(value) {
  const absolute = path.resolve(value);
  const parent = await noLinks(path.dirname(absolute));
  if (!(await lstat(parent)).isDirectory()) throw new Error("Destination parent must be an existing directory.");
  try { await lstat(absolute); } catch (error) { if (error.code === "ENOENT") return absolute; throw error; }
  throw new Error("Destination already exists; choose a new directory.");
}

export function nestedPath(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

export async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function inventory(root) {
  await noLinks(root);
  if (!(await lstat(root)).isDirectory()) throw new Error("Uploads must be an existing directory.");
  const records = [];
  const seen = new Set();
  async function walk(relative = "") {
    for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const key = portablePath(relative ? `${relative}/${entry.name}` : entry.name);
      const folded = key.toLowerCase();
      if (seen.has(folded)) throw new Error("Case-colliding upload paths cannot be restored portably.");
      seen.add(folded);
      const full = path.join(root, key);
      const before = await lstat(full);
      if (before.isDirectory() && !before.isSymbolicLink()) await walk(key);
      else if (before.isFile() && !before.isSymbolicLink()) {
        const sha256 = await digest(full);
        const after = await lstat(full);
        if (!after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino)
          throw new Error("Upload changed during backup; keep all writers stopped.");
        records.push({ path: key, bytes: before.size, sha256 });
      } else throw new Error("Uploads contain a symbolic link or a non-regular file.");
    }
  }
  await walk();
  return records.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function validateInventory(records) {
  if (!Array.isArray(records)) throw new Error("Backup inventory is missing.");
  const paths = new Set();
  for (const file of records) {
    const key = portablePath(file.path).toLowerCase();
    if (paths.has(key) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256))
      throw new Error("Invalid backup file inventory.");
    paths.add(key);
  }
}

export function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} does not match the backup manifest.`);
}

export function checkAttachments(attachments, files) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const attachment of attachments) {
    const file = byPath.get(portablePath(attachment.storageKey, true));
    if (!file || file.bytes !== attachment.size) throw new Error("A database attachment is missing or its file size differs. Backup cannot be marked complete.");
  }
}

export async function copyInventory(source, target, files) {
  const sourceRoot = await realpath(await noLinks(source));
  for (const file of files) {
    const key = portablePath(file.path);
    const input = await noLinks(path.join(sourceRoot, key));
    const output = path.join(target, key);
    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await noLinks(path.dirname(output));
    await copyFile(input, output, 1 /* COPYFILE_EXCL */);
  }
  assertEqual(await inventory(target), files, "Copied files");
}
