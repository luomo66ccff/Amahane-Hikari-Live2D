// SPDX-License-Identifier: MIT
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = data => createHash('sha256').update(data).digest('hex');

export function inside(root, relative) {
  if (!relative || relative.includes('\\') || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe relative path: ${relative}`);
  }
  const result = path.resolve(root, relative);
  if (!result.startsWith(path.resolve(root) + path.sep)) throw new Error('Path escapes destination');
  return result;
}

export async function walk(root, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(root, {withFileTypes:true})) {
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link is not permitted: ${entry.name}`);
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await walk(path.join(root, entry.name), relative + '/'));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`Unsupported file: ${relative}`);
  }
  return result.sort();
}

export async function copyUnchanged(source, destination) {
  const data = await fs.readFile(source);
  try {
    const stat = await fs.lstat(destination);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Destination is not a regular file: ${destination}`);
    if (!data.equals(await fs.readFile(destination))) throw new Error(`Existing file differs; no overwrite: ${destination}`);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.mkdir(path.dirname(destination), {recursive:true});
  await fs.writeFile(destination, data, {flag:'wx'});
}
