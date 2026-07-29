# Astra Frontend

React + TypeScript UI for the Astra Academic Intelligence Platform.

## Stack

- React 19
- Vite
- Tailwind CSS v4
- TanStack Query
- React Router

## Run

1. Start the backend (`uvicorn app.main:app --reload` from `backend/`).
2. From `frontend/`:
   - `npm install`
   - `npm run dev`
3. Open http://localhost:5173

API calls proxy to `http://127.0.0.1:8000` during development.

## Pages

- `/login` / `/register` — authentication
- `/` — role-aware overview
- `/institutions` — institutions & departments
- `/classrooms` — classrooms, students, announcements
- `/subjects` — subjects, syllabus, materials
