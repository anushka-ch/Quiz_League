console.log("app.js loaded and DOM is ready!");

// ---------- globals ----------
let globalAttemptId = null;
let globalCorrect = 0;
let globalAttempted = 0;
let questionStartTime = 0;
let secondsElapsed = 0;
let timerInterval = null;
let quizMode = "classic";
let analyticsHistory = [];
let lastQuizSettings = null;

let rapidRemainingSeconds = 0;
let rapidInterval = null;

const el = id => document.getElementById(id);

// ===============================
// XP + RANK UI
// ===============================
function updateXPandRank(xp, rank, nextRankXP) {
    const fill = el("xpFill");
    const label = el("rankLabel");

    const percent = nextRankXP ? Math.min(100, (xp / nextRankXP) * 100) : 0;

    if (fill) fill.style.width = percent + "%";
    if (label) label.innerText = rank || "Bronze";
}

// ===============================
// TIMER
// ===============================
function startTimer() {
    stopTimer();
    secondsElapsed = 0;
    timerInterval = setInterval(() => {
        secondsElapsed++;
        updateTimerUI();
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
}

function updateTimerUI() {
    if (!el("timer")) return;
    let mm = String(Math.floor(secondsElapsed / 60)).padStart(2, "0");
    let ss = String(secondsElapsed % 60).padStart(2, "0");
    el("timer").innerText = `${mm}:${ss}`;
}

// ===============================
// RAPID COUNTDOWN
// ===============================
function startRapidCountdown(seconds) {
    stopRapidCountdown();
    rapidRemainingSeconds = seconds;

    el("timer").innerText = `00:${String(rapidRemainingSeconds).padStart(2,"0")}`;

    rapidInterval = setInterval(() => {
        rapidRemainingSeconds--;

        if (rapidRemainingSeconds < 0) {
            stopRapidCountdown();
            finishQuizAndShowAnalytics(true);
            return;
        }

        let mm = "00";
        let ss = String(rapidRemainingSeconds).padStart(2, "0");
        el("timer").innerText = `${mm}:${ss}`;

    }, 1000);
}

function stopRapidCountdown() {
    if (rapidInterval) clearInterval(rapidInterval);
    rapidInterval = null;
}

// ===============================
// BASIC UI HELPERS
// ===============================
function setSubjectUI(s) {
    el("uiSubject").innerText = s === "cpp" ? "C++" : "Data Structures";
}

function setLevelUI(level) {
    el("uiLevel").innerText = level ? level.toUpperCase() : "—";
}

function updateScoreUI() {
    el("uiScore").innerText = globalCorrect * 3;
    el("uiAttempted").innerText = globalAttempted;
    el("uiCorrect").innerText = globalCorrect;
}

function showBackdrop(show) {
    const bd = el("overlayBackdrop");
    if (bd) bd.style.display = show ? "block" : "none";
}

// ===============================
// SHOW QUESTION
// ===============================
function showQuestion(q) {
    questionStartTime = secondsElapsed;

    if (!q) {
        el("qText").innerText = "No question available";
        el("optionsArea").innerHTML = "";
        return;
    }

    el("qText").innerText = q.question;
    el("optionsArea").innerHTML = "";

    q.options.forEach(opt => {
        const btn = document.createElement("button");
        btn.className = "opt-btn";
        btn.innerText = opt;
        btn.onclick = () => submitAnswer(opt);
        el("optionsArea").appendChild(btn);
    });
}

// ===============================
// QUIZ MODE SWITCHING (FIXED)
// ===============================
document.addEventListener("DOMContentLoaded", () => {
    const modeSelect = el("quizMode");
    if (!modeSelect) return;

    modeSelect.onchange = function () {
        quizMode = modeSelect.value;

        if (quizMode === "rapid") {
            el("timeLimitBox").style.display = "block";
            el("questionCountBox").style.display = "none";
        }
        else if (quizMode === "challenge") {
            el("timeLimitBox").style.display = "none";
            el("questionCountBox").style.display = "none";
        }
        else {
            el("timeLimitBox").style.display = "none";
            el("questionCountBox").style.display = "block";
        }
    };
});

// ===============================
// START QUIZ
// ===============================
async function startQuizWithSettings(settings) {
    lastQuizSettings = { ...settings };

    setSubjectUI(settings.subject);
    setLevelUI("medium");

    const res = await fetch("/api/start", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            subject: settings.subject,
            mode: settings.mode,
            settings: {
                questionCount: settings.questionCount,
                rapidTime: settings.rapidTime
            }
        })
    });

    const data = await res.json();

    if (data.error) {
        alert(data.error);
        return;
    }

    globalAttemptId = data.attemptId;
    globalCorrect = 0;
    globalAttempted = 0;
    analyticsHistory = [];

    updateScoreUI();
    el("endQuizBtn").style.display = "block";
    document.querySelector(".question-card").style.display = "block";

    // start timers
    if (settings.mode === "rapid") {
        startRapidCountdown(data.timeLimit);
    } else {
        startTimer();
    }

    showQuestion(data.question);
}

el("start").onclick = () => {
    const subject = el("subject").value;
    const mode = el("quizMode").value;

    const settings = {
        subject,
        mode,
        questionCount: mode === "classic" ? parseInt(el("questionCount").value) : undefined,
        rapidTime: mode === "rapid" ? parseInt(el("rapidTime").value) : undefined
    };

    startQuizWithSettings(settings);
};

// ===============================
// SUBMIT ANSWER
// ===============================
async function submitAnswer(selected) {
    const timeTaken = secondsElapsed - questionStartTime;

    const res = await fetch("/api/answer", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            attemptId: globalAttemptId,
            answer: selected,
            time: timeTaken
        })
    });

    const data = await res.json();

    globalAttempted++;
    if (data.isCorrect) globalCorrect++;

    analyticsHistory = data.history;

    updateScoreUI();
    if (data.newLevel) setLevelUI(data.newLevel);

    // end quiz if nextQuestion null
    if (!data.nextQuestion) {
        finishQuizAndShowAnalytics(false);
        return;
    }

    el("qText").innerHTML = `<strong>${data.isCorrect ? "Correct!" : "Wrong!"}</strong><br>
    Correct Answer: ${data.correctAnswer}<br><br>${data.explanation}`;

    el("optionsArea").innerHTML = "";
    setTimeout(() => showQuestion(data.nextQuestion), 800);
}

// ===============================
// FINISH QUIZ
// ===============================
async function finishQuizAndShowAnalytics() {
    stopTimer();
    stopRapidCountdown();

    const res = await fetch("/api/end", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            attemptId: globalAttemptId,
            totalTime: secondsElapsed
        })
    });

    const data = await res.json();

    analyticsHistory = data.history;

    showAnalyticsPanel(data);

    document.querySelector(".question-card").style.display = "none";
    el("endQuizBtn").style.display = "none";

    loadLeaderboard(); // update leaderboard after quiz
}

el("endQuizBtn").onclick = () => finishQuizAndShowAnalytics(false);

// ===============================
// LEADERBOARD (FIXED)
// ===============================
async function loadLeaderboard() {
    const res = await fetch("/api/leaderboard");
    const data = await res.json();
    const board = el("weeklyBoard");

    board.innerHTML = "";

    data.forEach((p, i) => {
        const li = document.createElement("li");
        li.textContent = `#${i+1} — ${p.username} (${p.score || 0}) • ${p.mode}`;
        board.appendChild(li);
    });
}

loadLeaderboard();
setInterval(loadLeaderboard, 30000);

// ===============================
// ANALYTICS PANEL
// ===============================
function showAnalyticsPanel(endData) {
    showBackdrop(true);
    const box = el("analyticsBox");
    const summary = el("analyticsSummary");
    const list = el("analyticsList");

    box.style.display = "block";

    const total = analyticsHistory.length;
    const correct = analyticsHistory.filter(h => h.correct).length;
    const avgTime = Math.round(
        analyticsHistory.reduce((sum,h)=>sum+(h.time||0),0) / (total || 1)
    );

    summary.innerHTML = `
        <strong>Score:</strong> ${endData.score}<br>
        <strong>Correct:</strong> ${correct}/${total} |
        <strong>Accuracy:</strong> ${endData.accuracy}% |
        <strong>Avg Time:</strong> ${avgTime} sec
    `;

    list.innerHTML = analyticsHistory.map(h => `
        <div style="margin:10px 0;padding:12px;border-left:4px solid ${h.correct ? '#4CAF50' : '#FF4D4D'};background:#faf9ff;border-radius:8px;">
          <div><strong>${h.question}</strong></div>
          <div>Your: ${h.selected} &nbsp;&nbsp; Correct: ${h.correctAnswer}</div>
          <small>Difficulty: ${h.difficulty} | Time: ${h.time}s</small>
        </div>
    `).join("");

    wireAnalyticsButtons();
}

function wireAnalyticsButtons() {
    el("analyticsCloseBtn").onclick = () => {
        el("analyticsBox").style.display = "none";
        showBackdrop(false);
        window.location.reload();
    };

    el("analyticsPlayAgainBtn").onclick = () => {
        el("analyticsBox").style.display = "none";
        showBackdrop(false);
        startQuizWithSettings(lastQuizSettings);
    };

    el("analyticsHomeBtn").onclick = () => {
        window.location.href = "/";
    };
}

// init XP UI
fetch("/api/userinfo")
.then(r=>r.json())
.then(info => updateXPandRank(info.xp, info.rank, info.nextRankXP))
.catch(()=>{});

// end init
updateScoreUI();
setLevelUI(null);
