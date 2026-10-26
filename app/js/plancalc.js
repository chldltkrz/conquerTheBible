// 분량 나누기를 화면이 멈추지 않게 돌린다. 성경 전체를 1년에 나누면 휴대폰에서 몇 초 걸리므로 Web Worker(planworker.js)에서
// 계산하고, 그동안 화면은 "나누는 중"을 보여 준다. Worker를 쓸 수 없으면(Node 테스트, 오래된 브라우저) 그 자리에서 계산한다.
// 이 모듈은 Node 테스트에서도 import되므로 최상위에서 window를 직접 쓰지 않는다.

import { getIndex } from './bible.js';
import { buildGroupPlan, buildParallelPlan, buildPlan } from './planner.js';

const FNS = { buildPlan, buildParallelPlan, buildGroupPlan };

let worker = null;
let broken = false; // Worker를 띄우지 못했거나 죽었다: 이후로는 그 자리에서 계산한다
let seq = 0;
const waiting = new Map(); // id → {resolve, reject, fn, args}

function startWorker() {
  if (worker || broken) return worker;
  if (typeof Worker === 'undefined') {
    broken = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./planworker.js', import.meta.url), { type: 'module' });
  } catch {
    broken = true;
    return null;
  }
  worker.postMessage({ index: getIndex() });
  worker.onmessage = ({ data }) => {
    const job = waiting.get(data.id);
    if (!job) return;
    waiting.delete(data.id);
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(data.result);
  };
  // 모듈 Worker를 모르는 브라우저 등: 기다리던 것은 그 자리에서 계산한다
  worker.onerror = () => {
    broken = true;
    worker = null;
    for (const [id, job] of waiting) {
      waiting.delete(id);
      runHere(job.fn, job.args).then(job.resolve, job.reject);
    }
  };
  return worker;
}

const runHere = async (fn, args) => FNS[fn](getIndex(), ...args);

/**
 * planner.js의 buildPlan · buildParallelPlan · buildGroupPlan을 Worker에서 부른다 (index는 넘기지 않는다).
 * 예: await planInBackground('buildPlan', chapters, days, { splitChapters: true })
 */
export function planInBackground(fn, ...args) {
  const w = startWorker();
  if (!w) return runHere(fn, args);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, fn, args });
    w.postMessage({ id, fn, args });
  });
}
