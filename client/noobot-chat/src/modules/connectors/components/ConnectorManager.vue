<!--
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
-->
<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { Connection, Delete, Link, Plus, RefreshLeft } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  connectUserConnector,
  createUserConnector,
  deleteUserConnector,
  disconnectUserConnector,
  getConnectorCatalog,
  listUserConnectors,
} from "../../../infrastructure/api/connectors/connectorApi.js";
import { useLocale } from "../../../shared/i18n/useLocale.js";

const props = defineProps({
  userId: { type: String, default: "" },
  connected: { type: Boolean, default: false },
  fetcher: { type: Function, required: true },
  compact: { type: Boolean, default: false },
});
const emit = defineEmits(["changed"]);
const { translate } = useLocale();
const catalog = ref([]);
const connectors = ref([]);
const loading = ref(false);
const dialogVisible = ref(false);
const form = reactive({ name: "", type: "", subType: "", parameters: {} });
let refreshRevision = 0;

const types = computed(() => [...new Set(catalog.value.map((item) => item.type))]);
const subTypes = computed(() =>
  catalog.value.filter((item) => item.type === form.type).map((item) => item.subType),
);
const definition = computed(() =>
  catalog.value.find((item) => item.type === form.type && item.subType === form.subType),
);
const connectedConnectors = computed(() =>
  connectors.value.filter((connector) => connector.status === "connected"),
);

function resetParameters() {
  form.parameters = Object.fromEntries(
    (definition.value?.fields || [])
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.name, field.defaultValue]),
  );
}

watch(
  () => form.type,
  () => {
    form.subType = subTypes.value[0] || "";
    resetParameters();
  },
);
watch(() => form.subType, resetParameters);

async function parseResponse(response) {
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true)
    throw new Error(payload?.error || "connector_request_failed");
  return payload;
}

async function refresh() {
  const revision = ++refreshRevision;
  const requestedUserId = String(props.userId || "").trim();
  if (!props.connected || !requestedUserId) {
    catalog.value = [];
    connectors.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const [catalogPayload, connectorPayload] = await Promise.all([
      parseResponse(await getConnectorCatalog({ fetcher: props.fetcher })),
      parseResponse(await listUserConnectors({ userId: requestedUserId, fetcher: props.fetcher })),
    ]);
    if (revision !== refreshRevision || requestedUserId !== String(props.userId || "").trim()) {
      return;
    }
    catalog.value = Array.isArray(catalogPayload.catalog) ? catalogPayload.catalog : [];
    connectors.value = Array.isArray(connectorPayload.connectors)
      ? connectorPayload.connectors
      : [];
    if (!form.type) form.type = types.value[0] || "";
  } catch (error) {
    if (revision === refreshRevision) ElMessage.error(error.message);
  } finally {
    if (revision === refreshRevision) loading.value = false;
  }
}

async function addConnector() {
  loading.value = true;
  try {
    const payload = await parseResponse(
      await createUserConnector({
        userId: props.userId,
        connector: {
          name: form.name,
          instanceType: definition.value?.instanceType,
          parameters: form.parameters,
        },
        fetcher: props.fetcher,
      }),
    );
    dialogVisible.value = false;
    form.name = "";
    resetParameters();
    await refresh();
    emit("changed");
    if (payload.connection?.connected !== true) {
      ElMessage.error(
        payload.connection?.connector?.statusMessage || "connector_connection_failed",
      );
    }
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    loading.value = false;
  }
}

async function setConnection(connector, shouldConnect) {
  loading.value = true;
  try {
    const action = shouldConnect ? connectUserConnector : disconnectUserConnector;
    await parseResponse(
      await action({
        userId: props.userId,
        connectorId: connector.connectorId,
        fetcher: props.fetcher,
      }),
    );
    await refresh();
    emit("changed");
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    loading.value = false;
  }
}

async function removeConnector(connector) {
  await ElMessageBox.confirm(
    translate("connectors.deleteConfirm"),
    translate("connectors.management"),
    { type: "warning" },
  );
  loading.value = true;
  try {
    await parseResponse(
      await deleteUserConnector({
        userId: props.userId,
        connectorId: connector.connectorId,
        fetcher: props.fetcher,
      }),
    );
    await refresh();
    emit("changed");
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);
watch(() => [props.connected, props.userId], refresh);
</script>

<template>
  <section class="connector-manager" :class="{ compact }" v-loading="loading">
    <header class="manager-header">
      <span class="manager-title"
        ><el-icon><Connection /></el-icon>{{ translate("connectors.management") }}
        <el-tag size="small" type="success">{{ connectedConnectors.length }}</el-tag></span
      >
      <span class="manager-actions">
        <el-button text circle :title="translate('common.refresh')" @click="refresh"
          ><el-icon><RefreshLeft /></el-icon
        ></el-button>
        <el-button
          type="primary"
          circle
          :title="translate('connectors.add')"
          @click="dialogVisible = true"
          ><el-icon><Plus /></el-icon
        ></el-button>
      </span>
    </header>
    <div class="connector-list">
      <div v-for="connector in connectors" :key="connector.connectorId" class="connector-row">
        <span class="connector-identity">
          <strong>{{ connector.name }}</strong>
          <small>{{ connector.type }} / {{ connector.subType }}</small>
        </span>
        <span class="connector-row-actions">
          <el-tag size="small" :type="connector.status === 'connected' ? 'success' : 'info'">{{
            translate(`connectors.status.${connector.status}`)
          }}</el-tag>
          <el-button
            text
            circle
            :title="
              connector.status === 'connected'
                ? translate('connectors.disconnect')
                : translate('connectors.connect')
            "
            @click="setConnection(connector, connector.status !== 'connected')"
            ><el-icon><Link /></el-icon
          ></el-button>
          <el-button
            text
            circle
            type="danger"
            :title="translate('common.delete')"
            @click="removeConnector(connector)"
            ><el-icon><Delete /></el-icon
          ></el-button>
        </span>
      </div>
      <el-empty
        v-if="!connectors.length"
        :description="translate('connectors.empty')"
        :image-size="48"
      />
    </div>

    <el-drawer
      v-model="dialogVisible"
      :title="translate('connectors.add')"
      direction="rtl"
      size="min(520px, 92vw)"
      append-to-body
      class="connector-add-drawer noobot-side-drawer"
    >
      <el-form label-position="top" @submit.prevent="addConnector">
        <el-form-item :label="translate('connectors.name')" required
          ><el-input v-model="form.name"
        /></el-form-item>
        <div class="type-grid">
          <el-form-item :label="translate('connectors.type')" required
            ><el-select v-model="form.type"
              ><el-option
                v-for="type in types"
                :key="type"
                :label="type"
                :value="type" /></el-select
          ></el-form-item>
          <el-form-item :label="translate('connectors.subType')" required
            ><el-select v-model="form.subType"
              ><el-option
                v-for="subType in subTypes"
                :key="subType"
                :label="subType"
                :value="subType" /></el-select
          ></el-form-item>
        </div>
        <el-form-item
          v-for="field in definition?.fields || []"
          :key="field.name"
          :label="translate(`connectors.fields.${field.name}`)"
          :required="field.required"
        >
          <el-switch v-if="field.kind === 'boolean'" v-model="form.parameters[field.name]" />
          <el-input-number
            v-else-if="field.kind === 'number'"
            v-model="form.parameters[field.name]"
            :min="1"
            controls-position="right"
          />
          <el-input
            v-else
            v-model="form.parameters[field.name]"
            :type="field.secret ? 'password' : 'text'"
            :show-password="field.secret"
          />
        </el-form-item>
      </el-form>
      <template #footer
        ><el-button @click="dialogVisible = false">{{ translate("common.cancel") }}</el-button
        ><el-button type="primary" @click="addConnector">{{
          translate("connectors.connect")
        }}</el-button></template
      >
    </el-drawer>
  </section>
</template>

<style scoped>
.connector-manager {
  min-width: 0;
  padding: 10px;
  border-top: 1px solid var(--noobot-border-color);
}
.manager-header,
.connector-row,
.manager-title,
.manager-actions,
.connector-row-actions {
  display: flex;
  align-items: center;
}
.manager-header,
.connector-row {
  justify-content: space-between;
  gap: 8px;
}
.manager-title {
  gap: 6px;
  font-weight: 650;
}
.manager-title .el-tag {
  margin-left: 2px;
}
.connector-list {
  display: grid;
  gap: 6px;
  margin-top: 8px;
}
.connector-row {
  padding: 7px 4px;
}
.connector-identity {
  display: grid;
  min-width: 0;
}
.connector-identity strong,
.connector-identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.connector-identity small {
  color: var(--noobot-text-secondary);
}
.connector-row-actions {
  gap: 2px;
  flex: none;
}
.type-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.connector-add-drawer :deep(.el-drawer__body) {
  padding: 18px;
}
@media (max-width: 600px) {
  .type-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
