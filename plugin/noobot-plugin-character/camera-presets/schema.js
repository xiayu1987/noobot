/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { z } from "zod";

const finite = z.number().finite();
const vec3 = z.array(finite).length(3);
const frameSubjects = z
  .object({
    type: z.literal("frame_subjects"),
    fov: finite.positive().max(120),
    margin: finite.nonnegative().max(2),
  })
  .strict();
const translate = z
  .object({
    type: z.literal("translate"),
    position: vec3.optional(),
    target: vec3.optional(),
  })
  .strict()
  .refine((value) => value.position || value.target, "translate requires position or target");
const dolly = z
  .object({ type: z.literal("dolly"), endDistanceRatio: finite.positive().max(4) })
  .strict();
const orbit = z.object({ type: z.literal("orbit"), degrees: finite.min(-360).max(360) }).strict();
const follow = z
  .object({ type: z.literal("follow"), side: z.enum(["behind", "left", "right"]) })
  .strict();

export const CameraPresetOperatorSchema = z.discriminatedUnion("type", [
  frameSubjects,
  translate,
  dolly,
  orbit,
  follow,
]);

export const CameraPresetSchema = z
  .object({
    presetId: z.string().regex(/^camera\.[a-z][a-z0-9_.-]{0,151}$/),
    version: z.number().int().positive(),
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(240),
    samples: z.number().int().min(2).max(32),
    operators: z.array(CameraPresetOperatorSchema).min(1).max(16),
  })
  .strict();

export const CameraPresetCatalogSchema = z
  .array(CameraPresetSchema)
  .min(1)
  .max(128)
  .superRefine((value, context) => {
    const ids = new Set();
    value.forEach((preset, index) => {
      if (ids.has(preset.presetId)) {
        context.addIssue({
          code: "custom",
          path: [index, "presetId"],
          message: "camera preset IDs must be unique",
        });
      }
      ids.add(preset.presetId);
      if (preset.operators[0]?.type !== "frame_subjects") {
        context.addIssue({
          code: "custom",
          path: [index, "operators", 0],
          message: "camera preset must begin with frame_subjects",
        });
      }
    });
  });

const subjectIds = z
  .array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,159}$/))
  .min(1)
  .max(32);
export const CameraPresetInvocationSchema = z
  .object({
    presetId: z.string().regex(/^camera\.[a-z][a-z0-9_.-]{0,151}$/),
    subjectIds: subjectIds.optional(),
  })
  .strict();
export const CameraShotSchema = z
  .object({
    presetId: z.string().regex(/^camera\.[a-z][a-z0-9_.-]{0,151}$/),
    subjectIds: subjectIds.optional(),
    start: finite.nonnegative(),
    duration: finite.positive().max(3600),
    transition: z.enum(["cut", "blend"]),
  })
  .strict();
export const CameraPlanSchema = z.union([
  CameraPresetInvocationSchema,
  z.object({ shots: z.array(CameraShotSchema).min(1).max(64) }).strict(),
]);
