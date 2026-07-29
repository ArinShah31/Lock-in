# Astra LMS Backend

## Setup

1. Create and activate a virtual environment.
2. Install dependencies:
   - `pip install -r requirements.txt`
3. Copy `.env.example` to `.env` and adjust values.
4. Run the API:
   - `uvicorn app.main:app --reload`

## Implemented Modules

### Authentication & RBAC

- JWT access and refresh token flow.
- Password hashing with bcrypt.
- Role-based route guards for:
  - `SUPER_ADMIN`
  - `INSTITUTION_ADMIN`
  - `HOD`
  - `CLASS_TEACHER`
  - `SUBJECT_TEACHER`
  - `STUDENT`

### Institution Management

- Institution CRUD (soft delete via `is_active`) by `SUPER_ADMIN`.
- Department CRUD by `INSTITUTION_ADMIN` only (scoped to their own institution).
- Users linked via `institution_id` / `department_id`.
- Non-`SUPER_ADMIN` registration requires a valid active institution.

### Classroom Management

- Classroom CRUD scoped to institutions/departments.
- Class teacher owns and manages the classroom.
- Enroll/remove students.
- Assign/remove subject teachers.
- Classroom announcements.
- Role-aware listing (HOD / class teacher / subject teacher / student).

### Subject Management

- Subjects belong to a classroom and a subject teacher.
- Syllabus text / file URL upload.
- Course materials metadata (`NOTE`, `PDF`, etc.).
- Publish flag — students only see published subjects.
- Creating a subject auto-syncs `ClassroomTeacher` assignment.
- Subject teachers can edit only their own subjects.

## Key Endpoints

### Auth

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/me`

### Institutions

- `POST /api/v1/institutions`
- `GET /api/v1/institutions`
- `GET /api/v1/institutions/{id}`
- `PATCH /api/v1/institutions/{id}`
- `DELETE /api/v1/institutions/{id}`
- `POST /api/v1/institutions/{id}/departments`
- `GET /api/v1/institutions/{id}/departments`
- `PATCH /api/v1/departments/{id}`
- `DELETE /api/v1/departments/{id}`

### Classrooms

- `POST /api/v1/classrooms`
- `GET /api/v1/classrooms`
- `GET /api/v1/classrooms/{id}`
- `PATCH /api/v1/classrooms/{id}`
- `DELETE /api/v1/classrooms/{id}`
- `POST /api/v1/classrooms/{id}/students`
- `GET /api/v1/classrooms/{id}/students`
- `DELETE /api/v1/classrooms/{id}/students/{student_id}`
- `POST /api/v1/classrooms/{id}/teachers`
- `GET /api/v1/classrooms/{id}/teachers`
- `DELETE /api/v1/classrooms/{id}/teachers/{assignment_id}`
- `POST /api/v1/classrooms/{id}/announcements`
- `GET /api/v1/classrooms/{id}/announcements`

### Subjects

- `POST /api/v1/subjects`
- `GET /api/v1/subjects`
- `GET /api/v1/subjects/{id}`
- `PATCH /api/v1/subjects/{id}`
- `DELETE /api/v1/subjects/{id}`
- `GET /api/v1/classrooms/{id}/subjects`
- `PUT /api/v1/subjects/{id}/syllabus`
- `POST /api/v1/subjects/{id}/materials`
- `GET /api/v1/subjects/{id}/materials`
- `DELETE /api/v1/subjects/{id}/materials/{material_id}`

### RBAC Demo

- `GET /api/v1/rbac/admin-only`
- `GET /api/v1/rbac/faculty-only`
- `GET /api/v1/rbac/student-or-faculty`
