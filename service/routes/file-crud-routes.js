/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { WORKSPACE_FILE_ROUTE } from "@noobot/shared/resource-access";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { writeFileAtomicCreatingParents } from "@noobot/platform-compatibility/atomic-file-write";
import {
  applyFileMutation,
  readFileMutation,
  readFileMutationDownload,
} from "noobot-agent/file-mutation-service";
import {
  createFileMutationLocator,
  createFileMutationDiffPreview,
  createFileMutationFilePreview,
  decodeFileMutationDownloadRequest,
  assertFileText,
  assertFileTextEncoding,
  decodePatchText,
  resolveFileWriteEncoding,
} from "@noobot/file-mutation-protocol";
import { encodeFileText, decodeFileDocument } from "@noobot/file-mutation-protocol/text-codec-node";
import { resolveMimeTypeFromFileName } from "@noobot/attachment-protocol/mime";
import { readWorkspaceFilePreview } from "../services/workspace-file-preview.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { isPathOutOfScopeError, safeJoin } from "#agent/utils";
import {
  classifyRequestedPathError,
  createBadRequestError,
  createJsonRouteWrapper,
  decodeRequestInput,
} from "./route-wrapper.js";
import { buildContentDisposition } from "./content-disposition.js";
import { sendAttachmentContent } from "./attachment-content.js";
import { recordFileAccessDebug } from "../runtime-events/file-access-debug.js";
import { text, isFunction } from "@noobot/shared/value";
import { readWorkspaceDirectoryPath } from "@noobot/workspace-protocol/directory-tree";

const DEFAULT_I18N_KEYS = {
  treeFailed: "common.loadWorkspaceTreeFailed",
  readFailed: "common.readWorkspaceFileFailed",
  saveFailed: "common.saveWorkspaceFileFailed",
  downloadFailed: "common.downloadWorkspaceFileFailed",
};

const JSON_DOCUMENT_NAMES = new Set(["config.json", "config-params.json"]);

function validateWorkspaceText(content) {
  return decodeRequestInput(
    () => assertFileText(content),
    (error) => error instanceof TypeError,
  );
}

async function resolveWriteEncoding(absolutePath, encoding) {
  const bytes = await readFile(absolutePath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const document = decodeRequestInput(
    () => (bytes === null ? null : decodeFileDocument(bytes, encoding)),
    (error) => error instanceof TypeError,
  );
  return resolveFileWriteEncoding(encoding, document?.encoding);
}

function validateJsonDocumentWrite(relativePath, content) {
  if (!JSON_DOCUMENT_NAMES.has(path.basename(relativePath))) return;
  try {
    JSON.parse(content);
  } catch (error) {
    throw createBadRequestError(
      `${path.basename(relativePath)} parse failed: ${error?.message || String(error)}`,
      { code: "INVALID_JSON_DOCUMENT" },
    );
  }
}

export function registerFileCrudRoutes(
  app,
  {
    routePrefix,
    resolveRootPath,
    middleware,
    buildWorkspaceTree,
    buildDirectoryArchiveFile,
    translateText,
    i18nKeys = {},
    responseBuilders = {},
    allowAbsolutePath = false,
    resolveMutationRoot = null,
    trackMutations = false,
    readMutations = false,
    authorizeWrite = null,
  } = {},
) {
  const keys = { ...DEFAULT_I18N_KEYS, ...i18nKeys };
  const middlewares = middleware ? (Array.isArray(middleware) ? middleware : [middleware]) : [];
  const jsonRoute = createJsonRouteWrapper({ translateText });
  const buildTreeResponse =
    typeof responseBuilders?.tree === "function"
      ? responseBuilders.tree
      : ({ root, tree }) => ({ ok: true, root, tree });
  const buildFileResponse =
    typeof responseBuilders?.file === "function"
      ? responseBuilders.file
      : ({ path, isText, size, content, preview, textFormat, textError }) => ({
          ok: true,
          path,
          isText,
          size,
          content,
          preview,
          ...(textFormat ? { textFormat } : {}),
          ...(textError ? { textError } : {}),
        });
  const maskWorkspacePath = (pathValue = "") => {
    const normalized = text(pathValue).replaceAll("\\", "/");
    const parts = normalized.match(/[^/]+/g) || [];
    return parts.length > 2
      ? `${parts.slice(0, 2).join("/")}/.../${parts[parts.length - 1]}`
      : normalized;
  };

  const logFileAccess = (req, event, payload = {}) =>
    recordFileAccessDebug(req, {
      event: "service.fileCrud.fileAccess.trace",
      traceEvent: event,
      data: { routePrefixLength: String(routePrefix || "").length, ...payload },
    });

  const isAbsolutePathAllowed = (req) =>
    typeof allowAbsolutePath === "function"
      ? allowAbsolutePath(req) === true
      : allowAbsolutePath === true;

  const resolveRequestFilePath = (req, root, requestedPath = "") => {
    const normalizedPath = String(requestedPath || "");
    if (isAbsolutePathAllowed(req) && path.isAbsolute(normalizedPath)) {
      return path.resolve(normalizedPath);
    }
    return decodeRequestInput(() => safeJoin(root, normalizedPath), isPathOutOfScopeError);
  };

  const resolveRequestMutationLocator = (req, requestedPath, absolutePath) =>
    isAbsolutePathAllowed(req) && path.isAbsolute(requestedPath)
      ? createFileMutationLocator({ view: "host", path: absolutePath })
      : createFileMutationLocator({ view: "workspace", path: requestedPath });

  const resolveRequestMutationRoot = async (req, root) => {
    if (!isFunction(resolveMutationRoot)) {
      throw new Error("file mutation session scope resolver is required");
    }
    const resolved = await resolveMutationRoot(req, root);
    if (!text(resolved)) throw new Error("file mutation repository root is required");
    return resolved;
  };

  app.get(
    `${routePrefix}/tree`,
    ...middlewares,
    jsonRoute(
      async (req, res) => {
        const root = await resolveRootPath(req);
        await mkdir(root, { recursive: true });
        const relativePath = decodeRequestInput(
          () => readWorkspaceDirectoryPath(req.query),
          (error) => error instanceof TypeError,
        );
        decodeRequestInput(() => safeJoin(root, relativePath), isPathOutOfScopeError);
        const tree = await buildWorkspaceTree(root, relativePath);
        res.json(buildTreeResponse({ req, root, tree }));
      },
      { fallbackErrorKey: keys.treeFailed },
    ),
  );

  app.get(
    `${routePrefix}/file`,
    ...middlewares,
    jsonRoute(
      async (req, res) => {
        const relativePath = String(req.query.path || "");
        logFileAccess(req, "file.request", {
          hasPath: Boolean(relativePath),
          relativePath: maskWorkspacePath(relativePath),
        });
        if (!relativePath) {
          throw createBadRequestError(translateText("common.pathRequired", req.locale));
        }
        const root = await resolveRootPath(req);
        const absolutePath = resolveRequestFilePath(req, root, relativePath);
        let file;
        try {
          const encoding = decodeRequestInput(
            () => assertFileTextEncoding(req.query.encoding ?? "auto"),
            (error) => error instanceof TypeError,
          );
          file = await readWorkspaceFilePreview(absolutePath, relativePath, encoding);
        } catch (error) {
          logFileAccess(req, "file.accessFailed", {
            relativePath: maskWorkspacePath(relativePath),
            error: String(error?.code || error?.message || error || ""),
          });
          throw classifyRequestedPathError(error);
        }
        logFileAccess(req, "file.response", {
          relativePath: maskWorkspacePath(relativePath),
          isText: file.isText,
          size: file.size,
        });
        res.json(
          buildFileResponse({
            req,
            path: relativePath,
            ...file,
          }),
        );
      },
      { fallbackErrorKey: keys.readFailed },
    ),
  );

  app.put(
    `${routePrefix}/file`,
    ...middlewares,
    jsonRoute(
      async (req, res) => {
        const relativePath = String(req.body?.path || "");
        if (!relativePath) {
          throw createBadRequestError(translateText("common.pathRequired", req.locale));
        }
        const content = validateWorkspaceText(req.body?.content);
        validateJsonDocumentWrite(relativePath, content);
        const root = await resolveRootPath(req);
        const absolutePath = resolveRequestFilePath(req, root, relativePath);
        const requestedEncoding = decodeRequestInput(
          () => assertFileTextEncoding(req.body?.encoding ?? "auto"),
          (error) => error instanceof TypeError,
        );
        const encoding = await resolveWriteEncoding(absolutePath, requestedEncoding);
        const bytes = decodeRequestInput(
          () => encodeFileText(content, encoding),
          (error) => error instanceof TypeError,
        );
        if (bytes.length > LENGTH_THRESHOLDS.serviceHttp.workspaceFileBytes) {
          throw Object.assign(
            new Error("encoded workspace file exceeds the configured size limit"),
            { statusCode: 413, code: "WORKSPACE_FILE_CONTENT_TOO_LARGE" },
          );
        }
        const writeBytes = (target, value) =>
          writeFileAtomicCreatingParents({
            filePath: target,
            content: value,
            mkdir,
            writeFile,
            rename,
            remove: rm,
          });
        if (authorizeWrite) await authorizeWrite(req, absolutePath, { root, content });
        const result = trackMutations
          ? await applyFileMutation({
              filePath: absolutePath,
              locator: resolveRequestMutationLocator(req, relativePath, absolutePath),
              content,
              encoding,
              operation: "replace",
              mutationRoot: await resolveRequestMutationRoot(req, root),
              sessionScope: null,
              stageBytes: writeBytes,
            })
          : (await writeBytes(absolutePath, bytes),
            {
              ok: true,
              path: relativePath,
              isText: true,
              size: bytes.length,
              content,
              textFormat: decodePatchText(content, encoding).textFormat,
            });
        res.json(result);
      },
      { fallbackErrorKey: keys.saveFailed },
    ),
  );

  if (readMutations === true) {
    app.get(
      `${routePrefix}/file-mutations/:mutationId/diff`,
      ...middlewares,
      jsonRoute(
        async (req, res) => {
          const root = await resolveRootPath(req);
          const mutation = await readFileMutation({
            mutationRoot: await resolveRequestMutationRoot(req, root),
            mutationId: req.params.mutationId,
          });
          res.json(createFileMutationDiffPreview(mutation));
        },
        { fallbackErrorKey: keys.readFailed },
      ),
    );

    app.get(
      `${routePrefix}/file-mutations/:mutationId/file`,
      ...middlewares,
      jsonRoute(
        async (req, res) => {
          const root = await resolveRootPath(req);
          const mutation = await readFileMutation({
            mutationRoot: await resolveRequestMutationRoot(req, root),
            mutationId: req.params.mutationId,
          });
          res.json(createFileMutationFilePreview(mutation));
        },
        { fallbackErrorKey: keys.readFailed },
      ),
    );

    app.get(
      `${routePrefix}/file-mutations/:mutationId/download`,
      ...middlewares,
      jsonRoute(
        async (req, res) => {
          const { revision, afterSha256 } = decodeFileMutationDownloadRequest(req.query);
          const root = await resolveRootPath(req);
          const download = await readFileMutationDownload({
            mutationRoot: await resolveRequestMutationRoot(req, root),
            mutationId: req.params.mutationId,
            revision,
            afterSha256,
          });
          res.setHeader("Content-Type", resolveMimeTypeFromFileName(download.fileName));
          res.setHeader(
            "Content-Disposition",
            buildContentDisposition("attachment", download.fileName),
          );
          res.setHeader("Content-Length", String(download.content.length));
          res.end(download.content);
        },
        { fallbackErrorKey: keys.downloadFailed },
      ),
    );
  }

  app.get(
    `${routePrefix}/${WORKSPACE_FILE_ROUTE.PREVIEW}`,
    ...middlewares,
    jsonRoute(
      async (req, res) => {
        const relativePath = String(req.query.path || "");
        if (!relativePath)
          throw createBadRequestError(translateText("common.pathRequired", req.locale));
        const root = await resolveRootPath(req);
        const absolutePath = resolveRequestFilePath(req, root, relativePath);
        const handle = await open(absolutePath, "r").catch((error) => {
          throw classifyRequestedPathError(error);
        });
        let fileStats;
        try {
          fileStats = await handle.stat();
          if (!fileStats.isFile())
            throw createBadRequestError(translateText("common.pathIsNotFile", req.locale));
        } catch (error) {
          await handle.close();
          throw error;
        }
        await sendAttachmentContent(req, res, {
          name: path.basename(relativePath),
          mimeType: resolveMimeTypeFromFileName(relativePath),
          size: fileStats.size,
          createReadStream: (range) => handle.createReadStream({ ...range, autoClose: false }),
          close: () => handle.close(),
        });
      },
      { fallbackErrorKey: keys.readFailed },
    ),
  );

  if (typeof buildDirectoryArchiveFile === "function") {
    app.get(
      `${routePrefix}/${WORKSPACE_FILE_ROUTE.DOWNLOAD}`,
      ...middlewares,
      jsonRoute(
        async (req, res) => {
          const relativePath = String(req.query.path || "");
          logFileAccess(req, "download.request", {
            hasPath: Boolean(relativePath),
            relativePath: maskWorkspacePath(relativePath),
          });
          if (!relativePath) {
            throw createBadRequestError(translateText("common.pathRequired", req.locale));
          }
          const root = await resolveRootPath(req);
          const absolutePath = resolveRequestFilePath(req, root, relativePath);
          const fileStats = await stat(absolutePath).catch((error) => {
            throw classifyRequestedPathError(error);
          });
          if (fileStats.isFile()) {
            logFileAccess(req, "download.fileResponse", {
              relativePath: maskWorkspacePath(relativePath),
              size: fileStats.size,
            });
            res.download(absolutePath, path.basename(relativePath));
            return;
          }
          if (!fileStats.isDirectory())
            throw createBadRequestError(translateText("common.pathIsNotFile", req.locale));
          logFileAccess(req, "download.directoryArchive", {
            relativePath: maskWorkspacePath(relativePath),
            size: fileStats.size,
          });
          const archiveMeta = await buildDirectoryArchiveFile({
            absoluteDirectoryPath: absolutePath,
            archiveName: path.basename(relativePath),
          });
          const cleanupTemp = async () => {
            await rm(archiveMeta.temporaryDirectory, { recursive: true, force: true }).catch(
              () => {},
            );
          };
          res.on("close", cleanupTemp);
          res.on("finish", cleanupTemp);
          res.download(archiveMeta.archiveFilePath, archiveMeta.archiveFileName);
        },
        { fallbackErrorKey: keys.downloadFailed },
      ),
    );
  }
}
