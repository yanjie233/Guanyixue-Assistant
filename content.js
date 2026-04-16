(function() {
    'use strict';
// ... 其余逻辑保持不变 ...
    const HOME_URL = 'https://study.dgjy.net/#/personal/index';
    const HOME_HASH = '#/personal/index';
    const LAST_FINISH_TS_KEY = 'helper-last-finish-ts';
    const LAST_SELECT_TS_KEY = 'helper-last-select-ts';
    const API_CACHE_TS_KEY = 'helper-api-cache-ts';
    const API_TARGET_NAME_KEY = 'helper-api-target-name';
    const API_TARGET_RAW_KEY = 'helper-api-target-raw';
    const PROGRESS_API = '/mod/student/study/list/progress';
    const CURRENT_INFO_API = '/mod/student/currentInfo';
    const NO_VIDEO_STALL_START_KEY = 'helper-no-video-stall-start';
    const NO_VIDEO_TIMEOUT_MS = 60000;
    const COURSE_FINISH_WAIT_START_KEY = 'helper-course-finish-wait-start';
    const COURSE_FINISH_WAIT_MS = 60000;

    let isSelectingCourse = false;

    // --- 1. UI 注入部分 ---
    function createStatusPanel() {
        if (document.getElementById('helper-ui-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'helper-ui-panel';
        panel.style = `
            position: fixed; top: 10px; right: 10px; width: 220px;
            background: rgba(0, 0, 0, 0.7); color: #fff; z-index: 2147483647;
            padding: 10px; border-radius: 8px; font-family: Arial, sans-serif;
            font-size: 13px; pointer-events: none; box-shadow: 0 0 10px rgba(0,0,0,0.5);
        `;
        panel.innerHTML = `
            <div style="font-weight:bold; color:#4CAF50; margin-bottom:5px; border-bottom:1px solid #555;">🚀 莞易学助手运行中</div>
            <div>当前状态: <span id="helper-status">扫描视频...</span></div>
            <div>当前倍速: <span id="helper-speed">1.0x</span></div>
            <div>剩余时间: <span id="helper-time">--:--</span></div>
            <div>预估时长: <span id="helper-estimate">--:--</span></div>
            <div id="helper-log" style="font-size:11px; color:#aaa; margin-top:5px; height:40px; overflow:hidden;">等待视频加载...</div>
        `;
        document.body.appendChild(panel);
    }

    function formatSeconds(seconds) {
        const total = Math.max(0, Math.ceil(Number(seconds) || 0));
        return `${String(total).padStart(2, '0')}秒`;
    }

    function updateUI(status, speed, timeLeft) {
        const s = document.getElementById('helper-status');
        const sp = document.getElementById('helper-speed');
        const t = document.getElementById('helper-time');
        const e = document.getElementById('helper-estimate');
        const l = document.getElementById('helper-log');
        if (s) s.innerText = status;
        if (sp) sp.innerText = speed + "x";
        if (t) t.innerText = timeLeft > 0 ? Math.round(timeLeft) + "秒" : "已结束";
        if (e) {
            const speedNum = Math.max(0.1, Number(speed) || 1);
            const estimateSeconds = timeLeft > 0 ? timeLeft / speedNum : 0;
            e.innerText = estimateSeconds > 0 ? formatSeconds(estimateSeconds) : "已结束";
        }
    }

    function addLog(msg) {
        const l = document.getElementById('helper-log');
        if (l) l.innerText = msg;
    }

    function isHomePage() {
        return location.hash.includes('/personal/index') || location.href.startsWith(HOME_URL);
    }

    function goHome() {
        if (!isHomePage()) {
            location.hash = HOME_HASH;
            return true;
        }
        return false;
    }

    function getText(el) {
        return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function clickElement(el) {
        if (!el) return false;
        try {
            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return true;
        } catch (_) {
            return false;
        }
    }

    function getNearestCard(el) {
        if (!el) return null;
        const matched = el.closest('[class*="course"], [class*="subject"], [class*="item"], .el-card, li, tr, .list-item, .cell');
        if (matched) return matched;

        let current = el;
        for (let i = 0; i < 8 && current; i += 1) {
            if (current.querySelector && current.querySelector('button, a, [role="button"], .el-button')) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    function findActionInCard(card) {
        if (!card) return null;
        const actionRegex = /学习|进入|继续|开始/;
        const candidates = Array.from(card.querySelectorAll('button, a, [role="button"], .el-button, [class*="btn"], [class*="button"]'))
            .filter(isVisible)
            .filter(el => actionRegex.test(getText(el)));

        if (candidates.length > 0) {
            return candidates[0];
        }

        if (card && isVisible(card)) {
            return card;
        }

        return null;
    }

    function normalizeCourseName(text) {
        return String(text || '')
            .replace(/[（(][^）)]*[）)]/g, '')
            .replace(/\s+/g, '')
            .trim();
    }

    function pickTargetCourseFromProgressList(list) {
        if (!Array.isArray(list) || list.length === 0) return null;

        const normalized = list
            .map(item => ({
                name: String(item?.kcmc || '').trim(),
                progress: Number(item?.progress),
                mocId: String(item?.mocId || ''),
                mocctId: String(item?.mocctId || '')
            }))
            .filter(item => item.name && !Number.isNaN(item.progress));

        const notStarted = normalized.find(item => item.progress === 0);
        if (notStarted) return notStarted;

        const inProgress = normalized.find(item => item.progress > 0 && item.progress < 100);
        if (inProgress) return inProgress;

        return null;
    }

    async function fetchTargetCourseFromApi() {
        const cacheTs = Number(localStorage.getItem(API_CACHE_TS_KEY) || 0);
        const cachedName = localStorage.getItem(API_TARGET_NAME_KEY) || '';
        const cachedRaw = localStorage.getItem(API_TARGET_RAW_KEY) || '';

        if (Date.now() - cacheTs < 8000 && cachedRaw) {
            try {
                const parsed = JSON.parse(cachedRaw);
                if (parsed?.name) return parsed;
            } catch (_) {}
        }

        if (Date.now() - cacheTs < 8000 && cachedName) {
            return { name: cachedName, progress: 0, mocId: '', mocctId: '' };
        }

        const url = `${new URL(PROGRESS_API, location.origin).href}?_t=${Date.now()}`;
        const resp = await fetch(url, {
            method: 'GET',
            credentials: 'include'
        });
        if (!resp.ok) {
            throw new Error(`progress api failed: ${resp.status}`);
        }

        const data = await resp.json();
        const target = pickTargetCourseFromProgressList(data?.result || []);

        if (target?.name) {
            localStorage.setItem(API_TARGET_NAME_KEY, target.name);
            localStorage.setItem(API_TARGET_RAW_KEY, JSON.stringify(target));
            localStorage.setItem(API_CACHE_TS_KEY, String(Date.now()));
            return target;
        }

        localStorage.removeItem(API_TARGET_NAME_KEY);
        localStorage.removeItem(API_TARGET_RAW_KEY);
        localStorage.setItem(API_CACHE_TS_KEY, String(Date.now()));
        return null;
    }

    async function fetchStudyTimeFromApi() {
        const url = new URL(CURRENT_INFO_API, location.origin);
        url.searchParams.set('_t', String(Date.now()));

        const resp = await fetch(url.href, {
            method: 'GET',
            credentials: 'include'
        });

        if (!resp.ok) {
            throw new Error(`currentInfo api failed: ${resp.status}`);
        }

        const payload = await resp.json();
        const result = payload?.result || payload?.data || payload || {};
        const studyTime = result?.studyTime ?? payload?.studyTime ?? null;

        return {
            studyTime,
            payload: result
        };
    }

    function findActionByCourseTarget(target) {
        if (!target?.name) return null;

        const courseName = target.name;
        const normalizedTargetName = normalizeCourseName(courseName);
        if (!normalizedTargetName || normalizedTargetName.length < 2) return null;
        const targetMocId = String(target.mocId || '');
        const targetMocctId = String(target.mocctId || '');

        const cards = Array.from(document.querySelectorAll('[class*="course"], [class*="subject"], [class*="item"], .el-card, li, tr, .list-item, .cell'))
            .filter(isVisible)
            .slice(0, 400);

        for (const card of cards) {
            const cardText = getText(card);
            const normalizedCardText = normalizeCourseName(cardText);
            const html = String(card.innerHTML || '');
            const href = String(card.getAttribute('href') || '');
            const datasetText = Object.values(card.dataset || {}).join(' ');
            const combined = `${html} ${href} ${datasetText}`;

            const nameMatched = normalizedCardText.includes(normalizedTargetName) || (normalizedCardText.length >= 2 && normalizedTargetName.includes(normalizedCardText));
            const idMatched = (targetMocId && combined.includes(targetMocId)) || (targetMocctId && combined.includes(targetMocctId));

            if (nameMatched || idMatched) {
                const action = findActionInCard(card);
                if (action) return action;
            }
        }

        const textNodes = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, span, p, div, li, strong, em, a'))
            .filter(isVisible)
            .filter(el => {
                const nodeText = normalizeCourseName(getText(el));
                return nodeText.includes(normalizedTargetName) || (nodeText.length >= 2 && normalizedTargetName.includes(nodeText));
            })
            .slice(0, 300);

        for (const node of textNodes) {
            const card = getNearestCard(node);
            const action = findActionInCard(card);
            if (action) {
                return action;
            }
        }

        return null;
    }

    function findFirstUnlearnedAction() {
        const actionRegex = /去学习|开始学习|继续学习|进入学习/;
        const notStartedRegex = /^未开始学习$/;
        const inProgressRegex = /^正在学习$/;
        const completedRegex = /^已学习完$/;

        const notStartedSoftRegex = /未开始学习/;
        const inProgressSoftRegex = /正在学习/;
        const completedSoftRegex = /已学习完/;

        const matchesNotStarted = (text) => notStartedRegex.test(text) || notStartedSoftRegex.test(text);
        const matchesInProgress = (text) => inProgressRegex.test(text) || inProgressSoftRegex.test(text);
        const matchesCompleted = (text) => completedRegex.test(text) || completedSoftRegex.test(text);

        const directActions = Array.from(document.querySelectorAll('button, a, [role="button"], .el-button'))
            .filter(isVisible)
            .filter(el => actionRegex.test(getText(el)));

        const stateNodes = Array.from(document.querySelectorAll('span, p, div, li, strong, em'))
            .filter(isVisible)
            .filter(el => {
                const text = getText(el);
                return matchesNotStarted(text) || matchesInProgress(text) || matchesCompleted(text);
            })
            .slice(0, 300);

        let inProgressCandidate = null;

        for (const node of stateNodes) {
            const text = getText(node);
            if (matchesCompleted(text)) continue;
            const card = getNearestCard(node);
            const action = findActionInCard(card);
            if (!action) continue;
            if (matchesNotStarted(text)) return action;
            if (!inProgressCandidate && matchesInProgress(text)) {
                inProgressCandidate = action;
            }
        }

        for (const action of directActions) {
            const card = getNearestCard(action);
            const cardText = getText(card || action);
            if (matchesCompleted(cardText)) {
                continue;
            }
            if (matchesNotStarted(cardText)) {
                return action;
            }
            if (!inProgressCandidate && matchesInProgress(cardText)) {
                inProgressCandidate = action;
            }
        }

        const fallback = directActions.find(el => /去学习|未开始学习/.test(getText(el)));
        return inProgressCandidate || fallback || null;
    }

    async function trySelectUnlearnedSubject() {
        if (!isHomePage()) return;
        if (isSelectingCourse) return;

        isSelectingCourse = true;

        try {
            const lastTs = Number(localStorage.getItem(LAST_SELECT_TS_KEY) || 0);
            if (Date.now() - lastTs < 3000) return;

            let action = null;
            let targetCourseName = '';

            try {
                const target = await fetchTargetCourseFromApi();
                targetCourseName = target?.name || '';
                if (targetCourseName) {
                    action = findActionByCourseTarget(target);
                }
            } catch (err) {
                addLog('进度接口失败，启用页面兜底');
            }

            if (!action) {
                action = findFirstUnlearnedAction();
            }

            if (!action) {
                updateUI('首页待命中', '1.0', 0);
                addLog('未找到可学习科目，继续扫描...');
                return;
            }

            localStorage.setItem(LAST_SELECT_TS_KEY, String(Date.now()));
            updateUI('进入未学习科目', '1.0', 0);
            addLog(targetCourseName ? `按进度选择: ${targetCourseName}` : '已选择未学习科目，准备进入...');
            clickElement(action);
        } finally {
            isSelectingCourse = false;
        }
    }

    function handleCourseFinished() {
        let waitStart = Number(sessionStorage.getItem(COURSE_FINISH_WAIT_START_KEY) || 0);
        if (!waitStart) {
            waitStart = Date.now();
            sessionStorage.setItem(COURSE_FINISH_WAIT_START_KEY, String(waitStart));
        }

        const elapsed = Date.now() - waitStart;
        const remainingSec = Math.max(0, Math.ceil((COURSE_FINISH_WAIT_MS - elapsed) / 1000));

        updateUI('课程结束，等待新内容', '1.0', remainingSec);
        addLog('视频结束后60秒无新内容将自动返回首页');

        if (elapsed < COURSE_FINISH_WAIT_MS) return;

        const lastTs = Number(localStorage.getItem(LAST_FINISH_TS_KEY) || 0);
        if (Date.now() - lastTs < 5000) return;

        localStorage.setItem(LAST_FINISH_TS_KEY, String(Date.now()));
        sessionStorage.setItem(COURSE_FINISH_WAIT_START_KEY, String(Date.now()));
        updateUI('课程完成，返回首页', '1.0', 0);
        addLog('等待60秒仍无新内容，正在返回首页...');
        goHome();
    }

    function clearNoVideoWatchState() {
        sessionStorage.removeItem(NO_VIDEO_STALL_START_KEY);
    }

    function clearCourseFinishedWaitState() {
        sessionStorage.removeItem(COURSE_FINISH_WAIT_START_KEY);
    }

    function handleNoVideoDetected() {
        const finishWaitStart = Number(sessionStorage.getItem(COURSE_FINISH_WAIT_START_KEY) || 0);
        if (finishWaitStart) {
            const elapsedFromFinish = Date.now() - finishWaitStart;
            const remainingAfterFinishSec = Math.max(0, Math.ceil((COURSE_FINISH_WAIT_MS - elapsedFromFinish) / 1000));

            updateUI('课程结束，等待新内容', '1.0', remainingAfterFinishSec);
            addLog('视频结束后60秒无新内容将自动返回首页');

            if (elapsedFromFinish < COURSE_FINISH_WAIT_MS) return;

            const lastTs = Number(localStorage.getItem(LAST_FINISH_TS_KEY) || 0);
            if (Date.now() - lastTs < 5000) return;

            localStorage.setItem(LAST_FINISH_TS_KEY, String(Date.now()));
            sessionStorage.setItem(COURSE_FINISH_WAIT_START_KEY, String(Date.now()));
            updateUI('无新内容，返回首页', '1.0', 0);
            addLog('视频结束后60秒仍无新内容，正在返回首页...');
            goHome();
            return;
        }

        let stallStart = Number(sessionStorage.getItem(NO_VIDEO_STALL_START_KEY) || 0);
        if (!stallStart) {
            stallStart = Date.now();
            sessionStorage.setItem(NO_VIDEO_STALL_START_KEY, String(stallStart));
        }

        const elapsed = Date.now() - stallStart;
        const remainingSec = Math.max(0, Math.ceil((NO_VIDEO_TIMEOUT_MS - elapsed) / 1000));

        updateUI('等待视频加载', '1.0', remainingSec);
        addLog('60秒无新视频将自动返回首页');

        if (elapsed < NO_VIDEO_TIMEOUT_MS) return;

        sessionStorage.setItem(NO_VIDEO_STALL_START_KEY, String(Date.now()));
        updateUI('无视频超时，返回首页', '1.0', 0);
        addLog('60秒无新视频，正在返回首页...');
        goHome();
    }

    // --- 2. 核心逻辑部分 ---
    const bypassVisibility = () => {
        window.onblur = null;
        try {
            Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
            Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
        } catch (e) {
            // ignore
        }
    };

    setInterval(() => {
        createStatusPanel(); // 确保面板存在
        const video = document.querySelector('video');
        
        if (!video || isNaN(video.duration) || video.duration === 0) {
            handleNoVideoDetected();
            return;
        }

        clearNoVideoWatchState();

        video.muted = true; // 自动静音

        const timeLeft = video.duration - video.currentTime;

        if (video.ended || timeLeft <= 0.5) {
            handleCourseFinished();
            return;
        }

        clearCourseFinishedWaitState();

        // 核心倍速控制逻辑
        if (timeLeft > 0 && timeLeft <= 25) {
            // 临近终点降速逻辑
            if (video.playbackRate !== 1.0) {
                video.playbackRate = 1.0;
                addLog("by github：yanjie233·莞易学助手");
            }
            updateUI("等待视频结束...", "1.0", timeLeft);
        } else if (timeLeft > 25) {
            // 高速冲刺逻辑
            if (video.playbackRate !== 16.0) {
                video.playbackRate = 16.0;
                addLog("by github：yanjie233·莞易学助手");
            }
            updateUI("冲刺中...", "16.0", timeLeft);
        }

        // 强制保持播放状态
        if (video.paused && !video.ended && timeLeft > 1) {
            video.play().catch(() => {});
        }
    }, 1000);

    setInterval(() => {
        trySelectUnlearnedSubject().catch(() => {});
    }, 2000);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message?.type !== 'GYX_GET_STUDY_TIME') {
                return false;
            }

            fetchStudyTimeFromApi()
                .then(({ studyTime }) => {
                    sendResponse({ ok: true, studyTime });
                })
                .catch((error) => {
                    sendResponse({
                        ok: false,
                        error: error?.message || '获取 studyTime 失败'
                    });
                });

            return true;
        });
    }

    bypassVisibility();
})();