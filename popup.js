const studyTimeEl = document.getElementById('study-time');
const studyTimeFriendlyEl = document.getElementById('study-time-friendly');
const refreshBtn = document.getElementById('refresh');

function formatAsDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function setDisplay(mainText, subText = '') {
  studyTimeEl.textContent = mainText;
  studyTimeFriendlyEl.textContent = subText;
}

async function getStudyTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) return null;
  const [tab] = tabs;
  if (!tab.url || !tab.url.includes('study.dgjy.net')) return null;
  return tab;
}

async function loadStudyTime() {
  setDisplay('加载中...', '');

  try {
    const tab = await getStudyTab();
    if (!tab?.id) {
      setDisplay('未检测到页面', '请先打开 study.dgjy.net');
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GYX_GET_STUDY_TIME' });
    if (!response?.ok) {
      setDisplay('获取失败', response?.error || '无法读取 studyTime');
      return;
    }

    const studyTime = response.studyTime;
    if (studyTime === null || studyTime === undefined || studyTime === '') {
      setDisplay('--', '接口未返回 studyTime');
      return;
    }

    setDisplay(String(studyTime), '');

    const numeric = Number(studyTime);
    if (Number.isFinite(numeric) && numeric >= 0) {
      setDisplay(String(studyTime), `按秒换算：${formatAsDuration(numeric)}`);
    }
  } catch (error) {
    setDisplay('获取失败', error?.message || '请刷新页面后重试');
  }
}

refreshBtn.addEventListener('click', loadStudyTime);
document.addEventListener('DOMContentLoaded', loadStudyTime);
