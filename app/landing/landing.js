// 소개 페이지: 머리 줄 아래 선, "고르게 나누기" 그래프(split.json, scripts/landing.mjs가 만든다).
// 그래프는 두 줄(장 수로 똑같이 나눈 것, 맛있는만나)이 같은 세로 눈금을 쓴다. 누르거나 마우스를 올리면,
// 또는 화살표 키로 날을 옮기면 그날 읽는 곳과 시간을 보여 준다. 자바스크립트가 없으면 숫자와 표만 보인다.

const header = document.querySelector('.top');
const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 4);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

const SVG = 'http://www.w3.org/2000/svg';
const SERIES = ['naive', 'plan'];
const NAMES = { naive: '장 수로', plan: '맛있는만나' };
const GUTTER = 38; // 왼쪽 눈금 글자 자리
const PAD_RIGHT = 6;
const PLOT_H = 84;
const PAD_TOP = 8;

const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const fmt = (m) => `${m.toFixed(1)}분`;

/** 가장 짧은 날·평균·가장 긴 날·10–90% */
function stats(days) {
  const m = days.map((d) => d.m).sort((a, b) => a - b);
  const at = (q) => m[Math.floor(q * (m.length - 1))];
  return { min: m[0], max: m.at(-1), avg: m.reduce((s, x) => s + x, 0) / m.length, p10: at(0.1), p90: at(0.9) };
}

function fillNumbers(data) {
  for (const s of SERIES) {
    const st = stats(data[s]);
    const range = document.querySelector(`[data-stat="${s}-range"]`);
    if (range) range.textContent = `${st.min.toFixed(1)}–${fmt(st.max)}`;
    const cells = document.querySelectorAll(`tr[data-row="${s}"] td`);
    [fmt(st.min), fmt(st.avg), fmt(st.max), `${st.p10.toFixed(1)}–${fmt(st.p90)}`].forEach((t, i) => cells[i] && (cells[i].textContent = t));
  }
}

function chart(root, data) {
  const svgs = Object.fromEntries(SERIES.map((s) => [s, root.querySelector(`svg[data-series="${s}"]`)]));
  const tip = root.querySelector('.chart-tip');
  const n = data.days;
  const yMax = Math.ceil(Math.max(...SERIES.flatMap((s) => data[s].map((d) => d.m))) / 5) * 5;
  let width = 0;
  let current = null; // 보이는 날 (0부터)

  const x = (i) => GUTTER + (i * (width - GUTTER - PAD_RIGHT)) / (n - 1);
  const y = (m) => PAD_TOP + PLOT_H * (1 - m / yMax);

  function draw() {
    width = root.clientWidth;
    for (const s of SERIES) {
      const svg = svgs[s];
      svg.replaceChildren();
      svg.setAttribute('viewBox', `0 0 ${width} ${svg.getAttribute('height')}`);
      for (const t of [0, 10, 20].filter((t) => t <= yMax)) {
        svg.append(el('line', { class: 'grid', x1: GUTTER, x2: width - PAD_RIGHT, y1: y(t), y2: y(t) }));
        const label = el('text', { x: GUTTER - 8, y: y(t) + 4, 'text-anchor': 'end' });
        label.textContent = `${t}분`;
        svg.append(label);
      }
      const pts = data[s].map((d, i) => `${x(i).toFixed(1)},${y(d.m).toFixed(1)}`);
      const color = `var(--series-${s})`;
      svg.append(
        el('path', { d: `M${x(0)},${y(0)}L${pts.join('L')}L${x(n - 1)},${y(0)}Z`, fill: color, 'fill-opacity': 0.1 }),
        el('path', { d: `M${pts.join('L')}`, fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
      );
      if (s === 'plan') {
        // 아래 줄에만 날 눈금 (좁으면 글자가 겹치지 않게 셋만)
        for (const day of width < 480 ? [1, 180, 365] : [1, 100, 200, 300, 365]) {
          const label = el('text', { x: x(day - 1), y: PAD_TOP + PLOT_H + 22, 'text-anchor': day === 1 ? 'start' : day === 365 ? 'end' : 'middle' });
          label.textContent = `${day}일`;
          svg.append(label);
        }
      }
      svg.append(el('line', { class: 'cross', y1: PAD_TOP - 4, y2: PAD_TOP + PLOT_H, visibility: 'hidden' }));
      svg.append(el('circle', { class: 'dot', r: 4, fill: color, visibility: 'hidden' }));
    }
    if (current != null) show(current);
  }

  function show(i) {
    current = Math.max(0, Math.min(n - 1, i));
    for (const s of SERIES) {
      const svg = svgs[s];
      const cross = svg.querySelector('.cross');
      const dot = svg.querySelector('.dot');
      for (const node of [cross, dot]) node.setAttribute('visibility', 'visible');
      cross.setAttribute('x1', x(current));
      cross.setAttribute('x2', x(current));
      dot.setAttribute('cx', x(current));
      dot.setAttribute('cy', y(data[s][current].m));
    }
    tip.replaceChildren();
    const day = document.createElement('p');
    day.className = 'day';
    day.textContent = `${current + 1}일째`;
    tip.append(day);
    for (const s of SERIES) {
      const row = document.createElement('p');
      row.className = 'row';
      row.style.setProperty('--key', `var(--series-${s})`);
      const key = document.createElement('i');
      const what = document.createElement('span');
      what.textContent = `${NAMES[s]} · ${data[s][current].r}`;
      const time = document.createElement('b');
      time.textContent = fmt(data[s][current].m);
      row.append(key, what, time);
      tip.append(row);
    }
    tip.hidden = false;
    // 가리킨 곳 옆에, 넘치면 반대쪽에
    const px = x(current);
    const w = tip.offsetWidth;
    tip.style.left = `${px + 14 + w > width ? Math.max(0, px - 14 - w) : px + 14}px`;
    // SVG 요소에는 offsetTop이 없어 화면 위치로 잰다
    tip.style.top = `${svgs.naive.getBoundingClientRect().top - root.getBoundingClientRect().top + PAD_TOP}px`;
  }

  function hide() {
    current = null;
    tip.hidden = true;
    root.querySelectorAll('.cross, .dot').forEach((node) => node.setAttribute('visibility', 'hidden'));
  }

  const dayAt = (clientX) => Math.round(((clientX - root.getBoundingClientRect().left - GUTTER) / (width - GUTTER - PAD_RIGHT)) * (n - 1));
  root.addEventListener('pointermove', (e) => show(dayAt(e.clientX)));
  root.addEventListener('pointerdown', (e) => show(dayAt(e.clientX)));
  root.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hide());
  root.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (step) show((current ?? (step > 0 ? -1 : n)) + step * (e.shiftKey ? 10 : 1));
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(n - 1);
    else if (e.key === 'Escape') hide();
    else return;
    e.preventDefault();
  });
  root.addEventListener('blur', hide);
  document.addEventListener('pointerdown', (e) => !root.contains(e.target) && hide());

  draw();
  new ResizeObserver(() => root.clientWidth !== width && draw()).observe(root);
}

const root = document.getElementById('split-chart');
if (root) {
  fetch('split.json')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
    .then((data) => {
      fillNumbers(data);
      chart(root, data);
    })
    .catch(() => {
      // 그래프 없이 숫자와 표만 보인다
      root.querySelectorAll('svg').forEach((svg) => svg.remove());
      document.querySelector('.chart-hint')?.remove();
    });
}
