import { cn } from "../../lib/utils";
import React, {
  useState,
  useRef,
  useEffect,
  Children,
} from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  ArrowRight,
  Mail,
  Eye,
  EyeOff,
  ArrowLeft,
  X,
  AlertCircle,
  PartyPopper,
  Loader,
  User as UserIcon,
} from "lucide-react";
import { AnimatePresence, motion, useInView, type Variants, type Transition } from "framer-motion";
// --- TEXT LOOP ANIMATION COMPONENT ---
type TextLoopProps = {
  children: React.ReactNode[];
  className?: string;
  interval?: number;
  transition?: Transition;
  variants?: Variants;
  onIndexChange?: (index: number) => void;
  stopOnEnd?: boolean;
};
export function TextLoop({
  children,
  className,
  interval = 2,
  transition = { duration: 0.3 },
  variants,
  onIndexChange,
  stopOnEnd = false,
}: TextLoopProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const items = Children.toArray(children);
  useEffect(() => {
    const intervalMs = interval * 1000;
    const timer = setInterval(() => {
      setCurrentIndex((current) => {
        if (stopOnEnd && current === items.length - 1) {
          clearInterval(timer);
          return current;
        }
        const next = (current + 1) % items.length;
        onIndexChange?.(next);
        return next;
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [items.length, interval, onIndexChange, stopOnEnd]);
  const motionVariants: Variants = {
    initial: { y: 20, opacity: 0 },
    animate: { y: 0, opacity: 1 },
    exit: { y: -20, opacity: 0 },
  };
  return (
    <div className={cn("relative inline-block whitespace-nowrap", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={currentIndex}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={transition}
          variants={variants || motionVariants}
        >
          {items[currentIndex]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// --- BUILT-IN BLUR FADE ANIMATION COMPONENT ---
interface BlurFadeProps {
  children: React.ReactNode;
  className?: string;
  variant?: { hidden: { y: number }; visible: { y: number } };
  duration?: number;
  delay?: number;
  yOffset?: number;
  inView?: boolean;
  inViewMargin?: string;
  blur?: string;
}
function BlurFade({
  children,
  className,
  variant,
  duration = 0.2,
  delay = 0,
  yOffset = 5,
  inView = true,
  inViewMargin = "-50px",
  blur = "4px",
}: BlurFadeProps) {
  const ref = useRef(null);
  const inViewResult = useInView(ref, { once: true, margin: inViewMargin as any });
  const isInView = !inView || inViewResult;
  const defaultVariants: Variants = {
    hidden: { y: yOffset, opacity: 0, filter: `blur(${blur})` },
    visible: { y: -yOffset, opacity: 1, filter: `blur(0px)` },
  };
  const combinedVariants = variant || defaultVariants;
  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      exit="hidden"
      variants={combinedVariants}
      transition={{ delay, duration, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// --- BUILT-IN GLASS BUTTON COMPONENT (FIXED SHADOW GEOMETRY & TYPOGRAPHY) ---
const glassButtonVariants = cva(
  "relative isolate all-unset cursor-pointer rounded-full transition-all w-full flex items-center justify-center",
  {
    variants: {
      size: {
        default: "text-base font-semibold",
        sm: "text-base font-semibold",
        lg: "text-lg font-bold",
        icon: "h-11 w-11 flex-shrink-0",
      },
    },
    defaultVariants: { size: "default" },
  },
);
const glassButtonTextVariants = cva(
  "glass-button-text relative block select-none tracking-tight w-full text-center",
  {
    variants: {
      size: {
        default: "px-6 py-3.5",
        sm: "px-5 py-3",
        lg: "px-8 py-4",
        icon: "flex h-11 w-11 items-center justify-center",
      },
    },
    defaultVariants: { size: "default" },
  },
);
export interface GlassButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof glassButtonVariants> {
  contentClassName?: string;
}
const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className, children, size, contentClassName, onClick, ...props }, ref) => {
    const handleWrapperClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const button = e.currentTarget.querySelector("button");
      if (button && e.target !== button) button.click();
    };
    return (
      <div
        className={cn("glass-button-wrap cursor-pointer rounded-full relative w-full", className)}
        onClick={handleWrapperClick}
      >
        <button
          className={cn("glass-button relative z-10 w-full flex items-center justify-center", glassButtonVariants({ size }))}
          ref={ref}
          onClick={onClick}
          {...props}
        >
          <span className={cn(glassButtonTextVariants({ size }), "w-full flex items-center justify-center gap-2", contentClassName)}>{children}</span>
        </button>
        <div className="glass-button-shadow rounded-full pointer-events-none"></div>
      </div>
    );
  },
);
GlassButton.displayName = "GlassButton";

// --- THEME-AWARE SVG GRADIENT BACKGROUND (Royal Academic Navy, Imperial Sapphire & Regal Gold) ---
const GradientBackground = () => (
  <>
    <style>
      {` @keyframes float1 { 0% { transform: translate(0, 0); } 50% { transform: translate(-12px, 12px); } 100% { transform: translate(0, 0); } } @keyframes float2 { 0% { transform: translate(0, 0); } 50% { transform: translate(12px, -12px); } 100% { transform: translate(0, 0); } } `}
    </style>
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 800 600"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-90"
    >
      <defs>
        <linearGradient id="rev_grad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#031635", stopOpacity: 0.85 }} />
          <stop offset="50%" style={{ stopColor: "#1e3a8a", stopOpacity: 0.65 }} />
          <stop offset="100%" style={{ stopColor: "#0f1c3f", stopOpacity: 0.45 }} />
        </linearGradient>

        <linearGradient id="rev_grad2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#fbbf24", stopOpacity: 0.85 }} />
          <stop offset="45%" style={{ stopColor: "#d4af37", stopOpacity: 0.7 }} />
          <stop offset="85%" style={{ stopColor: "#b45309", stopOpacity: 0.55 }} />
          <stop offset="100%" style={{ stopColor: "#f59e0b", stopOpacity: 0.4 }} />
        </linearGradient>

        <radialGradient id="rev_grad3" cx="50%" cy="50%" r="50%">
          <stop offset="0%" style={{ stopColor: "#f59e0b", stopOpacity: 0.75 }} />
          <stop offset="70%" style={{ stopColor: "#d4af37", stopOpacity: 0.35 }} />
          <stop offset="100%" style={{ stopColor: "#fef08a", stopOpacity: 0.1 }} />
        </radialGradient>

        <filter id="rev_blur1" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="42" />
        </filter>
        <filter id="rev_blur2" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="32" />
        </filter>
        <filter id="rev_blur3" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="48" />
        </filter>
      </defs>

      <g style={{ animation: "float1 22s ease-in-out infinite", willChange: "transform", transform: "translate3d(0,0,0)" }}>
        <ellipse
          cx="140"
          cy="490"
          rx="270"
          ry="200"
          fill="url(#rev_grad1)"
          filter="url(#rev_blur1)"
          transform="rotate(-25 140 490)"
        />
        <rect
          x="470"
          y="50"
          width="350"
          height="290"
          rx="110"
          fill="url(#rev_grad2)"
          filter="url(#rev_blur2)"
          transform="rotate(16 645 195)"
        />
      </g>
      <g style={{ animation: "float2 26s ease-in-out infinite", willChange: "transform", transform: "translate3d(0,0,0)" }}>
        <circle cx="690" cy="410" r="180" fill="url(#rev_grad3)" filter="url(#rev_blur3)" opacity="0.75" />
        <ellipse cx="90" cy="170" rx="195" ry="135" fill="#1d4ed8" filter="url(#rev_blur2)" opacity="0.45" />
      </g>
    </svg>
  </>
);

// --- SOCIAL ICONS ---
const GoogleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" className="w-5 h-5 flex-shrink-0">
    <g fillRule="evenodd" fill="none">
      <g fillRule="nonzero" transform="translate(3, 2)">
        <path
          fill="#4285F4"
          d="M57.8123233,30.1515267 C57.8123233,27.7263183 57.6155321,25.9565533 57.1896408,24.1212666 L29.4960833,24.1212666 L29.4960833,35.0674653 L45.7515771,35.0674653 C45.4239683,37.7877475 43.6542033,41.8844383 39.7213169,44.6372555 L39.6661883,45.0037254 L48.4223791,51.7870338 L49.0290201,51.8475849 C54.6004021,46.7020943 57.8123233,39.1313952 57.8123233,30.1515267"
        ></path>
        <path
          fill="#34A853"
          d="M29.4960833,58.9921667 C37.4599129,58.9921667 44.1456164,56.3701671 49.0290201,51.8475849 L39.7213169,44.6372555 C37.2305867,46.3742596 33.887622,47.5868638 29.4960833,47.5868638 C21.6960582,47.5868638 15.0758763,42.4415991 12.7159637,35.3297782 L12.3700541,35.3591501 L3.26524241,42.4054492 L3.14617358,42.736447 C7.9965904,52.3717589 17.959737,58.9921667 29.4960833,58.9921667"
        ></path>
        <path
          fill="#FBBC05"
          d="M12.7159637,35.3297782 C12.0932812,33.4944915 11.7329116,31.5279353 11.7329116,29.4960833 C11.7329116,27.4640054 12.0932812,25.4976752 12.6832029,23.6623884 L12.6667095,23.2715173 L3.44779955,16.1120237 L3.14617358,16.2554937 C1.14708246,20.2539019 0,24.7439491 0,29.4960833 C0,34.2482175 1.14708246,38.7380388 3.14617358,42.736447 L12.7159637,35.3297782"
        ></path>
        <path
          fill="#EB4335"
          d="M29.4960833,11.4050769 C35.0347044,11.4050769 38.7707997,13.7975244 40.9011602,15.7968415 L49.2255853,7.66898166 C44.1130815,2.91684746 37.4599129,0 29.4960833,0 C17.959737,0 7.9965904,6.62018183 3.14617358,16.2554937 L12.6832029,23.6623884 C15.0758763,16.5505675 21.6960582,11.4050769 29.4960833,11.4050769"
        ></path>
      </g>
    </g>
  </svg>
);

const GitHubIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" className="w-5 h-5 flex-shrink-0">
    <path
      fill="currentColor"
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
    />
  </svg>
);

const modalSteps = [
  { message: "Verifying credentials...", icon: <Loader className="w-12 h-12 text-[#1e293b] animate-spin" /> },
  { message: "Authenticating session...", icon: <Loader className="w-12 h-12 text-[#1e293b] animate-spin" /> },
  { message: "Connecting to ASTRA LMS...", icon: <Loader className="w-12 h-12 text-[#1e293b] animate-spin" /> },
  { message: "Welcome to ASTRA!", icon: <PartyPopper className="w-12 h-12 text-emerald-600" /> },
];
const TEXT_LOOP_INTERVAL = 1.2;

const DefaultLogo = () => (
  <div className="bg-[#031635] text-[#fbbf24] border border-[#d4af37]/40 rounded-xl p-2.5 flex items-center justify-center shadow-md">
    <svg
      className="h-5 w-5"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  </div>
);

export interface AuthComponentProps {
  logo?: React.ReactNode;
  brandName?: string;
  mode?: "login" | "register";
  onSubmitAction: (data: {
    email: string;
    password: string;
    fullName?: string;
    role?: "STUDENT" | "CLASS_TEACHER" | "SUBJECT_TEACHER" | "HOD" | "INSTITUTION_ADMIN" | "SUPER_ADMIN";
  }) => Promise<void>;
  onModeSwitch?: () => void;
  externalError?: string | null;
  isLoading?: boolean;
}

export const AuthComponent = ({
  logo = <DefaultLogo />,
  brandName = "MyWebApp",
  mode = "login",
  onSubmitAction,
  onModeSwitch,
  externalError,
  isLoading = false,
}: AuthComponentProps) => {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<"STUDENT" | "CLASS_TEACHER" | "SUBJECT_TEACHER" | "HOD" | "INSTITUTION_ADMIN" | "SUPER_ADMIN">("STUDENT");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [authStep, setAuthStep] = useState<"fullName" | "email" | "password" | "confirmPassword">("email");
  const [modalStatus, setModalStatus] = useState<"closed" | "loading" | "error" | "success">("closed");
  const [modalErrorMessage, setModalErrorMessage] = useState("");

  useEffect(() => {
    if (isLoading) {
      setModalStatus("loading");
    }
  }, [isLoading]);

  useEffect(() => {
    if (mode === "register") {
      setAuthStep("fullName");
    } else {
      setAuthStep("email");
    }
  }, [mode]);

  useEffect(() => {
    if (externalError) {
      setModalErrorMessage(externalError);
      setModalStatus("error");
    }
  }, [externalError]);

  const isFullNameValid = fullName.trim().length >= 2;
  const isEmailValid = /\S+@\S+\.\S+/.test(email);
  const isPasswordValid = password.length >= 6;
  const isConfirmPasswordValid = confirmPassword.length >= 6;

  const fullNameInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const confirmPasswordInputRef = useRef<HTMLInputElement>(null);

  const fireSideCanons = async () => {
    try {
      const confettiModule = await import("canvas-confetti");
      const confetti = confettiModule.default || confettiModule;
      const canvas = document.createElement("canvas");
      canvas.className = "fixed top-0 left-0 w-full h-full pointer-events-none z-[999]";
      document.body.appendChild(canvas);
      const myConfetti = confetti.create(canvas, { resize: true, useWorker: true });
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };
      const particleCount = 50;
      myConfetti({ ...defaults, particleCount, origin: { x: 0, y: 1 }, angle: 60 });
      myConfetti({ ...defaults, particleCount, origin: { x: 1, y: 1 }, angle: 120 });
      setTimeout(() => {
        try {
          if (document.body.contains(canvas)) {
            document.body.removeChild(canvas);
          }
        } catch {}
      }, 3500);
    } catch (e) {
      console.warn("Confetti dynamic load warning", e);
    }
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === "register" && password !== confirmPassword) {
      setModalErrorMessage("Passwords do not match!");
      setModalStatus("error");
      return;
    }

    setModalStatus("loading");
    try {
      await onSubmitAction({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        role,
      });
      fireSideCanons();
      setModalStatus("success");
    } catch (err: any) {
      setModalErrorMessage(err?.message || "Authentication failed");
      setModalStatus("error");
    }
  };

  const handleProgressStep = () => {
    if (mode === "register") {
      if (authStep === "fullName" && isFullNameValid) setAuthStep("email");
      else if (authStep === "email" && isEmailValid) setAuthStep("password");
      else if (authStep === "password" && isPasswordValid) setAuthStep("confirmPassword");
    } else {
      if (authStep === "email" && isEmailValid) setAuthStep("password");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (
        (mode === "login" && authStep === "password") ||
        (mode === "register" && authStep === "confirmPassword")
      ) {
        handleFinalSubmit(e);
      } else {
        handleProgressStep();
      }
    }
  };

  const handleGoBack = () => {
    if (mode === "register") {
      if (authStep === "confirmPassword") setAuthStep("password");
      else if (authStep === "password") setAuthStep("email");
      else if (authStep === "email") setAuthStep("fullName");
    } else {
      if (authStep === "password") setAuthStep("email");
    }
  };

  const closeModal = () => {
    setModalStatus("closed");
    setModalErrorMessage("");
  };

  useEffect(() => {
    if (authStep === "password") setTimeout(() => passwordInputRef.current?.focus(), 80);
    else if (authStep === "confirmPassword") setTimeout(() => confirmPasswordInputRef.current?.focus(), 80);
    else if (authStep === "fullName") setTimeout(() => fullNameInputRef.current?.focus(), 80);
  }, [authStep]);

  const Modal = () => (
    <AnimatePresence>
      {modalStatus !== "closed" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative bg-white/90 border border-white/80 backdrop-blur-xl rounded-2xl p-8 w-full max-w-sm flex flex-col items-center gap-4 mx-3 shadow-2xl"
          >
            {(modalStatus === "error" || modalStatus === "success") && (
              <button
                onClick={closeModal}
                className="absolute top-3 right-3 p-1 text-slate-400 hover:text-slate-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
            {modalStatus === "error" && (
              <>
                <AlertCircle className="w-12 h-12 text-red-500" />
                <p className="text-sm font-semibold text-slate-800 text-center">{modalErrorMessage}</p>
                <GlassButton onClick={closeModal} size="sm" className="mt-2">
                  Try Again
                </GlassButton>
              </>
            )}
            {modalStatus === "loading" && (
              <TextLoop interval={TEXT_LOOP_INTERVAL} stopOnEnd={true}>
                {modalSteps.slice(0, -1).map((step, i) => (
                  <div key={i} className="flex flex-col items-center gap-3">
                    {step.icon}
                    <p className="text-base font-semibold text-slate-800">{step.message}</p>
                  </div>
                ))}
              </TextLoop>
            )}
            {modalStatus === "success" && (
              <div className="flex flex-col items-center gap-3">
                {modalSteps[modalSteps.length - 1].icon}
                <p className="text-base font-semibold text-slate-800">
                  {modalSteps[modalSteps.length - 1].message}
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="bg-[#fafafa] min-h-screen w-screen flex flex-col font-sans overflow-hidden">
      <style>{`
        input[type="password"]::-ms-reveal, input[type="password"]::-ms-clear { display: none !important; } 
        input[type="password"]::-webkit-credentials-auto-fill-button, input[type="password"]::-webkit-strong-password-auto-fill-button { display: none !important; } 
        input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus, input:-webkit-autofill:active { -webkit-box-shadow: 0 0 0 30px transparent inset !important; -webkit-text-fill-color: #0f172a !important; background-color: transparent !important; background-clip: content-box !important; transition: background-color 5000s ease-in-out 0s !important; color: #0f172a !important; caret-color: #0f172a !important; } 
        input:autofill { background-color: transparent !important; background-clip: content-box !important; -webkit-text-fill-color: #0f172a !important; color: #0f172a !important; } 
        input:-internal-autofill-selected { background-color: transparent !important; background-image: none !important; color: #0f172a !important; -webkit-text-fill-color: #0f172a !important; } 
        input:-webkit-autofill::first-line { color: #0f172a !important; -webkit-text-fill-color: #0f172a !important; }
        
        @property --angle-1 { syntax: "<angle>"; inherits: false; initial-value: -75deg; } 
        @property --angle-2 { syntax: "<angle>"; inherits: false; initial-value: -45deg; }
        
        .glass-button-wrap { --anim-time: 400ms; --anim-ease: cubic-bezier(0.25, 1, 0.5, 1); --border-width: clamp(1px, 0.0625em, 4px); position: relative; z-index: 2; transform-style: preserve-3d; transition: transform var(--anim-time) var(--anim-ease); will-change: transform; transform: translateZ(0); backface-visibility: hidden; } 
        .glass-button-wrap:has(.glass-button:active) { transform: rotateX(20deg); } 
        .glass-button-shadow { position: absolute; inset: 0; width: 100%; height: 100%; filter: blur(6px); transition: filter var(--anim-time) var(--anim-ease); pointer-events: none; z-index: 0; border-radius: 9999px; } 
        .glass-button-shadow::after { content: ""; position: absolute; inset: 0; border-radius: 9999px; background: linear-gradient(180deg, rgba(15, 23, 42, 0.1), rgba(15, 23, 42, 0.03)); width: 100%; height: 100%; top: 2px; left: 0; transition: all var(--anim-time) var(--anim-ease); opacity: 0.6; }
        .glass-button { -webkit-tap-highlight-color: transparent; backdrop-filter: blur(clamp(1px, 0.125em, 4px)); transition: all var(--anim-time) var(--anim-ease); background: linear-gradient(-75deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.15)); box-shadow: inset 0 0.125em 0.125em rgba(15, 23, 42, 0.06), inset 0 -0.125em 0.125em rgba(255, 255, 255, 0.6), 0 0.25em 0.125em -0.125em rgba(15, 23, 42, 0.15), 0 0 0.1em 0.25em inset rgba(255, 255, 255, 0.3); will-change: transform, opacity; transform: translateZ(0); backface-visibility: hidden; } 
        .glass-button:hover { transform: scale(0.98); backdrop-filter: blur(0.01em); box-shadow: inset 0 0.125em 0.125em rgba(15, 23, 42, 0.08), inset 0 -0.125em 0.125em rgba(255, 255, 255, 0.7), 0 0.15em 0.05em -0.1em rgba(15, 23, 42, 0.2), 0 0 0.05em 0.1em inset rgba(255, 255, 255, 0.5); } 
        .glass-button-text { color: rgba(15, 23, 42, 0.95); text-shadow: 0em 0.15em 0.05em rgba(15, 23, 42, 0.08); transition: all var(--anim-time) var(--anim-ease); } 
        .glass-button:hover .glass-button-text { text-shadow: 0.025em 0.025em 0.025em rgba(15, 23, 42, 0.1); } 
        .glass-button-text::after { content: ""; display: block; position: absolute; width: calc(100% - var(--border-width)); height: calc(100% - var(--border-width)); top: calc(0% + var(--border-width) / 2); left: calc(0% + var(--border-width) / 2); box-sizing: border-box; border-radius: 9999px; overflow: clip; background: linear-gradient(var(--angle-2), transparent 0%, rgba(255, 255, 255, 0.5) 40% 50%, transparent 55%); z-index: 3; mix-blend-mode: screen; pointer-events: none; background-size: 200% 200%; background-position: 0% 50%; transition: background-position calc(var(--anim-time) * 1.25) var(--anim-ease), --angle-2 calc(var(--anim-time) * 1.25) var(--anim-ease); } 
        .glass-button:hover .glass-button-text::after { background-position: 25% 50%; } 
        .glass-button:active .glass-button-text::after { background-position: 50% 15%; --angle-2: -15deg; } 
        .glass-button::after { content: ""; position: absolute; z-index: 1; inset: 0; border-radius: 9999px; width: calc(100% + var(--border-width)); height: calc(100% + var(--border-width)); top: calc(0% - var(--border-width) / 2); left: calc(0% - var(--border-width) / 2); padding: var(--border-width); box-sizing: border-box; background: conic-gradient(from var(--angle-1) at 50% 50%, rgba(15, 23, 42, 0.4) 0%, transparent 5% 40%, rgba(15, 23, 42, 0.4) 50%, transparent 60% 95%, rgba(15, 23, 42, 0.4) 100%), linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.5)); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; transition: all var(--anim-time) var(--anim-ease), --angle-1 500ms ease; box-shadow: inset 0 0 0 calc(var(--border-width) / 2) rgba(255, 255, 255, 0.5); pointer-events: none; } 
        .glass-button:hover::after { --angle-1: -125deg; } 
        .glass-button:active::after { --angle-1: -75deg; } 
        .glass-button-wrap:has(.glass-button:hover) .glass-button-shadow::after { opacity: 0.8; } 
        
        .glass-input-wrap { position: relative; z-index: 2; transform-style: preserve-3d; border-radius: 9999px; width: 100%; will-change: transform; transform: translateZ(0); backface-visibility: hidden; } 
        .glass-input { display: flex; position: relative; width: 100%; align-items: center; gap: 0.5rem; border-radius: 9999px; padding: 0.35rem 0.5rem; -webkit-tap-highlight-color: transparent; backdrop-filter: blur(clamp(1px, 0.125em, 4px)); transition: all 400ms cubic-bezier(0.25, 1, 0.5, 1); background: linear-gradient(-75deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.1)); box-shadow: inset 0 0.125em 0.125em rgba(15, 23, 42, 0.05), inset 0 -0.125em 0.125em rgba(255, 255, 255, 0.5), 0 0.25em 0.125em -0.125em rgba(15, 23, 42, 0.15), 0 0 0.1em 0.25em inset rgba(255, 255, 255, 0.2); will-change: transform, opacity; transform: translateZ(0); backface-visibility: hidden; } 
        .glass-input-wrap:focus-within .glass-input { backdrop-filter: blur(0.01em); box-shadow: inset 0 0.125em 0.125em rgba(15, 23, 42, 0.05), inset 0 -0.125em 0.125em rgba(255, 255, 255, 0.5), 0 0.15em 0.05em -0.1em rgba(15, 23, 42, 0.2), 0 0 0.05em 0.1em inset rgba(255, 255, 255, 0.5); } 
        .glass-input::after { content: ""; position: absolute; z-index: 1; inset: 0; border-radius: 9999px; width: calc(100% + clamp(1px, 0.0625em, 4px)); height: calc(100% + clamp(1px, 0.0625em, 4px)); top: calc(0% - clamp(1px, 0.0625em, 4px) / 2); left: calc(0% - clamp(1px, 0.0625em, 4px) / 2); padding: clamp(1px, 0.0625em, 4px); box-sizing: border-box; background: conic-gradient(from var(--angle-1) at 50% 50%, rgba(15, 23, 42, 0.4) 0%, transparent 5% 40%, rgba(15, 23, 42, 0.4) 50%, transparent 60% 95%, rgba(15, 23, 42, 0.4) 100%), linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.5)); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; transition: all 400ms cubic-bezier(0.25, 1, 0.5, 1), --angle-1 500ms ease; box-shadow: inset 0 0 0 calc(clamp(1px, 0.0625em, 4px) / 2) rgba(255, 255, 255, 0.5); pointer-events: none; } 
        .glass-input-wrap:focus-within .glass-input::after { --angle-1: -125deg; } 
        .glass-input-text-area { position: absolute; inset: 0; border-radius: 9999px; pointer-events: none; } 
        .glass-input-text-area::after { content: ""; display: block; position: absolute; width: calc(100% - clamp(1px, 0.0625em, 4px)); height: calc(100% - clamp(1px, 0.0625em, 4px)); top: calc(0% + clamp(1px, 0.0625em, 4px) / 2); left: calc(0% + clamp(1px, 0.0625em, 4px) / 2); box-sizing: border-box; border-radius: 9999px; overflow: clip; background: linear-gradient(var(--angle-2), transparent 0%, rgba(255, 255, 255, 0.5) 40% 50%, transparent 55%); z-index: 3; mix-blend-mode: screen; pointer-events: none; background-size: 200% 200%; background-position: 0% 50%; transition: background-position calc(400ms * 1.25) cubic-bezier(0.25, 1, 0.5, 1), --angle-2 calc(400ms * 1.25) cubic-bezier(0.25, 1, 0.5, 1); } 
        .glass-input-wrap:focus-within .glass-input-text-area::after { background-position: 25% 50%; }
      `}</style>

      <Modal />

      {/* Brand Header (Centered at Top) */}
      <div className="fixed top-8 left-1/2 -translate-x-1/2 z-20 flex items-center justify-center gap-3">
        {logo}
        <h1 className="text-lg font-extrabold text-slate-900 tracking-tight">{brandName}</h1>
      </div>

      {/* Main Content Area */}
      <div className="flex w-full flex-1 min-h-screen items-center justify-center relative overflow-hidden bg-[#fafafa]">
        <div className="absolute inset-0 z-0">
          <GradientBackground />
        </div>

        <fieldset disabled={modalStatus !== "closed"} className="relative z-10 flex flex-col items-center gap-7 w-[380px] mx-auto p-4">
          <AnimatePresence mode="wait">
            {authStep === "email" && (
              <motion.div
                key="email-header"
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="w-full flex flex-col items-center gap-4 text-center"
              >
                <BlurFade delay={0.1} className="w-full">
                  <div className="text-center">
                    <p className="font-serif font-normal text-4xl sm:text-5xl md:text-5xl tracking-tight text-slate-900 whitespace-nowrap">
                      {mode === "login" ? "Welcome back" : "Get started with Us"}
                    </p>
                  </div>
                </BlurFade>

                <BlurFade delay={0.25 * 2}>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-600">
                    Continue with
                  </p>
                </BlurFade>

                {/* Social Login Buttons */}
                <BlurFade delay={0.25 * 3} className="w-full">
                  <div className="flex items-center justify-center gap-3 w-full">
                    <GlassButton contentClassName="flex items-center justify-center gap-2 text-base font-semibold" size="sm">
                      <GoogleIcon />
                      <span className="font-bold text-slate-800 text-sm">Google</span>
                    </GlassButton>
                    <GlassButton contentClassName="flex items-center justify-center gap-2 text-base font-semibold" size="sm">
                      <GitHubIcon />
                      <span className="font-bold text-slate-800 text-sm">GitHub</span>
                    </GlassButton>
                  </div>
                </BlurFade>

                {/* OR Divider */}
                <BlurFade delay={0.25 * 4} className="w-[300px]">
                  <div className="flex items-center w-full gap-3 py-1">
                    <hr className="w-full border-slate-300/80" />
                    <span className="text-xs font-extrabold text-slate-500">OR</span>
                    <hr className="w-full border-slate-300/80" />
                  </div>
                </BlurFade>
              </motion.div>
            )}

            {authStep === "fullName" && (
              <motion.div
                key="fullname-header"
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="w-full flex flex-col items-center text-center gap-2"
              >
                <BlurFade delay={0} className="w-full">
                  <div className="text-center">
                    <p className="font-serif font-normal text-4xl sm:text-5xl tracking-tight text-slate-900 whitespace-nowrap">
                      Get started with Us
                    </p>
                  </div>
                </BlurFade>
                <BlurFade delay={0.1}>
                  <p className="text-sm font-semibold text-slate-600">
                    Enter your details to create an account
                  </p>
                </BlurFade>
              </motion.div>
            )}

            {authStep === "password" && (
              <motion.div
                key="password-header"
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="w-full flex flex-col items-center text-center gap-2"
              >
                <BlurFade delay={0} className="w-full">
                  <div className="text-center">
                    <p className="font-serif font-normal text-4xl sm:text-5xl tracking-tight text-slate-900 whitespace-nowrap">
                      {mode === "login" ? "Enter your password" : "Create password"}
                    </p>
                  </div>
                </BlurFade>
                <BlurFade delay={0.1}>
                  <p className="text-sm font-semibold text-slate-600">
                    Must be at least 6 characters long
                  </p>
                </BlurFade>
              </motion.div>
            )}

            {authStep === "confirmPassword" && (
              <motion.div
                key="confirm-header"
                initial={{ y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="w-full flex flex-col items-center text-center gap-2"
              >
                <BlurFade delay={0} className="w-full">
                  <div className="text-center">
                    <p className="font-serif font-normal text-4xl sm:text-5xl tracking-tight text-slate-900 whitespace-nowrap">
                      One Last Step
                    </p>
                  </div>
                </BlurFade>
                <BlurFade delay={0.1}>
                  <p className="text-sm font-semibold text-slate-600">
                    Confirm password to finish registration
                  </p>
                </BlurFade>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form Fields */}
          <form onSubmit={handleFinalSubmit} className="w-full space-y-4">
            {/* Step: FullName */}
            {mode === "register" && authStep === "fullName" && (
              <BlurFade key="fullname-field" className="w-full space-y-4">
                <div className="relative w-full">
                  <div className="glass-input-wrap w-full">
                    <div className="glass-input">
                      <span className="glass-input-text-area"></span>
                      <div className="relative z-10 flex-shrink-0 flex items-center justify-center w-11 pl-2">
                        <UserIcon className="h-5 w-5 text-slate-700 flex-shrink-0" />
                      </div>
                      <input
                        ref={fullNameInputRef}
                        type="text"
                        placeholder="Full Name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="relative z-10 h-12 w-full bg-transparent text-slate-900 placeholder:text-slate-500 px-2 text-base focus:outline-none font-semibold"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="glass-input-wrap w-full">
                  <div className="glass-input px-3">
                    <span className="glass-input-text-area"></span>
                    <label className="relative z-10 text-sm font-bold text-slate-700 mr-2">Role:</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as any)}
                      className="relative z-10 bg-transparent text-slate-900 text-sm font-bold focus:outline-none w-full py-2.5 cursor-pointer"
                    >
                      <option value="STUDENT">Student</option>
                      <option value="CLASS_TEACHER">Class Teacher</option>
                      <option value="SUBJECT_TEACHER">Subject Teacher</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <GlassButton
                    type="button"
                    onClick={handleProgressStep}
                    disabled={!isFullNameValid}
                    size="sm"
                    className="w-full flex items-center justify-center gap-2"
                  >
                    <span className="text-base font-bold">Next: Email</span>
                    <ArrowRight className="w-5 h-5 text-slate-800" />
                  </GlassButton>
                </div>
              </BlurFade>
            )}

            {/* Step: Email */}
            {authStep === "email" && (
              <BlurFade key="email-field" className="w-full space-y-4">
                <div className="relative w-full">
                  <div className="glass-input-wrap w-full">
                    <div className="glass-input">
                      <span className="glass-input-text-area"></span>
                      <div className="relative z-10 flex-shrink-0 flex items-center justify-center w-11 pl-2">
                        <Mail className="h-5 w-5 text-slate-700 flex-shrink-0" />
                      </div>
                      <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="relative z-10 h-12 w-full bg-transparent text-slate-900 placeholder:text-slate-500 px-2 text-base focus:outline-none font-semibold"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-1">
                  <GlassButton
                    type="button"
                    onClick={handleProgressStep}
                    disabled={!isEmailValid}
                    size="sm"
                    className="w-full flex items-center justify-center gap-2"
                  >
                    <span className="text-base font-bold">Continue to Password</span>
                    <ArrowRight className="w-5 h-5 text-slate-800" />
                  </GlassButton>

                  {mode === "register" && (
                    <button
                      type="button"
                      onClick={handleGoBack}
                      className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 pt-1 justify-center"
                    >
                      <ArrowLeft className="w-4 h-4" /> Back to Name
                    </button>
                  )}
                </div>
              </BlurFade>
            )}

            {/* Step: Password */}
            {authStep === "password" && (
              <BlurFade key="password-field" className="w-full space-y-4">
                <div className="relative w-full">
                  <div className="glass-input-wrap w-full">
                    <div className="glass-input">
                      <span className="glass-input-text-area"></span>
                      <div className="relative z-10 flex-shrink-0 flex items-center justify-center w-11 pl-2">
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="text-slate-700 hover:text-slate-900"
                        >
                          {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                      <input
                        ref={passwordInputRef}
                        type={showPassword ? "text" : "password"}
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="relative z-10 h-12 w-full bg-transparent text-slate-900 placeholder:text-slate-500 px-2 text-base focus:outline-none font-semibold"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-1">
                  {mode === "login" ? (
                    <GlassButton
                      type="button"
                      onClick={handleFinalSubmit}
                      disabled={!isPasswordValid}
                      size="sm"
                      className="w-full flex items-center justify-center gap-2"
                    >
                      <span className="text-base font-bold">Sign In</span>
                      <ArrowRight className="w-5 h-5 text-slate-800" />
                    </GlassButton>
                  ) : (
                    <GlassButton
                      type="button"
                      onClick={handleProgressStep}
                      disabled={!isPasswordValid}
                      size="sm"
                      className="w-full flex items-center justify-center gap-2"
                    >
                      <span className="text-base font-bold">Next: Confirm Password</span>
                      <ArrowRight className="w-5 h-5 text-slate-800" />
                    </GlassButton>
                  )}

                  <button
                    type="button"
                    onClick={handleGoBack}
                    className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 pt-1 justify-center"
                  >
                    <ArrowLeft className="w-4 h-4" /> Back to Email
                  </button>
                </div>
              </BlurFade>
            )}

            {/* Step: Confirm Password */}
            {mode === "register" && authStep === "confirmPassword" && (
              <BlurFade key="confirm-field" className="w-full space-y-4">
                <div className="relative w-full">
                  <div className="glass-input-wrap w-full">
                    <div className="glass-input">
                      <span className="glass-input-text-area"></span>
                      <div className="relative z-10 flex-shrink-0 flex items-center justify-center w-11 pl-2">
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="text-slate-700 hover:text-slate-900"
                        >
                          {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                      <input
                        ref={confirmPasswordInputRef}
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="Confirm Password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="relative z-10 h-12 w-full bg-transparent text-slate-900 placeholder:text-slate-500 px-2 text-base focus:outline-none font-semibold"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-1">
                  <GlassButton type="button" onClick={handleFinalSubmit} disabled={!isConfirmPasswordValid} size="sm">
                    <span className="text-base font-bold">Complete Registration</span>
                    <ArrowRight className="w-5 h-5 text-slate-800" />
                  </GlassButton>

                  <button
                    type="button"
                    onClick={handleGoBack}
                    className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 pt-1 justify-center"
                  >
                    <ArrowLeft className="w-4 h-4" /> Back to Password
                  </button>
                </div>
              </BlurFade>
            )}
          </form>

          {/* Switch Mode Option (Login <-> Register) */}
          {onModeSwitch && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={onModeSwitch}
                className="text-sm font-bold text-slate-700 hover:text-slate-950 hover:underline transition-colors"
              >
                {mode === "login"
                  ? "Don't have an account? Sign up here"
                  : "Already have an account? Sign in here"}
              </button>
            </div>
          )}
        </fieldset>
      </div>
    </div>
  );
};
