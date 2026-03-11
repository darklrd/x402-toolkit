import type { X402FetchOptions } from 'x402-agent-client';
import type { ZodObject, ZodRawShape } from 'zod/v3';

export interface X402ToolConfig<T extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  schema: ZodObject<T>;
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  fetchOptions: X402FetchOptions;
  returnDirect?: boolean;
}
