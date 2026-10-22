/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import {
  currentAssistantDraft,
  currentAssistantPresentationMessageId,
} from "../../events/message-event-stream.js";
import { requireCurrentTurnMessagesStore } from "../turn/current-turn-ledger.js";
import { createStateCommitter } from "./state-committer.js";

export async function materializeStoppedAssistantDraft(runtime = {}) {
  const draft = currentAssistantDraft(runtime);
  if (!draft || draft.committed || !draft.content) return null;
  const turnMessageStore = requireCurrentTurnMessagesStore(runtime.currentTurnMessages);
  const messageUid = createMessageUid();
  await createStateCommitter({ turnMessageStore, runtime }).pushAssistantMessage({
    content: draft.content,
    type: "message",
    toolCalls: [],
    modelAlias: draft.modelAlias,
    modelName: draft.modelName,
    modelMessageId: draft.modelMessageId,
    messageUid,
    presentationMessageId: currentAssistantPresentationMessageId(runtime),
    chatPresentation: true,
  });
  return messageUid;
}
