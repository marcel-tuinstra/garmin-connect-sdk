import { z } from 'zod';

export const socialProfileSchema = z
  .object({
    displayName: z.string().min(1),
    id: z.union([z.number(), z.string()]).optional(),
    profileId: z.union([z.number(), z.string()]).optional(),
    fullName: z.string().nullable().optional(),
    userName: z.string().optional(),
  })
  .passthrough();

export const deviceSchema = z
  .object({
    deviceId: z.union([z.number(), z.string()]).optional(),
    unitId: z.union([z.number(), z.string()]).optional(),
    productDisplayName: z.string().optional(),
  })
  .passthrough();

export const devicesSchema = z.array(deviceSchema);
