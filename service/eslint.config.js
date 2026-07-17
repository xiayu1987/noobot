/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export default [
  {
    ignores: ["node_modules/**", "vendor/**", "**/vendor/**"],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  {
    files: [
      "**/constants.js",
      "**/*-constants.js",
      "**/*_constants.js",
      "**/constants/**/*.js",
      "**/constants-*.js",
      "**/constants.*.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      // Constants declaration names must use UPPER_SNAKE_CASE.
      "id-match": [
        "error",
        "^[A-Z][A-Z0-9_]*$",
        {
          onlyDeclarations: true,
          properties: false,
        },
      ],
    },
  },
];
