import { AttachmentService } from "../../src/artifacts/index.js";
import { createSessionServices } from "../../src/session/index.js";

export function createTestSessionServices(globalConfig, options = {}) {
  return createSessionServices(globalConfig, {
    ...options,
    attachmentService: new AttachmentService(globalConfig),
  });
}
