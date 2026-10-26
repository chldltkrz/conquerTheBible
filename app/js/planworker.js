// 분량 나누기(planner.js)를 화면과 따로 돌리는 Web Worker. plancalc.js가 띄우고 주고받는다.
//   받는 것: {index} (처음 한 번, bible.js의 index.json) · {id, fn, args} → 보내는 것: {id, result} 또는 {id, error}

import { buildGroupPlan, buildParallelPlan, buildPlan } from './planner.js';

const FNS = { buildPlan, buildParallelPlan, buildGroupPlan };
let index = null;

self.onmessage = ({ data }) => {
  if (data.index) {
    index = data.index;
    return;
  }
  const { id, fn, args } = data;
  try {
    self.postMessage({ id, result: FNS[fn](index, ...args) });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
