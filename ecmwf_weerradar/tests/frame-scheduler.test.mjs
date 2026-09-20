import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameScheduler, visibleTimeout} from '../frame-scheduler.mjs';

const stub = ({hidden = false, watchdogMs = 120} = {}) => {
  const frames = new Map(), timers = new Map();
  let frameId = 0, timerId = 0;
  const scheduler = createFrameScheduler({
    hidden: () => hidden,
    raf: fn => { frames.set(++frameId, fn); return frameId; },
    caf: id => frames.delete(id),
    timer: (fn, ms) => { timers.set(++timerId, {fn, ms}); return timerId; },
    clear: id => timers.delete(id),
    watchdogMs,
  });
  return {scheduler, frames, timers};
};

test('a visible page paints on the animation frame and cancels its watchdog', () => {
  const {scheduler, frames, timers} = stub();
  let painted = 0;
  scheduler.schedule(() => painted++);
  assert.equal(frames.size, 1);
  assert.equal([...timers.values()][0].ms, 120);
  frames.values().next().value();
  assert.equal(painted, 1);
  assert.equal(timers.size, 0, 'de reservetimer blijft niet staan');
  assert.equal(frames.size, 0);
});

test('an occluded window that never repaints still finishes through the watchdog, once', () => {
  const {scheduler, frames, timers} = stub();
  let painted = 0;
  scheduler.schedule(() => painted++);
  timers.values().next().value.fn();
  assert.equal(painted, 1);
  assert.equal(frames.size, 0, 'de achterhaalde animatieframe is opgezegd');
});

test('a hidden tab does not wait for an animation frame at all', async () => {
  const {scheduler, frames} = stub({hidden: true});
  let painted = 0;
  scheduler.schedule(() => painted++);
  assert.equal(frames.size, 0, 'een verborgen tabblad krijgt geen animatieframe');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(painted, 1);
});

test('cancelling before the frame keeps the work from running', () => {
  const {scheduler, frames, timers} = stub();
  let painted = 0;
  const handle = scheduler.schedule(() => painted++);
  scheduler.cancel(handle);
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(painted, 0);
});

test('a hidden page keeps every scheduled commit, in order', async () => {
  const order = [];
  const channelScheduler = createFrameScheduler({hidden: () => true, raf: null, caf: null});
  for (const name of ['a', 'b', 'c']) channelScheduler.schedule(() => order.push(name));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('a load deadline ignores the seconds a tab spends in the background', () => {
  let clock = 0, hidden = false, fired = 0;
  const timers = [];
  const stop = visibleTimeout(1000, () => fired++, {
    hidden: () => hidden, now: () => clock,
    timer: fn => { timers.push(fn); return timers.length; }, clear: () => {}, step: 200,
  });
  const advance = ms => { clock += ms; timers.pop()(); };
  hidden = true;
  for (let i = 0; i < 50; i++) advance(1000);
  assert.equal(fired, 0, 'tien seconden verborgen tellen niet mee');
  hidden = false;
  for (let i = 0; i < 4; i++) advance(200);
  assert.equal(fired, 0);
  advance(300);
  assert.equal(fired, 1, 'na een seconde zichtbaar wachten volgt de melding wel');
  stop();
});
