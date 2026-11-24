<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onBeforeUnmount, onWatcherCleanup, ref, watch } from "vue";
import { Delete, Refresh } from "@element-plus/icons-vue";
import { readApiResponseEnvelope } from "@noobot/shared/request-error";
import {
  deleteQuarantinedSessionApi,
  getQuarantinedSessionsApi,
} from "../../../infrastructure/api/chat/chatApi.js";
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { useUiFeedback } from "../../../shared/composables/useUiFeedback.js";
import {
  isOverlayDismissal,
  overlayMessageBox,
} from "../../../shared/composables/overlayMessageBox.js";

const props = defineProps({
  userId: { type: String, required: true },
  fetcher: { type: Function, required: true },
  connected: { type: Boolean, required: true },
  active: { type: Boolean, required: true },
});
const { translate, locale } = useLocale();
const { notify } = useUiFeedback();
const ready = computed(() => props.connected && props.active);
const sessions = ref([]);
const loading = ref(false);
const failed = ref(false);
const deletingId = ref("");
const revision = ref(0);
const dateFormatter = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: "medium", timeStyle: "short" }),
);
let mounted = true;
onBeforeUnmount(() => {
  mounted = false;
});

watch(
  [ready, () => props.userId, revision],
  async ([open, userId]) => {
    const request = new AbortController();
    onWatcherCleanup(() => request.abort());
    sessions.value = [];
    failed.value = false;
    loading.value = open;
    if (!open) return;
    try {
      const result = await readApiResponseEnvelope(
        await getQuarantinedSessionsApi(
          { userId },
          { fetcher: props.fetcher, signal: request.signal },
        ),
      );
      if (!request.signal.aborted) sessions.value = result.sessions;
    } catch {
      if (!request.signal.aborted) failed.value = true;
    } finally {
      if (!request.signal.aborted) loading.value = false;
    }
  },
  { immediate: true },
);

function sessionLabel(session) {
  return session.title || translate(`quarantinedSessions.status.${session.status}`);
}

async function deleteSession(session) {
  const userId = props.userId;
  deletingId.value = session.id;
  try {
    await overlayMessageBox.confirm(
      translate("quarantinedSessions.confirmDelete", { title: sessionLabel(session) }),
      translate("common.deleteSession"),
      {
        confirmButtonText: translate("common.deleteSession"),
        cancelButtonText: translate("common.cancel"),
        type: "warning",
      },
    );
    if (!mounted || !ready.value || props.userId !== userId) return;
    await readApiResponseEnvelope(
      await deleteQuarantinedSessionApi({ userId, id: session.id }, { fetcher: props.fetcher }),
    );
    notify({ type: "success", message: translate("common.deleteSessionSuccess") });
    if (props.userId === userId)
      sessions.value = sessions.value.filter(({ id }) => id !== session.id);
  } catch (error) {
    if (isOverlayDismissal(error)) return;
    notify({ type: "error", message: translate("quarantinedSessions.deleteFailed") });
    if (props.userId === userId) revision.value += 1;
  } finally {
    deletingId.value = "";
  }
}
</script>

<template>
  <section class="quarantine-panel noobot-workspace-panel" :aria-busy="loading">
    <header class="quarantine-toolbar noobot-workspace-head">
      <span class="noobot-workspace-title">{{ translate("common.currentUser", { userId }) }}</span>
      <el-button
        class="noobot-icon-button"
        :icon="Refresh"
        text
        circle
        :loading="loading"
        :disabled="!ready || Boolean(deletingId)"
        :title="translate('common.refresh')"
        :aria-label="translate('common.refresh')"
        @click="revision += 1"
      />
    </header>
    <div class="quarantine-body noobot-workspace-body">
      <div v-if="loading" role="status" class="quarantine-status">
        {{ translate("quarantinedSessions.loading") }}
      </div>
      <el-alert
        v-else-if="failed"
        :title="translate('quarantinedSessions.loadFailed')"
        type="error"
        :closable="false"
      />
      <el-empty
        v-else-if="!sessions.length"
        :description="translate(connected ? 'quarantinedSessions.empty' : 'common.disconnected')"
        :image-size="48"
      />
      <ul v-else class="quarantine-list">
        <li v-for="session in sessions" :key="session.id" class="quarantine-row noobot-subtle-row">
          <div class="quarantine-entry">
            <strong>{{ sessionLabel(session) }}</strong>
            <div class="quarantine-meta">
              <span :title="session.errorCode">{{
                translate(`quarantinedSessions.status.${session.status}`)
              }}</span>
              <time :datetime="session.quarantinedAt">{{
                dateFormatter.format(new Date(session.quarantinedAt))
              }}</time>
            </div>
            <span>{{ session.sessionId }}</span>
            <code>{{ session.quarantinePath }}</code>
            <span v-if="session.deleting" class="quarantine-interrupted">{{
              translate("quarantinedSessions.deleteInterrupted")
            }}</span>
          </div>
          <el-button
            class="noobot-icon-button quarantine-action"
            :icon="Delete"
            type="danger"
            text
            circle
            :loading="deletingId === session.id"
            :disabled="!ready || Boolean(deletingId)"
            :title="translate('common.deleteSession')"
            :aria-label="translate('common.deleteSession')"
            @click="deleteSession(session)"
          />
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.quarantine-toolbar {
  gap: var(--noobot-space-md);
  overflow-wrap: anywhere;
}

.quarantine-body {
  padding: var(--noobot-space-sm);
}

.quarantine-status {
  padding: var(--noobot-space-lg);
  color: var(--noobot-text-secondary);
}

.quarantine-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.quarantine-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--noobot-space-sm);
  padding: var(--noobot-space-sm) var(--noobot-space-md);
}

.quarantine-entry {
  display: grid;
  min-width: 0;
  gap: var(--noobot-space-2xs);
  overflow-wrap: anywhere;
  color: var(--noobot-text-secondary);
  font-size: var(--noobot-font-size-sm);
}

.quarantine-entry strong {
  color: var(--noobot-text-strong);
  font-size: var(--noobot-font-size-md);
}

.quarantine-meta {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--noobot-space-md);
}

.quarantine-interrupted {
  color: var(--noobot-status-warning);
}

.quarantine-action {
  margin: 0;
}
</style>
