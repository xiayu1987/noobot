/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const grantPublicRead = `
$ErrorActionPreference = 'Stop'
$file = $env:NOOBOT_PERMISSION_TEST_PATH
$acl = Get-Acl -LiteralPath $file
$acl.SetAccessRuleProtection($true, $true)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
  [Security.Principal.SecurityIdentifier]::new('S-1-1-0'),
  [Security.AccessControl.FileSystemRights]::Read,
  [Security.AccessControl.AccessControlType]::Allow))
Set-Acl -LiteralPath $file -AclObject $acl
`;

export async function grantPublicReadForTest(file) {
  if (process.platform !== "win32") return chmod(file, 0o644);
  await execute(
    path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(grantPublicRead, "utf16le").toString("base64"),
    ],
    { windowsHide: true, env: { ...process.env, NOOBOT_PERMISSION_TEST_PATH: file } },
  );
}

const inspectWindowsPermissions = `
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $env:NOOBOT_PERMISSION_TEST_PATH
$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object {
  @{sid=$_.IdentityReference.Value;rights=$_.FileSystemRights.ToString();type=$_.AccessControlType.ToString()}
})
@{owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;
  identity=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
  protected=$acl.AreAccessRulesProtected;rules=$rules} | ConvertTo-Json -Compress -Depth 4
`;

export async function assertPrivateStoragePermissions(file) {
  const info = await lstat(file);
  assert.equal(info.isSymbolicLink(), false, "private storage must not be a link");
  if (process.platform !== "win32") {
    assert.equal(info.mode & 0o777, info.isDirectory() ? 0o700 : 0o600);
    return;
  }
  const { stdout } = await execute(
    path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(inspectWindowsPermissions, "utf16le").toString("base64"),
    ],
    { windowsHide: true, env: { ...process.env, NOOBOT_PERMISSION_TEST_PATH: file } },
  );
  const permissions = JSON.parse(stdout);
  assert.equal(permissions.owner, permissions.identity);
  if (info.isDirectory()) assert.equal(permissions.protected, true);
  assert.deepEqual(
    permissions.rules.map(({ sid }) => sid).sort(),
    [permissions.identity, "S-1-5-18", "S-1-5-32-544"].sort(),
  );
  for (const rule of permissions.rules) {
    assert.equal(rule.type, "Allow");
    assert.equal(rule.rights, "FullControl");
  }
}
