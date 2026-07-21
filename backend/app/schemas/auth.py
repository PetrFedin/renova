from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    role: str = Field(pattern="^(customer|contractor)$")
    full_name: str | None = None
    inn: str | None = None


class UserOut(BaseModel):
    id: str
    phone: str
    role: str
    full_name: str | None
    inn: str | None
    npd_verified: bool
    moy_nalog_linked: bool = False
    profile_code: str | None = None
    # Выдаётся на login/register/demo/sms; /me может не включать
    access_token: str | None = None
    token_type: str | None = None


class DemoLoginRequest(BaseModel):
    role: str = Field(pattern="^(customer|contractor)$")


class SmsSendRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20)


class SmsVerifyRequest(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    code: str = Field(min_length=4, max_length=8)
    role: str = Field(pattern="^(customer|contractor)$")
    full_name: str | None = None
    inn: str | None = None
