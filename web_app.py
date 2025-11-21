from flask import Flask, render_template, request, jsonify, session, redirect
import uuid
import json
import os
import random
import time

app = Flask(__name__)
app.secret_key = "super-secret-key"

# ===================================================
# DATA PERSISTENCE
# ===================================================

DATA_DIR = "data"
USERS_FILE = os.path.join(DATA_DIR, "users.json")
ATTEMPTS_FILE = os.path.join(DATA_DIR, "attempts.json")
LEADERBOARD_FILE = os.path.join(DATA_DIR, "leaderboard.json")

def load_json(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {}

def save_json(path, data):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)

# Load initial data
users = load_json(USERS_FILE)
attempts = load_json(ATTEMPTS_FILE)

# Leaderboard is now USERNAME → entry
leaderboard = load_json(LEADERBOARD_FILE)


# ===================================================
# RANK SYSTEM
# ===================================================

RANKS = [
    ("Bronze", 0),
    ("Silver", 300),
    ("Gold", 700),
    ("Platinum", 1200),
    ("Diamond", 1800)
]

def calculate_rank(xp):
    current = RANKS[0][0]
    next_needed = 0

    for name, need in RANKS:
        if xp >= need:
            current = name
            next_needed = need

    next_threshold = None
    for name, need in RANKS:
        if need > next_needed:
            next_threshold = need
            break

    return current, next_threshold


# ===================================================
# QUESTION LOADING
# ===================================================

def load_questions(subject, level):
    path = os.path.join("quiz_data", subject, f"{level}.json")
    if not os.path.exists(path):
        return []
    return json.load(open(path, "r", encoding="utf-8"))

def pick_question(subject, level):
    q = load_questions(subject, level)
    return random.choice(q) if q else None

def next_level(cur, correct):
    if cur == "medium":
        return "hard" if correct else "easy"
    if cur == "easy":
        return "medium" if correct else "easy"
    if cur == "hard":
        return "hard" if correct else "medium"
    return "medium"


# ===================================================
# ROUTES
# ===================================================

@app.route("/")
def home():
    if "user" not in session:
        return redirect("/login")
    return render_template("index.html", username=session["user"])

@app.route("/login")
def login_page():
    return render_template("login.html")

@app.route("/signup")
def signup_page():
    return render_template("signup.html")

@app.route("/logout")
def logout():
    session.pop("user", None)
    return redirect("/login")


# ===================================================
# SIGNUP
# ===================================================

@app.post("/api/signup")
def api_signup():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip().lower()

    if not username:
        return jsonify({"error": "Username required"}), 400

    if username in users:
        return jsonify({"error": "User already exists"}), 400

    users[username] = {
        "username": username,
        "xp": 0,
        "rank": "Bronze",
        "attempts": []
    }
    save_json(USERS_FILE, users)

    session["user"] = username
    return jsonify({"ok": True})


# ===================================================
# LOGIN
# ===================================================

@app.post("/login")
def login_submit():
    username = (request.form.get("username") or "").strip().lower()

    if not username:
        return render_template("login.html", error="Username required")

    if username not in users:
        users[username] = {
            "username": username,
            "xp": 0,
            "rank": "Bronze",
            "attempts": []
        }
        save_json(USERS_FILE, users)

    session["user"] = username
    return redirect("/")


# ===================================================
# START QUIZ
# ===================================================

@app.post("/api/start")
def api_start():
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 401

    data = request.get_json() or {}

    subject = data.get("subject")
    mode = data.get("mode", "classic")
    settings = data.get("settings", {}) or {}

    if subject not in ["data_structures", "cpp"]:
        return jsonify({"error": "Invalid subject"}), 400

    if mode == "classic":
        qcount = int(settings.get("questionCount", 5))
        remaining = qcount - 1
        first_q = pick_question(subject, "medium")

    elif mode == "rapid":
        remaining = None
        first_q = pick_question(subject, "medium")

    elif mode == "challenge":
        remaining = 9
        first_q = pick_question(subject, "hard")

    attempt_id = uuid.uuid4().hex

    attempt = {
        "id": attempt_id,
        "user": session["user"],
        "subject": subject,
        "mode": mode,
        "started_at": time.time(),
        "current_level": "hard" if mode == "challenge" else "medium",
        "current_question": first_q,
        "remaining_questions": remaining,
        "time_limit": settings.get("rapidTime") if mode == "rapid" else None,
        "score": 0,
        "completed": False,
        "history": []
    }

    attempts[attempt_id] = attempt
    users[session["user"]]["attempts"].append(attempt_id)

    save_json(USERS_FILE, users)
    save_json(ATTEMPTS_FILE, attempts)

    return jsonify({
        "attemptId": attempt_id,
        "question": first_q,
        "mode": mode,
        "timeLimit": attempt["time_limit"]
    })


# ===================================================
# SUBMIT ANSWER
# ===================================================

@app.post("/api/answer")
def api_answer():
    data = request.get_json() or {}
    attempt_id = data.get("attemptId")
    selected = data.get("answer")
    time_taken = data.get("time", 0)

    attempt = attempts.get(attempt_id)
    if not attempt:
        return jsonify({"error": "Invalid attempt"}), 404

    q = attempt["current_question"]
    correct = (selected == q.get("correct"))

    attempt["history"].append({
        "question": q.get("question"),
        "selected": selected,
        "correct": correct,
        "correctAnswer": q.get("correct"),
        "difficulty": attempt["current_level"],
        "time": time_taken
    })

    if correct:
        attempt["score"] += q.get("points", 0)
        users[attempt["user"]]["xp"] += 10

    xp = users[attempt["user"]]["xp"]
    rank, nextRankXP = calculate_rank(xp)
    users[attempt["user"]]["rank"] = rank

    # End quiz condition
    if attempt["mode"] in ["classic", "challenge"] and attempt["remaining_questions"] <= 0:
        attempt["completed"] = True
        save_json(USERS_FILE, users)
        save_json(ATTEMPTS_FILE, attempts)

        return jsonify({
            "isCorrect": correct,
            "correctAnswer": q.get("correct"),
            "explanation": q.get("explanation"),
            "nextQuestion": None,
            "rank": rank,
            "xp": xp,
            "nextRankXP": nextRankXP,
            "history": attempt["history"]
        })

    # Next question
    subject = attempt["subject"]

    if attempt["mode"] == "challenge":
        next_q = pick_question(subject, "hard")
        attempt["current_level"] = "hard"
        attempt["remaining_questions"] -= 1

    elif attempt["mode"] == "classic":
        new = next_level(attempt["current_level"], correct)
        next_q = pick_question(subject, new)
        attempt["current_level"] = new
        attempt["remaining_questions"] -= 1

    elif attempt["mode"] == "rapid":
        new = next_level(attempt["current_level"], correct)
        next_q = pick_question(subject, new)
        attempt["current_level"] = new

    attempt["current_question"] = next_q

    save_json(USERS_FILE, users)
    save_json(ATTEMPTS_FILE, attempts)

    return jsonify({
        "isCorrect": correct,
        "correctAnswer": q.get("correct"),
        "explanation": q.get("explanation"),
        "newLevel": attempt["current_level"],
        "nextQuestion": next_q,
        "xp": xp,
        "rank": rank,
        "nextRankXP": nextRankXP,
        "history": attempt["history"]
    })


# ===================================================
# END QUIZ  (FINAL FIXED LEADERBOARD)
# ===================================================

@app.post("/api/end")
def api_end():
    data = request.get_json() or {}
    attempt_id = data.get("attemptId")
    total_time = data.get("totalTime", 0)

    attempt = attempts.get(attempt_id)
    if not attempt:
        return jsonify({"error": "Invalid attempt"}), 404

    username = attempt["user"]

    attempt["completed"] = True
    attempt["total_time"] = total_time

    # =============== FIX: store leaderboard by USERNAME ===============
    leaderboard[username] = {
        "username": username,
        "score": attempt["score"],
        "mode": attempt["mode"],
        "time": total_time,
        "timestamp": time.time()
    }

    save_json(LEADERBOARD_FILE, leaderboard)
    save_json(ATTEMPTS_FILE, attempts)

    hist = attempt["history"]
    correct = sum(1 for h in hist if h["correct"])
    total = len(hist)
    acc = round((correct / total) * 100, 2) if total > 0 else 0

    return jsonify({
        "ok": True,
        "score": attempt["score"],
        "correct": correct,
        "totalQuestions": total,
        "accuracy": acc,
        "totalTime": total_time,
        "history": hist
    })


# ===================================================
# LEADERBOARD API
# ===================================================

@app.get("/api/leaderboard")
def api_leaderboard():
    if not leaderboard:
        return jsonify([])

    ranked = sorted(
        leaderboard.values(),
        key=lambda x: (-x["score"], x["time"])
    )

    return jsonify(ranked[:3])


# ===================================================
# USER INFO
# ===================================================

@app.get("/api/userinfo")
def api_userinfo():
    if "user" not in session:
        return jsonify({"error": "Not logged in"}), 401
    
    user = users.get(session["user"]) or {}
    xp = user.get("xp", 0)
    rank = user.get("rank", "Bronze")

    nextRankXP = {
        "Bronze": 300,
        "Silver": 700,
        "Gold": 1200,
        "Platinum": 1800,
        "Diamond": 2500
    }.get(rank, 100)

    return jsonify({"xp": xp, "rank": rank, "nextRankXP": nextRankXP})


if __name__ == "__main__":
    app.run(debug=True)
