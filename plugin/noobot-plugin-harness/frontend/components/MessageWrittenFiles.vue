<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { View } from "@element-plus/icons-vue";
import { useLocale } from "../../../../client/noobot-chat/src/shared/i18n/useLocale";
import {
  BaseAttachmentFileCard,
  BaseSectionHeader,
  BaseFileCardList,
} from "../../../../client/noobot-chat/src/shared/ui";

defineProps({
  writtenFiles: { type: Array, default: () => [] },
});

const emit = defineEmits(["preview", "download"]);
const { translate } = useLocale();

const isImageMime = () => false;
const canPreviewAttachment = () => false;
const formatFileSize = () => "";
</script>

<template>
  <BaseFileCardList v-if="writtenFiles.length">
    <template #header>
      <BaseSectionHeader
        :title="translate('message.generatedFiles', { count: writtenFiles.length })"
      />
    </template>
    <BaseAttachmentFileCard
      v-for="(fileItem, fileIndex) in writtenFiles"
      :key="`${fileItem.resolvedPath}-${fileIndex}`"
      :attachment-item="fileItem"
      :is-image-mime="isImageMime"
      :can-preview-attachment="canPreviewAttachment"
      :format-file-size="formatFileSize"
      :translate="translate"
      :name-text="fileItem.fileName"
      :title-text="fileItem.resolvedPath || fileItem.fileName"
      :show-size="false"
      :show-preview="Boolean(fileItem.relativePath)"
      :show-download="Boolean(fileItem.relativePath)"
      :preview-icon="View"
      :custom-badge-text="fileItem.recognized ? translate('message.recognizedFile') : ''"
      custom-badge-class="is-recognized"
      @preview="emit('preview', fileItem)"
      @download="emit('download', fileItem)"
    />
  </BaseFileCardList>
</template>
