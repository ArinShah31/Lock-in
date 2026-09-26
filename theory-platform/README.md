# Astra Theory Platform (standalone v1)

Separate coding assessment app inspired by Codex. Not wired into main ASTRA UI yet.

## Ports

- Backend: `http://127.0.0.1:8010`
- Frontend: `http://127.0.0.1:5181`

## Setup

### Backend

```bash
cd theory-platform/backend
general -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # then set GROQ_API_KEY
general scripts/seed.py
general -m uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload
```

### Frontend

```bash
cd theory-platform/frontend
npm install
npm run dev
```

## Demo accounts

| Role | Email | Password |
|------|-------|----------|
| Teacher | `teacher@example.com` | `DemoPass123` |
| Student | `student@example.com` | `DemoPass123` |

After seed, the teacher has a **Python Progressive Demo** test. Use its invite code on the student home page, or assign by email from the teacher Tests tab.

## Flow

1. Teacher creates questions (SYLLABUS / HIRING, subject, difficulty)
2. Teacher builds a test with exactly Easy + Medium + Hard
3. Assign student by email or share invite code
4. Student starts timed Monaco exam (Q1→Q2→Q3 unlock on save)
5. Strict proctoring (copy/cut/paste blocked; short grace; block at score ≥ 5)
6. Final submit shows **Your Test Is Successfully Submitted**
7. Teacher reviews attempts and clicks **Publish results**
