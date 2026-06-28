import { cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export default async function copyBackendAfterPack(context) {
  const projectDir = context.packager.projectDir;
  const repoRoot = path.resolve(projectDir, '../..');
  const backendSource = path.join(projectDir, 'build/backend-runtime/backend');
  const backendDestination = path.join(context.appOutDir, 'resources/backend');
  const frontendSource = path.join(repoRoot, 'client/noobot-chat/dist');
  const frontendDestination = path.join(context.appOutDir, 'resources/frontend');

  await stat(path.join(backendSource, 'service/app.js'));
  await stat(path.join(backendSource, 'node_modules/express/package.json'));
  await rm(backendDestination, { recursive: true, force: true });
  await cp(backendSource, backendDestination, { recursive: true });
  await stat(path.join(backendDestination, 'service/app.js'));
  await stat(path.join(backendDestination, 'node_modules/express/package.json'));
  console.log(`Copied backend runtime to ${backendDestination}`);

  await stat(path.join(frontendSource, 'index.html'));
  await rm(frontendDestination, { recursive: true, force: true });
  await cp(frontendSource, frontendDestination, { recursive: true });
  await stat(path.join(frontendDestination, 'index.html'));
  console.log(`Copied frontend runtime to ${frontendDestination}`);
}
