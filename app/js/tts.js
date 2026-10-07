// 본문 읽어 주기: 브라우저에 들어 있는 음성 합성(Web Speech API)을 쓴다. 외부 API를 부르지 않는다.
// 한 절(긴 절은 문장)씩 읽으며, 지금 읽는 위치를 알려 주어 화면에서 강조할 수 있게 한다.

export const RATES = [0.8, 1, 1.2, 1.5];

const globalSynth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

export const ttsSupported = () => !!globalSynth && typeof SpeechSynthesisUtterance !== 'undefined';

export function koreanVoices(synth = globalSynth) {
  return (synth?.getVoices() ?? []).filter((v) => /^ko/i.test(v.lang));
}

/** 고른 목소리. 없으면 기기 안에서 도는(인터넷이 필요 없는) 한국어 목소리, 그것도 없으면 아무 한국어 목소리 */
export function pickVoice(uri, synth = globalSynth) {
  const ko = koreanVoices(synth);
  return ko.find((v) => v.voiceURI === uri) ?? ko.find((v) => v.localService) ?? ko[0] ?? null;
}

/** 목소리 목록은 늦게 채워지는 브라우저가 있어(크롬) 잠깐 기다린다. */
export function voicesReady(synth = globalSynth) {
  if (!synth) return Promise.resolve([]);
  if (synth.getVoices().length) return Promise.resolve(synth.getVoices());
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener?.('voiceschanged', done);
      resolve(synth.getVoices());
    };
    synth.addEventListener?.('voiceschanged', done);
    setTimeout(done, 1500);
  });
}

/**
 * 긴 절은 문장 단위로 나눈다. (크롬은 한 번에 너무 길게 읽으면 도중에 멈추는 일이 있다)
 * 문장이 그래도 길면 쉼표에서 한 번 더 나눈다.
 */
export function speechChunks(text, max = 140) {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.?!]+[.?!]+["'”’)\]]*\s*|[^.?!]+$/g) ?? [text];
  const out = [];
  for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
    if (s.length <= max) {
      out.push(s);
      continue;
    }
    let cur = '';
    for (const part of s.split(/(?<=,)\s+/)) {
      if (cur && (cur + ' ' + part).length > max) {
        out.push(cur);
        cur = part;
      } else {
        cur = cur ? `${cur} ${part}` : part;
      }
    }
    if (cur) out.push(cur);
  }
  // 아주 짧은 조각은 앞 조각에 붙인다
  return out.reduce((acc, s) => {
    if (acc.length && s.length < 12) acc[acc.length - 1] += ` ${s}`;
    else acc.push(s);
    return acc;
  }, []);
}

/**
 * 읽어 주기 플레이어.
 *   items: [{text, key}] 읽을 차례대로. key는 같은 절의 조각끼리 같고, 장 제목처럼 절이 아닌 것은 null.
 *   on.index(item, i): 읽기 시작할 때, on.state(playing): 재생/멈춤이 바뀔 때, on.end(): 끝까지 읽었을 때,
 *   on.error(code): 읽을 수 없을 때
 */
export function createPlayer(synth = globalSynth, Utterance = globalThis.SpeechSynthesisUtterance) {
  let items = [];
  let index = 0;
  let playing = false;
  let token = 0; // 취소된 발화의 끝 알림을 무시하기 위한 번호
  let rate = 1;
  let voice = null;
  let on = {};
  let wakeLock = null;
  let unlocked = false;
  // 읽고 있는 발화. 참조가 없으면 브라우저가 발화 객체를 치워 끝 알림(onend)이 오지 않는 일이 있다.
  let current = null;

  // 듣는 동안 화면이 꺼지지 않게 한다. (지원하지 않으면 그냥 넘어간다)
  const keepAwake = async () => {
    try {
      wakeLock ??= await navigator.wakeLock?.request('screen');
    } catch {
      wakeLock = null;
    }
  };
  const letSleep = () => {
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
  };

  const setPlaying = (v) => {
    if (playing === v) return;
    playing = v;
    if (v) keepAwake();
    else letSleep();
    on.state?.(v);
  };

  const speak = (i) => {
    if (i >= items.length) {
      setPlaying(false);
      index = 0;
      on.end?.();
      return;
    }
    index = i;
    on.index?.(items[i], i);
    const my = ++token;
    const u = new Utterance(items[i].text);
    u.lang = 'ko-KR';
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = () => {
      if (my === token && playing) speak(i + 1);
    };
    u.onerror = (e) => {
      if (my !== token || e.error === 'interrupted' || e.error === 'canceled') return;
      setPlaying(false);
      on.error?.(e.error);
    };
    if (synth.paused) synth.resume();
    current = u;
    synth.speak(u);
  };

  /** 지금 읽던 것을 끊고 i부터 다시 읽는다. (끊은 직후 바로 읽으면 무시하는 브라우저가 있어 잠깐 쉰다) */
  const restart = (i) => {
    token++;
    synth.cancel();
    setPlaying(true);
    const my = token;
    setTimeout(() => {
      if (my === token && playing) speak(i);
    }, 60);
  };

  /** i가 속한 절의 첫 조각 */
  const verseStart = (i) => {
    while (i > 0 && items[i].key != null && items[i - 1].key === items[i].key) i--;
    return i;
  };

  return {
    get playing() {
      return playing;
    },
    get index() {
      return index;
    },
    get items() {
      return items;
    },
    /**
     * 사파리(특히 iOS)는 페이지에서 처음 읽기를 사용자가 누른 그 순간(클릭 처리 안)에 시작해야 허용한다.
     * 버튼을 누르자마자 이것을 먼저 불러, 소리 없는 빈 발화로 읽기를 허용받아 둔다.
     * 그러면 목소리를 기다리거나 잠깐 쉬었다가 읽어도 막히지 않는다. (크롬에서는 아무 영향이 없다)
     */
    unlock() {
      if (unlocked || !synth) return;
      unlocked = true;
      try {
        const u = new Utterance(' ');
        u.lang = 'ko-KR';
        u.volume = 0;
        synth.speak(u);
      } catch {
        unlocked = false;
      }
    },
    /** 읽을 목록을 바꾼다 (멈춘 상태로 처음부터) */
    load(list, handlers = {}) {
      this.pause();
      items = list;
      index = 0;
      on = handlers;
    },
    setVoice(v) {
      voice = v;
    },
    setRate(r) {
      rate = r;
      if (playing) restart(verseStart(index));
    },
    play(from = index) {
      if (!items.length) return;
      restart(Math.max(0, Math.min(from, items.length - 1)));
    },
    pause() {
      token++;
      synth?.cancel();
      current = null;
      setPlaying(false);
    },
    toggle() {
      if (playing) this.pause();
      else this.play(verseStart(index));
    },
    /** 다음 절로 */
    next() {
      let i = index;
      const key = items[i]?.key;
      while (i < items.length && key != null && items[i].key === key) i++;
      if (key == null) i++;
      if (i >= items.length) return;
      if (playing) restart(i);
      else {
        index = i;
        on.index?.(items[i], i);
      }
    },
    /** 이전 절로 (절 중간이면 그 절 처음으로) */
    prev() {
      let i = verseStart(index);
      if (i === index || !playing) i = verseStart(Math.max(0, i - 1));
      if (playing) restart(i);
      else {
        index = i;
        on.index?.(items[i], i);
      }
    },
    /** 읽기를 멈추고 목록과 알림을 비운다 (화면을 떠날 때) */
    stop() {
      this.pause();
      items = [];
      index = 0;
      on = {};
    },
  };
}

/** 앱 전체에서 하나만 쓴다 */
export const player = ttsSupported() ? createPlayer() : null;
