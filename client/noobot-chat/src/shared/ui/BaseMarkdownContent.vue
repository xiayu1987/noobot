<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed } from "vue";
import { useMermaidRender } from "../composables/useMermaidRender.js";
import { useMarkdownAttachmentImages } from "../composables/useMarkdownAttachmentImages.js";
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
const markdownHtml = computed(() =>
  props.renderMarkdown(props.content, {
    attachmentRefIndex: props.attachmentRefIndex,
    linkSnapshots: props.linkSnapshots,
    messageIndex: props.messageIndex,
    workspaceRootDirectory: props.workspaceRootDirectory,
    translate: props.translate,
  }),
);
const renderedHtml = useMarkdownAttachmentImages(markdownHtml, (error) =>
  emit("link-error", error),
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
  color: inherit;
}
</style>
