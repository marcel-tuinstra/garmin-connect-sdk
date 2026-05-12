import type { z } from 'zod';
import type { deviceSchema, devicesSchema, socialProfileSchema } from '../schemas/user.schema.js';

export type SocialProfile = z.infer<typeof socialProfileSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type DeviceList = z.infer<typeof devicesSchema>;
