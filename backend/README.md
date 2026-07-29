# Astra LMS Backend

## Setup

1. Create and activate a virtual environment.
2. Install dependencies:
   - `pip install -r requirements.txt`
3. Copy `.env.example` to `.env` and adjust values.
4. Run the API:
   - `uvicorn app.main:app --reload`

## Implemented Authentication & RBAC

- JWT access and refresh token flow.
- Password hashing with bcrypt.
- Role-based route guards for:
  - `SUPER_ADMIN`
  - `HOD`
  - `CLASS_TEACHER`
  - `SUBJECT_TEACHER`
  - `STUDENT`

## Key Endpoints

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/me`
- `GET /api/v1/rbac/admin-only`
- `GET /api/v1/rbac/faculty-only`
- `GET /api/v1/rbac/student-or-faculty`
