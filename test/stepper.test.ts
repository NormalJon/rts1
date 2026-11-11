import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../src/session/stepper';

describe('fixed stepper', () => {
  it('runs 30 ticks per second however the frames fall', () => {
    for (const frameMs of [1000 / 144, 1000 / 60, 1000 / 24, 7.3]) {
      const stepper = new FixedStepper(30);
      let ticks = 0;
      let elapsed = 0;
      while (elapsed < 10_000) {
        ticks += stepper.advance(frameMs);
        elapsed += frameMs;
      }
      // Ten seconds is 300 ticks, give or take the one that may be in progress.
      expect(Math.abs(ticks - 300), `with ${frameMs.toFixed(1)} ms frames`).toBeLessThanOrEqual(1);
    }
  });

  it('reports how far the display is between two ticks', () => {
    const stepper = new FixedStepper(10); // 100 ms per tick
    expect(stepper.advance(25)).toBe(0);
    expect(stepper.alpha).toBeCloseTo(0.25);
    expect(stepper.advance(50)).toBe(0);
    expect(stepper.alpha).toBeCloseTo(0.75);
    expect(stepper.advance(50)).toBe(1);
    expect(stepper.alpha).toBeCloseTo(0.25);
  });

  it('cuts the backlog after a long stall instead of racing to catch up', () => {
    const stepper = new FixedStepper(30, 5);
    expect(stepper.advance(10_000)).toBe(5);
    expect(stepper.alpha).toBeLessThan(1);
    // The backlog is gone: the next ordinary frame is ordinary again.
    expect(stepper.advance(1000 / 60)).toBeLessThanOrEqual(1);
  });

  it('ignores time running backwards', () => {
    const stepper = new FixedStepper(30);
    expect(stepper.advance(-500)).toBe(0);
    expect(stepper.alpha).toBe(0);
  });
});
