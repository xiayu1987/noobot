import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_PATH_PLATFORMS,
  CLIENT_PATH_VIEWS,
  clientPathBasename,
  clientPathDelimiter,
  clientPathDirname,
  createDesktopPathEnvironment,
  isAbsoluteClientPath,
  joinClientPath,
  normalizeClientPath,
} from "../path-resolver.js";

test("shared client resolver uses explicit platform semantics", () => {
  assert.equal(joinClientPath("C:\\Users\\me", "docs", "file.txt"), "C:/Users/me/docs/file.txt");
  const result = createDesktopPathEnvironment({ entryUrl: new URL("../../windows/src/main.js", import.meta.url), platform: CLIENT_PATH_PLATFORMS.WINDOWS, iconName: "noobot.ico" });
  assert.equal(result.pathSemantic.sourcePlatform, CLIENT_PATH_PLATFORMS.WINDOWS);
  assert.equal(result.pathSemantic.sourceView, CLIENT_PATH_VIEWS.CLIENT);
  assert.match(result.windowIcon.replaceAll("\\", "/"), /client\/assets\/noobot\.ico$/);
});

test("shared client resolver handles windows drive and UNC paths without host platform leakage", () => {
  assert.equal(normalizeClientPath("C:\\Users\\me\\..\\you\\file.txt", { platform: CLIENT_PATH_PLATFORMS.WINDOWS }), "C:/Users/you/file.txt");
  assert.equal(joinClientPath("C:\\Program Files", "LibreOffice", "program", "soffice.exe"), "C:/Program Files/LibreOffice/program/soffice.exe");
  assert.equal(joinClientPath("\\\\server\\share", "dir", "file.txt"), "//server/share/dir/file.txt");
  assert.equal(clientPathDirname("C:\\Program Files\\LibreOffice\\program\\soffice.exe"), "C:/Program Files/LibreOffice/program");
  assert.equal(clientPathBasename("\\\\server\\share\\dir\\file.txt"), "file.txt");
  assert.equal(isAbsoluteClientPath("C:\\Users\\me"), true);
  assert.equal(isAbsoluteClientPath("\\\\server\\share\\dir"), true);
  assert.equal(isAbsoluteClientPath("Users\\me", { platform: CLIENT_PATH_PLATFORMS.WINDOWS }), false);
  assert.equal(clientPathDelimiter("win32"), ";");
});

test("shared client resolver keeps mac paths as POSIX paths", () => {
  assert.equal(joinClientPath("/Users/me", "Applications", "LibreOffice.app"), "/Users/me/Applications/LibreOffice.app");
  assert.equal(clientPathDirname("/Applications/LibreOffice.app/Contents/MacOS/soffice"), "/Applications/LibreOffice.app/Contents/MacOS");
  assert.equal(clientPathBasename("/Applications/LibreOffice.app/Contents/MacOS/soffice"), "soffice");
  assert.equal(isAbsoluteClientPath("/Applications/LibreOffice.app", { platform: CLIENT_PATH_PLATFORMS.MACOS }), true);
  assert.equal(clientPathDelimiter(CLIENT_PATH_PLATFORMS.MACOS), ":");
});
