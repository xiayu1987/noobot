import test from "node:test";
import assert from "node:assert/strict";

import {
  isSuperAdminRole,
  isSuperUserAgentContext,
  isSuperUserRuntime,
  resolveConfiguredSuperUserId,
  SUPER_ADMIN_ROLE,
} from "../../../src/system-core/utils/super-user.js";

test("super-user: configured super user id is not hardcoded to admin", () => {
  const configuredUserId = "owner-xiayu";
  assert.equal(resolveConfiguredSuperUserId({ superAdmin: { userId: configuredUserId } }), configuredUserId);
  assert.equal(
    resolveConfiguredSuperUserId({ super_admin: { user_id: configuredUserId } }),
    configuredUserId,
  );
  assert.equal(isSuperUserRuntime({
    userId: configuredUserId,
    globalConfig: { superAdmin: { userId: configuredUserId } },
  }), true);
  assert.equal(isSuperUserRuntime({
    userId: "admin",
    globalConfig: { superAdmin: { userId: configuredUserId } },
  }), false);
});

test("super-user: role and agent context checks share the same helper", () => {
  assert.equal(isSuperAdminRole(SUPER_ADMIN_ROLE), true);
  assert.equal(isSuperUserAgentContext({
    environment: { identity: { userId: "custom-root" } },
    execution: {
      controllers: {
        runtime: {
          globalConfig: { superAdmin: { userId: "custom-root" } },
          systemRuntime: { sessionId: "s1" },
        },
      },
    },
  }), true);
});
