import type { FastifyRequest, FastifyReply } from 'fastify';

interface WeatherResponse {
  city: string;
  temp: number;
  condition: string;
  humidity: number;
}

interface PriceResponse {
  symbol: string;
  price: number;
  change24h: number;
  volume: number;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function randomCondition(): string {
  const conditions = ['Sunny', 'Cloudy', 'Rainy', 'Partly Cloudy', 'Windy'];
  return conditions[randomInt(0, conditions.length - 1)];
}

function queryParam(request: FastifyRequest, key: string): string | undefined {
  const q = request.query as Record<string, string | undefined>;
  return q[key];
}

export async function weatherHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const city = queryParam(request, 'city') ?? 'London';
  const result: WeatherResponse = {
    city,
    temp: randomInt(15, 35),
    condition: randomCondition(),
    humidity: randomInt(40, 90),
  };
  await reply.send(result);
}

export async function priceHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const symbol = queryParam(request, 'symbol') ?? 'BTC';
  const result: PriceResponse = {
    symbol: symbol.toUpperCase(),
    price: randomFloat(0.01, 100000),
    change24h: randomFloat(-10, 10),
    volume: randomFloat(1e6, 1e9),
  };
  await reply.send(result);
}
