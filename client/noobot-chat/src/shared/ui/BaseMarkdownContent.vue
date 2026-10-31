<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { useMermaidRender } from "../composables/useMermaidRender.js";
import {
  attachmentIdentityKey,
  parseAttachmentIdentityRef,
} from "@noobot/attachment-protocol/identity";
import { LINK_SNAPSHOT_KIND, mutationLinkRef } from "@noobot/path-resolver/resource-link";

const props = defineProps({
  content: { type: String, required: true },
  renderMarkdown: { type: Function, required: true },
  attachmentRefIndex: { type: Map, required: true },

  linkSnapshots: { type: Array, required: true },

  messageIndex: { type: Number, required: true },

  workspaceRootDirectory: { type: [String, null], required: true },

  translate: { type: Function, required: true },
});
const emit = defineEmits(["download-attachment", "download-mutation", "link-error"]);

const { mermaidHostRef } = useMermaidRender();
const renderedHtml = computed(() =>
  props.renderMarkdown(props.content, {
    attachmentRefIndex: props.attachmentRefIndex,
    linkSnapshots: props.linkSnapshots,
    messageIndex: props.messageIndex,
    workspaceRootDirectory: props.workspaceRootDirectory,
    translate: props.translate,
  }),
);

function findMutationRef(chipRef) {
  const snapshot = props.linkSnapshots.find(
    (item) => item.kind === LINK_SNAPSHOT_KIND.MUTATION && mutationLinkRef(item.ref) === chipRef,
  );
  if (!snapshot) throw new Error(`rendered mutation chip has no snapshot: ${chipRef}`);
  return snapshot.ref;
}

function handleFileLink(event) {
  const link = event.target?.closest?.(
    "a[data-noobot-attachment-ref], a[data-noobot-mutation-ref]",
  );
  if (!link || !event.currentTarget?.contains(link)) return;
  event.preventDefault();
  if (event.type === "auxclick") return;
  try {
    const mutationChipRef = link.getAttribute("data-noobot-mutation-ref");
    if (mutationChipRef) {
      emit("download-mutation", findMutationRef(mutationChipRef));
      return;
    }
    const identity = parseAttachmentIdentityRef(link.getAttribute("data-noobot-attachment-ref"));
    const attachment = props.attachmentRefIndex.get(attachmentIdentityKey(identity));
    if (!attachment) {
      throw new Error(`rendered attachment chip is not indexed: ${identity.attachmentId}`);
    }
    emit("download-attachment", attachment);
  } catch (error) {
    emit("link-error", error);
  }
}
</script>

<template>
  <div
    ref="mermaidHostRef"
    class="base-markdown-content noobot-rich-content"
    @click="handleFileLink"
    @auxclick="handleFileLink"
    v-html="renderedHtml"
  />
</template>

<style scoped>
.base-markdown-content {
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  color: inherit;
}

.base-markdown-content :deep(p) {
  margin: 0 0 var(--noobot-space-md) 0;
}

.base-markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.base-markdown-content :deep(code) {
  padding: var(--noobot-space-3xs) var(--noobot-space-xs);
}

.base-markdown-content :deep(pre) {
  padding: var(--noobot-msg-markdown-pre-padding);
  margin: var(--noobot-space-md) 0;
}

.base-markdown-content :deep(pre code) {
  padding: 0;
}

.base-markdown-content :deep(ul),
.base-markdown-content :deep(ol) {
  margin: var(--noobot-space-2xs) 0 var(--noobot-space-sm) 0;
  padding-left: var(--noobot-space-xl);
}

.base-markdown-content :deep(li) {
  margin: var(--noobot-space-3xs) 0;
  line-height: var(--noobot-line-height-body);
}

.base-markdown-content :deep(table) {
  display: block;
  max-width: 100%;
  margin: var(--noobot-space-md) 0;
  font-size: var(--noobot-msg-caption-font-size);
  border-radius: var(--noobot-radius-sm);
  overflow-x: auto;
}

.base-markdown-content :deep(th),
.base-markdown-content :deep(td) {
  padding: var(--noobot-msg-table-cell-padding-y) var(--noobot-msg-table-cell-padding-x);
}

.base-markdown-content :deep(.mermaid) {
  margin: var(--noobot-space-md) 0;
  padding: var(--noobot-space-sm);
  overflow-x: auto;
}

.base-markdown-content :deep(blockquote) {
  margin: var(--noobot-space-md) 0;
  padding: var(--noobot-space-xs) var(--noobot-space-md);
  border-left: 3px solid color-mix(in srgb, var(--noobot-text-accent) 90%, transparent);
  background: var(--noobot-accent-soft);
}

.base-markdown-content :deep(.noobot-collapse) {
  margin: var(--noobot-space-md) 0;
  border: 1px solid var(--noobot-panel-border);
  border-radius: var(--noobot-radius-md);
  background: color-mix(in srgb, var(--noobot-panel-muted) 68%, transparent);
  overflow: hidden;
}

.base-markdown-content :deep(.noobot-collapse > summary) {
  cursor: pointer;
  user-select: none;
  padding: var(--noobot-space-sm) var(--noobot-space-md);
  font-weight: var(--noobot-font-weight-bold);
  color: var(--noobot-text-main);
  background: color-mix(in srgb, var(--noobot-accent-soft) 70%, transparent);
  border-bottom: 1px solid transparent;
}

.base-markdown-content :deep(.noobot-collapse[open] > summary) {
  border-bottom-color: var(--noobot-panel-border);
}

.base-markdown-content :deep(.noobot-collapse__body) {
  padding: var(--noobot-space-md);
}

.base-markdown-content :deep(.noobot-collapse__body > :first-child) {
  margin-top: 0;
}

.base-markdown-content :deep(.noobot-collapse__body > :last-child) {
  margin-bottom: 0;
}

.base-markdown-content :deep(h1),
.base-markdown-content :deep(h2),
.base-markdown-content :deep(h3),
.base-markdown-content :deep(h4) {
  margin: var(--noobot-space-md) 0 var(--noobot-space-sm);
  line-height: var(--noobot-line-height-balanced);
}

.base-markdown-content :deep(.noobot-attachment-chip) {
  display: inline-flex;
  align-items: center;
  gap: var(--noobot-space-xs);
  max-width: 100%;
  padding: var(--noobot-space-3xs) var(--noobot-space-sm);
  border: 1px solid var(--noobot-msg-file-card-border);
  border-radius: var(--noobot-radius-sm);
  background: var(--noobot-msg-file-card-bg);
  font-size: var(--noobot-font-size-sm);
  line-height: var(--noobot-line-height-comfortable);
  text-decoration: none;
  vertical-align: baseline;
}

.base-markdown-content :deep(a.noobot-attachment-chip:hover) {
  background: var(--noobot-accent-soft);
}

.base-markdown-content :deep(.noobot-attachment-chip__name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.base-markdown-content :deep(.noobot-attachment-chip[data-noobot-link-superseded]) {
  border-style: dashed;
}

.base-markdown-content :deep(.noobot-attachment-chip--latest) {
  margin-left: 4px;
  color: var(--noobot-text-muted);
}

.base-markdown-content :deep(.noobot-attachment-chip--missing) {
  opacity: 0.6;
  cursor: not-allowed;
  text-decoration: line-through;
}
</style>
