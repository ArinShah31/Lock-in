import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { requestGoogleIdToken } from "../auth/googleSignIn";
import { AuthComponent } from "../components/ui/sign-up";

export function RegisterPage() {
  const { user, register, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  async function handleRegister(data: {
    email: string;
    password: string;
    fullName?: string;
    role?: any;
  }) {
    setError(null);
    try {
      await register({
        full_name: data.fullName || "Student User",
        email: data.email,
        password: data.password,
        role: data.role || "STUDENT",
        institution_id: null,
        department_id: null,
      });
    } catch (err: any) {
      setError(err?.message || "Registration failed");
      throw err;
    }
  }

  async function handleGoogle() {
    setError(null);
    try {
      const idToken = await requestGoogleIdToken();
      await loginWithGoogle(idToken);
    } catch (err: any) {
      setError(err?.message || "Google Sign-In failed");
      throw err;
    }
  }

  return (
    <AuthComponent
      brandName="ASTRA Academic"
      mode="register"
      onSubmitAction={handleRegister}
      onGoogleAction={handleGoogle}
      onModeSwitch={() => navigate("/login")}
      externalError={error}
    />
  );
}
