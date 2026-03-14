import { StructuredTool, ToolInputParsingException } from '@langchain/core/tools';
import { createTool } from '@darklrd/x402-agent-client';
import {
  ZodObject,
  ZodString,
  ZodNumber,
  ZodBoolean,
  ZodEnum,
  ZodOptional,
  ZodArray,
  type ZodRawShape,
  type ZodTypeAny,
  type z,
} from 'zod/v3';
import type { X402ToolConfig } from './types.js';
import type { JsonSchema } from '@darklrd/x402-agent-client';

function zodFieldToJsonSchema(field: ZodTypeAny): JsonSchema {
  const desc = (field as { description?: string }).description;
  const base: JsonSchema = desc ? { description: desc } : {};

  if (field instanceof ZodOptional) {
    return zodFieldToJsonSchema(field.unwrap());
  }
  if (field instanceof ZodString) {
    return { type: 'string', ...base };
  }
  if (field instanceof ZodNumber) {
    return { type: 'number', ...base };
  }
  if (field instanceof ZodBoolean) {
    return { type: 'boolean', ...base };
  }
  if (field instanceof ZodEnum) {
    return { type: 'string', enum: field.options as string[], ...base };
  }
  if (field instanceof ZodArray) {
    return { type: 'array', items: zodFieldToJsonSchema(field.element), ...base };
  }
  if (field instanceof ZodObject) {
    return zodObjectToJsonSchema(field as ZodObject<ZodRawShape>);
  }
  return { type: 'string', ...base };
}

function zodObjectToJsonSchema<T extends ZodRawShape>(schema: ZodObject<T>): JsonSchema {
  const shape = schema.shape as Record<string, ZodTypeAny>;
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [key, val] of Object.entries(shape)) {
    properties[key] = zodFieldToJsonSchema(val);
    if (!(val instanceof ZodOptional)) {
      required.push(key);
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

export class X402Tool<T extends ZodRawShape = ZodRawShape> extends StructuredTool {
  name: string;
  description: string;
  schema: ZodObject<T>;

  private readonly agentTool: ReturnType<typeof createTool>;

  constructor(config: X402ToolConfig<T>) {
    super();
    this.name = config.name;
    this.description = config.description;
    this.schema = config.schema;
    this.returnDirect = config.returnDirect ?? false;

    const inputSchema = zodObjectToJsonSchema(config.schema);

    this.agentTool = createTool({
      name: config.name,
      description: config.description,
      inputSchema,
      endpoint: config.endpoint,
      method: config.method,
      fetchOptions: config.fetchOptions,
    });
  }

  async _call(input: z.infer<ZodObject<T>>): Promise<string> {
    const result = await this.agentTool.invoke(input as Record<string, unknown>);
    if (!result.ok) {
      throw new ToolInputParsingException(
        `x402 tool "${this.name}" failed: HTTP ${result.status} — ${JSON.stringify(result.data)}`,
      );
    }
    return JSON.stringify(result.data);
  }
}

export function createX402Tools(configs: X402ToolConfig[]): X402Tool[] {
  return configs.map((c) => new X402Tool(c));
}
