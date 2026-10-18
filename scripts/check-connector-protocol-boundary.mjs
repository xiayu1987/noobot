#!/usr/bin/env node
/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  addHit,
  defineCheck,
  emptyRuleMeasurements,
  runCheckWhenMain,
} from "./quality/check-protocol.mjs";
import {
  readRepositoryJson,
  readRepositoryText,
  repositoryRoot,
} from "./quality/repository-files.mjs";
import { addRemovedPathHits, addMissingMarkerHits } from "./quality/boundary-hits.mjs";
import { getFirstPartyFilesUnder } from "./quality/source-inventory.mjs";

const SCAN = Object.freeze({ extensions: [".js", ".mjs", ".vue"], includeTests: true });
const CATALOG = "connector-protocol/src/catalog.js";
const AGENT_TOOL = "agent/src/tools/connectors/connector-access-tool.js";
const RUN_PREFERENCES = "agent-transport-protocol/src/run-preferences.js";

const REMOVED_PATHS = Object.freeze([
  "agent/src/integrations/connectors",
  "agent/src/integrations/connectors/connector-event-listener.js",
  "agent/src/integrations/connectors/history-store.js",
  "agent/src/tools/connectors/base-connector-tool.js",
  "agent/src/tools/connectors/connector-toolkit/tool-connect-database.js",
  "agent/src/tools/connectors/connector-toolkit/tool-connect-email.js",
  "agent/src/tools/connectors/connector-toolkit/tool-connect-terminal.js",
]);
const CATALOG_MARKERS = Object.freeze([
  "normalizeConnectorType",
  "createConnectorInstanceDefinition",
  "normalizeConnectorParameters",
]);
const CONCRETE_TYPES = Object.freeze(["mysql", "postgres", "sqlite", "smtp_imap", "ssh"]);
const AGENT_TOOL_FORBIDDEN = Object.freeze([
  "runDetachedSubSession",
  "connector.type",
  "connector.subType",
  "@noobot/connector-runtime",
]);
const LAYER_FORBIDDEN = Object.freeze({
  "connector-runtime/src": ["noobot-agent", "@noobot/connector-instances", "/service/"],
  "connector-instances/src": [
    "noobot-agent",
    "@noobot/agent-config-protocol",
    "@noobot/connector-runtime",
    "/service/",
  ],
});
const CONSUMER_ROOTS = Object.freeze([
  "agent-config-protocol/src",
  "agent-transport-protocol/src",
  "agent/src",
  "client/noobot-chat/src",
  "service",
]);
const LEGACY_TERMS = Object.freeze([
  "selectedConnectors",
  "normalizeSelectedConnectors",
  "getRootSessionSelectedConnectors",
  "setRootSessionSelectedConnectors",
  "database_connect_connector",
  "terminal_connect_connector",
  "email_connect_connector",
  "getConnectorHistoryStore",
  "connectorEventListener",
]);

const filesUnder = (directories) =>
  getFirstPartyFilesUnder(directories, { ...SCAN, repositoryRoot });

async function measure() {
  const measured = emptyRuleMeasurements(CHECK);
  await addRemovedPathHits(measured.removedImplementation, REMOVED_PATHS, "must remain removed");
  const catalog = await readRepositoryText(CATALOG);
  await addMissingMarkerHits(measured.protocolCatalog, CATALOG, CATALOG_MARKERS);
  for (const type of CONCRETE_TYPES) {
    if (catalog.includes(`"${type}"`)) {
      addHit(measured.protocolCatalog, { file: CATALOG, message: `concrete instance ${type}` });
    }
  }
  const agentTool = await readRepositoryText(AGENT_TOOL);
  for (const term of AGENT_TOOL_FORBIDDEN) {
    if (agentTool.includes(term)) {
      addHit(measured.agentRuntimeDetail, { file: AGENT_TOOL, message: term });
    }
  }
  const agentPackage = await readRepositoryJson("agent/package.json");
  if (Object.hasOwn(agentPackage.dependencies, "@noobot/connector-runtime")) {
    addHit(measured.agentRuntimeDetail, {
      file: "agent/package.json",
      message: "depends on @noobot/connector-runtime",
    });
  }
  for (const [layer, forbidden] of Object.entries(LAYER_FORBIDDEN)) {
    for (const file of await filesUnder([layer])) {
      const source = await readRepositoryText(file);
      for (const dependency of forbidden) {
        if (source.includes(dependency)) {
          addHit(measured.layerDependency, { file, message: `depends on ${dependency}` });
        }
      }
    }
  }
  for (const file of await filesUnder(CONSUMER_ROOTS)) {
    const source = await readRepositoryText(file);
    if (/export\s+const\s+CONNECTOR_TYPE\b/.test(source)) {
      addHit(measured.typeOwnership, { file, message: "exports CONNECTOR_TYPE" });
    }
    for (const term of LEGACY_TERMS) {
      if (source.includes(term)) addHit(measured.legacyTerm, { file, message: term });
    }
  }
  if ((await readRepositoryText(RUN_PREFERENCES)).includes("selectedConnectorIds")) {
    addHit(measured.typeOwnership, { file: RUN_PREFERENCES, message: "selectedConnectorIds" });
  }
  return measured;
}

export const CHECK = defineCheck({
  id: "connector-protocol-boundary",
  description: "Connector types, catalog and runtime layering are owned by connector-protocol",
  rules: {
    removedImplementation: {
      description: "Obsolete Agent connector implementations stay deleted",
      hint: "delete the file; connectors live in connector-runtime and connector-instances",
    },
    protocolCatalog: {
      description: "The protocol catalog exposes the normalizers and no concrete instance types",
      hint: "keep concrete types in connector-instances and normalizers in the catalog",
    },
    agentRuntimeDetail: {
      description: "Agent consumes the connector protocol port, not runtime details",
      hint: "call the connector access port instead of runtime internals",
    },
    layerDependency: {
      description: "Runtime and instance layers do not depend upward",
      hint: "invert the dependency through connector-protocol",
    },
    typeOwnership: {
      description: "Connector types and selection belong to connector-protocol and Session",
      hint: "import CONNECTOR_TYPE from @noobot/connector-protocol; keep selection on Session",
    },
    legacyTerm: {
      description: "Obsolete connector selection and history terms stay removed",
      hint: "use the Session connector selection and connector-runtime history",
    },
  },
  exemptions: [],
  baseline: {
    removedImplementation: 0,
    protocolCatalog: 0,
    agentRuntimeDetail: 0,
    layerDependency: 0,
    typeOwnership: 0,
    legacyTerm: 0,
    exemptions: 0,
  },
  measure,
});

await runCheckWhenMain(CHECK, import.meta.url);
