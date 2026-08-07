import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { requestGoogleIdToken } from "../auth/googleSignIn";
import { AuthComponent } from "../components/ui/sign-up";

export function LoginPage() {
  const { user, login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  async function handleLogin(data: { email: string; password: string }) {
    setError(null);
    try {
      await login(data.email, data.password);
    } catch (err: any) {
      setError(err?.message || "Invalid credentials");
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
      mode="login"
      onSubmitAction={handleLogin}
      onGoogleAction={handleGoogle}
      onModeSwitch={() => navigate("/register")}
      externalError={error}
    />
  );
}
