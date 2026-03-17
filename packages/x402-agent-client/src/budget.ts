function normalizeDecimal(s: string): string {
  const [intPart = '0', fracPart = ''] = s.split('.');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

function toParts(s: string): [bigint, number] {
  const norm = normalizeDecimal(s);
  const [intPart = '0', fracPart = ''] = norm.split('.');
  const scale = fracPart.length;
  const combined = BigInt(intPart) * 10n ** BigInt(scale) + BigInt(fracPart || '0');
  return [combined, scale];
}

function alignScale(a: string, b: string): [bigint, bigint, number] {
  const [aVal, aScale] = toParts(a);
  const [bVal, bScale] = toParts(b);
  const maxScale = Math.max(aScale, bScale);
  return [
    aVal * 10n ** BigInt(maxScale - aScale),
    bVal * 10n ** BigInt(maxScale - bScale),
    maxScale,
  ];
}

function bigintToDecimal(val: bigint, scale: number): string {
  if (scale === 0) return val.toString();
  const str = val.toString().padStart(scale + 1, '0');
  const intPart = str.slice(0, str.length - scale);
  const fracPart = str.slice(str.length - scale).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

function addDecimal(a: string, b: string): string {
  const [aVal, bVal, scale] = alignScale(a, b);
  return bigintToDecimal(aVal + bVal, scale);
}

function subtractDecimal(a: string, b: string): string {
  const [aVal, bVal, scale] = alignScale(a, b);
  const result = aVal - bVal;
  if (result < 0n) return '0';
  return bigintToDecimal(result, scale);
}

function compareDecimal(a: string, b: string): number {
  const [aVal, bVal] = alignScale(a, b);
  if (aVal < bVal) return -1;
  if (aVal > bVal) return 1;
  return 0;
}

export class BudgetExceededError extends Error {
  readonly requested: string;
  readonly spent: string;
  readonly maxSpend: string;
  readonly remaining: string;

  constructor(details: { requested: string; spent: string; maxSpend: string; remaining: string }) {
    super(
      `Budget exceeded: requested ${details.requested}, remaining ${details.remaining} of ${details.maxSpend} (spent ${details.spent})`,
    );
    this.name = 'BudgetExceededError';
    this.requested = details.requested;
    this.spent = details.spent;
    this.maxSpend = details.maxSpend;
    this.remaining = details.remaining;
  }
}

export interface BudgetTrackerOptions {
  maxSpend: string;
}

export class BudgetTracker {
  private _maxSpend: string;
  private _spent: string;

  constructor(options: BudgetTrackerOptions) {
    this._maxSpend = options.maxSpend;
    this._spent = '0';
  }

  get maxSpend(): string {
    return this._maxSpend;
  }

  get spent(): string {
    return this._spent;
  }

  get remaining(): string {
    return subtractDecimal(this._maxSpend, this._spent);
  }

  reserve(amount: string): void {
    const newSpent = addDecimal(this._spent, amount);
    if (compareDecimal(newSpent, this._maxSpend) > 0) {
      throw new BudgetExceededError({
        requested: amount,
        spent: this._spent,
        maxSpend: this._maxSpend,
        remaining: this.remaining,
      });
    }
    this._spent = newSpent;
  }

  release(amount: string): void {
    this._spent = subtractDecimal(this._spent, amount);
  }

  reset(): void {
    this._spent = '0';
  }
}
