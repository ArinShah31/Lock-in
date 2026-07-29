from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class InstitutionCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    code: str = Field(min_length=2, max_length=50)
    address: str | None = Field(default=None, max_length=500)


class InstitutionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    code: str | None = Field(default=None, min_length=2, max_length=50)
    address: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class InstitutionOut(BaseModel):
    id: int
    name: str
    code: str
    address: str | None
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    code: str = Field(min_length=2, max_length=50)


class DepartmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    code: str | None = Field(default=None, min_length=2, max_length=50)
    is_active: bool | None = None


class DepartmentOut(BaseModel):
    id: int
    institution_id: int
    name: str
    code: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)
