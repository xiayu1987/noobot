/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  isSuperAdminRole,
  isSuperUserAgentContext,
  resolveConfiguredSuperUserId,
  SUPER_ADMIN_ROLE,
} from "../../../src/shared/utils/super-user.js";

test("super-user: configured super user id alone does not grant super user", () => {
  const configuredUserId = "owner-xiayu";
  assert.equal(
    resolveConfiguredSuperUserId({ superAdmin: { userId: configuredUserId } }),
    configuredUserId,
  );
  assert.equal(resolveConfiguredSuperUserId({ super_admin: { user_id: configuredUserId } }), "");
});

test("super-user: agent context grants only via systemRuntime.isSuperUser", () => {
  assert.equal(isSuperAdminRole(SUPER_ADMIN_ROLE), true);
  assert.equal(
    isSuperUserAgentContext({
      context: {
        environment: { identity: { userId: "custom-root" } },
      },
      bindings: {
        runtime: {
          globalConfig: { superAdmin: { userId: "custom-root" } },
          systemRuntime: { sessionId: "s1", isSuperUser: true },
        },
      },
    }),
    true,
  );
  assert.equal(
    isSuperUserAgentContext({
      environment: { identity: { role: SUPER_ADMIN_ROLE } },
      auth: { role: SUPER_ADMIN_ROLE },
      bindings: {
        runtime: {
          role: SUPER_ADMIN_ROLE,
          systemRuntime: { sessionId: "s1", role: SUPER_ADMIN_ROLE },
        },
      },
    }),
    false,
  );
});
