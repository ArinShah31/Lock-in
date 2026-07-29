# Astra

AI-powered Academic Intelligence Platform (LMS) for colleges and universities.

## Structure

- `backend/` — FastAPI API (auth, institutions, classrooms, subjects)
- `frontend/` — React + Vite app branded **ASTRA**
- `lms - LMS Project Planning.pdf` — product PRD

## Quick start

### Backend

```bash
cd backend
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

API docs: http://127.0.0.1:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:5173

## Built so far

1. Authentication + RBAC
2. Institution Management
3. Classroom Management
4. Subject Management
5. Astra web frontend
