import type { HttpClient } from '../client/HttpClient.js';
import { devicesSchema } from '../schemas/user.schema.js';
import type { DeviceList } from '../types/user.js';

export class DevicesEndpoint {
  #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  list(): Promise<DeviceList> {
    return this.#http.request('/device-service/deviceregistration/devices', {
      schema: devicesSchema,
    });
  }
}
