// 설정 화면의 "읽기 알림": 켜고 끄기, 알림 시각, 시험 알림

import {
  disableReminder,
  enableReminder,
  reminderSetting,
  reminderSupport,
  setReminderTime,
  testReminder,
  timeLabel,
} from '../reminder.js';
import { html, josa, toast } from '../ui.js';
import { track } from '../analytics.js';

const SUPPORT_NOTE = {
  install:
    '아이폰·아이패드에서는 Safari의 공유 버튼에서 "홈 화면에 추가"로 앱을 설치한 뒤, 홈 화면의 맛있는만나에서 켤 수 있습니다.',
  denied: '이 브라우저에서 알림이 차단되어 있습니다. 브라우저(또는 기기) 설정에서 이 사이트의 알림을 허용한 뒤 켜 주세요.',
  unsupported: '이 브라우저는 알림을 지원하지 않습니다.',
};

/** 설정 화면에 넣을 "읽기 알림" 칸 */
export function reminderSection() {
  const { on, time } = reminderSetting();
  const support = reminderSupport();
  return html`<section class="block" id="reminder-block">
    <h2 class="block-title">읽기 알림</h2>
    <div class="card">
      <label class="field-row">
        <span>매일 알림 받기</span>
        <input type="checkbox" id="reminder-on" ${on ? 'checked' : ''} ${support !== 'ok' && !on ? 'disabled' : ''} />
      </label>
      <label class="field-row">
        <span>알림 시각</span>
        <input type="time" id="reminder-time" class="select" value="${time}" step="300" required />
      </label>
      <p class="muted small">
        ${on ? html`매일 <span id="reminder-when">${timeLabel(time)}</span>에` : '켜 두면 매일 정한 시각에'} 오늘 분량을 아직 다 읽지 않았으면 이 기기로 알려 드립니다.
        다 읽은 날과 읽을 분량이 없는 날에는 보내지 않습니다.
      </p>
      ${SUPPORT_NOTE[support] ? html`<p class="muted small">${SUPPORT_NOTE[support]}</p>` : ''}
      ${on ? html`<button class="btn btn-ghost btn-sm" data-reminder-action="test">시험 알림 보내기</button>` : ''}
    </div>
  </section>`;
}

const hourOf = (time) => Number(time.slice(0, 2));

/**
 * 설정 화면의 change 이벤트 중 이 칸의 것을 처리한다. 처리했으면 true.
 * 켜기는 알림 허용을 묻는 창을 띄우므로 이벤트 안에서 기다리지 않고 바로 불러야 한다.
 */
export function handleReminderChange(el, rerender) {
  if (el.id === 'reminder-on') {
    toggle(el, rerender);
    return true;
  }
  if (el.id === 'reminder-time') {
    // 컴퓨터에서는 시·분을 하나씩 고칠 때마다 change가 와서, 고치기를 멈춘 뒤에 한 번만 바꾼다
    clearTimeout(timeTimer);
    timeTimer = setTimeout(() => changeTime(el), 1000);
    return true;
  }
  return false;
}

let timeTimer = null;

async function toggle(el, rerender) {
  el.disabled = true;
  const time = document.getElementById('reminder-time')?.value || reminderSetting().time;
  try {
    if (el.checked) {
      await enableReminder(time);
      toast(`매일 ${timeLabel(time)}에 오늘 분량이 남아 있으면 알려 드립니다`);
      track('reminder_enabled', { hour: hourOf(time) });
    } else {
      await disableReminder();
      toast('읽기 알림을 껐습니다');
      track('reminder_disabled');
    }
  } catch (err) {
    toast(err.message);
    track('reminder_enable_failed', { reason: err.code ?? 'error' });
  }
  rerender();
}

/** 다시 그리지 않는다 (시각을 고치는 중에 입력 칸을 놓치지 않도록) */
async function changeTime(el) {
  const time = el.value;
  if (!time || time === reminderSetting().time) {
    if (!time) el.value = reminderSetting().time;
    return;
  }
  try {
    await setReminderTime(time);
    if (reminderSetting().on) {
      const label = timeLabel(time);
      const when = document.getElementById('reminder-when');
      if (when) when.textContent = label;
      toast(`알림 시각을 ${label}${josa(label, '으로', '로')} 바꿨습니다`);
      track('reminder_time_changed', { hour: hourOf(time) });
    }
  } catch (err) {
    toast(err.message);
  }
}

/** 이 칸의 버튼(data-reminder-action)을 처리한다 */
export async function handleReminderAction(action, btn) {
  if (action !== 'test') return;
  btn.disabled = true;
  try {
    await testReminder();
    toast('시험 알림을 보냈습니다. 잠시 뒤 알림이 오는지 확인해 주세요');
    track('reminder_test_sent');
  } catch (err) {
    toast(err.message);
  }
  btn.disabled = false;
}
