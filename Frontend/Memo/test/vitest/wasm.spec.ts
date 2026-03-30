import {it, expect, beforeAll} from 'vitest';
import init, {concatenate} from '../../../organizator-wasm/pkg/organizator_wasm';

beforeAll(async () => {
  await init();
});

it('should concatenate strings', () => {
  const result = concatenate("hello", " world");
  expect(result).toBe("hello world");
});