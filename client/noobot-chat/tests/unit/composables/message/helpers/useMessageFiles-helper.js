import { useMessageFiles } from "../../../../../src/composables/message/useMessageFiles";

export function createMessageFiles(options) {
  return useMessageFiles({
    getAllMessages: () => [],
    getSessionDocs: () => [],
    getUserId: () => "admin",
    ...options,
  });
}
