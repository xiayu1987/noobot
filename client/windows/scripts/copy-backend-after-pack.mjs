import { cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export default async function copyBackendAfterPack(context) {
  const projectDir = context.packager.projectDir;
  const source = path.join(projectDir, 'build/backend-runtime/backend');
  const destination = path.join(context.appOutDir, 'resources/backend');
  await stat(path.join(source, 'service/app.js'));
  await stat(path.join(source, 'node_modules/express/package.json'));
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });
  await stat(path.join(destination, 'service/app.js'));
  await stat(path.join(destination, 'node_modules/express/package.json'));
  console.log(`Copied backend runtime to ${destination}`);
}
